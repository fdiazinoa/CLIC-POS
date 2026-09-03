# Arranque Android 1.1.248 — corrección y QA

En la terminal 10.0.0.123:5555 se identificó una espera acumulada por el refresco general de configuración seguido de otro refresco de configuración para usuarios y roles. La corrección consulta primero la seguridad necesaria, reutiliza esa consulta y difiere los catálogos generales hasta después de abrir la puerta de carga. Se mantiene la validación de licencia, la consulta remota de usuarios, el comportamiento offline existente y el bloqueo cuando no hay usuarios utilizables. Antes del acceso se relee el roster persistido para respetar revocaciones recibidas después de la consulta inicial.

Las sondas de red/registro local de Android también estaban tomando HTTPS del origen de assets de Capacitor. Ahora utilizan el servicio HTTP nativo en loopback:3001. Los candidatos de navegador HTTPS mantienen su comportamiento. No se cambiaron APIs, políticas ni tablas de Supabase.

## Mediciones

| Medida | Antes (1.1.246 instrumentada) | Después (1.1.248) |
| --- | --- | --- |
| SQLite | 0,693 s | 0,655–0,845 s |
| Inicialización JS hasta READY | 12,022 s | 6,640 / 9,088 / 9,285 / 6,695 s |
| Fase posterior de seguridad | 5,415 s | 0,035–0,883 s; consulta realizada antes |
| Errores SSL en la ventana de cada arranque | 13 | 0 en los cuatro arranques |
| Proceso estable al menos 15 s después de READY | Sí | Sí, cuatro arranques |

La medición visual adicional confirmó la pantalla de acceso en una captura terminada a los **10,025 s desde el lanzamiento**. Las mediciones previas de 1.1.245 daban acceso entre 14–16,6 s y 20–22,5 s. Son muestras pequeñas con variación normal de red; no constituyen un compromiso de rendimiento universal.

`READY` es un hito de inicialización interna, no el instante de pintura de la pantalla. Las capturas de los tres primeros arranques se hicieron al observar ese hito y pueden mostrar todavía el splash. La cuarta prueba esperó además a reconocer «Acceso de Sistema» mediante OCR; esa es la evidencia del acceso visible. El muestreo y la transferencia de captura agregan latencia al límite observado.

## Conservación y validación

- Instalación `adb install -r`, versión final 1.1.248 / 1248; primera instalación conservada (2026-08-31).
- Pantalla de acceso con POS-001 y los mismos tres usuarios visibles; sin activación nueva ni login durante el QA.
- Snapshot permitido de identidad/roles de terminales idéntico antes y después; `/api/config` local responde HTTP 200.
- Sin ventas, pagos, cierres, restauración/descarte de recuperación, borrado de datos ni cambios manuales de configuración.
- 118 pruebas aprobadas: matriz operacional obligatoria, escáner, timeout/eventos de arranque, trazas, reutilización del snapshot, roster vacío, fallos, revocaciones concurrentes, catálogo diferido y transporte nativo/navegador.
- `npm ci` y build TypeScript/Vite en fuente limpia exacta; Gradle release correcto en 21 s.
- 42 assets comprobados entre dist/Capacitor antes de Gradle y nuevamente dentro del APK firmado.
- Certificado CLIC POS igual al instalado; HTTP LAN habilitado (`usesCleartextTraffic=0xffffffff`).
- Lint bloqueado por falta preexistente de `eslint.config.*` para ESLint 9.
- No se hizo QA físico de tablet, periféricos, login ni operaciones comerciales.

## Trazabilidad

Fuente: `7401973c9d2661a67cb24e672aaa5a300ca8d370`, PR #509 hacia develop. Conserva por ancestralidad la fuente del último release validado (`ffd3a1f`, instrumentación 1.1.246) y todos los fixes de develop usados para 1.1.245.

APK: 33.285.155 bytes. SHA-256: `3e3e254a7584528c49aa01970f8dc2facd64fc66f788826c2677ddd8f035140b`.

Certificado SHA-256: `17746ded8c0d08a839ac5c3e84903b46c6f537f798d053a94e021355af188e2c`.

Artefactos canónicos: `Clic-Pos-1.1.248-release.apk`, `output-metadata-1.1.248.json`, `release-report-1.1.248.txt`, `web-assets-1.1.248.json`. Evidencia local: `Downloads/CLIC-POS-startup-improvement/result.json` y mediciones por arranque, sin credenciales.
