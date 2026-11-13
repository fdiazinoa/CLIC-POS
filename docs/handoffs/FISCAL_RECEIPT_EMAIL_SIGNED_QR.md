# Correos fiscales con QR firmado

Ventas E31/E32/E44/E45 y NC E34: la solicitud de correo se guarda en `fiscalReceiptEmailRequests`, separada de los documentos y eventos financieros. El cobro únicamente espera que se guarde la solicitud, nunca la firma ni el envío HTTP. Los comprobantes tradicionales conservan su envío habitual.

El proceso de fondo consulta la evidencia existente mediante el cliente fiscal vigente. Cuando obtiene evidencia firmada verificada, fija el cuerpo y `deliveryRequestId` antes del primer envío. Fuerza el QR fiscal visible sólo en el correo, conserva el QR literal del proveedor y no exige aceptación DGII. No modifica tickets ni invoca ISSUE.

La cola se recupera tras hidratación/reinicio, reconexión y notificaciones de sincronización, con pasadas acotadas y prioridad al intento más antiguo. Está separada por URL ERP, tenant, empresa, terminal y dispositivo. Doble clic pendiente reutiliza la solicitud. Los reintentos conservan el mismo cuerpo e identidad para la deduplicación existente del ERP/Resend. Una entrega incierta que supera la ventana de 24h de Resend queda en REVIEW; no se reenvía a ciegas. Reenviar deliberadamente después de una entrega confirmada crea otra solicitud.

La interfaz distingue pendiente de firma y enviado. El historial registra EMAIL_REQUESTED cuando sólo se guardó una solicitud. La aceptación del proveedor de correo no representa aceptación DGII.

## Validación local

- 93/93 pruebas en fiscalReceiptEmailQueue, fiscalReceiptEmailEvidence, fiscalPrintEvidence, receiptEmailPayload, receiptEmailService, fiscalStatusLifecycle y posUiRegressionGuards.
- Cobertura de los cinco tipos electrónicos firmados pendientes de DGII, rechazo sin firma/QR oculto, cuerpo estable ante respuesta perdida, reinicio, doble clic, alcance de empresa, fallo de almacenamiento, progreso de la cola y remount del adaptador CapacitorSQLiteAdapter sobre SQLite sintético sin cambios financieros.
- npm run build (tsc -b + Vite): aprobado.
- Revisión independiente: inanición detectada y corregida con regresión; sin bloqueantes restantes en el diff final.

No se enviaron correos reales, no se consultó MSeller real, no se instaló/generó APK ni se modificó producción o las NC reales 3 y 6. La prueba SQLite usa un puente sintético, no Android. La consulta RETURN real requiere que el consumidor fiscal correspondiente (PR #998) también esté integrado; esta tarea no lo sustituye. El servidor de correo y el proveedor conservan su contrato vigente de generación/entrega del documento.
