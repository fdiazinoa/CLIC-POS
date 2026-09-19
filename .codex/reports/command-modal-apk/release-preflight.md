# RELEASE — preflight independiente de APK candidato

Rol/sessionId: RELEASE `/root/release`. Fecha: 2026-09-19. Fuente inspeccionada: `06ed4f72915d32651a0776eddfaf1798f21b9f02`; base develop local: `bcbc46c02d74246da16698cae54e3887a11e6ffd`.

## Alcance y dictamen

El coordinador comunica nueva autorización expresa del usuario: generar un único APK candidato con fix sync PR742 y UI PR743 e instalar SOLO en el emulador. Esta autorización reemplaza la prohibición previa de generar APK para este alcance concreto; no autoriza publicar versión, Cloud Admin, terminal Cliente, Master ni promoción. Cliente/Master y demás topologías físicas permanecen pendientes.

Preflight de trazabilidad: PASS. Preflight completo para iniciar build: PENDING del prebuild y verificaciones de fuente limpia exacta que ejecuta coordinador. Aprobación del artefacto: PENDING, aún no generado/verificado por este rol. Promoción/release global: BLOCKED por gates runtime/performance/topologías pendientes; no se emite APPROVED_FOR_INTERNAL_TESTING ni aprobación de producción.

## Evidencia comprobada directamente

- Worktree fuente actual limpia: `git status --short` sin salida; HEAD exacto `06ed4f72915d32651a0776eddfaf1798f21b9f02`.
- `git merge-base --is-ancestor` retorna 0 individualmente para origin/develop bcbc46c, baseline obligatoria `766be5b8c15f4ca69da3527b5f8e35ae0f3877f5`, source del APK anterior `7bb04dcd5004c74353c6dda8305aa1be5bb4090e`, hotfix Master HTTP `bcd71c8`, fix sync `70498f5` y UI `7c0be6fb`, contra la fuente actual. No se pierden esos ancestros; no hace falta equivalencia squash.
- `git cherry -v 06ed4f7 7bb04dc` no reporta commits faltantes.
- Worktree firmada canónica limpia y HEAD `7bb04dcd5004c74353c6dda8305aa1be5bb4090e` antes del build. Aún debe alinearla el protocolo al source candidato.
- Reporte canónico 1.1.406: versionCode1406, source7bb04dc, HTTP LAN=true, assets/prebuild declarados verificados; promotionGatePassed=false. Se usa como referencia histórica, NO como release promovido acreditado.
- QA web final `82749aa` declara PASS; las diferencias posteriores de 06ed4f7 son documentación. Performance exploratoria conserva BLOCKED global, n20/una sesión y sin Android. No se convierte en PASS mediante esta autorización.

## Condiciones antes/durante una única compilación

Leer/ejecutar el script perteneciente al source exacto desde checkout limpio, no otra copia. La rama piloto comunicada debe basarse en develop e integrar UI mediante fast-forward, manteniendo el SHA o reconfirmando las comprobaciones de ancestralidad y diff si cambia. Coordinar fetch fresco antes de construir y verificar que el origin/develop actualizado siga incluido.

Ejecutar npm ci, build fuente y suite operacional/específica además de prebuild sin skip. El script canónico ejecuta prebuild antes de editar versión/Gradle, build y cap sync en worktree firmada, verifica dist frente a assets, usa una sola assembleRelease y exige política HTTP/firma. Declarar `CLIC_POS_RELEASE_LAN_HTTP_ENABLED=true` explícitamente. El script no sustituye revisión independiente del APK producido.

Versión siguiente debe ser monótona respecto a1406 y metadata real de todas las salidas; no se certifica aquí un número futuro. Tras build verificar APK y metadata, package com.clicpos.app, cert baseline `17746ded8c0d08a839ac5c3e84903b46c6f537f798d053a94e021355af188e2c`, SHA256/size, manifest cleartext true, flags release y hashes efectivos de assets dentro del ZIP contra reporte/dist. Conservar source y versión formalizados sin copiar secretos.

Instalación solo después de verificación independiente, serial emulador identificado, inspección del APK instalado, firma compatible y upgrade `adb install -r` sin clear/uninstall/downgrade. Estado posterior sigue APK candidato; smoke y conservación de identidad/SQLite/config se acreditan por QA. No inventar promote PASS ni equivaler emulador a Cliente/Master.

Fuentes leídas: skill clic-pos-apk-installation completo, AGENTS/WORKFLOW, contrato RELEASE/checklist, constitución APK, checklist APK, protocolo agentes, baseline y script release-android.sh. No se modificó código ni scripts; no se ejecutó build, instalación o despliegue por este rol.
