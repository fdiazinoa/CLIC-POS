# QA independiente — command-modal-flow

## Dictamen

- Rol: QA; agente independiente `/root/qa`.
- Base: `bcbc46c02d74246da16698cae54e3887a11e6ffd`.
- Candidato final: `82749aa1d365bc0dd5c9cbc1d0f8d36cd03b8da5`.
- Autor funcional: `/root/modal_developer`. Reviewer independiente: `/root/sync_review`.
- Estado: **QA PASS para código y navegador web**. No autoriza APK, instalación, despliegue, pruebas internas ni producción. Performance y las demás puertas conservan estado independiente.
- `review.md` registra REVIEW PASS de la lógica y reatestación de los cambios de presentación. La matriz completa, las siete capturas y el build se repitieron en `0473b582…`; el commit final modifica únicamente la concordancia singular de `1 seleccionado`. QA inspeccionó ese diff y repitió el flujo visual completado en React/DOM real sobre el SHA final.

## Entorno y método

Se usó Chrome headless con CDP y viewport real, React 19 y el componente `ModifierModal` real. El harness temporal ignorado por Git importa `index.css`, el CSS del componente y `IndexedDBAdapter`; no simula hooks ni invoca handlers extraídos. Todas las acciones se ejecutaron con clics sobre botones DOM, esperas observadas para el temporizador y comprobación de `document.activeElement` después de `requestAnimationFrame`.

La fixture es sintética y privada, sin datos de clientes. Se guardó en IndexedDB, se cerró el primer adaptador y se reabrió con una segunda instancia antes de renderizar: `data-indexed-db-reopen=pass`. No se ejecutaron ventas, cobros, sincronización manual, reset, APK, emulador ni escrituras remotas.

## Matriz funcional

| Caso | Resultado |
|---|---|
| Apertura y estado inicial | PASS: solo Extras activo; ocho tarjetas visibles en cuadrícula 4×2; `1 de 2`; sin alerta roja antes del intento; Base/Extras/Total visibles. |
| Selección múltiple | PASS: Bacon y Extra queso permanecen en Extras; no hay autoavance; total cambia de RD$550 a RD$640. |
| Paginación 9 | PASS: segunda página contiene Jalapeño; selección de página 1 y página 2 persiste al navegar en ambos sentidos. |
| Paginación 17 | PASS: tres páginas 8/8/1; selección de página intermedia persiste al volver a la primera. |
| Mínimo/máximo | PASS: mínimo 2 impide continuar y muestra alerta solo tras intento; máximo 3 ignora una cuarta selección; con dos o tres avanza. |
| Grupo requerido | PASS: Bebida vacía muestra `Seleccione Bebida.` tras Continuar; foco real queda en la primera tarjeta. Desde Nota, confirmar redirige a Bebida y vuelve a enfocar su primera tarjeta. Un grupo requerido vacío usa el encabezado como fallback. |
| SINGLE y timer | PASS: Agua con Gas autoavanza a Nota después de 250 ms; navegar manualmente a Extras antes del vencimiento cancela el timer y mantiene Extras. No confirma el pedido automáticamente. |
| Nota | PASS: presets se aplican sin duplicarse; texto libre se recorta al confirmar; la nota persiste en pantalla y payload. |
| `free_quantity` | PASS: con una selección gratis, Bacon seguido de Extra queso produce RD$580; se conserva el orden de selección. |
| Fracciones | PASS: dos mitades Clásica RD$500/Premium RD$700 producen RD$700 con `HIGHEST_PRICE`, RD$600 con `AVERAGE_PRICE` y RD$700 con `BASE_PLUS_DIFF`; cada parte lleva ratio `0.5`. |
| Confirmación/payload | PASS: Bacon +60, Extra queso +30, Agua con Gas +0 y nota Salsa aparte confirman una sola vez RD$640. Se preservan `modifierGroups`, `comboGroups`, snapshots detallados, `product_type=COMBO`, `production_area_id=qa-kitchen` y nota. |
| Impuestos | PASS: la salida conserva `appliedTaxIds=[qa-tax-preserved]` y `taxable=true`; el diff no modifica cálculo ni asignación fiscal. |
| Responsive | PASS: 4 columnas × 2 filas en 1440×900; 2 columnas en tablet 820×1180 y móvil 390×844. Header y footer permanecen fijos mientras el contenido central es desplazable. |
| Cierre | PASS en DOM: botón de cierre cancela el temporizador mediante el mismo callback revisado; no se creó pedido ni efecto externo. |

Resultado estructurado: `qa-interaction-results.json`, SHA-256 `7dc136f580d8b8cd49581d88c43231e09f11fb8826499385547b1a3299d4be22`. Log externo de la repetición final: `/tmp/command-modal-flow-interaction.log`, SHA-256 `aa18b4e256be2075c646dc7d35fa2cc1f70ea184bc0be6f4c611cc92f83c2c11`.

## Evidencia visual

