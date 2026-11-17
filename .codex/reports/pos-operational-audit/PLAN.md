# Auditoría operativa POS → ERP

## Identificación

- Objetivo autorizado: revisar emisores POS y corregir integración para ver descuentos, autorizaciones y otras acciones en Auditoría ERP sin afectar operación local.
- ERP: `fix/auditoria-eventos-pos`, PR a `clean-erp`; base `e6c92bd0`.
- POS: `/private/tmp/clic-pos-audit-integration`, `fix/auditoria-eventos-erp`, PR a `develop` (política específica POS); base `9ceea821dc4909b62b244925eff6a24a6e7427b8`.
- Entorno: código local, PostgreSQL PGlite/IndexedDB aislados; sin cambios remotos, APK ni instalación. Checkouts principales con cambios ajenos preservados.
- Coordinador y autor del plan: /root. Análisis POS: /root/pos_events_contract. Escritor funcional: pendiente. Evaluadores: pendientes.

## G0: análisis

`useSupervisorAuth.logAction` conserva `config.auditLogs` sin transporte ERP; terminal placeholder y hash simulado. Captura una autorización concedida, antes de ejecutar el callback: no prueba operación aplicada. Registra descuentos, anulaciones, devoluciones, reenvíos, cambios de cantidad y otras solicitudes del hook. `InvoiceReviewService` sí emite `INVOICE_AUDIT_RECORDED` / `INVOICE_REVIEW_FLAGGED` hacia inbox cuando Outbox v2 está activo. No hay productor actual hacia `erp_audit_events`.

ERP consulta solamente `erp_audit_events`; catálogo de acciones fijo y filtros exactos. Sync escribe `erp_sync_inbox`, con scope canónico resuelto por terminal. No modificar applier financiero, fiscal, inventario, caja, permisos operativos ni configuración de terminales.

Nueva colección POS se puede añadir sin esquema SQLite; IndexedDB v27 exige store aditivo y bump. Probar que conserva documentos y cierres. Actualizar scope de BackgroundSyncManager; transporte independiente al final del ciclo, sin HTTP en interacción del cajero. Logs históricos con terminal ficticia no se deben atribuir retroactivamente.

## G1: plan propuesto para evaluación independiente

1. POS: colección durable `posAuditEvents`, captura del hook con terminal real, actor/supervisor y hora/valores/permiso. Mantener log local existente. Guardar local antes de finalizar decisión cuando sea posible; error de auditoría debe ser visible y preservado para recuperación sin bloquear operación financiera. No etiquetar autorización como acción ejecutada. Añadir cola a BackgroundSyncManager al final con retries y ACK validado por ID; sin nueva dependencia, sin cambiar Outbox financiero.
2. ERP: servicio y endpoint terminal-autenticado `/api/sync/audit-events` para eventos operativos versionados y limitados. Scope tenant/company/store/terminal derivado del servidor; rechazar cruces. Payload allowlisted, no PIN/token/hash simulado. ID determinista por tenant+terminal+sourceEventId e inserción idempotente inmutable, detectar replay con contenido cambiado. No registrar que la identidad POS equivale a una sesión Supabase.
3. ERP: proyectar los dos tipos de auditoría de factura existentes al recibir inbox single/batch, incluidos duplicados. La proyección fallida retiene retry solo para eventos de auditoría; jamás impedir aplicación de ventas/pagos/Z. ACK de auditoría únicamente tras persistencia. No cambiar ACKs de eventos comerciales.
4. Catálogo/etiquetas: autorización de descuento y autorización de operación, revisión y correo según productores reales. Actor POS visible con identidad declarada por terminal y supervisor en detalle; no inventar usuario ERP. Conservar hora ocurrida y recibida.
5. Esquema: migración mínima reproducible para acciones adicionales si son necesarias (preservar conjunto actual, RLS/grants e índices). Preflight, rollback y prueba en PostgreSQL aislado; no aplicar remotamente. No backfill productivo ni reproducción comercial; documentar recuperación selectiva idempotente de eventos inbox históricos.
6. Pruebas: permisos/scope, éxito, duplicados/replay alterado, concurrencia, fallo y reintento tras ACK perdido, orden invertido, timestamp, redacción de secretos; contrato real de payload de ambos repos; persistencia offline y upgrade IndexedDB; compatibilidad sin endpoint/migración, fallos independientes de venta. Lint/build/test relevantes en ambos; pruebas con mocks no equivalen a terminal Android real.
7. Gates independientes y entrega: reviewer, qa, data-integrity, integration, performance y release. Cualquier falta de evidencia real permanece BLOCKED, PR draft. Push PRs con bases específicas, sin merge/deploy.

## Invariantes y rollback

Sin escrituras comerciales nuevas ni reaplicación de ventas. Eventos append-only por identidad estable. Reintentar no duplica. No inferir ejecución por aprobación. No secretos en evidencia. ERP anterior no elimina cola nueva sin ACK válido. Rollback: revertir PRs por flujo protegido, conservar cola POS e histórico ERP; no desinstalar APK ni borrar datos. Feature flag de transporte permite pausar auditoría conservando pendientes; no altera autorizaciones.

## Validación y gates

G0/G1 pendientes de segundo evaluador. G2–G8 BLOCKED hasta implementación y evaluaciones. No se autoriza release por esta planificación.

### Ajustes tras evaluación G1 (/root/audit_review)

- Política de fallo local: LOG estable con terminal real en `config.auditLogs` como respaldo y cola individual `posAuditEvents`; el background reconcilia registros nuevos marcados para envío que faltan en la cola. Guardar cola antes de resolver autorización (solo I/O local), nunca esperar HTTP. Si falla, conservar respaldo local y mostrar advertencia visible; si ambos almacenes fallan no afirmar durabilidad ni envío. No atribuir logs antiguos `current-terminal`. Evitar sobrescribir la cola desde config al reconciliar o revertir un ACK.
- Drenar también `invoiceAuditEvents` del camino legacy sin Outbox v2 con ACK individual. Evitar doble envío cuando el evento pertenece al Outbox activo; si ambos caminos pueden ejecutarse, identidad determinista compartida impide doble auditoría. Mantener datos de revisión y estados locales existentes.
- Selector preventivo POS ejecutado antes de implementación, archivo externo `/private/tmp/pos-audit-preimplementation-plan.json`, riesgo CRITICAL y gates sync/offline/performance requeridos. Expediente POS creado en `.codex/reports/pos-operational-audit/PLAN.md`.
- Performance: presupuesto de UI p95<=50ms conforme AGENTS POS, medir baseline/candidate comparables cuando exista entorno; tests de contrato/microbench no sustituyen hardware. Ausencia de captura runtime permanece BLOCKED.
- Migración de acciones preservará constraints existentes (incluido RECEIVE y comentarios/hash de native_inventory_transfer_receipts); extensión aditiva comprobada y rollback documentado sin eliminar histórico.
