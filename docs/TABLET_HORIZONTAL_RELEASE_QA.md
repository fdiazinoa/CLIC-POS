# Tablet horizontal — release 1.1.249

- Fecha: 2026-09-03.
- versionName: `1.1.249`; versionCode: `1249`.
- Fuente exacta del APK: `0c3a3ea2910fe41ea59a374b4f8825936eb8e222` (PR #510, integrado en develop).
- Conserva el PR #509 y sus correcciones de arranque.
- Tamaño: 33,286,311 bytes.
- SHA-256: `b5958236532d48e0d9b30ee0005b7f8ede3095c5745fd70ebf503e9bfd540e52`.
- Package: `com.clicpos.app`; certificado CN=CLIC POS.
- Certificado SHA-256: `17746ded8c0d08a839ac5c3e84903b46c6f537f798d053a94e021355af188e2c`.

## Cambio visible

En el perfil TABLET de restaurante, horizontal, ancho mínimo 900 px y alto máximo 760 px: categorías arriba en una fila desplazable; búsqueda desplegable desde una lupa; tarifa en Opciones; barra inferior compacta con Mesas, Guardar y Cocina e indicador de conexión. Se conservan Sub-total, historial y Cierre X. Nombres en dos líneas y filas de artículos de al menos 176 px.

Reproducción de navegador a 1024×600: catálogo de aproximadamente 199 a 474 px de alto; tarjetas de aproximadamente 81 a 219 px.

## Antirregresión

El último release validado era 1.1.248, fuente `7401973c9d2661a67cb24e672aaa5a300ca8d370`. Se revisaron todos los commits marcados por git cherry: ffd3a1f, a24538a, 88c6070, d110090 y 7401973.

El squash #509 (`753a623`) tiene árbol idéntico a `495e4dd`, último commit de esa rama. Respecto de la fuente 7401973, solo difieren la versión Android y la documentación QA. 753a623 es ancestro del candidato. El squash #510 tiene árbol idéntico a 8d86060. No se pierde ningún hotfix funcional del APK anterior.

## Validación

- npm ci y TypeScript/Vite build en worktree limpia del commit fuente: PASS.
- 124 tests, incluidos los diez archivos de la matriz operacional y regresiones de arranque, navegación y perfiles: PASS.
- 42 archivos dist comparados por SHA-256 con assets de Capacitor antes de Gradle y con el APK firmado después: PASS.
- Gradle clean assembleRelease: BUILD SUCCESSFUL, 18 s.
- Firma, package, metadata y versión independientes: PASS.
- HTTP LAN explícitamente habilitado; usesCleartextTraffic=0xffffffff: PASS.
- Navegador con datos ficticios: 900×500, 1024×600, 1280×720 y 1024×520 sin imágenes; cero precios recortados. Búsqueda, filtro, cerrar buscador, Opciones, tarifa, Sub-total, Cierre X y Mesas → Mesa 1 verificados.
- Vertical 800×1280 y escritorio 1280×900 mantienen navegación.
- npm run lint: bloqueado por configuración ESLint 9 ausente en el repositorio.

## Pendiente

No se solicitó instalación para este release; no se ejecutó ADB ni smoke Android. Falta QA físico en tablet: rotación, categorías, búsqueda, selección de mesa, tarifa, scanner y operación Master/Cliente. Las comprobaciones funcionales de navegador usan datos ficticios y no sustituyen esa validación.

Los artefactos canónicos son Clic-Pos-1.1.249-release.apk, output-metadata-1.1.249.json, release-report-1.1.249.txt y web-assets-1.1.249.json en android/app/build/outputs/apk/release de la worktree firmada.