Las siete capturas se recapturaron en `0473b582…`, se inspeccionaron visualmente y no contienen badges ni resultados de depuración. `qa-05-completed-flow.png` se recapturó nuevamente en el SHA final `82749aa1…` y acredita el texto corregido `1 seleccionado`; las otras seis vistas no dependen de ese resumen.

| Archivo | Viewport | SHA-256 |
|---|---:|---|
| `qa-01-extras-4x2.png` | 1440×900 | `a79a212493ef304c89cbd6623a139f1374a813dca60ca15ca6c66c86d34c07b3` |
| `qa-02-extras-2-selected.png` | 1440×900 | `543d7bc33a94866d07d747d2aeaa05798cde2be65fea5e8ba465df489b06d9f1` |
| `qa-03-beverage-active.png` | 1440×900 | `c8e8e6208b05d896c7415443a9c7f424ece4e7ef610221abdccf10e345b937b2` |
| `qa-04-required-incomplete.png` | 1440×900 | `c33943204e7d1a883a8862778108084d06dda4b7b70dbfdbea6202964b152e07` |
| `qa-05-completed-flow.png` | 1440×900 | `220281bffc80f96ba4f96ed1750e5ce802f433cf87d1b72c501c167ea6c4235c` |
| `qa-06-tablet-portrait.png` | 820×1180 | `c9b510c1ae34c976071b53af778fcf34275b04cd0fb73463e5ba398922cc83b8` |
| `qa-07-mobile-portrait.png` | 390×844 | `37cc451180376dda2175072f9151b50bda2675009672914f0f57716b103b6a55` |

La primera evidencia accidental que mostró la pantalla Activación se sobrescribió y no forma parte de estos hashes. Los siete archivos enumerados contienen exclusivamente el harness del modal candidato.

## Regresión y puertas

El commit lógico `7c0be6fb…` incluye todo el comportamiento. Sobre él se ejecutaron las suites siguientes; `0473b582…` cambia una sola clase JSX y recibió repetición completa de interacción, capturas y build. El commit final `82749aa1…` contiene solo la concordancia singular/plural del resumen; se inspeccionó el diff y se recapturó el flujo completado. No hay motivo técnico para repetir las suites de lógica por ese cambio de texto.

- Workflow QA crítico: 242/242 PASS, 0 skip, 0 fail. Log `/tmp/command-modal-flow-workflow-qa.log`, SHA-256 `b9ee5592b35737e50025d51718c57cee7f304228385d3d8992d63ccb55cf9988`.
- Suite general `tsx --test tests/*.test.ts`: 1294 total, 1289 PASS, 5 skip, 0 fail. Log `/tmp/command-modal-flow-all-tests.log`, SHA-256 `682d964e5aa643fdb9620470b7bae5d8a23c3217d4ae0696e68b3cb7aa32d85f`.
- `npm run lint`: PASS, 0 errores y 33 warnings preexistentes fuera del diff. Log `/tmp/command-modal-flow-lint.log`, SHA-256 `56b7cd03232fe3572a69b0f3fd61e76bfede1bece488bf0ce13b5d53eef7d3e2`.
- `npm run test:catalog-sync`: 107/107 PASS en sus dos fases (89 + 18), 0 skip, 0 fail. Log `/tmp/command-modal-flow-catalog.log`, SHA-256 `88813a1d9e736ceac8ba91de3d49b54a9993e0e689630d2d298294a3f6de7943`.
- `npm run build` sobre `0473b582…`: PASS; TypeScript y Vite completan. Permanece el aviso conocido de chunks mayores a 700 kB. Log `/tmp/command-modal-flow-build-final.log`, SHA-256 `6ffd2f726b998de5311e7bbcff4795ac6af0ff41daa60dfb8267d875df51a3f4`.
- Smoke visual final sobre `82749aa1…`: Nota activa, Extras `2 seleccionados`, Bebida `1 seleccionado`, total RD$640 y CTA final visibles. Log `/tmp/command-modal-flow-qa05-final.log`, SHA-256 `7dcb2690ad7ffab0fc7b0260587ce12bba371450cb753c599282242ee5eee757`.
- `git diff --check`: PASS.

El oracle ERP se usó exclusivamente en lectura desde `/private/tmp/clic-items-multiple-tax-assignment`, repo SHA `2b687b565a066e563f76054066de6a2c793549a7`. El helper `server/services/posRetainedRestore.js` tiene SHA-256 `46fe69fcbcacaaf3468015ef3b01e211cb60c3876a6f51def406ae967318340b`. Así se ejecutaron los contratos de recuperación sin omitirlos por falta de `CLIC_ERP_REVIEW_PATH` y sin modificar ERP.

## Límites

Este dictamen cubre código y navegador web con IndexedDB aislado. No se solicitó ni ejecutó APK, instalación Android, emulador, dispositivo físico, venta real, impresión, red externa o publicación. La medición de performance permanece a cargo del agente independiente correspondiente y este QA PASS no la sustituye.
