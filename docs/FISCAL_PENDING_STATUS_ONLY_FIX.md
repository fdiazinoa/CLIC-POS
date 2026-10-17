# Consulta del e-CF original desde el botón de pendientes

Base: `origin/develop` `eeee6a01c733b56f15af9c2597047be21a8be828`.
Rama: `fix/fiscal-pending-status-only`.

## Alcance

Por indicación posterior del usuario, el cambio no se restringe a Caja 6 ni a una empresa. Se aplica a la acción manual de documentos delegados a MSeller/ERP. El botón muestra **Consultar estado**. No cambia configuración ERP, emisión, proveedores directos, activación ni bindingEvidence.

Recorrido anterior: `TicketHistory.handleRetryFiscal` → `App.retryFiscalDocument` → `syncFiscalDocument` → consulta/requisito de emisión. Recorrido corregido: el mismo callback entra directamente a `FiscalStatusReconciler` en modo de consulta del original → `GET /api/sync/v3/fiscal/documents/status` → verificación de identidad y evidencia → CAS atómico existente `FISCAL_STATUS_RECONCILE` sobre `transactions` y `transactionHistory`.

## Reproducción antes de modificar la lógica

La suite existente pasó 54 pruebas. Se añadieron y ejecutaron dos regresiones antes de implementar:

1. Sesión vigente con `deviceTokenExpiresAt` histórico vencido: falló con `FISCAL_TERMINAL_AUTH_REQUIRED`, sin llegar al GET.
2. Respuesta inequívoca `REJECTED`: original e historial permanecían `PENDING` en vez de registrar el rechazo.

Ambas reproducciones son automatizadas con credenciales sintéticas y SQLite real; no se emitieron documentos de producción.

## Comportamiento

- La consulta exige sesión vigente, dispositivo vinculado, credenciales de registro y coincidencia exacta de tenant/empresa/tienda/terminal/dispositivo. El ERP valida los mismos encabezados en el GET. Rechazos 401/403 se muestran como problema de sesión/dispositivo.
- El vencimiento histórico del vínculo se conserva íntegro y forma parte del fingerprint de carrera. No sustituye el vencimiento de la sesión vigente. `captureFiscalBoundContext`, usado para emisión, conserva su guard original.
- Solo se consulta si existe intento previo y scope persistido válido con checksum del original. El botón no genera autorizaciones de búsqueda ni infiere el entorno histórico.
- Aceptado pasa a `SYNCED`; rechazado inequívoco pasa a `ERROR`, con prueba y motivo. Pendiente, identidad ambigua, scope ausente, error de red o fallo de escritura conservan la evidencia. No se consumen reintentos de clasificación.
- Las escrituras atómicas existentes preservan identidad fiscal, importes, impuestos, pagos y datos independientes del historial; no crean documentos, eventos ni números fiscales.
- Pulsaciones simultáneas comparten la consulta. El resto de la reconciliación automática conserva su comportamiento.

## Validación

- `npm exec -- tsx --test tests/fiscal*.test.ts tests/msellerFiscalIntegration.test.ts tests/terminalFiscalProviderSnapshot.test.ts tests/terminalAuthorizationGuard.test.ts tests/largeMasterSyncV3CheckoutAuthority.test.ts tests/largeMasterSyncV3RefundAuthority.test.ts tests/posFiscalStatusRefresh.test.ts`: **499 aprobadas**, cero fallos.
- Incluye 74 pruebas de reconciliación: callback real del botón → transporte real con fetch simulado → adaptador SQLite real. Aceptado/rechazado/pendiente en dos scopes distintos; red; sesión vencida/ausente; dispositivo no autorizado/revocado; 401/403; scope/documento/referencia incorrectos; falta de scope/intento; JSON inválido; rollback si falla el historial; cambios durante el GET; veinte pulsaciones → un GET/un batch. Todos los requests de esa ruta son GET de estado; cero ISSUE/duplicados; outbox y datos financieros preservados.
- `npm run build`: aprobado (advertencia de tamaño de chunks).
- `npm run lint`: cero errores, 39 advertencias.
- `git diff --check`: aprobado.

Pendiente: smoke de la versión candidata instalada en Android contra una respuesta ERP real de un envío original inequívocamente identificado. No se compiló/instaló APK, desplegó ERP, reemitió e-CF ni activó bindingEvidence.

## Observación adicional: TCK6000033

Consulta de solo lectura solicitada durante esta tarea: ticket `TCK6000033`, NCF `E320000000513`, original `TXN-1792264366763-lttq228vo`.

Los eventos existentes `SALE_POSTED` y `PAYMENT_POSTED` llegaron a `erp_sync_inbox`, ambos en `FAILED` con `FISCAL_V3_SELECTED_APPLICATION_HELD`. No tienen plan de aplicación ni resultado de aplicación. La búsqueda en `erp_sales_documents`, acotada a tenant/empresa y ticket/NCF, no devolvió factura. Este bloqueo ocurre en la aplicación de la venta en el ERP, antes de disponer de un documento fiscal original consultable; este PR no lo corrige ni reintenta su aplicación. Se conserva para diagnóstico y corrección aparte del ERP, sin cambios de configuración ni datos.
