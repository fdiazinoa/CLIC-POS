# Aprobación independiente del plan

- Tarea: `sync-command-modifiers`.
- Rol: REVIEWER / aprobador de plan.
- Identidad independiente: `/root/reviewer`.
- Analista: `/root/sync_review`; aprobador distinto del autor del plan.
- Base exacta: `a0cfcae1ccc3086d4ce64e099ff0ee232a706a79`.
- Documento revisado: `analysis.md` de este expediente.
- Estado: PLAN APPROVED. Autoriza únicamente implementar el alcance delimitado; no constituye REVIEW PASS del código ni aprobación QA, sync, performance o release.

Se revisaron AGENTS.md, WORKFLOW.md y el contrato reviewer, el recorrido de normalización/ingreso en SyncManager, ProductImageCacheService, restaurantProductConfig y el consumo POS/ModifierModal. El replay del snapshot conserva configuración y emite APPLIED; la pérdida ante entrada parcial está reproducida en normalización. La prueba adicional de IndexedDB y render fresco aporta evidencia de que el snapshot completo llega íntegro al modal. Ninguna de estas pruebas identifica por sí sola la causa operativa de Caja 4.

Se aprueba el plan mínimo de preservar por familia los campos restaurante ausentes al ingresar un producto existente y respetar presencia explícita de valores vacíos/null. Debe centralizarse la precedencia raíz snake, raíz camel, restaurant snake y restaurant camel, impidiendo resucitar aliases antiguos. Las familias presentes se reemplazan de forma autoritativa; no se mezcla indiscriminadamente el producto local. Un objeto restaurant vacío no implica borrar todas las familias. Se mantienen identidad, impuestos, inventario, imágenes, tarifas, ACK, cursores y eventos. El defecto del modal abierto y la precedencia de variantes quedan documentados fuera del cambio funcional.

Criterios vinculantes antes de aprobar candidato:

- Pruebas por familia para ausencia, actualización, clear explícito, aliases y configuración anidada; verificar también cambios de tipo y área sin perder familias hermanas.
- Prueba de la ruta real de SyncManager con ingreso parcial posterior al producto completo y comprobación del estado persistido; repetir con clear explícito. Una llamada aislada al normalizador no sustituye esa cobertura.
- Regresión de snapshot completo y compatibilidad con payloads históricos, sin atribuir a ausencia una semántica de borrado no demostrada.
- Revisión independiente del SHA congelado y selector de gates sobre diff committed; QA funcional/regresión, sync/offline y performance conservadores por impacto compartido. Catálogo requiere test:catalog-sync; lint/build y suites obligatorias deben quedar registrados.
- La evidencia SSR no sustituye interacción UI, y IndexedDB simulado no demuestra SQLite/WebView. Un entorno requerido ausente se registra BLOCKED. No declarar resuelto el incidente Caja 4 ni autorizar APK/deploy con este plan.

El coordinador puede iniciar IMPLEMENTATION dentro de este alcance. Cualquier ampliación a UI, transporte, storage, identidad o arquitectura exige revisar el plan y sus riesgos.
