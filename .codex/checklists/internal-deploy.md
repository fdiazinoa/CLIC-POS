# Checklist internal-deploy

Cada punto pertinente requiere SHA/manifest, entorno/rol/flags, esperado/observado y evidencia. No ejecutado = BLOCKED, no PASS.

- [ ] APPROVED_FOR_INTERNAL_TESTING y verify stage internal con todos los gates y artefacto exacto.
- [ ] Filename/versionName/versionCode/commit/build/date/size/SHA256/certificado/package; logs firma/version/flags prueban release limpio.
- [ ] Proveedor upload/endpoint/credencial servidor y canal interno realmente corroborados: hoy BLOCKED sin implementarlos.
- [ ] INSPECT_CURRENT guarda referencias/estado; reconcile list antes de reintentar create no idempotente.
- [ ] UPLOAD_NEW→VERIFY_STORAGE→PUBLISH_INTERNAL→VERIFY_DOWNLOAD→CLEANUP o RETAINED; nunca borrar primero.
- [ ] Crear explícitamente internal_testing en pos-apk-releases-api; jamás available ni public latest para verificar interno.
- [ ] Descarga directa/UI/registro/size/hash corresponden al APK aprobado; no HTML/Drive confirmation como APK.
- [ ] Retener versión anterior hasta verificación; cleanup solo política comprobada; falla parcial aborta y conserva/recupera referencia cuando posible.
- [ ] Reporte completo artefacto/gates/steps/referencias/ambiente; no production approval ni declarar PASS por metadata.
