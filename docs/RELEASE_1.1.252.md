# APK 1.1.252 — control de impresión

- Fuente: `18a0e625d7da842f1798796f1fbcb05f6cd37388`, PR #516 integrado en develop.
- Versión: `1.1.252`, versionCode `1252`.
- Release anterior: 1.1.251, fuente `50d1043819f8a26c482a286e3a087a10e59c5235`, ancestro comprobado del candidato.
- Controla fallos y estados de tickets, vouchers, reservas, precuentas, comandas, etiquetas y cierres X/Z. Conserva la pantalla del comprobante, informa causas, permite reintento sin repetir el cobro, bloquea doble envío y distingue enviado, en cola, fallido o sin confirmar.
- Package `com.clicpos.app`; HTTP LAN habilitado y verificado. Android nativo sin cambios funcionales respecto al release anterior.
- APK: `Clic-Pos-1.1.252-release.apk`, 33,289,739 bytes.
- SHA-256: `da3cf0838524120aa4ea36522cb903eaae57094d780944e54da2a661d75ff218`.
- Certificado: CN=CLIC POS, OU=Mobile, O=CLIC POS, L=Santo Domingo, ST=Distrito Nacional, C=DO.
- SHA-256 certificado: `17746ded8c0d08a839ac5c3e84903b46c6f537f798d053a94e021355af188e2c`.

## Validación

`npm ci`, TypeScript/Vite y 77 pruebas correctas en la fuente limpia exacta. Incluye matriz operacional y regresión de impresión: error nativo, impresora ausente, doble envío, comprobante retenido y cobertura de salidas. Los 42 assets coinciden antes de Gradle y dentro del APK. Gradle: BUILD SUCCESSFUL en 19 s; firma y HTTP LAN verificados. ESLint no disponible por falta de configuración; lintVital pasó.

## Emulador

Actualizado exclusivamente `127.0.0.1:6555` (Pixel_C) con `adb install -r`: Success, desde 1.1.250/1250 hasta 1.1.252/1252. Launcher resuelto, proceso estable más de 15 segundos, POS-001 y usuarios Admin/Cajero/Supervisor conservados, fecha de primera instalación intacta y SQLite abierto. Sin crashes, `Failed to fetch`, errores WebView ni bloqueo cleartext en logs acotados.

No se borraron datos ni se crearon ventas, pagos o cierres. Pendiente: con credenciales, reimprimir una venta existente sin impresora y verificar aviso, pantalla retenida, reintento y doble clic. También quedan pruebas con impresora física conectada, apagada, sin papel y salida parcial.
