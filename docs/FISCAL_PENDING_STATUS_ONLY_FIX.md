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

- La consulta exige sesión vigente, dispositivo vinculado, credenciales procedentes del registro/autenticación ERP y coincidencia exacta de tenant/empresa/tienda/terminal/dispositivo. El ERP valida los mismos encabezados en el GET. Rechazos 401/403 se muestran como problema de sesión/dispositivo.
- El vencimiento histórico del vínculo se conserva íntegro y forma parte del fingerprint de carrera. No sustituye el vencimiento de la sesión vigente. `captureFiscalBoundContext`, usado para emisión, conserva su guard original.
- Solo se consulta si existe intento previo y scope persistido válido con checksum del original. El botón no genera autorizaciones de búsqueda ni infiere el entorno histórico.
- Aceptado pasa a `SYNCED`; rechazado inequívoco pasa a `ERROR`, con prueba y motivo. Pendiente, identidad ambigua, scope ausente, error de red o fallo de escritura conservan la evidencia. No se consumen reintentos de clasificación.
- Las escrituras atómicas existentes preservan identidad fiscal, importes, impuestos, pagos y datos independientes del historial; no crean documentos, eventos ni números fiscales.
- Pulsaciones simultáneas comparten la consulta. El resto de la reconciliación automática conserva su comportamiento.

## Iteración correctiva P1–P5

El candidato inicial `7e385adc51e749dd1230d610c00df11e2983fdd0` tenía dos hallazgos adicionales. Antes de cambiar su implementación se reprodujeron ambos mediante regresiones: las cuatro fuentes legítimas de recuperación de credenciales devolvían `FISCAL_TERMINAL_AUTH_REQUIRED`, y el contexto manual frío invocaba la sesión operacional, cuya apertura puede solicitar maestros por POST y escribir preparación local. Las pruebas anteriores sustituían ese contexto y no detectaban ese recorrido.

La consulta manual ahora acepta exactamente `ERP_REGISTER`, `ERP_REGISTER_REAUTH`, `ERP_REGISTER_REFRESH`, `ERP_AUTH_REAUTH` y `ERP_AUTH_REFRESH`, manteniendo los demás controles de sesión/dispositivo/scope. `captureFiscalBoundContext` y la función de emisión `syncFiscalDocument` permanecen idénticos, byte por byte, al candidato inicial.

`context(originalOnly)` selecciona únicamente para esa acción una lectura local del binding autorizado, configuración persistida, runtime activo con contrato >= 2 y owner coincidente. No abre sesiones operacionales, conecta/prepara catálogos, descarga, registra, refresca credenciales ni escribe configuración. Si falta ese contexto, conserva el pendiente y explica que debe validarse la preparación de la terminal. La selección predeterminada, automática y de impresión conserva su recorrido existente.

La identidad/base/origen, credenciales y ambas fechas, scope fiscal persistido, runtime y owner se comparan con los valores capturados antes de la petición y del commit; los cambios bloquean la reconciliación. Las escrituras de estado siguen usando el mismo CAS atómico sobre el original y su historial.

## Validación técnica de implementación

Ejecución local con **Node 24.11.1**; WORKFLOW/CI prescribe Node 22. No se atribuye a esta ejecución validación en Node 22.

- `tsx --test tests/fiscal*.test.ts tests/msellerFiscalIntegration.test.ts tests/terminalFiscalProviderSnapshot.test.ts tests/terminalAuthorizationGuard.test.ts tests/largeMasterSyncV3CheckoutAuthority.test.ts tests/largeMasterSyncV3RefundAuthority.test.ts tests/posFiscalStatusRefresh.test.ts`: **543 pruebas completadas, cero fallos**.
- Incluye **118 pruebas de reconciliación**; las manuales ejecutan callback y contexto reales extraídos de App, transporte de estado con fetch simulado y adaptador SQLite real. Aceptado/rechazado/pendiente, red, sesión vencida, 401/403, identidad ambigua, rollback del historial, carreras de auth/base/origen/config/runtime/owner y veinte pulsaciones → un GET/un batch. Contexto ausente/inconsistente → cero peticiones/cero escrituras; ninguna llamada a bootstrap/POST/descarga/ISSUE y ningún documento/NCF/evento nuevo.
- `npm run build`: compilación TypeScript/Vite completada; advertencias de tamaño de chunks y Browserslist.
- `npm run lint`: cero errores, 39 advertencias.
- `git diff --check`: sin errores.

Estos resultados son evidencia del desarrollador, **no aprobación de QA/review/sync/performance**. Quedan pendientes las revisiones independientes sobre el nuevo SHA, suites transversales exigidas por el selector, repetición con Node 22, smoke Android contra ERP real y medición comparable baseline/candidato. Ningún gate requerido se declara aprobado o prescindible por falta de entorno. No se compiló/instaló APK, desplegó ERP, reemitió e-CF ni activó bindingEvidence.

El candidato inicial se implementó antes de leer el procedimiento multiagente actualizado y sin aprobación independiente previa del plan; esa omisión histórica no se subsana retroactivamente. Esta iteración sí sigue el análisis P1–P5 y aprobación prospectiva independiente registrados externamente. El cliente expone identidades de agentes delegados, pero no selección nativa de roles ni UUID de sesión independiente; no se inventan firmas o identidades.

## Panel de operación de prueba

La petición adicional de excluir «Preparar una operación de prueba» / «Marcar la próxima venta nueva» del próximo APK no requiere borrar UI en esta base: `origin/develop` y esta rama no contienen `FiscalPreparationPanel`, `FiscalSinglePreparation`, `NativeCaja6Preparation` ni esos textos. El panel se rastreó en otra worktree/candidato; no se copiaron ni editaron sus archivos. Los assets compilados de esta rama se revisan para confirmar la misma ausencia. Esta comprobación de fuente/assets no certifica un APK instalado; deben verificarse el SHA y los bytes del próximo artefacto antes de distribuirlo. Se conservan datos y flags.

## Observación adicional: TCK6000033

Consulta de solo lectura solicitada durante esta tarea: ticket `TCK6000033`, NCF `E320000000513`, original `TXN-1792264366763-lttq228vo`.

Los eventos existentes `SALE_POSTED` y `PAYMENT_POSTED` llegaron a `erp_sync_inbox`, ambos en `FAILED` con `FISCAL_V3_SELECTED_APPLICATION_HELD`. No tienen plan de aplicación ni resultado de aplicación. La búsqueda en `erp_sales_documents`, acotada a tenant/empresa y ticket/NCF, no devolvió factura. Este bloqueo ocurre en la aplicación de la venta en el ERP, antes de disponer de un documento fiscal original consultable; este PR no lo corrige ni reintenta su aplicación. Se conserva para diagnóstico y corrección aparte del ERP, sin cambios de configuración ni datos.
