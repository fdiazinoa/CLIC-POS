# Recuperación automática al volver a vincular

La detección autenticada existente inicia `AutomaticRecovery` cuando ERP habilita
el contrato para la terminal. No modifica pairing ni takeover.

La primera ejecución requiere que todas las colecciones operacionales estén vacías
y que la captura local no tenga secuencias previas. Por ello una actualización con
ventas, movimientos, wallet o historial existente no inicia una importación.
Una marca por contexto en SQLite conserva el intento pendiente y permite reanudarlo
incluso si la importación atómica terminó pero falló la continuidad posterior.

El flujo reutiliza `download()` y `restoreRetained()`: verifica el snapshot y sus
relaciones, restaura el conjunto retenido y establece la continuidad mediante los
servicios existentes. No utiliza la reconstrucción legacy por fechas ni vuelve a
enviar eventos comerciales. Un snapshot vacío completa la comprobación sin recargar.
Los conjuntos sin manifiesto válido se mantienen bloqueados para revisión.

La interfaz muestra etapas reales (descarga/verificación, restauración y finalización),
sin porcentajes temporales. Su suscripción se limita al modal. Un fallo muestra el
detalle y permite reintentar; un éxito recarga el POS para leer los documentos
restaurados. El cierre Z permanece manual. El respaldo no demuestra que operaciones
que nunca salieron del dispositivo estén presentes.

Validación: build web y 124 pruebas operativas/de recuperación, incluidas cinco
pruebas de orquestación con SQLite. Cubren repetición concurrente, reinicio tras fallo,
aislamiento de contexto, BD existente, continuidad fallida después de importar y
snapshot vacío. Los verificadores de descarga, importación atómica y ERP se mantienen
en la suite. La prueba de la nueva interfaz en APK requiere una nueva versión; el
APK 1.1.308 todavía no contiene esta mejora.
