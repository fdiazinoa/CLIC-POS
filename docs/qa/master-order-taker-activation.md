# QA — directorio de activación Master Android

Fecha: 2026-09-16. Base: `origin/develop` en `8c54ab4`.

## Causa observada

Master `10.0.0.101:5555` y Cliente `10.0.0.123:5555`, APK instalado 1.1.392 / 1392.
Ping Cliente → Master: 2–4 ms, sin pérdida; `/api/config` y `/api/setup/terminals`: HTTP 200.

`ClicPOSMasterHttpServer.buildTerminalListResponse` enumeraba exclusivamente
`configSnapshot.terminals`, y etiquetaba el resultado con el tenant del query
o `default-tenant`. No consultaba el contrato ERP vigente ni filtraba empresa/sucursal.
Los registros locales `{id, config}` materializados por `buildBoundConfig` no
conservan los campos superiores de empresa/sucursal del directorio ERP; los templates
también pueden conservar `isPrimaryNode` de otras cajas. El refresco del contrato de
la terminal activa no actualiza automáticamente el tipo de las demás terminales.

Evidencia concreta:

| Terminal | Snapshot Master instalado | ERP vigente |
| --- | --- | --- |
| Caja 01, `0efd23be-d73f-42aa-ab7d-5895b56edee0` | STANDARD_POS | ORDER_TAKER, asignada a CAJA-2 |
| POS-005, `26b5b3c7-75f1-4eee-9ed1-c58aa5c6fe63` | ORDER_TAKER, incluida en el listado | Otra empresa/sucursal y otra Master |

CAJA-2: `0f77877f-66b2-4820-b956-997cd5b4b575`.
Tenant: `9eda7d73-76e4-4432-ad13-4934fefe8f69`.
Empresa: `6b6153ce-501e-4702-9ae9-34a3f1ab9042`.
Sucursal: `de8dd318-12e7-4a3f-b0e8-4ea1bdb70c07`.

GET ERP `/api/sync/terminals` con los tres filtros devuelve cinco terminales,
incluida Caja 01 como ORDER_TAKER y sin POS-005. No se modificó ERP.

## Cambio acotado

- La WebView identifica la Master que ejecuta el APK por su UUID ERP y entrega
  contexto ERP explícito. SERVER_LOCAL conserva su directorio local.
- Únicamente list/bind/initial-config consultan el directorio vigente, con filtros
  tenant/empresa/sucursal y validación local de esos campos y asociación Master.
- Proyección de configuración para activación, separada del snapshot operacional.
  Tipo, identidad, asociación, capacidades y restricciones proceden del ERP.
- No hay fallback al roster obsoleto en fallos ERP; la UI muestra el mensaje.
- Se conservan bindings nativos válidos, pero no sobreescriben una ocupación
  diferente confirmada por ERP. No se permite force-transfer en activación ERP.
- Initial-config comprueba scope y dispositivo vinculado. LOCAL_ONLY mantiene
  su comportamiento previo. No hay polling nuevo ni cambios en Mesas, cobro,
  catálogo, sincronización periódica o SQLite operacional.

## Verificación automatizada

- `npm ci`: correcto.
- `npm run build`: TypeScript + Vite correctos; warnings de bundling existentes.
- Suite activación/restaurante/LAN/persistencia/autorización/idle: 68/68.
- Matriz operacional de diez archivos, más regresión nueva: 58/58.
  Son suites parcialmente solapadas, no 126 pruebas distintas.
- `git diff --check`: correcto.
- ESLint pendiente: el repositorio no contiene configuración compatible con
  ESLint 9 (`eslint.config.js/mjs/cjs`). No se alteró tooling en este fix.
- Compilación JVM del servidor Kotlin real y discovery contra Android SDK 36:
  correcta; warnings NSD deprecated preexistentes.
- Harness JVM: seis grupos correctos (rol/scope/Master/proyección; tenant incorrecto;
  ERP fallido; ocupación y force-transfer; initial-config; LOCAL_ONLY sin HTTP ERP).

Comandos Node: las suites existentes de `androidMasterSetupContract`,
`androidMasterRestaurantContract`, `masterPairingConnection`, `masterLanDiscovery`,
`terminalUpgradePersistence`, `terminalAuthorizationGuard`, `posIdleRenderContract`,
`posProductPricesIdleContract`, junto a `masterScopedSetupDirectory`.

Harness reproducible: `bash scripts/qa/test-master-setup-jvm.sh`, proporcionando
`CLIC_POS_KOTLIN_COMPILER_CP`, `CLIC_POS_KOTLIN_STDLIB_JAR`,
`CLIC_POS_ANDROID_JAR` y `CLIC_POS_JSON_JAR` (org.json JVM real).
Compila y ejecuta `tests/fixtures/masterSetupDirectoryHarness.kt`; no genera APK.

## Pendientes físicos / release

Por instrucción expresa NO se generó ni instaló otro APK, no se incrementó versión
y no se cambiaron bindings/configuración de los equipos.

Pendiente después de autorizar un APK candidato:

1. Instalar preservando datos y verificar roster sin POS-005, tenant real y Caja 01 ORDER_TAKER.
2. Verificar autorización ERP y activar Cliente 123 sin takeover implícito.
3. Reiniciar Master/Cliente y comprobar vínculo, LAN, usuarios y estado operacional.
4. Medir frames/CPU idle con el mismo protocolo previo; los contratos de idle pasan,
   pero NO sustituyen medición física del nuevo código.
5. Gradle, firma, puertas release prebuild/promote y QA físico: no ejecutados.
