# Análisis y plan: opciones de comanda tras sincronización

- Rol: ANALYST. Identidad de sesión/agente: `/root/sync_review`.
- Tarea: `sync-command-modifiers`.
- Base inspeccionada: `a0cfcae1ccc3086d4ce64e099ff0ee232a706a79`.
- Estado: PLAN_READY; requiere aprobación independiente. No es aprobación de implementación, QA ni release.
- Instrucciones consultadas: AGENTS.md, WORKFLOW.md, .codex/agents/analyst.md y mapas de arquitectura. Los mapas documentan `669f9624c85de40129169e6779aa6983f1441fea`, anterior a esta base; se contrastaron los recorridos relevantes en código actual.

## Síntoma y límites

Se reporta que Caja 4 no muestra opciones de comanda de Hamburguesa BBQ - Regular (`b8ceb05d-ce8a-4d1b-8e04-f155d6088bff`) pese a CONFIG_PUSH_V2 APPLIED. El snapshot catálogo `5482c74a-932e-44ca-98c1-55d5d7246d32` contiene tres extras, bebida obligatoria y tres notas. No se capturó el producto efectivo del almacenamiento ni estado React de Caja 4. La causa del incidente operativo permanece sin confirmar.

## Evidencia reproducida

Replay con el dominio catálogo exacto obtenido del snapshot; contexto fiscal sintético porque el consumidor acopla catálogo y fiscal. Se reutilizó el harness de `tests/configPushV2Contract.test.ts`, sustituyendo almacenamiento por un mapa en memoria y transporte por fetch simulado. No hubo escritura remota ni modificación de datos operativos.

Resultado: processed=1, applied=1, failed=0; ACK APPLIED; productsUpdated emitido. Producto persistido con variants=[], attributes=[], COMBO, Extras (Bacon, Extra queso, Sin tomate), Bebida (Agua con Gas) y notas íntegros. `productHasRestaurantConfiguration` devuelve true. No se reprodujo pérdida durante aplicación del snapshot. Variantes no explica este producto.

Segundo paso sobre ese almacenamiento: `normalizeIncomingProducts([{id: product.id, name: product.name, price: product.price}])`, seguido de `normalizeRestaurantProductConfig`. Resultado reproducido: hasConfig true → false; modifier_groups=[], combo_groups=[], note_presets=[]. Demuestra pérdida ante entrada parcial sin campos restaurante. No demuestra que Caja 4 haya recibido ese payload parcial.

Comando exacto reproducible en esta máquina, desde el checkout de la tarea:

```sh
./node_modules/.bin/tsx /tmp/sync-command-modifiers-repro.mts > /tmp/sync-command-modifiers-repro.log 2>&1
```

El script y entradas privadas viven en /tmp. `/tmp/sync-command-modifiers-snapshots.json` contiene datos de terceros y no debe versionarse. El script usa rutas absolutas de esta worktree y la entrada obtenida; no constituye fixture portable. La implementación debe agregar fixtures sintéticos mínimos versionados que reproduzcan los dos casos. El log muestra REPRO y PARTIAL_PULL; no imprime clientes.

## Recorrido y causa demostrada

1. `utils/erpSyncLifecycle.ts:658` construye writes por dominio; catálogo lee masters.items.
2. `utils/erpSyncLifecycle.ts:831` normaliza imágenes/productos y guarda documentos completos atómicamente; `:873` publica eventos de colecciones.
3. `services/sync/ProductImageCacheService.ts:419` conserva `...item` y campos locales seleccionados, pero no configuración restaurante ausente.
4. `services/sync/SyncManager.ts:7427` delega enriquecimiento a ese servicio; rutas snapshot/pull llaman `normalizeRestaurantProductConfig`, entre ellas `:3715`, `:5729`, `:6009` y `:6647`.
5. `utils/restaurantProductConfig.ts:48` elige aliases por longitud, sin distinguir ausencia de vacío explícito; `:75` normaliza ausencia a arrays vacíos. Un pull parcial puede por ello eliminar configuración previa y un alias antiguo no vacío puede resucitar configuración que otro alias pretende borrar.
6. `App.tsx:7478` y `:7548` recargan productos desde DB mediante setProducts, sin comparación que excluya modifiers.
7. `POSInterface.tsx:3417` detecta configuración; ModifierModal resuelve snake/camel y restaurant. No se identificó pérdida del snapshot en esta ruta.

Limitación secundaria: `POSInterface.tsx:2165` guarda productForModifiers como objeto y `:9565` lo entrega al modal; no lo rehidrata al actualizar products. Un modal abierto puede conservar configuración anterior. Se documenta separado y no se incluye automáticamente en el fix de pérdida por pull parcial.

## Plan mínimo propuesto

