# Revisión final independiente

- Tarea: `sync-command-modifiers`.
- Rol / identidad: REVIEWER, `/root/reviewer`.
- Base: `a0cfcae1ccc3086d4ce64e099ff0ee232a706a79`.
- Candidato congelado revisado: `70498f5df019d6ea802b4acd6c7a25cc96db405f`.
- Estado: REVIEW PASS. Autoriza avanzar a QA independiente; no aprueba QA, sync, performance, device ni release.

Se revisó el diff final base→candidato de los cuatro archivos y el commit correctivo. El P1 anterior queda resuelto: al recibir área autoritativa se neutralizan los aliases metadata y los aliases raíz legacy que consultaba POS; metadata ajena al área se conserva. El clear explícito se representa como null al ingreso. La normalización posterior puede volverlo undefined, pero los aliases de área ya no existen y no reaparecen tras JSON ni tras una entrada parcial posterior.

Verificación independiente en el SHA final: `tsx --test tests/restaurantProductPartialSync.test.ts` obtuvo 10 PASS, 0 FAIL (`/tmp/sync-command-modifiers-review-70498f5.log`). Se ejecutó además merge con clear y ambos aliases metadata → normalize → JSON roundtrip → nueva entrada parcial; el área permaneció ausente. Se revisaron el reemplazo por familia, precedencia snake/camel/nested, defaults de productos nuevos y el acceso al producto local en ProductImageCacheService. Las rutas y contratos de ACK/cursor/stock/impuestos no se modifican. La prueba SyncManager incremental comprueba preservación y clear hasta persistencia simulada.

No hay hallazgos accionables adicionales en el alcance revisado. La causa real de Caja 4 sigue sin confirmar; no se declara corregido el modal ya abierto. Evidencia simulada/SSR no acredita interacción Android ni presupuesto UI. Los tres fallos de suites por CLIC_ERP_REVIEW_PATH ausente deben conservarse en QA como bloqueo, sin convertir este REVIEW PASS en aprobación de release.

## Historial del candidato previo

# Revisión independiente del candidato

- Tarea: `sync-command-modifiers`.
- Rol / identidad: REVIEWER, `/root/reviewer`; distinto de developer, analyst, QA y sync/performance.
- Base: `a0cfcae1ccc3086d4ce64e099ff0ee232a706a79`.
- Candidato: `1a520f21a3e069d1360d336fbc21f1a9f9e7f8a0`.
- Estado: REVIEW FAILED. Volver a implementación y revisión de nuevo SHA.

Se inspeccionó el diff completo de los cuatro archivos, la normalización compartida, las rutas FULL/incremental de SyncManager, los lectores restaurante y resolución de área de POS. La prueba independiente `tsx --test tests/restaurantProductPartialSync.test.ts` obtuvo 9 PASS; log `/tmp/sync-command-modifiers-review-specific.log`. La ruta real incremental está ejercitada con persistencia simulada y satisface ese componente del plan, pero los nueve casos omiten un conflicto de metadata.

## P1: El borrado explícito del área revive el alias de metadata

En `utils/restaurantProductConfig.ts:123` se copia metadata intacta y en `:131` el área borrada se representa como undefined. Con entrada `{id:'p', production_area_id:null, metadata:{production_area_id:'old-kitchen'}}`, merge produce un área aparentemente vacía. Tras JSON stringify/parse, desaparecen los campos undefined de raíz y restaurant; `resolveRestaurantProductConfig` vuelve a leer metadata y obtiene `old-kitchen`. Además `components/POSInterface.tsx:443` consulta metadata directamente como fallback, de modo que el consumidor operativo puede seguir usando el área antigua aun antes de persistir.

Reproducción independiente, ejecutada sobre el SHA indicado:

```ts
const result = mergeIncomingRestaurantProductConfig({
  id: 'p', production_area_id: null,
  metadata: { production_area_id: 'old-kitchen' },
});
resolveRestaurantProductConfig(result).production_area_id; // undefined
resolveRestaurantProductConfig(JSON.parse(JSON.stringify(result))).production_area_id; // old-kitchen
```

Impacto: un clear explícito enviado por ERP no elimina el destino de producción y puede mantener la comanda dirigida al área anterior. Incumple el criterio aprobado de no resucitar aliases tras clear/persistencia. Neutralizar los aliases metadata de área cuando existe un valor autoritativo que los invalida, conservando el resto de metadata y la preservación ante ausencia. Añadir regresión con ambos aliases metadata, roundtrip JSON y siguiente entrada parcial; verificar el consumidor POS sin ampliar funcionalmente el modal.

No se modificó código funcional. No se aprueba QA/release ni se atribuye causa definitiva al incidente Caja 4. Los fallos de suites dependientes de CLIC_ERP_REVIEW_PATH y el entorno Android/performance pertenecen a sus gates independientes y no se convierten en PASS por esta revisión.
