"""Informes de KDS (solo lectura) y marcas de tiempo del ciclo de preparación.

El ciclo de un detalle de orden de cocina queda registrado con cuatro marcas ISO
(nullables) en ``ordenes_detalles``:

* ``recibido_at``  — la comanda llegó a cocina.
* ``inicio_at``    — se empezó a preparar.
* ``listo_at``     — quedó listo.
* ``entregado_at`` — se entregó al mesero / cliente.

Reglas de negocio:

* Cada marca se fija **solo la primera vez** (``COALESCE(columna, ?)``), por lo que
  reintentar la misma transición es idempotente y ninguna marca retrocede.
* Las filas históricas se rellenan en la migración: ``inicio_at`` desde
  ``hora_inicio_preparacion``, ``listo_at`` desde ``hora_terminado`` y
  ``recibido_at`` desde ``transactions.date``.
* La "estación" de un detalle es ``area_id`` (área de producción que enrutó el
  ítem). Cuando no se conoce, se agrupa como ``SIN_ESTACION``.

Los endpoints son de solo lectura: reciben ``desde``, ``hasta`` y, opcionalmente,
``estacion``. Todo el agregado se hace en SQLite (AVG/MEDIANA/P90 con funciones de
ventana, GROUP BY por hora) para no cargar filas en memoria.
"""

from __future__ import annotations

import math
import sqlite3
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# Constantes del modelo
# ---------------------------------------------------------------------------

ESTADOS_COCINA = ("PENDIENTE", "EN_PREPARACION", "LISTO", "DEVUELTO", "ENTREGADO")
ESTADO_SIN_ESTACION = "SIN_ESTACION"

MARCAS = ("recibido_at", "inicio_at", "listo_at", "entregado_at")

#: Columnas que el servicio necesita tener en ``ordenes_detalles``. Se añaden con
#: ``ALTER TABLE ... ADD COLUMN`` solo cuando faltan (migración idempotente).
COLUMNAS_DETALLE: Tuple[Tuple[str, str], ...] = (
    ("cantidad", "REAL DEFAULT 1"),
    ("modificadores", "TEXT"),
    ("estado_cocina", "TEXT DEFAULT 'PENDIENTE'"),
    ("hora_inicio_preparacion", "TEXT"),
    ("hora_terminado", "TEXT"),
    ("area_id", "TEXT"),
    ("recibido_at", "TEXT"),
    ("inicio_at", "TEXT"),
    ("listo_at", "TEXT"),
    ("entregado_at", "TEXT"),
)

SIN_ESTACION_SQL = (
    "COALESCE(NULLIF(d.area_id, ''), '" + ESTADO_SIN_ESTACION + "')"
)
#: Momento en que la comanda entró a cocina: marca nueva o, si no existe, la
#: fecha de creación de la transacción (columna histórica).
RECIBIDO_SQL = "COALESCE(NULLIF(d.recibido_at, ''), t.date)"

SLA_POR_DEFECTO = 15.0
MAX_FILAS_RETRASOS = 100
HORAS_DEL_DIA = 24

_schema_listo = False


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------


def ahora_iso() -> str:
    """Marca de tiempo local en ISO 8601 (misma convención que el resto del KDS)."""
    return datetime.now().isoformat()


def _round(value: Any, digits: int = 2) -> Optional[float]:
    if value is None:
        return None
    try:
        return round(float(value), digits)
    except (TypeError, ValueError):
        return None


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone()
    return bool(row)


def _columns(conn: sqlite3.Connection, table: str) -> List[str]:
    if not _table_exists(conn, table):
        return []
    return [row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]


# ---------------------------------------------------------------------------
# Migración idempotente
# ---------------------------------------------------------------------------


