"""Pruebas de los informes y marcas de tiempo de KDS (SQLite en memoria)."""

import os
import sqlite3
import sys
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import kds_reports  # noqa: E402


ESQUEMA_LEGADO = """
CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    date TEXT,
    status TEXT
);
CREATE TABLE production_areas (
    id TEXT PRIMARY KEY,
    nombre TEXT,
    modo_salida TEXT
);
CREATE TABLE ordenes_detalles (
    id TEXT PRIMARY KEY,
    orden_id TEXT NOT NULL,
    producto_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    cantidad REAL NOT NULL,
    modificadores TEXT,
    estado_cocina TEXT DEFAULT 'PENDIENTE',
    hora_inicio_preparacion TEXT,
    hora_terminado TEXT
);
"""


def conectar() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(ESQUEMA_LEGADO)
    conn.execute("INSERT INTO production_areas (id, nombre, modo_salida) VALUES ('COCINA', 'Cocina', 'KDS')")
    conn.execute("INSERT INTO production_areas (id, nombre, modo_salida) VALUES ('BAR', 'Bar', 'KDS')")
    kds_reports.ensure_kds_schema(conn)
    return conn


def detalle(conn, detalle_id, orden_id, estado="PENDIENTE", area_id="COCINA", **marcas):
    columnas = ["id", "orden_id", "producto_id", "nombre", "cantidad", "estado_cocina", "area_id"]
    valores = [detalle_id, orden_id, "P1", "Producto", 1, estado, area_id]
    for columna in kds_reports.MARCAS:
        if columna in marcas:
            columnas.append(columna)
            valores.append(marcas[columna])
    marcadores = ", ".join(["?"] * len(valores))
    conn.execute(
        f"INSERT INTO ordenes_detalles ({', '.join(columnas)}) VALUES ({marcadores})",
        valores,
    )


def orden(conn, orden_id, date):
    conn.execute(
        "INSERT INTO transactions (id, date, status) VALUES (?, ?, 'EN_COCINA')",
        (orden_id, date),
    )


def iso(minutos_despues_de_9=0, hora=9):
    base = datetime(2025, 3, 4, hora, 0, 0)
    return (base + timedelta(minutes=minutos_despues_de_9)).isoformat()


