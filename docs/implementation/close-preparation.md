# Preparación local durable del cierre

`ClosePreparation` guarda un borrador interno bajo la cola de `recoveryDatabase`, con el feature flag de recuperación habilitado. `closePreparation` lo expone a futuros consumidores internos; esta entrega no lo conecta al botón Z ni envía un comando ERP. El cierre recuperado sigue bloqueado antes del cálculo y del avance de series.

`prepare({preparationId, scopeKey, terminalId, members, declaration})` exige una imagen tipada `expectedDocument` por miembro, tal como fue leído por el consumidor. Conserva el orden solicitado, rechaza IDs duplicados, ausentes, ya cerrados, de otra terminal o con imagen desactualizada. No resuelve aliases por suposición: exige terminalId local explícito. Conserva la imagen original y coordenadas de su revisión local, o el recibo y bytes originales de staging para recuperados, verificando sus hashes. Una revisión local sin captura o con ámbito distinto bloquea la preparación.

El consumidor debe reutilizar preparationId para el mismo intento y obtener scopeKey del contexto autenticado existente; no de una entrada libre de UI. El proxy contrasta ese ámbito con su provenance actual. La llamada congela la entrada antes de esperar la cola, de modo que mutaciones posteriores del objeto de UI no cambian el borrador.

Antes de calcular el hash local, genera commandId y los tres IDs closeControl (closeId, closeEventId, nextOpenSetId), y conserva la declaración exactamente recibida, incluyendo tipos/presencia. Se escribe un único documento en recoveryState mediante almacenamiento atómico con requireAbsent. El mismo intento devuelve los mismos bytes/IDs; cambiar declaración, selección u otro dato bajo la misma clave da conflicto. No hay incremento, reserva, archivo, asiento, impresión, envío ni rollover.

El cuerpo usa `pos.close.preparation.local.v1`. **No es pos.intent.close_set.v2 ni su intentHash**, no se traduce silenciosamente a ese contrato. Los IDs están disponibles para vincular una futura intención v2 completa, pero este hash no la sustituye. El borrador conserva `coverage=UNKNOWN`, `configurationCoverage=INCOMPLETE`, `seal=null`, `exactZEligible=false`, `closeAuthorization=NOT_GRANTED`. Su único estado es PREPARED_LOCAL, no aceptado ni enviable.

`resume(scopeKey, preparationId)` verifica el cuerpo y compara las lecturas observadas y fuentes seleccionadas. Cambios en transactions, cashMovements, collections, history, wallet, Z, series, configuración o contexto de captura invalidan su reutilización completa, incluso si la modificación fue en una fila no seleccionada. Un cambio técnico que crea otra revisión también invalida. No refresca ni borra silenciosamente el borrador; no filtra filas para seguir. La comparación conserva el orden de lectura; un cambio de orden puede invalidar conservadoramente.

## Límite de la evidencia

- La cola coordina escritores del mismo proxy en este proceso. No es un lock entre procesos/dispositivos ni una transacción de lectura y escritura que coordine SQL directo. La futura aceptación debe revalidar en su propio commit; un resultado de resume no autoriza un envío o cierre posterior sin coordinación.
- Los hashes de colecciones son un guard local conservador. No prueban exhaustividad de resolvers, pertenencia completa de la jornada, historial de cambios A→B→A ni un prefijo sellado. No se infiere sesión desde capture.openSetId.
- La configuración histórica disponible permanece dentro de los originales conservados. El borrador guarda un digest de la configuración actual como guard, **no una copia completa del config con credenciales**, ni reconstruye campos perdidos. La declaración no se certifica como confirmación de usuario por recibirla como argumento.
- Las dependencias históricas no se convierten en miembros; sus colecciones se observan, pero falta producir el grafo completo y artifacts de configuración/declaración/selección requeridos por ERP. El paquete no acredita esos perfiles.
- El consumidor UI y el protocolo de sello/preparación ERP todavía no están conectados. No se activa ninguna función operativa por esta entrega. Los originales nunca enviados siguen fuera de lo recuperable.

## Pruebas locales

```sh
npx tsx --test tests/closePreparation.test.ts
```

Seis pruebas con SQLite en archivo y bridge de prueba: reinicio/reapertura con mismos bytes e IDs; declaración con Date/undefined; selección ordenada entre dos fechas; reintentos concurrentes; escritura fallida sin borrador parcial; conflictos; cambios observados; flag y ámbito; rechazo de staging alterado y conservación de revisión recuperada. Se comprueba ausencia de Z, archivo, avance de series y recaptura por preparar. No son ventas/cierres reales ni validación Android.

Integración pendiente: convertir la preparación en artifacts completos y sello verificable según contrato ERP real; registrar el resultado aceptado y rollover en una publicación local atómica. Hasta entonces el flujo normal mantiene su comportamiento y los recuperados no pueden cerrar.

`listPreparedIds(scopeKey)` permite descubrir las claves persistidas tras reiniciar sin depender de estado en memoria; listar no establece vigencia, que se comprueba al hacer resume. Validación de esta entrega: 71 pruebas POS/recovery/outbox/series/Z PASS y build PASS (aviso existente de chunks grandes). Lint bloqueado por ausencia preexistente de eslint.config para ESLint 9.