def ensure_kds_schema(conn: sqlite3.Connection) -> Dict[str, List[str]]:
    """Crea la tabla y añade las columnas/marcas que falten.

    Devuelve ``{"columnas_agregadas": [...], "backfill": {...}}`` para que la
    migración pueda registrarse/loguearse. Llamarla dos veces no cambia nada.
    """
    agregadas: List[str] = []

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ordenes_detalles (
            id TEXT PRIMARY KEY,
            orden_id TEXT NOT NULL,
            producto_id TEXT NOT NULL DEFAULT '',
            nombre TEXT NOT NULL DEFAULT '',
            cantidad REAL DEFAULT 1,
            modificadores TEXT,
            estado_cocina TEXT DEFAULT 'PENDIENTE',
            hora_inicio_preparacion TEXT,
            hora_terminado TEXT,
            area_id TEXT,
            recibido_at TEXT,
            inicio_at TEXT,
            listo_at TEXT,
            entregado_at TEXT,
            FOREIGN KEY (orden_id) REFERENCES transactions(id)
        )
        """
    )

    existentes = set(_columns(conn, "ordenes_detalles"))
    for columna, definicion in COLUMNAS_DETALLE:
        if columna in existentes:
            continue
        conn.execute(f"ALTER TABLE ordenes_detalles ADD COLUMN {columna} {definicion}")
        agregadas.append(columna)

    for indice, columnas in (
        ("idx_ordenes_detalles_orden", ("orden_id",)),
        ("idx_ordenes_detalles_area", ("area_id",)),
        ("idx_ordenes_detalles_recibido", ("recibido_at",)),
        ("idx_ordenes_detalles_listo", ("listo_at",)),
    ):
        conn.execute(
            f"CREATE INDEX IF NOT EXISTS {indice} ON ordenes_detalles ({', '.join(columnas)})"
        )

    backfill = backfill_kds_timestamps(conn)
    conn.commit()
    return {"columnas_agregadas": agregadas, "backfill": backfill}


def backfill_kds_timestamps(conn: sqlite3.Connection) -> Dict[str, int]:
    """Rellena marcas de filas históricas sin sobrescribir las ya puestas."""
    resultado: Dict[str, int] = {}

    # inicio_at <- hora_inicio_preparacion
    resultado["inicio_at"] = _run_update(
        conn,
        """
        UPDATE ordenes_detalles
           SET inicio_at = hora_inicio_preparacion
         WHERE inicio_at IS NULL
           AND hora_inicio_preparacion IS NOT NULL
           AND hora_inicio_preparacion <> ''
        """,
    )

    # listo_at <- hora_terminado, salvo las filas DEVUELTO: en ellas hora_terminado es el
    # momento en que se devolvió el platillo, no el momento en que estuvo listo. Fabricar
    # esa marca inflaría los tiempos de preparación, así que se deja sin dato.
    resultado["listo_at"] = _run_update(
        conn,
        """
        UPDATE ordenes_detalles
           SET listo_at = hora_terminado
         WHERE listo_at IS NULL
           AND hora_terminado IS NOT NULL
           AND hora_terminado <> ''
           AND UPPER(COALESCE(estado_cocina, '')) <> 'DEVUELTO'
        """,
    )
    resultado["listo_at_devuelto_omitido"] = _run_count(
        conn,
        """
        SELECT COUNT(*) FROM ordenes_detalles
         WHERE listo_at IS NULL
           AND hora_terminado IS NOT NULL
           AND hora_terminado <> ''
           AND UPPER(COALESCE(estado_cocina, '')) = 'DEVUELTO'
        """,
    )

    # recibido_at <- transactions.date de la orden.
    if _table_exists(conn, "transactions"):
        resultado["recibido_at"] = _run_update(
            conn,
            """
            UPDATE ordenes_detalles
               SET recibido_at = (
                    SELECT t.date FROM transactions t WHERE t.id = ordenes_detalles.orden_id
               )
             WHERE recibido_at IS NULL
               AND EXISTS (
                    SELECT 1 FROM transactions t
                     WHERE t.id = ordenes_detalles.orden_id
                       AND t.date IS NOT NULL
                       AND t.date <> ''
               )
            """,
        )
    else:
        resultado["recibido_at"] = 0

    # area_id <- patrón de id que escribe el despacho directo: {orden_id}_{area_id}_...
    if _table_exists(conn, "production_areas"):
        resultado["area_id"] = _run_update(
            conn,
            """
            UPDATE ordenes_detalles
               SET area_id = (
                    SELECT pa.id FROM production_areas pa
                     WHERE ordenes_detalles.id LIKE
                           replace(ordenes_detalles.orden_id, '\\', '\\\\') || '\\_' ||
                           replace(pa.id, '\\', '\\\\') || '\\_%' ESCAPE '\\'
                     LIMIT 1
               )
             WHERE area_id IS NULL
               AND EXISTS (
                    SELECT 1 FROM production_areas pa
                     WHERE ordenes_detalles.id LIKE
                           replace(ordenes_detalles.orden_id, '\\', '\\\\') || '\\_' ||
                           replace(pa.id, '\\', '\\\\') || '\\_%' ESCAPE '\\'
               )
            """,
        )
    else:
        resultado["area_id"] = 0

    if any(resultado.values()):
        conn.commit()
    return resultado


def _run_count(conn: sqlite3.Connection, sql: str) -> int:
    try:
        fila = conn.execute(sql).fetchone()
        return int(fila[0] if fila else 0)
    except sqlite3.Error:
        return 0


def _run_update(conn: sqlite3.Connection, sql: str) -> int:
    try:
        cursor = conn.execute(sql)
        return int(cursor.rowcount or 0)
    except sqlite3.Error:
        # Compatibilidad con bases antiguas: el backfill es best-effort.
        return 0


def ensure_kds_schema_once(conn: sqlite3.Connection) -> None:
    """Ejecuta la migración una sola vez por proceso."""
    global _schema_listo
    if _schema_listo:
        return
    ensure_kds_schema(conn)
    _schema_listo = True


def reset_schema_cache() -> None:
    """Solo para pruebas: permite volver a ejecutar la migración."""
    global _schema_listo
    _schema_listo = False


# ---------------------------------------------------------------------------
# Transiciones de estado -> marcas de tiempo
# ---------------------------------------------------------------------------


def build_status_transition(
    estado: str, now: Optional[str] = None
) -> Tuple[str, List[Any]]:
    """Fragmento ``SET`` (incluye ``estado_cocina = ?``) y sus parámetros.

    Las marcas se fijan con ``COALESCE``: si ya había valor, se conserva. El
    estado desconocido se guarda tal cual sin tocar marcas (comportamiento previo).
    """
    now = now or ahora_iso()
    nuevo = (estado or "").strip().upper()
    fragmentos = ["estado_cocina = ?"]
    params: List[Any] = [nuevo]

    if nuevo == "EN_PREPARACION":
        # Fallback: si nunca se registró la recepción, se ancla al inicio.
        fragmentos.append("recibido_at = COALESCE(recibido_at, ?)")
        params.append(now)
        fragmentos.append("inicio_at = COALESCE(inicio_at, ?)")
        params.append(now)
        fragmentos.append("hora_inicio_preparacion = COALESCE(hora_inicio_preparacion, ?)")
        params.append(now)
    elif nuevo == "LISTO":
        fragmentos.append("listo_at = COALESCE(listo_at, ?)")
        params.append(now)
        fragmentos.append("hora_terminado = COALESCE(hora_terminado, ?)")
        params.append(now)
    elif nuevo == "DEVUELTO":
        # Devolución: conserva el histórico de "terminado" pero no marca listo.
        fragmentos.append("hora_terminado = COALESCE(hora_terminado, ?)")
        params.append(now)
    elif nuevo == "ENTREGADO":
        # La entrega no cambia el estado de cocina visible: solo sella la marca.
        params[0] = "LISTO"
        fragmentos.append("entregado_at = COALESCE(entregado_at, ?)")
        params.append(now)

    return ", ".join(fragmentos), params


def apply_status_transition(
    conn: sqlite3.Connection,
    estado: str,
    now: Optional[str] = None,
    *,
    item_id: Optional[str] = None,
    item_ids: Optional[Sequence[str]] = None,
    cart_id: Optional[str] = None,
    orden_id: Optional[str] = None,
) -> int:
    """Aplica el cambio de estado (y sus marcas) a los detalles indicados.

    Devuelve cuántas filas se actualizaron. El orden de prioridad replica al del
    endpoint original: ids explícitos, luego ``cart_id`` dentro de la orden y, si
    no hay ids, la orden completa.
    """
    set_sql, params = build_status_transition(estado, now)
    actualizadas = 0

    vistos: List[str] = []
    for candidato in ([item_id] if item_id else []) + list(item_ids or []):
        if candidato and candidato not in vistos:
            vistos.append(candidato)

    for detalle_id in vistos:
        actualizadas += int(
            conn.execute(
                f"UPDATE ordenes_detalles SET {set_sql} WHERE id = ?",
                [*params, detalle_id],
            ).rowcount
            or 0
        )

    if cart_id and orden_id:
        actualizadas += int(
            conn.execute(
                f"UPDATE ordenes_detalles SET {set_sql} WHERE orden_id = ? AND id LIKE ?",
                [*params, orden_id, f"%{cart_id}%"],
            ).rowcount
            or 0
        )
    elif not vistos and orden_id:
        actualizadas += int(
            conn.execute(
                f"UPDATE ordenes_detalles SET {set_sql} WHERE orden_id = ?",
                [*params, orden_id],
            ).rowcount
            or 0
        )

    return actualizadas


def mark_delivered(
    conn: sqlite3.Connection,
    *,
    orden_id: Optional[str] = None,
    item_id: Optional[str] = None,
    item_ids: Optional[Sequence[str]] = None,
    now: Optional[str] = None,
) -> int:
    """Sella ``entregado_at`` sin depender de un cambio de estado."""
    ids: List[str] = []
    for candidato in ([item_id] if item_id else []) + list(item_ids or []):
        if candidato and candidato not in ids:
            ids.append(candidato)

    now = now or ahora_iso()
    actualizadas = 0
    for detalle_id in ids:
        actualizadas += int(
            conn.execute(
                "UPDATE ordenes_detalles SET entregado_at = COALESCE(entregado_at, ?) WHERE id = ?",
                (now, detalle_id),
            ).rowcount
            or 0
        )
    if not ids and orden_id:
        actualizadas += int(
            conn.execute(
                "UPDATE ordenes_detalles SET entregado_at = COALESCE(entregado_at, ?) WHERE orden_id = ?",
                (now, orden_id),
            ).rowcount
            or 0
        )
    return actualizadas


# ---------------------------------------------------------------------------
# Rango de fechas y filtros
# ---------------------------------------------------------------------------


def _parse_timestamp(valor: Any, nombre: str, es_fin: bool = False) -> Optional[str]:
    """Normaliza ``desde``/``hasta`` a ISO local.

    Acepta fecha sola (``2025-01-31``), ISO con ``T``, con espacio o con zona
    horaria. Una fecha sola se expande al inicio o al final del día.
    """
    if valor is None:
        return None
    texto = str(valor).strip()
    if not texto:
        return None

    try:
        if len(texto) == 10 and texto[4] == "-" and texto[7] == "-":
            dia = date.fromisoformat(texto)
            momento = datetime.combine(dia, time.max if es_fin else time.min)
            return momento.isoformat()
        normalizado = texto.replace("Z", "+00:00")
        momento = datetime.fromisoformat(normalizado)
        if momento.tzinfo is not None:
            momento = momento.astimezone().replace(tzinfo=None)
        return momento.isoformat()
    except ValueError:
        sufijo = (
            "se espera una fecha ISO 8601, por ejemplo 2025-01-31 o 2025-01-31T08:30:00"
        )
        raise ValueError(f"Formato inválido en '{nombre}': {sufijo}") from None


def resolve_range(
    desde: Any = None, hasta: Any = None
) -> Tuple[Optional[str], Optional[str], bool]:
    """Devuelve ``(desde, hasta, rango_por_defecto)``.

    Sin parámetros el informe cubre el día de hoy. Un rango invertido es un
    error explícito.
    """
    inicio = _parse_timestamp(desde, "desde", es_fin=False)
    fin = _parse_timestamp(hasta, "hasta", es_fin=True)

    por_defecto = False
    if inicio is None and fin is None:
        hoy = date.today()
        inicio = datetime.combine(hoy, time.min).isoformat()
        fin = datetime.combine(hoy, time.max).isoformat()
        por_defecto = True

    if inicio and fin and datetime.fromisoformat(inicio) > datetime.fromisoformat(fin):
        raise ValueError(
            "Rango inválido: 'desde' es posterior a 'hasta'. Revisa las fechas del informe."
        )

    return inicio, fin, por_defecto


def _normalize_station(estacion: Any) -> Optional[str]:
    if estacion is None:
        return None
    texto = str(estacion).strip()
    return texto or None


def _base_from(conn: sqlite3.Connection) -> Tuple[str, str]:
    """FROM con los joins disponibles y la expresión de nombre de estación."""
    from_sql = "FROM ordenes_detalles d"
    nombre_sql = "COALESCE(NULLIF(d.area_id, ''), 'Sin estación')"
    if _table_exists(conn, "transactions"):
        from_sql += " LEFT JOIN transactions t ON t.id = d.orden_id"
    if _table_exists(conn, "production_areas"):
        from_sql += " LEFT JOIN production_areas pa ON pa.id = d.area_id"
        nombre_sql = "COALESCE(NULLIF(pa.nombre, ''), NULLIF(d.area_id, ''), 'Sin estación')"
    else:
        nombre_sql = "COALESCE(NULLIF(d.area_id, ''), 'Sin estación')"
    return from_sql, nombre_sql


def _recibido_sql(conn: sqlite3.Connection) -> str:
    return RECIBIDO_SQL if _table_exists(conn, "transactions") else "d.recibido_at"


def _where(
    conn: sqlite3.Connection,
    desde: Optional[str],
    hasta: Optional[str],
    estacion: Optional[str],
) -> Tuple[str, List[Any]]:
    recibido = _recibido_sql(conn)
    clausulas: List[str] = []
    params: List[Any] = []
    if desde:
        clausulas.append(f"datetime({recibido}) >= datetime(?)")
        params.append(desde)
    if hasta:
        clausulas.append(f"datetime({recibido}) <= datetime(?)")
        params.append(hasta)
    if estacion:
        clausulas.append(f"{SIN_ESTACION_SQL} = ?")
        params.append(estacion)
    return (" AND ".join(clausulas) if clausulas else "1 = 1"), params


# ---------------------------------------------------------------------------
# Informe: órdenes por estado
# ---------------------------------------------------------------------------


def orders_by_state(
    conn: sqlite3.Connection,
    desde: Any = None,
    hasta: Any = None,
    estacion: Any = None,
) -> Dict[str, Any]:
    inicio, fin, por_defecto = resolve_range(desde, hasta)
    filtro_estacion = _normalize_station(estacion)
    where_sql, where_params = _where(conn, inicio, fin, filtro_estacion)
    from_sql, nombre_sql = _base_from(conn)

    filas = conn.execute(
        f"""
        SELECT {SIN_ESTACION_SQL} AS estacion,
               {nombre_sql} AS nombre,
               COALESCE(NULLIF(d.estado_cocina, ''), 'PENDIENTE') AS estado,
               COUNT(*) AS items,
               COUNT(DISTINCT d.orden_id) AS pedidos
          {from_sql}
         WHERE {where_sql}
         GROUP BY estacion, estado
         ORDER BY estacion, estado
        """,
        where_params,
    ).fetchall()

    totales = conn.execute(
        f"""
        SELECT COUNT(DISTINCT d.orden_id) AS pedidos, COUNT(*) AS items
          {from_sql}
         WHERE {where_sql}
        """,
        where_params,
    ).fetchone()

    por_estado: Dict[str, Dict[str, Any]] = {}
    por_estacion: Dict[str, Dict[str, Any]] = {}

    for fila in filas:
        estacion_id = fila["estacion"]
        estado = fila["estado"]
        items = int(fila["items"] or 0)
        pedidos = int(fila["pedidos"] or 0)

        acumulado = por_estado.setdefault(estado, {"estado": estado, "items": 0, "pedidos": 0})
        acumulado["items"] += items
        acumulado["pedidos"] += pedidos

        grupo = por_estacion.setdefault(
            estacion_id,
            {
                "estacion": estacion_id,
                "nombre": fila["nombre"] or "Sin estación",
                "total_items": 0,
                "total_pedidos": 0,
                "por_estado": [],
            },
        )
        grupo["por_estado"].append({"estado": estado, "items": items, "pedidos": pedidos})

    # Totales por estación en una sola consulta (evita N+1 y traer filas al proceso).
    totales_estacion = conn.execute(
        f"""
        SELECT {SIN_ESTACION_SQL} AS estacion,
               COUNT(DISTINCT d.orden_id) AS pedidos,
               COUNT(*) AS items
          {from_sql}
         WHERE {where_sql}
         GROUP BY estacion
        """,
        where_params,
    ).fetchall()
    for fila in totales_estacion:
        grupo = por_estacion.get(fila["estacion"])
        if grupo is None:
            continue
        grupo["total_pedidos"] = int(fila["pedidos"] or 0)
        grupo["total_items"] = int(fila["items"] or 0)

    detalle_estaciones = []
    for estacion_id in sorted(por_estacion):
        grupo = por_estacion[estacion_id]
        grupo["por_estado"].sort(key=lambda item: item["estado"])
        detalle_estaciones.append(grupo)

    return {
        "desde": inicio,
        "hasta": fin,
        "rango_por_defecto": por_defecto,
        "estacion": filtro_estacion,
        "total_pedidos": int((totales["pedidos"] if totales else 0) or 0),
        "total_items": int((totales["items"] if totales else 0) or 0),
        "por_estado": sorted(por_estado.values(), key=lambda item: item["estado"]),
        "por_estacion": sorted(detalle_estaciones, key=lambda item: item["estacion"]),
    }


# ---------------------------------------------------------------------------
# Informe: tiempos de preparación
# ---------------------------------------------------------------------------

DURACIONES = {
    "preparacion": "((julianday(d.listo_at) - julianday(d.inicio_at)) * 1440.0)",
    "ciclo_total": "((julianday(d.listo_at) - julianday({recibido})) * 1440.0)",
}


def _stats_query(
    conn: sqlite3.Connection,
    duracion_sql: str,
    where_sql: str,
    params: Sequence[Any],
    per_station: bool,
) -> List[sqlite3.Row]:
    """Agrega promedio/mediana/P90/máximo en SQLite (sin traer filas al proceso)."""
    from_sql, nombre_sql = _base_from(conn)
    if per_station:
        estacion_sql = SIN_ESTACION_SQL
        particion = "estacion"
        nombre_select = nombre_sql
    else:
        estacion_sql = "'GLOBAL'"
        particion = "1"
        nombre_select = "'Global'"

    return conn.execute(
        f"""
        WITH base AS (
            SELECT {estacion_sql} AS estacion,
                   {nombre_select} AS nombre,
                   {duracion_sql} AS minutos
              {from_sql}
             WHERE {where_sql}
               AND {duracion_sql} IS NOT NULL
               AND {duracion_sql} >= 0
        ), ranked AS (
            SELECT estacion, nombre, minutos,
                   ROW_NUMBER() OVER (PARTITION BY {particion} ORDER BY minutos) AS rn,
                   COUNT(*) OVER (PARTITION BY {particion}) AS cnt
              FROM base
        )
        SELECT estacion,
               MIN(nombre) AS nombre,
               COUNT(*) AS conteo,
               AVG(minutos) AS promedio,
               AVG(CASE WHEN rn IN ((cnt + 1) / 2, (cnt + 2) / 2) THEN minutos END) AS mediana,
               MIN(CASE WHEN rn >= ((cnt * 9 + 9) / 10) THEN minutos END) AS p90,
               MAX(minutos) AS maximo
          FROM ranked
         GROUP BY estacion
         ORDER BY estacion
        """,
        list(params),
    ).fetchall()


def _stats_block(fila: Optional[sqlite3.Row]) -> Dict[str, Any]:
    if fila is None:
        return {
            "conteo": 0,
            "promedio_min": None,
            "mediana_min": None,
            "p90_min": None,
            "maximo_min": None,
        }
    return {
        "conteo": int(fila["conteo"] or 0),
        "promedio_min": _round(fila["promedio"]),
        "mediana_min": _round(fila["mediana"]),
        "p90_min": _round(fila["p90"]),
        "maximo_min": _round(fila["maximo"]),
    }


def prep_times(
    conn: sqlite3.Connection,
    desde: Any = None,
    hasta: Any = None,
    estacion: Any = None,
) -> Dict[str, Any]:
    inicio, fin, por_defecto = resolve_range(desde, hasta)
    filtro_estacion = _normalize_station(estacion)
    where_sql, where_params = _where(conn, inicio, fin, filtro_estacion)
    recibido = _recibido_sql(conn)

    global_block: Dict[str, Any] = {"estacion": "GLOBAL", "nombre": "Global"}
    por_estacion: List[Dict[str, Any]] = []

    for clave, plantilla in DURACIONES.items():
        duracion = plantilla.format(recibido=recibido)
        global_rows = _stats_query(
            conn, duracion, where_sql, where_params, per_station=False
        )
        global_block[clave] = _stats_block(global_rows[0] if global_rows else None)

        station_rows = _stats_query(
            conn, duracion, where_sql, where_params, per_station=True
        )
        for fila in station_rows:
            estacion_id = fila["estacion"]
            entrada = next(
                (item for item in por_estacion if item["estacion"] == estacion_id), None
            )
            if entrada is None:
                entrada = {"estacion": estacion_id, "nombre": fila["nombre"] or estacion_id}
                por_estacion.append(entrada)
            entrada[clave] = _stats_block(fila)

    for entrada in por_estacion:
        entrada.setdefault("preparacion", _stats_block(None))
        entrada.setdefault("ciclo_total", _stats_block(None))

    return {
        "desde": inicio,
        "hasta": fin,
        "rango_por_defecto": por_defecto,
        "estacion": filtro_estacion,
        "global": {
            "estacion": "GLOBAL",
            "nombre": "Global",
            "preparacion": global_block.get("preparacion", _stats_block(None)),
            "ciclo_total": global_block.get("ciclo_total", _stats_block(None)),
        },
        "por_estacion": sorted(por_estacion, key=lambda item: item["estacion"]),
    }


# ---------------------------------------------------------------------------
# Informe: retrasos por SLA
# ---------------------------------------------------------------------------


def parse_sla_map(valor: Any) -> Dict[str, float]:
    """Lee ``sla_por_estacion`` con el formato ``COCINA:20,BAR:10``."""
    if valor is None:
        return {}
    if isinstance(valor, dict):
        crudo = valor.items()
    else:
        crudo = (
            (parte.split(":", 1)[0], parte.split(":", 1)[1])
            for parte in str(valor).split(",")
            if ":" in parte
        )

    resultado: Dict[str, float] = {}
    for estacion, minutos in crudo:
        clave = str(estacion).strip()
        texto = str(minutos).strip()
        if not clave or not texto:
            continue
        try:
            numero = float(texto)
        except ValueError:
            raise ValueError(
                "Valor inválido en 'sla_por_estacion': usa el formato COCINA:20,BAR:10"
            ) from None
        if numero <= 0:
            raise ValueError(
                "Valor inválido en 'sla_por_estacion': los minutos deben ser mayores que cero."
            )
        resultado[clave] = numero
    return resultado


def _sla_case(estacion_sql: str, default: float, sla_map: Dict[str, float]) -> Tuple[str, List[Any]]:
    if not sla_map:
        return "?", [default]
    fragmentos: List[str] = []
    params: List[Any] = []
    for estacion, minutos in sla_map.items():
        fragmentos.append("WHEN ? THEN ?")
        params.extend([estacion, minutos])
    params.append(default)
    return f"(CASE {estacion_sql} {' '.join(fragmentos)} ELSE ? END)", params


def _sla_value(default: float, sla_map: Dict[str, float], estacion: str) -> float:
    return sla_map.get(estacion, default)


def delays(
    conn: sqlite3.Connection,
    desde: Any = None,
    hasta: Any = None,
    estacion: Any = None,
    sla_minutes: Any = SLA_POR_DEFECTO,
    sla_por_estacion: Any = None,
    limit: Any = 20,
) -> Dict[str, Any]:
    inicio, fin, por_defecto = resolve_range(desde, hasta)
    filtro_estacion = _normalize_station(estacion)
    where_sql, where_params = _where(conn, inicio, fin, filtro_estacion)
    recibido = _recibido_sql(conn)
    from_sql, nombre_sql = _base_from(conn)

    try:
        sla = float(sla_minutes)
    except (TypeError, ValueError):
        raise ValueError("Parámetro 'sla_minutes' inválido: se espera un número mayor que cero.") from None
    if not math.isfinite(sla) or sla <= 0:
        raise ValueError("Parámetro 'sla_minutes' inválido: se espera un número mayor que cero.")

    sla_map = parse_sla_map(sla_por_estacion)
    sla_sql, sla_params = _sla_case(SIN_ESTACION_SQL, sla, sla_map)
    duracion = DURACIONES["ciclo_total"].format(recibido=recibido)
    retrasado_sql = f"({duracion}) > {sla_sql}"

    agregados = conn.execute(
        f"""
        WITH base AS (
            SELECT {SIN_ESTACION_SQL} AS estacion,
                   {nombre_sql} AS nombre,
                   {duracion} AS minutos,
                   {retrasado_sql} AS retrasado,
                   d.orden_id AS orden_id
              {from_sql}
             WHERE {where_sql}
               AND {duracion} IS NOT NULL
               AND {duracion} >= 0
        )
        SELECT estacion,
               MIN(nombre) AS nombre,
               COUNT(*) AS items_medidos,
               SUM(CASE WHEN retrasado THEN 1 ELSE 0 END) AS items_retrasados,
               COUNT(DISTINCT orden_id) AS pedidos_medidos,
               COUNT(DISTINCT CASE WHEN retrasado THEN orden_id END) AS pedidos_retrasados,
               AVG(minutos) AS espera_media,
               MAX(minutos) AS espera_maxima
          FROM base
         GROUP BY estacion
         ORDER BY estacion
        """,
        [*sla_params, *where_params],
    ).fetchall()

    por_estacion: List[Dict[str, Any]] = []
    items_medidos = items_retrasados = 0
    pedidos_retrasados = 0
    for fila in agregados:
        medidos = int(fila["items_medidos"] or 0)
        retrasados = int(fila["items_retrasados"] or 0)
        items_medidos += medidos
        items_retrasados += retrasados
        pedidos_retrasados += int(fila["pedidos_retrasados"] or 0)
        por_estacion.append(
            {
                "estacion": fila["estacion"],
                "nombre": fila["nombre"] or fila["estacion"],
                "sla_minutes": _sla_value(sla, sla_map, fila["estacion"]),
                "items_medidos": medidos,
                "items_retrasados": retrasados,
                "porcentaje_retraso": _round((retrasados / medidos * 100.0) if medidos else None),
                "pedidos_medidos": int(fila["pedidos_medidos"] or 0),
                "pedidos_retrasados": int(fila["pedidos_retrasados"] or 0),
                "espera_media_min": _round(fila["espera_media"]),
                "espera_maxima_min": _round(fila["espera_maxima"]),
            }
        )

    try:
        limite = int(limit)
    except (TypeError, ValueError):
        limite = 20
    limite = max(1, min(limite, MAX_FILAS_RETRASOS))

    filas_tardias = conn.execute(
        f"""
        SELECT d.id AS detalle_id,
               d.orden_id AS orden_id,
               {SIN_ESTACION_SQL} AS estacion,
               {nombre_sql} AS nombre,
               d.estado_cocina AS estado_cocina,
               {recibido} AS recibido_at,
               d.listo_at AS listo_at,
               {duracion} AS espera_min,
               {retrasado_sql} AS retrasado
          {from_sql}
         WHERE {where_sql}
           AND {duracion} IS NOT NULL
           AND {duracion} >= 0
           AND {retrasado_sql}
         ORDER BY {duracion} DESC
         LIMIT ?
        """,
        [*sla_params, *where_params, *sla_params, limite],
    ).fetchall()

    mas_tardios = [
        {
            "detalle_id": fila["detalle_id"],
            "orden_id": fila["orden_id"],
            "estacion": fila["estacion"],
            "nombre": fila["nombre"] or fila["estacion"],
            "estado_cocina": fila["estado_cocina"],
            "recibido_at": fila["recibido_at"],
            "listo_at": fila["listo_at"],
            "espera_min": _round(fila["espera_min"]),
            "sla_minutes": _sla_value(sla, sla_map, fila["estacion"]),
        }
        for fila in filas_tardias
    ]

    totales = conn.execute(
        f"""
        SELECT COUNT(*) AS items_medidos,
               COUNT(DISTINCT d.orden_id) AS pedidos_medidos
          {from_sql}
         WHERE {where_sql}
           AND {duracion} IS NOT NULL
           AND {duracion} >= 0
        """,
        where_params,
    ).fetchone()

    return {
        "desde": inicio,
        "hasta": fin,
        "rango_por_defecto": por_defecto,
        "estacion": filtro_estacion,
        "sla_minutes": sla,
        "sla_por_estacion": sla_map,
        "items_medidos": int((totales["items_medidos"] if totales else 0) or 0),
        "items_retrasados": items_retrasados,
        "porcentaje_retraso": _round(
            (items_retrasados / items_medidos * 100.0) if items_medidos else None
        ),
        "pedidos_medidos": int((totales["pedidos_medidos"] if totales else 0) or 0),
        "pedidos_retrasados": pedidos_retrasados,
        "por_estacion": por_estacion,
        "mas_tardios": mas_tardios,
    }


# ---------------------------------------------------------------------------
# Informe: desempeño por estación
# ---------------------------------------------------------------------------


def station_performance(
    conn: sqlite3.Connection,
    desde: Any = None,
    hasta: Any = None,
    estacion: Any = None,
    sla_minutes: Any = SLA_POR_DEFECTO,
    sla_por_estacion: Any = None,
) -> Dict[str, Any]:
    inicio, fin, por_defecto = resolve_range(desde, hasta)
    filtro_estacion = _normalize_station(estacion)
    where_sql, where_params = _where(conn, inicio, fin, filtro_estacion)
    recibido = _recibido_sql(conn)
    from_sql, nombre_sql = _base_from(conn)

    try:
        sla = float(sla_minutes)
    except (TypeError, ValueError):
        raise ValueError("Parámetro 'sla_minutes' inválido: se espera un número mayor que cero.") from None
    if not math.isfinite(sla) or sla <= 0:
        raise ValueError("Parámetro 'sla_minutes' inválido: se espera un número mayor que cero.")

    sla_map = parse_sla_map(sla_por_estacion)
    sla_sql, sla_params = _sla_case(SIN_ESTACION_SQL, sla, sla_map)
    duracion = DURACIONES["ciclo_total"].format(recibido=recibido)
    retrasado_sql = f"({duracion}) > {sla_sql}"

    filas = conn.execute(
        f"""
        WITH base AS (
            SELECT {SIN_ESTACION_SQL} AS estacion,
                   {nombre_sql} AS nombre,
                   {duracion} AS minutos,
                   {retrasado_sql} AS retrasado
              {from_sql}
             WHERE {where_sql}
               AND {duracion} IS NOT NULL
               AND {duracion} >= 0
        ), ranked AS (
            SELECT estacion, nombre, minutos, retrasado,
                   ROW_NUMBER() OVER (PARTITION BY estacion ORDER BY minutos) AS rn,
                   COUNT(*) OVER (PARTITION BY estacion) AS cnt
              FROM base
        )
        SELECT estacion,
               MIN(nombre) AS nombre,
               COUNT(*) AS atendidos,
               AVG(minutos) AS promedio,
               AVG(CASE WHEN rn IN ((cnt + 1) / 2, (cnt + 2) / 2) THEN minutos END) AS mediana,
               MIN(CASE WHEN rn >= ((cnt * 9 + 9) / 10) THEN minutos END) AS p90,
               MAX(minutos) AS maximo,
               SUM(CASE WHEN retrasado THEN 1 ELSE 0 END) AS retrasados
          FROM ranked
         GROUP BY estacion
         ORDER BY estacion
        """,
        [*sla_params, *where_params],
    ).fetchall()

    estaciones = []
    for fila in filas:
        atendidos = int(fila["atendidos"] or 0)
        retrasados = int(fila["retrasados"] or 0)
        estaciones.append(
            {
                "estacion": fila["estacion"],
                "nombre": fila["nombre"] or fila["estacion"],
                "atendidos": atendidos,
                "tiempo_medio_min": _round(fila["promedio"]),
                "mediana_min": _round(fila["mediana"]),
                "p90_min": _round(fila["p90"]),
                "maximo_min": _round(fila["maximo"]),
                "sla_minutes": _sla_value(sla, sla_map, fila["estacion"]),
                "retrasados": retrasados,
                "porcentaje_retraso": _round(
                    (retrasados / atendidos * 100.0) if atendidos else None
                ),
            }
        )

    return {
        "desde": inicio,
        "hasta": fin,
        "rango_por_defecto": por_defecto,
        "estacion": filtro_estacion,
        "sla_minutes": sla,
        "sla_por_estacion": sla_map,
        "estaciones": estaciones,
    }


# ---------------------------------------------------------------------------
# Informe: volumen por hora
# ---------------------------------------------------------------------------


def _horas_vacias() -> List[Dict[str, int]]:
    return [{"hora": hora, "pedidos": 0} for hora in range(HORAS_DEL_DIA)]


def hourly_volume(
    conn: sqlite3.Connection,
    desde: Any = None,
    hasta: Any = None,
    estacion: Any = None,
) -> Dict[str, Any]:
    inicio, fin, por_defecto = resolve_range(desde, hasta)
    filtro_estacion = _normalize_station(estacion)
    where_sql, where_params = _where(conn, inicio, fin, filtro_estacion)
    recibido = _recibido_sql(conn)
    from_sql, nombre_sql = _base_from(conn)

    filas = conn.execute(
        f"""
        SELECT {SIN_ESTACION_SQL} AS estacion,
               {nombre_sql} AS nombre,
               CAST(strftime('%H', datetime({recibido})) AS INTEGER) AS hora,
               COUNT(DISTINCT d.orden_id) AS pedidos
          {from_sql}
         WHERE {where_sql}
           AND datetime({recibido}) IS NOT NULL
         GROUP BY estacion, hora
         ORDER BY estacion, hora
        """,
        where_params,
    ).fetchall()

    total_por_hora = {hora["hora"]: 0 for hora in _horas_vacias()}
    estaciones: Dict[str, Dict[str, Any]] = {}

    for fila in filas:
        hora = int(fila["hora"] or 0)
        pedidos = int(fila["pedidos"] or 0)
        if hora < 0 or hora >= HORAS_DEL_DIA:
            continue

        estacion_id = fila["estacion"]
        grupo = estaciones.get(estacion_id)
        if grupo is None:
            grupo = {
                "estacion": estacion_id,
                "nombre": fila["nombre"] or estacion_id,
                "total_pedidos": 0,
                "horas": _horas_vacias(),
            }
            estaciones[estacion_id] = grupo
        grupo["horas"][hora]["pedidos"] = pedidos
        grupo["total_pedidos"] += pedidos

    total = conn.execute(
        f"""
        SELECT COUNT(DISTINCT d.orden_id) AS pedidos
          {from_sql}
         WHERE {where_sql}
           AND datetime({recibido}) IS NOT NULL
        """,
        where_params,
    ).fetchone()

    # El global por hora se agrupa aparte para no sumar dobles conteos por estación.
    filas_globales = conn.execute(
        f"""
        SELECT CAST(strftime('%H', datetime({recibido})) AS INTEGER) AS hora,
               COUNT(DISTINCT d.orden_id) AS pedidos
          {from_sql}
         WHERE {where_sql}
           AND datetime({recibido}) IS NOT NULL
         GROUP BY hora
         ORDER BY hora
        """,
        where_params,
    ).fetchall()

    for fila in filas_globales:
        hora = int(fila["hora"] or 0)
        if 0 <= hora < HORAS_DEL_DIA:
            total_por_hora[hora] = int(fila["pedidos"] or 0)

    por_hora = [{"hora": hora, "pedidos": total_por_hora[hora]} for hora in range(HORAS_DEL_DIA)]
    hora_pico = max(por_hora, key=lambda item: item["pedidos"]) if por_hora else None

    return {
        "desde": inicio,
        "hasta": fin,
        "rango_por_defecto": por_defecto,
        "estacion": filtro_estacion,
        "total_pedidos": int((total["pedidos"] if total else 0) or 0),
        "hora_pico": hora_pico["hora"] if hora_pico and hora_pico["pedidos"] else None,
        "por_hora": por_hora,
        "por_estacion": sorted(estaciones.values(), key=lambda item: item["estacion"]),
    }


# ---------------------------------------------------------------------------
# Router FastAPI (import perezoso: los informes se pueden probar sin fastapi)
# ---------------------------------------------------------------------------


def build_reports_router(get_db_connection):
    """Crea el ``APIRouter`` de informes KDS (solo lectura)."""
    from fastapi import APIRouter, HTTPException, Query

    router = APIRouter(prefix="/api/cocina/informes", tags=["informes-kds"])

    def _ejecutar(consulta, **kwargs):
        conn = None
        try:
            conn = get_db_connection()
            ensure_kds_schema_once(conn)
            return consulta(conn, **kwargs)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from None
        except sqlite3.Error as error:
            raise HTTPException(
                status_code=500, detail=f"Error de base de datos al calcular el informe: {error}"
            ) from None
        finally:
            if conn is not None:
                conn.close()

    @router.get("/orders-by-state")
    def orders_by_state_endpoint(
        desde: Optional[str] = Query(None, description="ISO 8601. Por defecto, hoy."),
        hasta: Optional[str] = Query(None, description="ISO 8601. Por defecto, hoy."),
        estacion: Optional[str] = Query(None, description="id de área de producción"),
    ):
        return _ejecutar(orders_by_state, desde=desde, hasta=hasta, estacion=estacion)

    @router.get("/prep-times")
    def prep_times_endpoint(
        desde: Optional[str] = Query(None),
        hasta: Optional[str] = Query(None),
        estacion: Optional[str] = Query(None),
    ):
        return _ejecutar(prep_times, desde=desde, hasta=hasta, estacion=estacion)

    @router.get("/delays")
    def delays_endpoint(
        desde: Optional[str] = Query(None),
        hasta: Optional[str] = Query(None),
        estacion: Optional[str] = Query(None),
        sla_minutes: float = Query(SLA_POR_DEFECTO, description="Umbral de espera en minutos"),
        sla_por_estacion: Optional[str] = Query(None, description="COCINA:20,BAR:10"),
        limit: int = Query(20, description="Máximo de pedidos tardíos listados"),
    ):
        return _ejecutar(
            delays,
            desde=desde,
            hasta=hasta,
            estacion=estacion,
            sla_minutes=sla_minutes,
            sla_por_estacion=sla_por_estacion,
            limit=limit,
        )

    @router.get("/station-performance")
    def station_performance_endpoint(
        desde: Optional[str] = Query(None),
        hasta: Optional[str] = Query(None),
        estacion: Optional[str] = Query(None),
        sla_minutes: float = Query(SLA_POR_DEFECTO),
        sla_por_estacion: Optional[str] = Query(None),
    ):
        return _ejecutar(
            station_performance,
            desde=desde,
            hasta=hasta,
            estacion=estacion,
            sla_minutes=sla_minutes,
            sla_por_estacion=sla_por_estacion,
        )

    @router.get("/hourly-volume")
    def hourly_volume_endpoint(
        desde: Optional[str] = Query(None),
        hasta: Optional[str] = Query(None),
        estacion: Optional[str] = Query(None),
    ):
        return _ejecutar(hourly_volume, desde=desde, hasta=hasta, estacion=estacion)

    return router
