# Consumidor POS de seguridad v2 — transporte conectado, sin activación operativa

Contrato fijo: [ERP 8e2b335](https://github.com/fdiazinoa/CLIC-ERP/blob/8e2b3353504b964d50f5706a2bed1c983e2aae91/docs/development/pos-return-permission-contract-v2.md).
Wiring ERP revisado: [handoff 210102cd](https://github.com/fdiazinoa/CLIC-ERP/blob/210102cd5f14268fd5e82616a42f5da4e0e58da4/docs/development/pos-security-v2-wiring-handoff.md), PR2533 abierto al consultar. Base POS: `origin/develop` 74152192 (merge PR1012). No se cambia el contrato, digest, hash canónico ni reglas de permisos de PR1011/1012.

## Qué está conectado

- `AuthenticatedPosSecurityV2Transport` implementa el puerto existente con `requestJson` (web/nativo) y el lector existente de identidad ERP vinculada. Reutiliza sus credenciales, sin register/reauth. Envía `X-Sync-Token`, `X-Device-Id` y `X-POS-Device-Id`; comprueba que las credenciales no cambiaron durante la petición. El bindingEpoch sólo viene del GET autenticado de control, validado contra tenant/terminal/dispositivo locales autorizados. El body de POST sólo es eco, nunca autoridad. Sin logs de tokens/PIN ni nuevos headers de negociación.
- Rutas de control: GET `/api/sync/terminals/:terminalId/security-contract`; POST `/offer`, `/accept`, `/capability`. Los métodos explícitos del consumidor están disponibles; polling, recepción y reinicio **no llaman** announce/accept ni activan. Repetir aceptación conserva el acuerdo del servidor y ACCEPTED/WAIT_ACTIVATION mantiene CURRENT en floor0. No hay endpoint/botón/aprobación de activación POS.
- `PosSecurityV2Sync` inyecta transporte y adaptador durable en el consumidor existente. La inicialización de DB conecta `configureReturnSecurityContext`; el guard consulta control autenticado antes de usar un checkpoint. Error, suspensión, cambio de binding/acuerdo o falta de contexto bloquean devoluciones tras floor2. No se limpian floors/checkpoints ni se restauran roles.
- Entradas conectadas: config/initial-config → body con `terminal_config.pos_security`; config-snapshot → `domains.catalog.pos_security`; manifest → `body.manifest`; CONFIG_PUSH_V2 → `event.payload`. `currentReference` extrae `body.manifest.security_contract`; download hace GET config y devuelve `{pos_security: body.terminal_config.pos_security}`. La extracción/validación de config se comparte con el consumidor; no hay un segundo validador ni almacenamiento/resolver alternativo.
- El coordinador de initial-config valida seguridad antes del callback/cache y rechaza el 304 genérico tras floor2. Los headers añadidos a setup/manifest/config sólo se adjuntan al scope y autoridad ya vinculados. La identidad externa snapshot_id/version_hash sigue en el flujo de transporte existente, nunca en el reference normativo.
- CONFIG_PUSH valida/aplica seguridad antes de los atajos por hash/versiones/304 y vuelve a comprobar la referencia antes de ACK APPLIED. No hay APPLIED ante error, referencia antigua o commit fallido. Roles, users, checkpoint y floor usan la transacción/CAS existentes. Listas vacías reemplazan; ACTIVE sólo consume pos_security y el boundary existente rechaza escrituras legacy tras floor2.
- CURRENT sin carrier v2 ni floor2 conserva el flujo anterior. POS_RETURNS explícito, ALL literal, ADMIN protegido, personalizados, descuento y configuración Z conservan los validadores/proyector/resolver existentes.

## Evidencia local reproducible

Todos los ACTIVE y las aprobaciones son **fixtures sintéticas**. Ninguna prueba usa credenciales operativas ni registra capacidad/negocia con terminales reales.

| Comprobación | Alcance real |
|---|---|
| `tests/posSecurityV2Consumer.test.ts` | Transporte simulado + IndexedDBAdapter/fake-indexeddb: contrato/hash, permisos exactos, empty, revocación, ausencia de rol, recarga, CAS y floor. |
| `tests/posSecurityV2Http.test.ts` | HTTP loopback con handlers fixture: headers/bodies, cinco carriers, cambios de credencial en vuelo, bindings cruzados, estado ACCEPTED, refs antiguas/conflictivas, hash, acuerdo, partición, 304, commit fallido y no negociación al reiniciar. Captura de logs comprueba ausencia del token/PIN sintéticos. Incluye coordinator real antes del apply/cache. |
| `tests/configPushV2Outbox.test.ts` | Procesador outbox real con HTTP simulado y IndexedDBAdapter/fake-indexeddb conectado: no ACK durante commit pendiente; commit fallido sin publicación; referencia antigua y 304 no producen APPLIED pese a mismo version_hash; revocación durable antes del ACK. Verifica aislamiento de headers setup por autoridad/scope. |
| `tests/posSecurityV2Sqlite.test.ts` | Archivo **SQLite real de escritorio**, clase CapacitorSQLiteAdapter de producción y puente Capacitor simulado: recarga, revocación, listas vacías, CAS concurrente y fallo SQL después de comenzar la sustitución sin publicación parcial. Floor2/bloqueo persisten tras reapertura/rollback offline. No es una prueba Android. |
| `tests/posSecurityV2ErpHttp.test.ts` | Importa módulos originales ERP fijados y verifica SHA256 de siete archivos. Monta router real security-contract, servicio y autenticación originales con RPC en memoria; monta también **handler original initial-config** con dependencias ajenas de catálogo/empresa simuladas. Su envelope entra al consumidor POS y valida hash/contrato. Los endpoints config/manifest/config-snapshot de esta suite son wrappers HTTP fixture sobre el servicio ERP original, **no** los handlers completos syncInbox. |

La suite ERP es opt-in, sin descargas durante la prueba:

```sh
CLIC_SECURITY_V2_ERP_SOURCE=/ruta/a/export-ERP-210102cd \
  npx tsx --test tests/posSecurityV2ErpHttp.test.ts
```

La exportación debe ser del commit completo `210102cd5f14268fd5e82616a42f5da4e0e58da4`, sin modificar los módulos verificados, con resolución de `express` disponible. La prueba con hooks de módulos requiere Node 22.15+; QA ejecutada con Node 24.11.1. Se usó una exportación temporal separada, sin modificar el repo ERP ni instalar/aplicar migraciones.

Resultados finales se registran en la sección siguiente. Las suites CURRENT con almacenamiento mock declaran explícitamente checkpoints vacíos; no cuentan como evidencia durable v2.

## Resultados y pendientes

- Build web (`tsc -b && vite build`): PASS; advertencias de tamaño de chunks/Browserslist.
- Lint: PASS, sin errores; 43 advertencias en el árbol completo (no certifica ausencia de defectos).
- Gate obligatorio prebuild `npm run qa:release-gate`: PASS, 130 pruebas. No compila APK ni promueve artefactos.
- Consumer + HTTP + ERP opt-in + SQLite + outbox + regresión CONFIG_PUSH: **65/65 PASS** en una ejecución conjunta con la suite ERP habilitada. Después, al añadir aserciones de aislamiento de headers, outbox: **16/16 PASS**. TypeScript final: PASS.
- Regresión adicional `terminalConfigRequestCoordinator` + `erpSecuritySnapshot`: incluidas en ejecución local de 14 pruebas junto al consumidor, PASS.

Pendientes concretos: Android SQLite/Preferences y dispositivo real; UI completa; handlers completos ERP syncInbox (config/manifest/config-snapshot) con sus dependencias y esquema aprobados; negociación real y verificación conjunta de despliegue. El handler original ERP initial-config, en este commit, deniega el token inválido con HTTP 500 porque su catch usa statusCode y ese error sólo lleva status; el control sí responde 401. POS rechaza ambos; ERP no se modificó.

No se generó APK, desplegó, aplicó migración, activó cliente, creó evidencia de rollout ni aprobó una activación. Estas pruebas no acreditan integración E2E operativa, activación segura ni rollback de un binario antiguo que ignore floor2.
