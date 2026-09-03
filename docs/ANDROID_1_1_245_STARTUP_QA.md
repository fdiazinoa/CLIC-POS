# QA de carga Android 1.1.245

El APK se generó desde `431564a` de develop, que integra el PR #507, y se instaló con `adb install -r` en la terminal solicitada. La actualización y el arranque funcionan; **la demora de carga no queda resuelta en este equipo**.

## Medición visible

Se reinició el proceso y se capturó la pantalla cada 2 segundos, sin iniciar sesión ni operar ventas. Ambas versiones seguían mostrando «Cargando CLIC POS OS» a los 20 segundos y mostraban acceso en la captura de 22 segundos (terminada a los 22,5 s). No hay mejora medible con esta resolución de muestreo. Los tiempos de Android `am start` —816 ms antes y 752 ms después— miden la actividad nativa, no el POS listo.

En ambos arranques aparecieron fallos SSL `net_error -107`. No hubo `FATAL EXCEPTION` ni bloqueo `ERR_CLEARTEXT_NOT_PERMITTED` en los logs acotados. Los marcadores JS `POS_BOOT` no están disponibles en logcat de este release: no se puede atribuir con certeza el tiempo restante a una etapa o servidor concreto. El límite de 8 segundos añadido en #507 aplica al refresco de configuración, no a todo el arranque. Permanecen otras esperas en serie, incluida inicialización/autenticación y carga de usuarios. Hace falta observar las etapas en este equipo para localizar el bloqueo restante.

## Conservación y alcance

Tras más de 15 segundos desde el acceso, el proceso siguió estable. Permanecieron el identificador visible POS-001, los tres usuarios visibles y la misma venta pendiente de recuperación. No se pulsó restaurar ni descartar. La primera instalación sigue fechada el 31 de agosto; versión final 1.1.245 / 1245. El snapshot permitido de identidad y roles de `/api/config` coincide antes y después; el servicio local respondió HTTP 200. Los artefactos entregados no contienen credenciales; no se auditó el contenido completo de SQLite. No se hicieron pruebas físicas de tablet, login, ventas, pagos o cierres.

## Puerta de release

- `npm ci` y build TypeScript/Vite: PASS en worktree limpia del commit fuente.
- 108 pruebas: PASS; incluye las 10 de la matriz operacional obligatoria, timeout/eventos de arranque, navegación tablet, escáner, coordinación de configuración y licencia.
- Lint: bloqueado por configuración preexistente ausente (`eslint.config.*` con ESLint 9); no se cambió la configuración de lint.
- Gradle: BUILD SUCCESSFUL, 29 s.
- 42 assets idénticos entre dist y Capacitor antes de Gradle, y verificados dentro del APK firmado.
- Se conserva el parche funcional de 1.1.244: frente al squash #506 solo difiere la numeración Android.
- Package `com.clicpos.app`; certificado CLIC POS idéntico al instalado; HTTP LAN habilitado en manifiesto.
- APK: 33.284.703 bytes; SHA-256 `0e6309e18c434cec2f6a93d296485324672568e348fde055effbf20dbf38dde8`.

La corrección de navegación de mesas está incluida en #507 y tiene pruebas automatizadas previas; no queda validada en una tablet física por este QA. Este commit solo registra la versión generada y el resultado de QA; no altera comportamiento adicional.
