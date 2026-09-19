# QA independiente

- Tarea: `sync-command-modifiers`.
- Rol / identidad: QA, `/root/qa`; distinta de analyst, developer, reviewer, sync-validator y performance.
- Base: `a0cfcae1ccc3086d4ce64e099ff0ee232a706a79`.
- Candidato congelado: `70498f5df019d6ea802b4acd6c7a25cc96db405f`.
- Review previo: **REVIEW PASS** en `review.md` para el mismo SHA.
- Estado: **QA PASS** para código, web, funcionalidad del modal y regresión automatizada. No es aprobación de sync, offline, performance, APK, despliegue ni release.

## Resultado funcional del candidato

Se montó `components/ModifierModal.tsx` real en Chrome mediante un harness temporal ignorado por Git. El producto sintético se guardó con `IndexedDBAdapter` sobre `fake-indexeddb` aislado, se desconectó el adaptador, se creó una segunda instancia y se reabrió el producto antes de renderizar. No se simularon hooks ni handlers.

Resultado observado en DOM tras recarga limpia del candidato:

- IndexedDB reopen: PASS.
- Precio base: RD$550.00.
- Sin bebida: mensaje `Seleccione Bebida` y `Agregar al Pedido` deshabilitado.
- Bacon: +RD$60.00; Extra queso: +RD$30.00; Sin tomate: sin costo y `affects_price=false`.
- Tras seleccionar los tres extras y Agua con Gas: contadores 3/3 y 1/1, total RD$640.00 y confirmación habilitada.
- `onConfirm`: `finalPrice=640`, cuatro etiquetas visibles, cuatro entradas `selected_modifiers`, tipo `COMBO`, área `qa-kitchen` y payload de carrito con precio 640/cantidad 1.

Evidencia sanitizada: `/tmp/sync-command-modifiers-ui-evidence.json`, SHA-256 `725e998f3007a34c4acdf1c7ffd47421dba427b4bde6154ca35afe1ac99dfcf9`. La captura visual quedó en el trace CUA de la sesión y muestra persistencia PASS, 3/3, 1/1 y RD$640.00. No se pudo exportar otra copia local después porque macOS quedó bloqueado; la evidencia DOM estructurada y el JSON no contienen datos de clientes.

## Suites y checks

| Validación | Resultado | Evidencia SHA-256 |
|---|---:|---|
| Selector `workflow-gate plan` | CRITICAL; sync/tables/offline; gates funcional/regresión/sync/offline/performance | `/tmp/sync-command-modifiers-plan.json` · `1f7e1ad01123084961030679cffb2f3a03bb4b1d09e4ab7efe0e73c73351914a` |
| `workflow-gate qa` con oracle ERP | 242 PASS, 0 FAIL | `/tmp/sync-command-modifiers-qa-workflow.log` · `92fd497c78e2be6df8f083a9957bee5b0a3b799640476fe180b5f14549219b4e` |
| `tsx --test tests/*.test.ts` con oracle ERP | 1290 total; 1285 PASS; 5 SKIP; 0 FAIL | `/tmp/sync-command-modifiers-full-tests.log` · `7ed4655a4faf217ba1899d17d52cee588a5e10e32cc7f10bf6a0a73a93fb7bf2` |
| `tests/recoveryRetainedSet.test.ts` con oracle ERP | 5 PASS, 0 FAIL | `/tmp/sync-command-modifiers-erp-oracle.log` · `12125903722702342b92e9350c66b4219e80e7c5195c9dadeb3ebd0aedae0c01` |
| `npm run test:catalog-sync` | 89 + 18 = 107 PASS, 0 FAIL | `/tmp/sync-command-modifiers-catalog.log` · `f23fed1fa25a4432bb53fff312a7d1f680cb29d79cfe2f73e6a2dabbdd2a8b99` |
| `npm run lint` | exit 0; 0 errors, 33 warnings | `/tmp/sync-command-modifiers-lint.log` · `56b7cd03232fe3572a69b0f3fd61e76bfede1bece488bf0ce13b5d53eef7d3e2` |
| `npm run build` | PASS; TypeScript + Vite, 3407 módulos | `/tmp/sync-command-modifiers-build.log` · `a0769b71bb9b5be134b298f46f4deaee1235f24130a65df9f271a42fa87dfe6c` |

El oracle ERP se usó exclusivamente en lectura desde `/private/tmp/clic-items-multiple-tax-assignment`, repo SHA `2b687b565a066e563f76054066de6a2c793549a7`. El helper `server/services/posRetainedRestore.js` tiene SHA-256 `46fe69fcbcacaaf3468015ef3b01e211cb60c3876a6f51def406ae967318340b`. Esto elimina el fallo evitable por `CLIC_ERP_REVIEW_PATH` ausente sin modificar ERP.

Los 33 warnings de lint y los avisos de chunks/caniuse del build no causaron error. No se ocultó el error de red impreso por `zReportSyncRetry`: es el fallo inyectado que la propia prueba exige y el caso terminó PASS.

## Inspección de Caja 4 instalada

Se aplicó la skill `clic-pos-apk-installation` en modalidad **validar**, sin build ni instalación. Único dispositivo: `127.0.0.1:6555`, modelo Pixel_C, package `com.clicpos.app`, APK instalada 1.1.405/code 1405. La identidad se confirmó en estado React/config, no solo por el rótulo: terminal `CAJA 4`, código `POS-003`, id `69dc181d-b85e-486b-8f7f-c0d21b69d298`.

El producto real `b8ceb05d-ce8a-4d1b-8e04-f155d6088bff` estaba hidratado con precio 550, tipo COMBO, área COCINA, Bacon +60, Extra queso +30, Sin tomate REMOVE/0, Bebida obligatoria 1/1 con Agua con Gas y tres notas. En la UI real, el modal bloqueó sin bebida a RD$550 y mostró RD$640 tras seleccionar los tres extras y la bebida. Se canceló con X; el carrito permaneció vacío en RD$0. No hubo venta, pago, sync manual, confirmación de carrito ni escritura de configuración.

Evidencia sanitizada: `/tmp/sync-command-modifiers-android-baseline-evidence.json`, SHA-256 `c83a25f1c416e59b70372812fa13544e537f83c366359ada41c6087018e058f2`. Esta observación corresponde a la APK baseline 1.1.405, no al candidato 70498f5.

## Criterio QA y límites

El candidato satisface la interacción exigida, persistencia/reopen del adaptador web, semántica de ausencia/update/clear/aliases mediante pruebas y regresión transversal sin fallos. El estado actual de Caja 4 demuestra que la configuración completa está presente y renderiza hoy; el incidente histórico de opciones ausentes **no se reproduce** y no queda atribuida su causa a un payload parcial concreto.

La prueba web usa `fake-indexeddb`; no equivale a SQLite Android. No se generó ni instaló APK candidata por alcance explícito. Sync/offline y performance siguen siendo gates independientes a cargo de sus agentes; este QA PASS no los sustituye ni autoriza release.