1. Incorporar fixture sintético equivalente del producto y pruebas que fallen con la base: completo → entrada parcial conserva opciones; modificación y borrado explícitos producen su nuevo estado.
2. Centralizar la resolución de presencia por campo y alias para los campos restaurante y usarla en normalización de ingreso con acceso al producto local. No propagar un merge indiscriminado de todo el producto local.
3. Semántica: para cada familia (modifier_groups/modifierGroups, combo_groups/comboGroups, note_presets/notePresets, fraction_rule/fractionRule, product_type/productType, production_area_id/productionAreaId), buscar propiedades propias del payload en precedencia determinista: raíz snake, raíz camel, restaurant snake, restaurant camel. La presencia decide autoridad, no la longitud ni truthiness. Un campo ausente en todas sus ubicaciones conserva el correspondiente valor local. Un array explícito vacío elimina esa familia; null explícito elimina contenido opcional y se normaliza al vacío/default canónico adecuado para su tipo. Otros campos ausentes del mismo payload conservan sus valores locales.
4. Evitar resurrección: tras resolver cada familia, sincronizar o eliminar aliases conflictivos y representación anidada. Un clear en una ubicación autoritativa no debe caer al alias antiguo no vacío. Los lectores sin producto local deben seguir el mismo criterio de presencia; los payloads heredados con solo camel o restaurant continúan funcionando. Un objeto restaurant vacío no debe interpretarse como borrado de todas las familias; para borrado total debe existir semántica explícita y probada, sin inferirla por falta de campos.
5. Preservar identidad, impuestos autoritativos, inventario, imágenes, tarifas y demás comportamiento actual. No cambiar ACK, cursor, scopes, flag ni rollout. No tocar variantes ni implementar automáticamente reactividad del modal sin evidencia adicional.
6. Candidato congelado: revisión independiente, QA y sync-validator independientes; lint/build y suites requeridas por workflow. Revalidar selector de gates sobre diff committed.

## Riesgos, aceptación y matriz

Riesgo alto por normalización compartida de catálogo/sync. La modificación debe ser compatible con payloads históricos. Se requiere distinguir ausencia de clear; conservar todo indiscriminadamente impediría borrados ERP y escoger cualquier array no vacío resucitaría opciones antiguas.

| Caso | Resultado requerido | Evidencia |
|---|---|---|
| Snapshot completo equivalente | Tres extras, bebida requerida y notas persisten; ACK después de commit, evento observable | Prueba de integración con harness |
| Pull parcial posterior, mismo ID | Opciones/local production type/área intactos; nuevo precio u otros campos presentes aplicados | Prueba de normalizador y ruta snapshot/pull |
| Actualización solo una familia | Reemplaza esa familia; las ausentes permanecen | Tabla de tests snake/camel/nested |
| Arrays vacíos/null explícitos | Borra familia sin resurrección de alias local/entrante viejo | Tests precedencia y clear |
| Payload heredado con un alias | Mismo resultado canónico | Tests compatibilidad |
| Doble evento/retry/reinicio | Estado final único e idéntico; opciones no desaparecen | Sync/offline con fixtures |
| Impuestos, inventario, imágenes/tarifas | Mantiene contratos de autoridad y operación previa | Suite catálogo y regresiones requeridas |
| UI con producto completo | Bebida obligatoria; Bacon +60, queso +30, Sin tomate +0; precio 550→640 con los tres y bebida | QA funcional real |
| Catálogo actualizado con modal cerrado | Reabrir muestra la configuración persistida nueva | QA UI |
| Modal ya abierto durante sync | Documentar estado observado y alcance pendiente; no reclamar solución | Captura runtime |

Se requieren las suites transversales y checks derivados de WORKFLOW, incluyendo test:catalog-sync, y pruebas específicas añadidas. Los tests de memoria no equivalen a persistencia IndexedDB/SQLite real ni a E2E Android. Falta captura Caja 4 de DB antes/después de apply/pull, producto que llega al click/modal, topología/version exacta y operación tras reinicio. Para gates Android/performance se requieren hardware/capturas y medición n/p50/p95/p99/max según protocolo; ausencia de ese entorno se registra BLOCKED, nunca PASS.

Rollback: revertir el cambio mediante rama/PR a develop si la validación falla o se detecta regresión, sin resetear datos locales ni modificar main. No se autorizan despliegue o promoción por este plan.

## Evidencia adicional comunicada por developer

El coordinador informó un replay independiente de Sol con adaptador IndexedDB real y SSR: 165 productos, PASS, artefactos `/tmp/sync-command-modifiers-indexeddb-modal.mts` y `/tmp/sync-command-modifiers-indexeddb-modal.log`. Esta evidencia amplía la reproducción de memoria descrita arriba; el analyst no la ejecutó ni certifica sus detalles. No sustituye captura Caja 4 ni Android. El alcance propuesto permanece pérdida por payload parcial; stale modal separado sin cambio en esta implementación.
