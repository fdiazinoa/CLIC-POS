# RELEASE — verificación independiente APK candidato 1.1.407

Rol/sessionId RELEASE `/root/release`. Dictamen: **VERIFIED CANDIDATE FOR EMULATOR ONLY**. Bajo la autorización expresa del usuario, el artefacto verificado puede pasar a instalación preservando datos SOLO en el emulador identificado, tras inspección compatible del APK instalado. No es aprobación de promoción, publicación, Cliente, Master ni gate global de producción.

Fuente: `00b687112522bfa6eb872fcf2f9c8f6b6fa30b31`. Versión1.1.407 / code1407, package `com.clicpos.app`, variante release. Tamaño33391757 bytes. SHA256 `8d2b2d55aadb9eee6013637a9d52701b96afb204f08d424f5ce79337e419f9e5`. Certificado SHA256 `17746ded8c0d08a839ac5c3e84903b46c6f537f798d053a94e021355af188e2c`, coincide baseline golden; apksigner independiente confirma firma v2 válida, un firmante CN=CLIC POS.

## Verificación efectuada

- Log canónico: BUILD SUCCESSFUL, reporte source exacto y version407/code1407. HEAD de worktree firmada coincide con source y git diff vacío. Commit de versión único delta funcional respecto a06ed4f7.
- Prebuild del artefacto: PASSED para source exacto. Logs revisados:117/117 prebuild y60/60 operacional, cero fallos/skip.
- Ancestralidad reconfirmada para origin/develop, golden766be5, APK anterior7bb04dc, hotfixMasterHTTPbcd71c8, sync70498f5 y UI06ed4f7. Ninguno se pierde.
- `apksigner verify --verbose --print-certs`, `aapt dump badging` y `aapt dump xmltree` ejecutados independientemente contra bytes finales. Package/versión y metadata coinciden; cleartextTraffic=true. No atributos debuggable/testOnly en manifiesto.
-44 assets del reporte se verificaron SHA256 individualmente dentro del ZIP y contra dist y assets/public en worktree firmada; todos coinciden. Solo extras públicos: cordova.js y cordova_plugins.js, ambos vacíos y coincidentes con salida Capacitor. No se sustituyen assets del nuevo modal por bundles antiguos.
- El primer intento se detuvo en fetch DNS antes de Gradle; el coordinador resolvió transporte por override Git por proceso y repitió protocolo. El intento completo observado finalizó correctamente; no se atribuye build exitoso al intento fallido.

Manifest/logs independientes: `/tmp/command-modal-apk-signature.log`, `/tmp/command-modal-apk-badging.log`, `/tmp/command-modal-apk-manifest.log`. Metadata completa y rutas de artefacto/reportes: `/tmp/command-modal-apk-release-verification.json`.

## Límites que se conservan

APK **candidato**, promotionGatePassed=false. No se ejecutó instalación por RELEASE. QA emulador y conservación de SQLite/identidad/pairing siguen al upgrade `adb install -r`; no borrar/resetear/desinstalar ni downgrade. Cliente/Master/toma de pedidos físicos y presupuestos/runtime globales permanecen pendientes. No se emite CODE_VALIDATED global, APPROVED_FOR_INTERNAL_TESTING ni release producción a partir de esta verificación limitada.
