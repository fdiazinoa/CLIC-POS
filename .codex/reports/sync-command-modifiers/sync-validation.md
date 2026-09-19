# Sync validation — preparación y bloqueo

- Rol: SYNC-VALIDATOR; identidad independiente `/root/sync_validator`.
- Tarea: `sync-command-modifiers`.
- Base corroborada: `a0cfcae1ccc3086d4ce64e099ff0ee232a706a79`.
- Candidato rechazado por reviewer: `1a520f21a3e069d1360d336fbc21f1a9f9e7f8a0`; sin aprobación sync. Pendiente nuevo SHA y REVIEW PASS.
- Estado: BLOCKED/PENDING; este documento no aprueba código ni release.

## Evidencia independiente sobre base exacta

Se ejecutó `/tmp/sync-command-modifiers-sync-atomic-baseline.mts` importando el código de `/tmp/sync-command-modifiers-perf-baseline`, cuyo HEAD se verificó igual a la base. Node 24.11.1, transporte fetch simulado, IndexedDBAdapter real sobre motor fake-indexeddb; no cambios de env ni schema. El catálogo utiliza el dominio exacto privado capturado; el contexto fiscal es sintético mínimo. No es una ejecución contra ERP real ni SQLite Android.

CONFIG_PUSH_V2 con catálogo y fiscal llega a `IndexedDBAdapter.saveDocumentsAtomically`; falla con `RECOVERY_ATOMIC_STORAGE_UNAVAILABLE` y emite ACK FAILED, applied=0. El schema IndexedDB base no incluye `taxes`, que exige el commit atómico fiscal/catálogo. Es un bloqueo preexistente del recorrido web, independiente del fix de familias restaurante; no demuestra causa de Caja 4 Android. El proceso de comprobación termina con código 0 porque esperaba explícitamente ese fallo; **no significa snapshot PASS**.

Artefactos externos:

- Harness `/tmp/sync-command-modifiers-sync-atomic-baseline.mts`, SHA256 `954f24ac22317213e4bace62422aec67377f14035865bc01b1da04dc14e85948`.
- Log `/tmp/sync-command-modifiers-sync-atomic-base-exact.log`, SHA256 `63ee999955b4e1eb5ee4f254b8b1048e7f68c49076e733f248a86d2d919be7ef`.

## Preparación de recorrido posterior

`/tmp/sync-command-modifiers-sync-independent.mts` prueba SyncManager.pullCatalog real DELTA/FULL con persistencia IndexedDB, reapertura del adaptador, duplicado del pull, clear raíz contra aliases viejos y FULL posterior. Para aislar ese recorrido se siembra directamente el catálogo en almacenamiento de prueba después del fallo atómico registrado. Se simulan transporte/policy y side-channel de imágenes. La reapertura no equivale a reinicio completo de proceso o WebView. Los resultados preliminares pertenecen a un working tree no congelado y deben repetirse sobre el candidato aprobado.

No se aprobará `1a520f2`: reviewer identificó resurrección del área desde metadata tras serialización JSON; developer prepara corrección. El harness deberá cubrir también esa secuencia antes de concluir.

## Entorno y límites

El coordinador comunicó evidencia QA en emulador Android con APK 1.1.405 y Caja 4: extras completos y precio modal 640. Este validador no ejecutó esa prueba; la evidencia corresponde al APK observado, no al futuro candidato. No se reproduce actualmente el incidente operativo según QA.

Siguen pendientes receiver de prueba, candidato runtime, ambos sentidos, fallos de red/ACK y consistencia de efectos ERP; no se reemplazan por tests de memoria ni por mera aparición eventual. No se realizaron escrituras remotas, instalación, reset ni modificaciones funcionales.

## Validación final del candidato

Candidato validado: `70498f5df019d6ea802b4acd6c7a25cc96db405f`, HEAD corroborado antes de ejecución, sin diff funcional local. REVIEW PASS formal comunicado por coordinador y expediente reviewer. Identidad ejecutora sigue `/root/sync_validator`, distinta de developer/reviewer/QA/performance.

**Resultado focal: PASS. Gate sync completo: BLOCKED.**

Se ejecutó el harness independiente sobre este candidato. Después de sembrar directamente el dominio catálogo de prueba, SyncManager.pullCatalog real DELTA y FULL conservó extras, combos y notas ausentes y aplicó nuevo precio. La reapertura del adaptador y repetición del pull conservaron estado. Un array vacío explícito eliminó modifiers frente a aliases antiguos sin borrar combos; FULL posterior mantuvo el clear. Para área se probaron metadata snake y camel con raíz null y aliases raíz/anidados obsoletos: tras persistencia, serialización JSON, reapertura y FULL parcial posterior no resucitó el área; metadata ajena se mantuvo. Alias camel eliminado se acepta como representación canónica válida, además de array vacío.

Comandos ejecutados desde raíz del candidato:

```sh
./node_modules/.bin/tsx /tmp/sync-command-modifiers-sync-independent.mts > /tmp/sync-command-modifiers-sync-candidate70498.log 2>&1
./node_modules/.bin/tsx --test tests/restaurantProductPartialSync.test.ts tests/configPushV2Contract.test.ts tests/durableOutboxV2.test.ts tests/durableOutboxBatchSender.test.ts tests/catalogMultiTerminalRoundTrip.test.ts > /tmp/sync-command-modifiers-sync-contract70498.log 2>&1
```

Contratos: **61 tests, 61 PASS, 0 FAIL, 0 omitidos**. Aportan regresión sobre CONFIG_PUSH, ACK, colas durable y múltiples terminales bajo sus fixtures; no certifican receptor ERP real, red física, SQLite ni efectos contables desplegados.

Artefactos y SHA256:

- `/tmp/sync-command-modifiers-sync-independent.mts`: `26d7d3aa4cbdee0b1dc202c2a9864ed6eb43e3102c065480b5b3e9f1574a5d91`.
- `/tmp/sync-command-modifiers-sync-candidate70498.log`: `624a7739b572c018379281bda38a58d71c407aac9978539dd988e078ec7d4925`.
- `/tmp/sync-command-modifiers-sync-contract70498.log`: `b64a51fab99249e73ee5ad9d4c1c2a94dc7db0411be4990b97c248ba7d8210f7`.

### Bloqueos conservados

El mismo replay de CONFIG_PUSH_V2 atómico sobre candidato retorna applied=0, ACK FAILED y `RECOVERY_ATOMIC_STORAGE_UNAVAILABLE`; confirmado previamente en base exacta. La prueba de preservación posterior no elude ni resuelve ese fallo web preexistente. El transporte usa un envelope sintético y catálogo privado capturado más fiscal sintético: no debe presentarse como outbox completo exacto de producción.

Falta cliente/receiver de prueba con este candidato y validación E2E ONLINE/OFFLINE/reconexión, caída antes/después de ACK y reinicio de proceso/WebView con efectos ERP únicos en ambos sentidos. Reabrir fake-indexeddb solo prueba reapertura del adaptador. La observación QA de APK 1.1.405 no convierte este candidato en runtime aprobado. No se atribuye causa definitiva al incidente Caja 4, no se declara resolución global y no se autoriza APK/deploy/release.
