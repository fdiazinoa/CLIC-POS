# Despacho separado por empresa — POS y ERP

Solicitud: reservar al vender y descontar físico al confirmar conduce con ubicación/tramo, configurable por empresa. Usuario eligió explícitamente POS offline con cupos preasignados, no online-only.

POS base oficial origin/develop `1e3273e94309c2a4e50b19767cef981eaf51f5dd`, rama feature/inventory-company-dispatch, worktree limpio aislado por conflictos ajenos en principal. ERP base origin/clean-erp `68519916a1c8f2007c6146edc6a70b496efc3cff`; expediente principal docs/development/tasks/company-warehouse-dispatch.md en worktree ERP hermano.

Orchestrator /root, único developer previsto /root/implementation; análisis ERP /root/analysis y análisis POS /root/pos_dispatch_analysis; datos /root/data_validation; aprobador plan/reviewer /root/operations_review. QA, sync-validator y performance se delegarán a identidades distintas entre sí y de autores/reviewer según AGENTS POS; no se reutiliza la combinación QA/performance de tareas ERP-only. Release independiente /root/visibility_release. Los campos UNASSIGNED/PENDING no son aprobación.

Antes de editar código se ejecutó workflow-gate.mjs plan con base=candidate y --critical; informe externo /tmp/clic-company-dispatch-pos-plan.json. Clasificación CRITICAL; gates analysis,plan,review,qa,functional,regression,sync,offline,performance y device adicional. Se reconfirmará sobre diff committed. PLAN todavía no aprobado; no fuentes funcionales modificadas.

Default IMMEDIATE preserva contratos previos. WAREHOUSE_DISPATCH requiere derechos escrow por terminal/generación, precharge antes del pago y consumo durable con venta+obligación+Outbox en SQLite. Stock físico y COGS solo en confirmación de conduce en ERP; revenue/impuestos permanecen en venta. Transferencia central cupo→reserva del documento conserva un solo hold; ACK/retry/snapshot no duplica ni libera derechos inciertos. No lotes/PEDIDOS ficticios para stock ordinario.

Activación exige barrera/reconciliación y derechos drenados de TODOS los bindings capaces de vender del mismo pool; no basta lastSeen/revocación/timeout o rechazar intake tardío. Desactivación no libera pendientes. Cupo agotado bloquea antes cobro; servicios no inventariables no requieren cupo. Nuevas políticas no reinterpretan documentos/cupos históricos.

Validación incluirá SQLite real y laboratorio Android aislado si el entorno lo permite; no declarará code validado si falta evidencia requerida. No se genera release firmado, sube versionCode, instala com.clicpos.app operativo, publica Cloud Admin o despliega producción por esta solicitud. Guía APK se usa para proteger dispositivos/identidad; laboratorio sintético propio no sustituye promoción o testing productivo.

G0/G1 ratificados PASS por /root/operations_review sobre el plan035d34e5 y ambas bases. Copia del dictamen independiente y diagnóstico POS en planning/. Se asigna único developer /root/implementation tras la ratificación. Los gates de implementación/review/QA/sync/offline/device/performance permanecen pendientes; el candidateSha de la evidencia se reconciliará con el candidato real por los evaluadores, sin autoaprobar resultados.
