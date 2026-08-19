# Prompt para el hilo del ERP — sincronización POS, monedas y multimedia

Implementa en el ERP/Supabase el complemento backend para los fixes ya realizados en CLIC-POS. No cambies el contrato del POS descrito abajo. Trabaja desde `develop`, crea una rama `fix/erp-pos-sync-currency-media`, usa migraciones versionadas, pruebas y PR hacia `develop`.

## Objetivos

1. Recibir altas/ediciones/bajas de clientes creadas en el POS.
2. Aplicar movimientos de inventario del POS de forma idempotente y devolver confirmación funcional real.
3. Persistir multimedia de productos y promociones/ofertas, incluyendo videos.
4. Crear/editar monedas sin que desaparezcan en el siguiente snapshot ERP.
5. Auditar y programar cambios de tasas.

## Contratos HTTP requeridos

Todos estos endpoints viven bajo `/api/sync`, usan la autenticación actual de terminal/dispositivo y resuelven `tenant_id`, compañía, tienda y terminal desde el contexto autenticado. Nunca aceptes esos alcances solo por confiar en el body.

### `POST /api/sync/customers/upsert`

Body:

```json
{
  "terminalId": "uuid-terminal-erp",
  "tenant_id": "uuid-tenant",
  "items": [
    {
      "source_customer_mutation_id": "customer-upsert-CUST-1-...",
      "source_customer_id": "CUST-1",
      "source_terminal_id": "T1",
      "operation": "UPSERT",
      "customer": { "id": "CUST-1", "name": "Cliente", "phone": "..." },
      "created_at": "ISO-8601"
    }
  ]
}
```

- `UPSERT`: resolver por `(tenant_id, source_channel='POS', source_customer_id)` y crear/actualizar.
- `DELETE`: baja lógica; no borrar físicamente historial financiero.
- Idempotencia única por `(tenant_id, source_customer_mutation_id)`.
- Guardar relación entre ID POS e ID ERP.
- Responder `processedIds` con los `source_customer_mutation_id` exactos.

### `POST /api/sync/inventory/movements`

Cada item incluye identidad `source_inventory_movement_id`, `source_terminal_id`, `device_id`, además de ambos formatos compatibles:

```json
{
  "productId": "P-1",
  "product_id": "P-1",
  "warehouseId": "WH-1",
  "warehouse_id": "WH-1",
  "concept": "AJUSTE_ENTRADA",
  "movement_type": "AJUSTE_ENTRADA",
  "qtyIn": 2,
  "qty_in": 2,
  "qtyOut": 0,
  "qty_out": 0,
  "unitCost": 5,
  "unit_cost": 5
}
```

- Idempotencia única por `(tenant_id, source_inventory_movement_id)`.
- Resolver mapeo de producto y almacén POS→ERP antes de aplicar.
- Aplicar ledger y balance en una sola transacción.
- Si falta un mapeo, responder error funcional (`ITEM_MAPPING_MISSING`, `WAREHOUSE_MAPPING_MISSING`) y no confirmar el item.
- Un HTTP 200 no puede ocultar fallos internos.

### `POST /api/sync/currencies/upsert`

Body: `{ mutationId, currencies, actor, terminalId, tenant_id }`.

- Persistir la lista dentro de la fuente de verdad que alimenta el snapshot/configuración ERP→POS.
- Crear monedas nuevas y actualizar existentes en una transacción.
- Validar exactamente una moneda base, tasa base `1`, códigos ISO únicos y tasas no negativas.
- Registrar auditoría por cada cambio de `rate`, `buyRate` y `sellRate`.
- Responder `processedIds: [mutationId]`.

### `GET /api/sync/currencies/audit/:currencyCode`

Retornar los registros del tenant actual, descendentes por fecha: `id`, `currencyCode`, `field`, `oldValue`, `newValue`, `changedAt`, `changedBy`, `changedByName`, `terminalId`, `source`.

### `POST /api/sync/currencies/schedules`

Recibe `items` con `id`, `currencyCode`, `rate`, `buyRate?`, `sellRate?`, `executeAt`, usuario y terminal.

- Guardar con estado `PENDING` e idempotencia por `(tenant_id, id)`.
- Un worker confiable debe reclamar cambios vencidos con bloqueo (`FOR UPDATE SKIP LOCKED` o equivalente), actualizar moneda + auditoría + estado `APPLIED` en una transacción.
- Si falla, marcar `FAILED` con causa; no reintentar infinitamente sin política explícita.
- Responder `processedIds` con los IDs exactos.

## Respuesta operacional obligatoria

Éxito:

```json
{ "success": true, "processedIds": ["id-exacto"], "failed": 0, "errors": [] }
```

Fallo total o parcial: usar HTTP apropiado cuando corresponda y, aun con 200 parcial, devolver `success: false` o `failed > 0`, más `errors`. El POS ahora rechaza también `applyFailedCount > 0` y resultados con estado `FAILED`, `ERROR` o `REJECTED`.

## Supabase y seguridad

- Crear migraciones para inbox/idempotencia de clientes, mapeos POS↔ERP, auditoría de moneda, programación de tasas y metadatos multimedia.
- Para tablas nuevas: aplicar `GRANT` explícitos al rol usado por el backend y activar RLS. No exponer escrituras directas al cliente POS.
- Políticas RLS por `tenant_id`; el backend debe usar el usuario/rol servidor ya establecido y nunca enviar `service_role` al frontend.
- Índices mínimos: claves idempotentes, `(tenant_id, currency_code, changed_at desc)` y `(tenant_id, status, execute_at)`.

## Multimedia

Aceptar en productos y promociones/ofertas:

```ts
type MediaAsset = {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  url: string;
  posterUrl?: string;
  mimeType?: string;
  storagePath?: string;
  version?: string;
  sortOrder?: number;
  active?: boolean;
}
```

- Incluir `media` en snapshots de productos y promociones.
- Mantener campos históricos `image`, `imageUrl` e `images`.
- Si se implementa upload, usar bucket privado/público según política actual, validar MIME/tamaño y devolver URL HTTPS o signed URL renovable. No guardar video base64 en JSON/DB.

## Criterios de aceptación

- Repetir el mismo cliente o movimiento 3 veces produce un único efecto ERP y confirma las 3 solicitudes idempotentemente.
- Cliente creado en POS aparece en ERP y vuelve en el siguiente snapshot sin duplicarse.
- Ajuste de stock POS cambia el balance ERP; un mapeo inválido queda pendiente/bloqueado en POS, nunca como sincronizado.
- Moneda creada en POS permanece después de refrescar configuración desde ERP.
- Cada tasa modificada guarda valor anterior/nuevo, fecha/hora, usuario y terminal.
- Una tasa programada se aplica una sola vez a la hora indicada y aparece en auditoría.
- Videos de producto/promoción llegan en snapshots y conservan compatibilidad con imágenes existentes.
- Añadir pruebas de integración, idempotencia, RLS/tenant isolation y respuesta parcial.
