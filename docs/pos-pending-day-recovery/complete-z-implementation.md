# Cierre Z después de recuperación

## Cambio

El flujo existente prepara y confirma un único Z contra ERP. La preparación v2 liga el manifiesto recibido y el hash del descriptor, con configuración explícita CURRENT_AT_PREPARATION; no traduce preparaciones v1 ni afirma configuración histórica. Antes de preparar se completa el respaldo y se descarga un snapshot consistente. ERP debe anunciar retainedSelectionVersion=1 para habilitar este camino.

Publicación local tras ACK: un espejo abierto en transactionHistory solo puede sustituirse si coincide íntegramente con el ticket activo; historiales cerrados o discrepantes siguen bloqueados. Se guardan el Z, los vínculos de pertenencia y las postimágenes de respaldo en la misma transacción SQLite. Las postimágenes llevan closeCommitId; conservan marcadores locales contra reenvío y sus contadores técnicos aumentan dentro de la época autorizada. Repetir el ACK publicado no crea otra revisión ni otro Z. Los contadores documentales usan el máximo local/remoto, sin retroceder.

La siguiente descarga debe validar esas postimágenes contra el commit durable en ERP. El historial cerrado se conserva como contexto; no se reabre como venta pendiente. No se ejecutan appliers comerciales desde este flujo.

## Evidencia

116 pruebas aprobadas sin omisiones, build Vite aprobado. La suite incluye pérdida de ACK, rollback atómico, publicación idempotente, espejos de historial y captura de postimágenes. Preparación v2 prueba binding del manifiesto, conservación de IDs y rechazo de un cambio de descriptor en el mismo intento.

Además se usó una copia privada de la descarga real de demo (tres tickets) en SQLite y PostgreSQL aislados. ReceivedCloseFlow validó el ACK y packet producido por ERP y publicó tres históricos y un Z; repetir preservó cuatro postcapturas. ERP contrastó las cuatro imágenes reales contra su ACK. La declaración de esa prueba es sintética, explícitamente offline, y no representa arqueo físico. Los fixtures privados no se incluyen en Git.

## Límites y puesta en demo

Este documento describe código probado, no un cierre real ya emitido. Requiere integrar la contraparte ERP, su migración/capability y el APK actualizado antes de la confirmación del usuario en la pantalla habitual de Z. El emulador sigue con sus ventas abiertas mientras se valida la entrega.

Cobertura RECEIVED_ONLY: no demuestra movimientos que nunca llegaron al ERP. exactZEligible=false se conserva; el único permiso tras commit válido es GRANTED_RECEIVED_SCOPE. Los estados comerciales observados se mantienen separados de la verificación financiera agregada (PENDING/NOT_EVALUATED), sin reenviar ventas o cobros para resolver esa incertidumbre. No se cambia pairing/takeover ni el cálculo Z.
