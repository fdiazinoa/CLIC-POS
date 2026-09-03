# APK 1.1.254 — cobro no bloqueante

- Fuente funcional: `c05f8344149b730f914178267646c81e020c47ef`, PR #520.
- Versión: `1.1.254`, versionCode `1254`.
- Release anterior: 1.1.253, fuente `8c417b04d04e67cce889852b588d28dddef22f30`, ancestro comprobado del candidato.
- Publica la venta completada inmediatamente después de confirmar la persistencia local.
- Ejecuta apertura de cajón, impresión integrada y correo después de liberar la pantalla de cobro.
- Difiere el recálculo completo del kardex y la recarga del catálogo sin omitir la persistencia de movimientos.
- Propaga secuencias remotamente en una cola ordenada que no bloquea al cajero.
- Elimina la segunda persistencia de la secuencia desde `App`; `transactionService` conserva la responsabilidad del incremento durable.
- Package `com.clicpos.app`; HTTP LAN habilitado y verificado. Android nativo sin cambios funcionales respecto al release anterior.
- APK: `Clic-Pos-1.1.254-release.apk`, 33,289,883 bytes.
- SHA-256: `d423f00647398859bbbe09fa991d5a2962b053ced5097240e4e02993e9ac353d`.
- Certificado: CN=CLIC POS, OU=Mobile, O=CLIC POS, L=Santo Domingo, ST=Distrito Nacional, C=DO.
- SHA-256 certificado: `17746ded8c0d08a839ac5c3e84903b46c6f537f798d053a94e021355af188e2c`.

## Validación

`npm ci`, TypeScript/Vite y 67 pruebas correctas en la fuente limpia exacta: 14 regresiones de checkout/impresión y 53 pruebas de la matriz operacional Android. Gradle: `BUILD SUCCESSFUL` en 19 s; firma, package y HTTP LAN verificados. Los 44 assets web fueron empacados por Capacitor desde el build del mismo commit. ESLint no está disponible porque el repositorio no contiene `eslint.config.js`; `lintVital` pasó.

## Instalaciones

- Canario `127.0.0.1:6555` (Pixel_C): `adb install -r` exitoso desde 1.1.253/1253; proceso estable tras 15 segundos, SQLite existente y terminal POS-001 conservadas, sin crashes ni errores de transporte/cleartext.
- POS `10.0.0.123:5555` (Aptio_CRB): `adb install -r` exitoso desde 1.1.253/1253; proceso estable tras 15 segundos, POS-001, usuarios Felix/Jonas/MercaSend y fecha de primera instalación conservados, sin crashes ni errores de transporte/cleartext.

No se borraron datos ni se crearon ventas, pagos o cierres. Pendiente físico: cobrar una venta en efectivo con cajón configurado por impresora, confirmar que la pantalla de éxito aparece sin esperar la respuesta del puerto y validar que inventario y próximo número de ticket queden correctos.