class MigracionTests(unittest.TestCase):
    def test_migracion_agrega_columnas_y_rellena_historicos(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.executescript(ESQUEMA_LEGADO)
        conn.execute("INSERT INTO transactions (id, date, status) VALUES ('O1', ?, 'EN_COCINA')", (iso(),))
        conn.execute(
            """
            INSERT INTO ordenes_detalles
                (id, orden_id, producto_id, nombre, cantidad, estado_cocina,
                 hora_inicio_preparacion, hora_terminado)
            VALUES ('O1_0', 'O1', 'P1', 'Producto', 1, 'LISTO', ?, ?)
            """,
            (iso(2), iso(9)),
        )

        resultado = kds_reports.ensure_kds_schema(conn)
        self.assertIn("recibido_at", resultado["columnas_agregadas"])
        self.assertIn("entregado_at", resultado["columnas_agregadas"])

        fila = conn.execute("SELECT * FROM ordenes_detalles WHERE id = 'O1_0'").fetchone()
        self.assertEqual(fila["recibido_at"], iso())      # desde transactions.date
        self.assertEqual(fila["inicio_at"], iso(2))       # desde hora_inicio_preparacion
        self.assertEqual(fila["listo_at"], iso(9))        # desde hora_terminado
        self.assertIsNone(fila["entregado_at"])

        # Segunda pasada: idempotente (no agrega columnas ni pisa marcas).
        conn.execute("UPDATE ordenes_detalles SET recibido_at = NULL WHERE id = 'O1_0'")
        segunda = kds_reports.ensure_kds_schema(conn)
        self.assertEqual(segunda["columnas_agregadas"], [])
        fila = conn.execute("SELECT recibido_at FROM ordenes_detalles WHERE id = 'O1_0'").fetchone()
        self.assertEqual(fila["recibido_at"], iso())

    def test_backfill_no_sobrescribe_marcas_existentes(self):
        conn = conectar()
        orden(conn, "O1", iso())
        detalle(conn, "O1_0", "O1", recibido_at=iso(1), inicio_at=iso(3), listo_at=iso(4))
        kds_reports.backfill_kds_timestamps(conn)
        fila = conn.execute("SELECT * FROM ordenes_detalles WHERE id = 'O1_0'").fetchone()
        self.assertEqual(fila["recibido_at"], iso(1))
        self.assertEqual(fila["inicio_at"], iso(3))
        self.assertEqual(fila["listo_at"], iso(4))

    def test_backfill_area_desde_patron_de_id(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.executescript(ESQUEMA_LEGADO)
        conn.execute("INSERT INTO production_areas (id, nombre, modo_salida) VALUES ('COCINA', 'Cocina', 'KDS')")
        conn.execute("INSERT INTO transactions (id, date, status) VALUES ('O1', ?, 'EN_COCINA')", (iso(),))
        conn.execute(
            """
            INSERT INTO ordenes_detalles (id, orden_id, producto_id, nombre, cantidad)
            VALUES ('O1_COCINA_P1_0', 'O1', 'P1', 'Producto', 1)
            """
        )
        kds_reports.ensure_kds_schema(conn)
        fila = conn.execute("SELECT area_id FROM ordenes_detalles").fetchone()
        self.assertEqual(fila["area_id"], "COCINA")


class MarcasTests(unittest.TestCase):
    def test_marcas_se_fijan_una_sola_vez(self):
        conn = conectar()
        orden(conn, "O1", iso())
        detalle(conn, "O1_0", "O1")

        kds_reports.apply_status_transition(conn, "EN_PREPARACION", iso(1), item_id="O1_0")
        kds_reports.apply_status_transition(conn, "EN_PREPARACION", iso(6), item_id="O1_0")
        kds_reports.apply_status_transition(conn, "LISTO", iso(7), item_id="O1_0")
        kds_reports.apply_status_transition(conn, "LISTO", iso(30), item_id="O1_0")
        kds_reports.apply_status_transition(conn, "ENTREGADO", iso(8), item_id="O1_0")
        kds_reports.apply_status_transition(conn, "ENTREGADO", iso(40), item_id="O1_0")

        fila = conn.execute("SELECT * FROM ordenes_detalles WHERE id = 'O1_0'").fetchone()
        self.assertEqual(fila["estado_cocina"], "LISTO")
        self.assertEqual(fila["recibido_at"], iso(1))
        self.assertEqual(fila["inicio_at"], iso(1))
        self.assertEqual(fila["listo_at"], iso(7))
        self.assertEqual(fila["entregado_at"], iso(8))
        self.assertEqual(fila["hora_inicio_preparacion"], iso(1))
        self.assertEqual(fila["hora_terminado"], iso(7))

    def test_estado_desconocido_no_toca_marcas(self):
        conn = conectar()
        orden(conn, "O1", iso())
        detalle(conn, "O1_0", "O1", estado="PENDIENTE")
        kds_reports.apply_status_transition(conn, "PENDIENTE", iso(5), item_id="O1_0")
        fila = conn.execute("SELECT * FROM ordenes_detalles WHERE id = 'O1_0'").fetchone()
        self.assertIsNone(fila["inicio_at"])
        self.assertIsNone(fila["listo_at"])

    def test_transicion_por_orden_y_por_carrito(self):
        conn = conectar()
        orden(conn, "O1", iso())
        detalle(conn, "O1_0", "O1", area_id="COCINA")
        detalle(conn, "O1_1", "O1", area_id="BAR")

        self.assertEqual(
            kds_reports.apply_status_transition(conn, "EN_PREPARACION", iso(1), orden_id="O1"), 2
        )
        filas = conn.execute("SELECT inicio_at FROM ordenes_detalles").fetchall()
        self.assertTrue(all(fila["inicio_at"] == iso(1) for fila in filas))

        self.assertEqual(
            kds_reports.apply_status_transition(
                conn, "LISTO", iso(4), cart_id="O1_1", orden_id="O1"
            ),
            1,
        )
        fila = conn.execute("SELECT listo_at FROM ordenes_detalles WHERE id = 'O1_1'").fetchone()
        self.assertEqual(fila["listo_at"], iso(4))

    def test_marcar_entregado_sin_cambiar_estado(self):
        conn = conectar()
        orden(conn, "O1", iso())
        detalle(conn, "O1_0", "O1", estado="LISTO", listo_at=iso(5))
        kds_reports.mark_delivered(conn, orden_id="O1", now=iso(9))
        kds_reports.mark_delivered(conn, orden_id="O1", now=iso(50))
        fila = conn.execute("SELECT * FROM ordenes_detalles WHERE id = 'O1_0'").fetchone()
        self.assertEqual(fila["entregado_at"], iso(9))
        self.assertEqual(fila["estado_cocina"], "LISTO")


class InformesTests(unittest.TestCase):
    def setUp(self):
        self.conn = conectar()
        # COCINA: un pedido de 4 min de preparación y 10 de ciclo; otro de 10/20.
        orden(self.conn, "O1", iso(0))
        detalle(
            self.conn,
            "O1_0",
            "O1",
            area_id="COCINA",
            estado="LISTO",
            recibido_at=iso(0),
            inicio_at=iso(2),
            listo_at=iso(12),
        )
        orden(self.conn, "O2", iso(0))
        detalle(
            self.conn,
            "O2_0",
            "O2",
            area_id="COCINA",
            estado="LISTO",
            recibido_at=iso(0),
            inicio_at=iso(5),
            listo_at=iso(25),
        )
        # BAR: 6 min de preparación y 6 de ciclo, bien dentro del SLA.
        orden(self.conn, "O3", iso(0))
        detalle(
            self.conn,
            "O3_0",
            "O3",
            area_id="BAR",
            estado="EN_PREPARACION",
            recibido_at=iso(0),
            inicio_at=iso(0),
            listo_at=iso(6),
        )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def test_orders_by_state(self):
        informe = kds_reports.orders_by_state(self.conn, iso(0), iso(120))
        self.assertEqual(informe["total_items"], 3)
        self.assertEqual(informe["total_pedidos"], 3)
        por_estado = {fila["estado"]: fila for fila in informe["por_estado"]}
        self.assertEqual(por_estado["LISTO"]["items"], 2)
        self.assertEqual(por_estado["EN_PREPARACION"]["items"], 1)
        estaciones = {fila["estacion"]: fila for fila in informe["por_estacion"]}
        self.assertEqual(estaciones["COCINA"]["total_items"], 2)
        self.assertEqual(estaciones["COCINA"]["nombre"], "Cocina")
        self.assertEqual(estaciones["BAR"]["total_pedidos"], 1)

        filtrado = kds_reports.orders_by_state(self.conn, iso(0), iso(120), estacion="BAR")
        self.assertEqual(filtrado["total_items"], 1)

    def test_prep_times_global_y_por_estacion(self):
        informe = kds_reports.prep_times(self.conn, iso(0), iso(120))

        preparacion = informe["global"]["preparacion"]
        self.assertEqual(preparacion["conteo"], 3)
        self.assertAlmostEqual(preparacion["promedio_min"], (10 + 20 + 6) / 3, places=2)
        self.assertAlmostEqual(preparacion["mediana_min"], 10.0, places=2)
        self.assertAlmostEqual(preparacion["maximo_min"], 20.0, places=2)
        self.assertAlmostEqual(preparacion["p90_min"], 20.0, places=2)

        ciclo = informe["global"]["ciclo_total"]
        self.assertEqual(ciclo["conteo"], 3)
        self.assertAlmostEqual(ciclo["promedio_min"], (12 + 25 + 6) / 3, places=2)
        self.assertAlmostEqual(ciclo["mediana_min"], 12.0, places=2)

        estaciones = {fila["estacion"]: fila for fila in informe["por_estacion"]}
        self.assertAlmostEqual(estaciones["COCINA"]["preparacion"]["promedio_min"], 15.0, places=2)
        self.assertAlmostEqual(estaciones["COCINA"]["preparacion"]["mediana_min"], 15.0, places=2)
        self.assertAlmostEqual(estaciones["BAR"]["preparacion"]["promedio_min"], 6.0, places=2)

        solo_bar = kds_reports.prep_times(self.conn, iso(0), iso(120), estacion="BAR")
        self.assertEqual([fila["estacion"] for fila in solo_bar["por_estacion"]], ["BAR"])
        self.assertEqual(solo_bar["global"]["preparacion"]["conteo"], 1)

    def test_prep_times_excluye_filas_sin_marcas(self):
        detalle(self.conn, "O1_9", "O1", area_id="COCINA", estado="PENDIENTE", recibido_at=iso(0))
        self.conn.commit()
        informe = kds_reports.prep_times(self.conn, iso(0), iso(120))
        self.assertEqual(informe["global"]["preparacion"]["conteo"], 3)
        self.assertEqual(informe["global"]["ciclo_total"]["conteo"], 3)

    def test_delays_por_sla(self):
        informe = kds_reports.delays(self.conn, iso(0), iso(120), sla_minutes=15)
        self.assertEqual(informe["items_medidos"], 3)
        self.assertEqual(informe["items_retrasados"], 1)  # solo O2_0 (25 min)
        self.assertAlmostEqual(informe["porcentaje_retraso"], 33.33, places=2)
        self.assertEqual(informe["pedidos_retrasados"], 1)
        self.assertEqual(len(informe["mas_tardios"]), 1)
        self.assertEqual(informe["mas_tardios"][0]["orden_id"], "O2")
        self.assertAlmostEqual(informe["mas_tardios"][0]["espera_min"], 25.0, places=2)
        self.assertEqual(informe["mas_tardios"][0]["sla_minutes"], 15.0)

        por_estacion = {fila["estacion"]: fila for fila in informe["por_estacion"]}
        self.assertEqual(por_estacion["COCINA"]["items_retrasados"], 1)
        self.assertEqual(por_estacion["BAR"]["items_retrasados"], 0)
        self.assertEqual(por_estacion["BAR"]["porcentaje_retraso"], 0.0)

    def test_delays_sla_por_estacion_y_sin_retrasos(self):
        estricto = kds_reports.delays(
            self.conn, iso(0), iso(120), sla_minutes=15, sla_por_estacion="COCINA:5"
        )
        self.assertEqual(estricto["items_retrasados"], 2)  # COCINA 12 y 25 minutos
        self.assertEqual(estricto["sla_por_estacion"], {"COCINA": 5.0})

        holgado = kds_reports.delays(self.conn, iso(0), iso(120), sla_minutes=600)
        self.assertEqual(holgado["items_retrasados"], 0)
        self.assertEqual(holgado["porcentaje_retraso"], 0.0)
        self.assertEqual(holgado["mas_tardios"], [])

    def test_delays_sla_invalido(self):
        with self.assertRaises(ValueError):
            kds_reports.delays(self.conn, iso(0), iso(120), sla_minutes=0)
        with self.assertRaises(ValueError):
            kds_reports.delays(self.conn, iso(0), iso(120), sla_por_estacion="COCINA:abc")

    def test_station_performance(self):
        informe = kds_reports.station_performance(self.conn, iso(0), iso(120), sla_minutes=15)
        estaciones = {fila["estacion"]: fila for fila in informe["estaciones"]}
        cocina = estaciones["COCINA"]
        self.assertEqual(cocina["atendidos"], 2)
        self.assertAlmostEqual(cocina["tiempo_medio_min"], 18.5, places=2)
        self.assertAlmostEqual(cocina["mediana_min"], 18.5, places=2)
        self.assertAlmostEqual(cocina["p90_min"], 25.0, places=2)
        self.assertAlmostEqual(cocina["maximo_min"], 25.0, places=2)
        self.assertEqual(cocina["retrasados"], 1)
        self.assertAlmostEqual(cocina["porcentaje_retraso"], 50.0, places=2)

        bar = estaciones["BAR"]
        self.assertEqual(bar["atendidos"], 1)
        self.assertEqual(bar["retrasados"], 0)

    def test_hourly_volume(self):
        self.conn.execute(
            "INSERT INTO transactions (id, date, status) VALUES ('O4', ?, 'EN_COCINA')", (iso(0, hora=13),)
        )
        detalle(
            self.conn,
            "O4_0",
            "O4",
            area_id="BAR",
            estado="LISTO",
            recibido_at=iso(0, hora=13),
            inicio_at=iso(0, hora=13),
            listo_at=iso(5, hora=13),
        )
        self.conn.execute(
            "INSERT INTO transactions (id, date, status) VALUES ('O5', ?, 'EN_COCINA')", (iso(0, hora=13),)
        )
        detalle(self.conn, "O5_0", "O5", area_id="COCINA", estado="PENDIENTE", recibido_at=iso(0, hora=13))
        self.conn.commit()

        informe = kds_reports.hourly_volume(self.conn, iso(0, hora=8), iso(0, hora=20))
        self.assertEqual(len(informe["por_hora"]), 24)
        self.assertEqual(informe["por_hora"][9]["pedidos"], 3)
        self.assertEqual(informe["por_hora"][13]["pedidos"], 2)
        self.assertEqual(informe["hora_pico"], 9)
        self.assertEqual(informe["total_pedidos"], 5)

        estaciones = {fila["estacion"]: fila for fila in informe["por_estacion"]}
        self.assertEqual(estaciones["COCINA"]["horas"][9]["pedidos"], 2)
        self.assertEqual(estaciones["BAR"]["horas"][13]["pedidos"], 1)
        self.assertEqual(len(estaciones["BAR"]["horas"]), 24)

    def test_rango_vacio_no_divide_entre_cero(self):
        desde, hasta = "2030-01-01", "2030-01-02"
        estados = kds_reports.orders_by_state(self.conn, desde, hasta)
        self.assertEqual(estados["total_pedidos"], 0)
        self.assertEqual(estados["por_estado"], [])
        self.assertEqual(estados["por_estacion"], [])

        tiempos = kds_reports.prep_times(self.conn, desde, hasta)
        self.assertEqual(tiempos["global"]["preparacion"]["conteo"], 0)
        self.assertIsNone(tiempos["global"]["preparacion"]["promedio_min"])
        self.assertIsNone(tiempos["global"]["preparacion"]["mediana_min"])
        self.assertEqual(tiempos["por_estacion"], [])

        retrasos = kds_reports.delays(self.conn, desde, hasta)
        self.assertEqual(retrasos["items_retrasados"], 0)
        self.assertIsNone(retrasos["porcentaje_retraso"])
        self.assertEqual(retrasos["mas_tardios"], [])

        desempeno = kds_reports.station_performance(self.conn, desde, hasta)
        self.assertEqual(desempeno["estaciones"], [])

        volumen = kds_reports.hourly_volume(self.conn, desde, hasta)
        self.assertEqual(volumen["total_pedidos"], 0)
        self.assertIsNone(volumen["hora_pico"])
        self.assertEqual(volumen["por_estacion"], [])
        self.assertEqual(sum(fila["pedidos"] for fila in volumen["por_hora"]), 0)

    def test_rango_invalido_es_error_claro(self):
        with self.assertRaises(ValueError) as contexto:
            kds_reports.orders_by_state(self.conn, iso(120), iso(0))
        self.assertIn("Rango inválido", str(contexto.exception))

        with self.assertRaises(ValueError) as contexto:
            kds_reports.orders_by_state(self.conn, "no-es-fecha")
        self.assertIn("Formato inválido", str(contexto.exception))

    def test_rango_por_defecto_es_hoy(self):
        informe = kds_reports.orders_by_state(self.conn)
        self.assertTrue(informe["rango_por_defecto"])
        hoy = datetime.now().date().isoformat()
        self.assertTrue(informe["desde"].startswith(hoy))
        self.assertTrue(informe["hasta"].startswith(hoy))

    def test_sin_estacion_se_agrupa_aparte(self):
        detalle(
            self.conn,
            "O6_0",
            "O6",
            area_id=None,
            estado="LISTO",
            recibido_at=iso(0),
            inicio_at=iso(0),
            listo_at=iso(3),
        )
        self.conn.commit()
        informe = kds_reports.station_performance(self.conn, iso(0), iso(120))
        estaciones = {fila["estacion"]: fila for fila in informe["estaciones"]}
        self.assertIn(kds_reports.ESTADO_SIN_ESTACION, estaciones)
        self.assertEqual(estaciones[kds_reports.ESTADO_SIN_ESTACION]["nombre"], "Sin estación")


if __name__ == "__main__":
    unittest.main()
