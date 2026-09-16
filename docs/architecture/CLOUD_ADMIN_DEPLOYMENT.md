# Cloud-Admin: APK POS y publicación interna

Auditoría independiente local solo lectura, 2026-09-16: repo hermano Cloud-Admin, SHA 67c502590d4af91c87daa38702f6d29c05125b59, rama fix/terminal-device-request-canonical-id. Sin cambios tracked; datos untracked ajenos preservados. Las cuatro fuentes APK principales no diferían de refs locales origin/main 0b3da6e / origin/develop 9fc194a; refs no certificadas contra deploy remoto. No se leyeron .env ni secretos.

## Implementación real (rutas relativas al repo Cloud-Admin)

| Área | Fuente | Contrato |
|---|---|---|
| Pantalla | src/App.tsx:249; src/pages/PosApkReleases.tsx:33,729 | Ruta UI /pos-apk; permiso apk_view y gestión apk_manage. URL externa requerida, default internal_testing |
| Cliente | src/lib/posApkReleases.ts:84 | supabase.functions.invoke('pos-apk-releases-api'); acciones list/latest/create/update_status |
| API | supabase/functions/pos-apk-releases-api/index.ts:94,127,191 | JWT, permisos persistidos; create metadata y cambio de status, sin upload/delete de bytes |
| Auth | supabase/functions/_shared/cloud-admin-auth.ts:55,69; supabase/config.toml:24 | getUser, actor activo/perfil/permisos y cliente service role server-side, schema landlord, verify_jwt=true |
| Metadata | landlord.pos_apk_releases; migraciones APK | version_name/code, apk_url/direct_download_url, checksum_sha256, changelog/release_type/status/summary/listas/install_notes/rollout_scope/is_latest/actor/fecha/notas |
| Transición | 20260912192818_manage_pos_apk_release_status.sql:51 | RPC set_pos_apk_release_status serializa tabla y recalcula available highest code |
| Pública | api/pos-apk/latest.ts:21,41,64 | GET/OPTIONS, CORS *, no-store; latest solo available mayor code, ?download=1 redirige 302 URL externa |
| POS consumidor | CLIC-POS services/version/posApkUpdateService.ts:52 | default cloud-admin.clicsuite.com/api/pos-apk/latest y portal /apk-pos; UI Cloud auditada es /pos-apk: alias /apk-pos no corroborado |
| CI | .github/workflows/deploy-supabase-functions.yml:5,40,79 | main aplica migraciones linked y despliega funciones; no pipeline APK internal corroborado |

APK bytes son externos. No Vercel Blob/bucket APK/upload endpoint/delete APK detectados: hosting Vercel no implica storage binario. Buckets helpdesk/knowledge no son APK. API valida URL HTTP/HTTPS (2000), version_name (80), code entero positivo, release_type enum bugfix/feature/improvement/hotfix/beta, estados draft/internal_testing/beta/available/retired, checksum opcional 64hex. Drive /file/d/id o query id se convierte backend a uc?export=download&id=...; otras URLs permanecen externas. No checksum real/version/firma/binario verificadas por API.

## Separación interna/producción

Siempre crear explícitamente internal_testing. Está fuera de latest; rollout_scope es texto informativo, no allowlist. API permite available directamente y update_status acepta cambios sin gate QA técnico. Default SQL histórico available es otro motivo para jamás confiar en defaults. Internal gate aprobado NO autoriza available. No canal privado de descarga/cohortes verificado. La URL externa puede ser accesible al público y su cache/CDN depende de proveedor.

## Secuencia obligatoria del agente internal-deploy

IDENTIFY artefacto exacto → validar manifest/firma/version/hash/bytes/gates → INSPECT CURRENT list con actor autorizado → UPLOAD NEW a proveedor contractual confirmado → VERIFY STORAGE bytes/size/hash/access → CREATE metadata internal_testing mediante API real → VERIFY Cloud UI/registro y descarga con mismo SHA-256 → CLEAN OLD solo según política, o RETAINED. Nunca latest-file ni DELETE OLD primero. Registro create no es idempotente: antes de retry inspeccionar list/referencia de tarea/hash/code para reconciliar timeout y evitar duplicado. Operación parcial registra paso y aborta sin PASS.

No usar public latest para comprobar internal_testing: se verifica list/registro/UI y URL directa. Produce INTERNAL DEPLOYMENT REPORT con manifest completo, review/QA/sync/performance, internal approval, pasos ordered, previous ref/retained y checksum descargado. Manifest/checksum/code/SHA discrepantes abortan. Retirar metadata no elimina el binario; no endpoint delete observado. Rollback de referencia disponible puede requerir retirar available superior para exponer anterior; no restaura APK instalado ni garantiza downgrade no destructivo.

## Bloqueos exactos pendientes

1. Proveedor y endpoint autenticado de upload APK no existen/corroborados en fuentes; faltan contrato, bucket/container si aplica, naming, límites/permisos/credencial servidor, verify y cleanup/retención.
2. Canal interno de acceso/download/cohorte no corroborado; definirlo sin permitir exposición/update producción.
3. Verificar schema/functions/RPC/host realmente desplegados y actor apk_view/apk_manage autorizado (latest de función exige tenants_view distinto).
4. Commit SHA/buildId/build date/size/certificate no son campos create corroborados; expediente externo conserva esos vínculos, no enviar campos inventados.
5. Create no idempotente, codes duplicados/no monotonicidad y latest sin desempate: procedimiento debe reconciliar y bloquear ambigüedad.
6. Política explícita de retención/rollback/naming. Gradle actual Clic-Pos-<version>-release.apk; clic-pos-<version>.apk es preferencia futura, no convención de storage encontrada.

Automatización upload completo = BLOCKED hasta resolver 1–3. Esta instalación provee validación local/contratos/checklists, no uploader ficticio ni publicación de APK existente. El gate técnico no sustituye permisos y estado desplegado.
