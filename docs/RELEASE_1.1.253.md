# APK 1.1.253 — desglose fiscal en cierres

- Fuente: `8c417b04d04e67cce889852b588d28dddef22f30`, PR #518 integrado en develop.
- Versión: `1.1.253`, versionCode `1253`.
- Release anterior: 1.1.252, fuente `18a0e625d7da842f1798796f1fbcb05f6cd37388`, ancestro comprobado del candidato.
- Conserva el desglose fiscal calculado en ventas normales y mixtas para que los cierres X/Z impriman conceptos como ITBIS y propina legal por separado.
- Recupera la tasa de ventas anteriores solo cuando los importes fiscales persistidos por línea coinciden con el impuesto del encabezado.
- Package `com.clicpos.app`; HTTP LAN habilitado y verificado. Android nativo sin cambios funcionales respecto al release anterior.
- APK: `Clic-Pos-1.1.253-release.apk`, 33,289,887 bytes.
- SHA-256: `02e8856f2711cd410c293373958ce854bf79d492284f73fe83d8a41c00bf6148`.
- Certificado: CN=CLIC POS, OU=Mobile, O=CLIC POS, L=Santo Domingo, ST=Distrito Nacional, C=DO.
- SHA-256 certificado: `17746ded8c0d08a839ac5c3e84903b46c6f537f798d053a94e021355af188e2c`.

## Validación

`npm ci`, TypeScript/Vite y 69 pruebas correctas en la fuente limpia exacta. La suite incluye la matriz operacional y las regresiones de cierre, desglose fiscal y presentación del ticket. Gradle: BUILD SUCCESSFUL en 21 s; firma y HTTP LAN verificados. ESLint no está disponible por falta de `eslint.config.js`; lintVital pasó.

## POS físico

Actualizado `10.0.0.123:5555` (Aptio_CRB) con `adb install -r`: Success, desde 1.1.252/1252 hasta 1.1.253/1253. Launcher resuelto, proceso estable durante más de 15 segundos, POS-001 y usuarios Felix/Jonas/MercaSend conservados y fecha de primera instalación intacta. No hubo crashes, errores WebView, fallos de transporte ni bloqueo cleartext en logs acotados.

No se borraron datos ni se crearon ventas, pagos o cierres. Pendiente físico: realizar una venta gravada con propina legal y confirmar que el próximo cierre imprime `ITBIS 18%` y `Propina legal 10%` en líneas separadas; reimprimir un cierre previo con líneas fiscales persistidas para verificar la recuperación compatible.
