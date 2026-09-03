# APK 1.1.251 — variantes en ticket

- Fuente: `50d1043819f8a26c482a286e3a087a10e59c5235`, PR #514 integrado en develop.
- Versión: `1.1.251`, versionCode `1251`.
- Release anterior validado: 1.1.250, fuente `1ad60f526605b1066bb4fb34305e054438bb41fa`, ancestro comprobado del candidato.
- El ticket muestra `Azul / L` por defecto. Diseño de ticket permite activar nombres (`Color: Azul / Talla: L`). Se aplica a ESC/POS, HTML y vista previa, sin cambiar la venta guardada.
- Package: `com.clicpos.app`. HTTP LAN habilitado y manifiesto verificado (`0xffffffff`). Código Android y Capacitor sin cambios funcionales respecto al release anterior.
- APK: `Clic-Pos-1.1.251-release.apk`, 33,287,847 bytes.
- SHA-256: `7a0b5d368f8ab75e916ba4e078521cd749754d1271788469be14abf27d381233`.
- Certificado: CN=CLIC POS, OU=Mobile, O=CLIC POS, L=Santo Domingo, ST=Distrito Nacional, C=DO.
- SHA-256 certificado: `17746ded8c0d08a839ac5c3e84903b46c6f537f798d053a94e021355af188e2c`, coincide con el instalado.

## Validación

`npm ci` y build TypeScript/Vite en fuente limpia exacta; 66 pruebas operacionales y regresión específica de variantes correctas. Suite: androidDiscountKeypadContract, androidOperationalKeypadContract, fiscalLegacyModeRegression, masterLanDiscovery, masterPairingConnection, posCategoryTwoRowLayout, posProductGridTwoByFour, posUserReconciliation, terminalAuthorizationGuard, terminalUpgradePersistence, erpPaymentMethods, paymentReceiptPresentation. Regresión de variantes: modo omitido/desactivado/activado, separadores de escaneo, fracciones, valores antiguos, modificadores, vista previa y ESC/POS.

Los 42 archivos web coinciden por SHA-256 entre dist y Capacitor antes de Gradle, y se verificaron independientemente dentro del APK firmado. Gradle: BUILD SUCCESSFUL (19 s), lintVital correcto. ESLint no disponible por falta de configuración en el repositorio.

## Instalación

Actualizado exclusivamente `10.0.0.123:5555` (Aptio_CRB) mediante `adb install -r`: Success. Versión anterior 1.1.248/1248; versión instalada 1.1.251/1251. Arranque con launcher resuelto y proceso estable durante más de 15 segundos. Pantalla de acceso conserva POS-001 y sus tres usuarios. Fecha de primera instalación intacta, SQLite abierto y evento MASTER_CONFIG_READY. Sin errores de crash, fetch o cleartext en logs acotados del proceso.

No se borraron datos ni se crearon ventas, pagos o cierres. Pendiente QA físico: imprimir artículo con variantes en ambos modos, persistencia de la opción, catálogo, orientaciones y operación LAN completa.

## Evidencia canónica

Directorio: `_worktrees/CLIC-POS/CLIC-POS-mobile-sqlite/android/app/build/outputs/apk/release`.

- `Clic-Pos-1.1.251-release.apk`
- `output-metadata-1.1.251.json`
- `release-report-1.1.251.txt`
- `web-assets-1.1.251.json`
