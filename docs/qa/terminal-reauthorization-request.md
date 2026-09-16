# Solicitud de reautorización de terminal ocupada

## Causa y alcance

Base origin/develop d836456, rama fix/terminal-reauthorization-request. La tarjeta ocupada confundía permiso de transferencia local (`can_reauthorize`) con capacidad de solicitar revisión administrativa. Android devolvía 409 antes de registrar una solicitud.

La corrección conserva `can_reauthorize=false` en ERP y añade `can_request_authorization` para una terminal compatible distinta de la master. El botón abre una acción explícita. Los endpoints nativos POST/GET `/api/setup/device-requests` validan el scope de la master, roster fresco, UUID/dispositivo y campos permitidos, y delegan al ERP sin credenciales administrativas. Nunca escriben bindings. `bind-terminal` sigue bloqueando terminal ocupada y ahora rechaza explícitamente `force_transfer=true` en ERP.

El recibo solo se acepta con success=true, request_id UUID, terminal/dispositivo exactos y PENDING. Se guarda un espejo del recibo para retomar después de reiniciar el flujo. El POST repetido utiliza la idempotencia canónica ERP; no se crea una solicitud desde listados. La consulta de estado es manual, sin nuevo polling. APPROVED y binding_authorized=true son necesarios; además se verifica el contrato fresco tenant/company/store, dispositivo, tipo y master antes del binding habitual sin takeover.

Contrato ERP: PR https://github.com/fdiazinoa/CLIC-ERP/pull/2086, commit db49261e. Documentación https://github.com/fdiazinoa/CLIC-ERP/blob/fix/sync-device-authorization-request/docs/terminal-device-request-api.md. La implementación ERP fue validada localmente; su despliegue real sigue pendiente de confirmación. HTTP 404/503/403 no se muestran como solicitud enviada.

## Evidencia y restricciones

ADB de solo lectura confirmó cliente 123 con fingerprint DEV-50WKC4HD. Consulta ERP fresca confirmó Caja 01 autorizada a DEV-HUUCIX17, ORDER_TAKER y master 0f77877f-66b2-4820-b956-997cd5b4b575. CAJA-2 conserva DEV-9SQ6QCTE: la discrepancia con DEV-HQY8OXQR se documenta, no se corrige automáticamente.

No se borró BD, reinstaló, regeneró identidad, aprobó solicitudes ni transfirió bindings. Sin cambios a catálogo, Mesas, cobro, SQLite operacional o sincronización idle. No se genera APK en este PR.

## Validación automatizada

- npm ci y npm run build correctos (avisos de tamaño de chunks existentes).
- 17 pruebas focalizadas: identidad completa, recibo sin persistencia, dispositivo/terminal incorrectos, estados no aprobados, APPROVED sin binding, payload exacto, POST repetido, GET manual, endpoint no desplegado y protección nativa.
- 69 pruebas operacionales: keypad, fiscal legacy, LAN/pairing, layouts, usuarios, autorización, persistencia tras upgrade, protocolo master e idle render.
- Harness JVM compila el servidor Android real y prueba roster fresco, aislamiento, rechazo ERP, ocupación, initial-config, LOCAL_ONLY y proxy de solicitudes con recibos simulados. No demuestra persistencia ERP real ni QA de este código en APK.
- Lint global pendiente: repositorio usa ESLint 9 sin configuración flat; no se cambia su configuración en este fix.

## QA físico pendiente (después de despliegue ERP y APK expresamente solicitado)

1. Confirmar antes de tocar cliente su fingerprint actual. No limpiar datos.
2. Confirmar disponibilidad del endpoint en la URL que utiliza la master.
3. Entrar al selector en 123: solo Caja 01 compatible, sin POS-005 ni otra empresa. Abrir/cancelar no registra solicitudes.
4. Tocar Solicitar autorización; confirmar el request_id persistido en ERP para Caja 01 y ese dispositivo. Si existe la solicitud pendiente real ff405c30-1fd7-4f03-a1d1-36e997250e44 para DEV-50WKC4HD, el POST debe devolverla, no crear otra.
5. Reintentar ante respuesta perdida y verificar exactamente una fila pendiente; binding sigue DEV-HUUCIX17. Cancelar/reabrir y reiniciar conserva acceso al recibo.
6. Actualizar estado muestra PENDING. Simular errores/404 no produce éxito aparente. APPROVED con binding_authorized=false bloquea activación.
7. Probar scope ajeno y force_transfer: rechazados, sin escrituras locales ni remotas.
8. Solo tras aprobación administrativa expresamente autorizada fuera de POS: actualizar estado, confirmar contrato nuevo, activar y verificar ORDER_TAKER/CAJA-2 después de reiniciar master y cliente.
9. Medir 30 s idle y comparar CPU/frames con 1.1.393; no se asume ausencia de regresión física por pruebas de código.

No se afirma QA físico completo ni disponibilidad del endpoint desplegado.
