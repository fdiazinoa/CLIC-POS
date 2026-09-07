# Actualización del conjunto respaldado en segundo plano

El ciclo existente de BackgroundSyncManager actualiza el conjunto después de enviar operaciones y avances de series, si no hay cobro activo. Envía un lote acotado de originales y espera que no queden originales pendientes antes de capturar el manifiesto. ACK fallido conserva la misma captura para el reintento. No agrega red al commit de venta.

Las operaciones restauradas reutilizan la referencia recibida del staging íntegro; se comparan sus imágenes persistidas sin `_posRecovery` y se bloquea una modificación no respaldada. Nunca se recapturan como nuevas ventas.

El trabajo automático requiere `retainedSet` local previo de la misma época. Una base recién creada o perdida no publica un conjunto vacío ni reemplaza el remoto. La primera activación y la continuación después de perder toda la base requieren establecer autoridad explícita; este commit no demuestra ni implementa CAS remoto de continuidad.

Fuente de arranque: origin/develop 8973297, incluye PR #580 dcb31e2 y APK anterior bcdb7e6. Pruebas de padrón vacío y restantes suites: 111 pasan; pruebas específicas cubren originales antes del manifiesto, recuperación sin recaptura, ACK/repetición y base vacía sin publicaciones.
