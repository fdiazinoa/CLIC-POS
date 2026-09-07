# Actualización del conjunto respaldado en segundo plano

El ciclo existente de BackgroundSyncManager actualiza el conjunto después de enviar operaciones y avances de series, si no hay cobro activo. Envía un lote acotado de originales y espera que no queden originales pendientes antes de capturar el manifiesto. ACK fallido conserva la misma captura para el reintento. No agrega red al commit de venta.

Las operaciones restauradas reutilizan la referencia recibida del staging íntegro; se comparan sus imágenes persistidas sin `_posRecovery` y se bloquea una modificación no respaldada. Nunca se recapturan como nuevas ventas.

El trabajo automático requiere `retainedSet` local previo de la misma época. Una base recién creada o perdida no publica un conjunto vacío ni reemplaza el remoto. La primera activación y la continuación después de perder toda la base requieren establecer autoridad explícita; este commit no demuestra ni implementa CAS remoto de continuidad.

Fuente de arranque: origin/develop 8973297, incluye PR #580 dcb31e2 y APK anterior bcdb7e6. Pruebas de padrón vacío y restantes suites: 111 pasan; pruebas específicas cubren originales antes del manifiesto, recuperación sin recaptura, ACK/repetición y base vacía sin publicaciones.

## Ensayo real de pérdida completa y revinculación (7-sep-2026)

Se verificó respaldo íntegro, se ejecutó `pm clear com.clicpos.app` SOLO en el emulador de pruebas 127.0.0.1:6555 y se comprobó la desaparición de SQLite antes de arrancar. No se reinyectaron credenciales, configuración ni datos de la copia privada. El usuario activó y vinculó de nuevo la misma Caja01; el APK 1.1.304 cargó cuatro usuarios desde ERP.

Hallazgo de despliegue: también se perdió la bandera local de prueba. La primera descarga rechazó RECOVERY_NOT_AVAILABLE. Tras verificar capabilities HTTP200 para el scope demo exacto, se reactivó exclusivamente `clic_pos_feature_pending_operations_recovery` en ese emulador. Este paso manual NO es habilitación automática demostrada.

El APK descargó 21 originales desde ERP, snapshot `4cdd8318-55db-431a-b8d3-b7148f683eb8`, digest `20f85af7ca4e29eedb993290cc15471a85f7a5c599007bb5d7aeed7df22b3d68`, manifiesto receipt21. Preflight pasó con cuatro ubicaciones. Restore publicó dos ventas y dos entradas de historial; todos los campos persistidos coinciden con el estado anterior, excluyendo únicamente el nuevo marcador `_posRecovery`. Los cobros conservan DOP1650 efectivo y USD25 tarjeta a tasa60 (DOP1500). Repetir restore devolvió4 sin duplicados. La nueva base contiene cero recoveryOriginals y cero Z.

Productor nativo Z y anexos antes/después: igualdad exacta; hash tipado `7829481ee9a1ef35706cafba3f79143e171f867addd06ade403185b372307edc`, CASH1650, CARD1500, dos transacciones. Se usó la misma entrada de efectivo esperado para comparar; no se confirmó declaración física ni se emitió cierre.

La prueba de recuperación tras pérdida completa pasó con habilitación manual de la bandera y ejecución del método del APK. No acredita un flujo enteramente automático para usuario final. Permanecen pendientes habilitación durable de la función tras revincular y continuidad de publicación con autoridad/CAS ERP después de perder la época local. No se reutilizó una época ni contador remoto a ciegas.
