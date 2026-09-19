# Validación sync/offline independiente

- Tarea: `command-modal-flow`.
- Rol/identidad: SYNC-VALIDATOR, `/root/sync_validator`, distinto de developer/reviewer/QA/performance y analyst.
- Base: `bcbc46c02d74246da16698cae54e3887a11e6ffd`.
- Candidato vigente reatestiguado: `7c0be6fb5137c5286061077885f9ad44554206fd`.
- Primera ejecución focal: `f6e5feba49a0a9d40c65b2ff9f294f46650fc888`.
- Resultado vigente: **PASS focal de contrato estático y regresión; gate sync completo BLOCKED/PENDING**. REVIEW PASS formal del candidato vigente constatado en review.md. QA interactivo en progreso; no aprobación global.

Se leyeron contrato sync-validator, análisis y plan aprobado; mapas sync/offline y checklists previamente consultados se contrastaron con el alcance actual. El diff tiene cuatro archivos: modal, CSS, helper presentación y test UI. No modifica caller POSInterface, types, modelo, resolver restaurante, impuestos, DB, catálogo ni transporte. El modal no añade fetch/storage. El caller continúa pasando snapshot, precio, labels y nota a addToCart y cierra el modal. No hay escritura/confirmación automática desde el timer de navegación.

## Evidencia independiente

Un script local con TypeScript AST extrajo y comparó base/candidato: selectedModifierSnapshot, selectedFractionSnapshot, selectedComboSnapshot, cuarto argumento de onConfirm y argumento note. Las cinco expresiones normalizadas son idénticas. Los IDs, nombres, ratios, deltas, grupos y campos canónicos del contrato permanecen intactos; ningún dato de navegación entra al snapshot. Se revisaron además labels, fórmulas de fracciones, free_quantity y orden de iteración, que mantienen su semántica. Esto verifica construcción del payload **para iguales selecciones**, no sustituye interacción que demuestre que la navegación entrega esas selecciones.

Comandos:

```sh
node /tmp/command-modal-flow-sync-boundary.cjs
./node_modules/.bin/tsx --test tests/restaurantProductPartialSync.test.ts tests/restaurantClientConsistencyContract.test.ts tests/catalogMultiTerminalRoundTrip.test.ts tests/catalogSnapshotPreservationContract.test.ts tests/catalogSnapshotFence.test.ts tests/productTaxSnapshot.test.ts tests/paymentFractionPersistenceContract.test.ts tests/modifierGroupVisuals.test.ts
```

Resultado: **31 tests PASS, 0 FAIL, 0 omitidos**. Cubren contrato de restaurante/catálogo parcial y mult terminal, snapshots locales, fence, impuestos y persistencia de fracciones bajo sus fixtures. La prueba de AST también terminó exitosa.

- Harness AST: `/tmp/command-modal-flow-sync-boundary.cjs`.
- Log AST: `/tmp/command-modal-flow-sync-boundary.log`; SHA256 `51e433a57a36ff69ac940a26f0575044004ea5186733a4dc75e10c06e0adc02d`.
- Log contratos: `/tmp/command-modal-flow-sync-contracts.log`; SHA256 `231b21ab610120d1c5acfa4722145b9ed46a598985662fe7671b312d0a15a39b`.

## Límites y siguiente gate

Pendientes REVIEW PASS y QA runtime de navegación/confirmación/payload capturado; el coordinador comunica corrección de foco y copia de límites, aún sin nuevo SHA. Debe reconfirmarse que el nuevo diff no altera el boundary para portar esta evidencia.

No se ejecutó ERP receptor real, ONLINE/OFFLINE/reconnect con efectos únicos, pérdida ACK, master Node/Kotlin ni dispositivo con candidato. Un selector que exija esos gates debe conservar BLOCKED: esta tarea UI y estas pruebas no los certifican. El usuario prohíbe APK en este alcance; no se generó/instaló ninguno ni se escribió en servicios remotos o datos operativos. No se extrapolan resultados de tareas previas a este candidato.

## Reatestación final de código

HEAD `7c0be6fb5137c5286061077885f9ad44554206fd` corroborado. Se revisó el diff completo desde `f6e5feba`: solo reemplazo del selector de foco por helper con precedencia tarjeta→encabezado, texto informativo requerido/opcional/min/max y pruebas. No cambia selecciones, cálculos, snapshots, onConfirm, caller ni árboles sync/DB. Se volvió a ejecutar `/tmp/command-modal-flow-sync-boundary.cjs`: cinco expresiones AST conservan paridad exacta con base y no hay cambios en el boundary de transporte/persistencia.

Los **31/31 resultados anteriores se conservan como evidencia focal previa**, no se afirma que se ejecutaran 31 tests nuevamente en este SHA. Los contratos sync/persistencia y sus dependencias no cambiaron; no requieren repetición por esta corrección de foco/copia. El test UI sí se amplió: reviewer documentó ejecución independiente 6/6 PASS en el candidato vigente. QA debe completar interacción y paridad de selecciones durante navegación. Se mantienen los bloqueos E2E y la prohibición de APK/publicación hasta autorización expresa del usuario.
