# Formas de pago ERP — release 1.1.250

- Fecha: 2026-09-03.
- versionName: `1.1.250`; versionCode: `1250`.
- Fuente exacta: `1ad60f526605b1066bb4fb34305e054438bb41fa` (PR #512 integrado en develop).
- Release anterior: 1.1.249, fuente `0c3a3ea2910fe41ea59a374b4f8825936eb8e222`.
- El commit anterior es ancestro de la fuente; conserva los fixes de arranque #509 y tablet #510.
- Package: `com.clicpos.app`; certificado CN=CLIC POS.
- Tamaño: 33,287,551 bytes.
- SHA-256 APK: `509d22223117cbd49665eb59b4fb58cd7f7f6951431884958918e03f8aa3d7be`.
- SHA-256 certificado: `17746ded8c0d08a839ac5c3e84903b46c6f537f798d053a94e021355af188e2c`.

## Cambio incluido

El catálogo de formas de pago del ERP se descarga y persiste en la colección local y en la configuración consumida por el cobro. Propaga nombres, desactivaciones y bajas, sin restaurar métodos predeterminados cuando la lista ERP queda vacía. Mantiene el catálogo previo ante errores de transporte o respuestas incompletas y conserva el comportamiento del modo local.

La corrección fiscal de PANCUVI fue resuelta en el ERP según confirmó el usuario. Este APK no agrega un cambio fiscal en el POS.

## Validación del release

- npm ci y TypeScript/Vite build en worktree limpia del commit fuente: PASS.
- 88 pruebas: diez archivos de la suite operacional obligatoria, erpPaymentMethods, paymentMethodsSyncIntegration, startupSecuritySnapshot, startupConfigEvents, paymentDrawerPolicy y paymentReceiptPresentation: PASS.
- 42 archivos web comparados por SHA-256 con Capacitor antes de Gradle y con el APK firmado: PASS.
- Gradle clean assembleRelease: BUILD SUCCESSFUL en 19 s.
- Firma, package, versión y metadata: PASS; mismo certificado que 1.1.249.
- HTTP LAN habilitado explícitamente: usesCleartextTraffic=0xffffffff.
- Código nativo Android sin cambios frente al release previo, excepto versión.
- npm run lint: bloqueado por ausencia previa de eslint.config.* requerido por ESLint 9. LintVital de Android pasó en Gradle.

## QA pendiente en Android

No se solicitó instalación; no se hizo adb install ni smoke test del APK nuevo. Tras una instalación autorizada: comprobar catálogo real del ERP en cobro, persistencia al reiniciar, conservación offline y propagación de bajas/desactivaciones. Validar funcionamiento Master/Cliente, tablet y caja local. No crear ventas, pagos ni cierres sin autorización.

Artefactos canónicos en android/app/build/outputs/apk/release de la worktree firmada: Clic-Pos-1.1.250-release.apk, output-metadata-1.1.250.json, release-report-1.1.250.txt y web-assets-1.1.250.json.
