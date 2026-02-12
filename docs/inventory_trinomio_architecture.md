# Trinomio de Inventario: Toma, Auditoría y Cierre (Hard Lock)

## 1) Interceptor de fecha de bloqueo (pseudocódigo)

```pseudo
function assertInventoryMovementUnlocked(warehouseId, effectiveDate):
  activeLock = getLatestClosedSnapshotForWarehouse(warehouseId)
  if activeLock is null:
    return ALLOW

  lockDate = activeLock.lockDate OR activeLock.cutoffDate OR activeLock.closedAt
  movementDate = effectiveDate OR now()

  if movementDate <= lockDate:
    throw "Acción denegada: El inventario a esta fecha ya ha sido cerrado y auditado."

  return ALLOW
```

Integración recomendada:

- `recordInventoryMovement(...)`: validar antes de insertar en kardex.
- `recordInventoryMovements([...])`: validar cada movimiento por `warehouseId` y `effectiveDate`.
- Para operaciones con fecha documental (venta/compra/anulación), pasar `effectiveDate` explícita.

## 2) Estructura de UI (Auditoría histórica)

### Pantalla principal

- Selector de almacén.
- Buscador histórico de sesiones de conteo (filtro por fecha y texto).
- Lista de sesiones finalizadas.
- Panel de resultados (drill-down) de la sesión seleccionada.

### Reglas de visualización (solo lectura)

- `FALTANTE` (rojo): `fisico < sistema`
- `SOBRANTE` (azul): `fisico > sistema`
- `SIN CONTAR` (gris): producto en snapshot del sistema sin conteo físico
- `OK` (verde): `fisico == sistema`

### Resumen superior

- Conteo de faltantes
- Conteo de sobrantes
- Conteo de sin contar
- Monto total de discrepancias (abs(diff) * avgCost)

### Panel de cierre hard lock

- Input de fecha de corte
- Botón `Ejecutar Cierre`
- Estado del escudo activo (último lock vigente)
- Historial corto de cierres recientes

## 3) Schema de snapshots (SQL recomendado)

```sql
CREATE TABLE IF NOT EXISTS inventory_count_sessions (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL,
  warehouse_name TEXT,
  created_at TEXT NOT NULL,
  finalized_at TEXT,
  status TEXT NOT NULL DEFAULT 'FINALIZED',
  created_by TEXT,
  created_by_name TEXT
);

CREATE TABLE IF NOT EXISTS inventory_count_session_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT,
  system_qty REAL NOT NULL,
  counted_qty REAL NOT NULL,
  difference REAL NOT NULL,
  avg_cost REAL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES inventory_count_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_count_items_session ON inventory_count_session_items(session_id);
CREATE INDEX IF NOT EXISTS idx_count_items_product ON inventory_count_session_items(product_id);

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  cutoff_date TEXT NOT NULL,
  lock_date TEXT NOT NULL,
  immutable INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL, -- CLOSED | REOPENED
  created_by TEXT,
  created_by_name TEXT,
  total_value REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_snapshots_warehouse_lock
  ON inventory_snapshots(warehouse_id, lock_date DESC);

CREATE TABLE IF NOT EXISTS inventory_snapshot_items (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT,
  warehouse_id TEXT NOT NULL,
  qty REAL NOT NULL,
  avg_cost REAL NOT NULL,
  value REAL NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES inventory_snapshots(id)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_items_snapshot ON inventory_snapshot_items(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_items_product ON inventory_snapshot_items(product_id);
```

## 4) Flujo de datos consolidado

1. `Toma`: crea sesión y guarda ítems contados + snapshot de sistema en el momento.
2. `Auditoría`: consulta sesiones finalizadas y compara físico vs sistema sin permitir edición.
3. `Cierre`: crea snapshot inmutable por fecha de corte y activa lock transaccional.
