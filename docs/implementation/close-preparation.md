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

## Productor nativo compartido

`buildNativeZReportContent` extrae de handleZReport los campos calculados/declarados y todos los anexos, reutilizando los mismos helpers y precedencias. El cierre normal ahora construye ese contenido antes de avanzar series; selección, asignación, guardado e impresión continúan en su flujo existente. Los cálculos no se corrigen ni se convierten monedas de otra manera. `fallbackOpenedAt` es un instante explícito para el caso sin movimientos válidos, no una nueva apertura persistente. El orden de propiedades del objeto ensamblado puede cambiar; no es un contrato de bytes del transporte previo.

Una preparación puede incluir `nativeZ:{configurationSha256,user,notes}`. En ese caso verifica el digest de config/current y una única terminal local; usa declaration como reportData y las imágenes seleccionadas para congelar body.nativeReport. Conserva id=closeControl.closeId, closedAt=preparedAt y recoveryMemberIds ordenados. Omite sequenceNumber, seriesId, seriesNumber y syncStatus: aún no hay numeración ni publicación. El resultado y sus anexos sobreviven al reinicio con el mismo hash del cuerpo local. El digest de config no es un artifact completo ni certifica la identidad del usuario/declaración.

`tests/fixtures/nativeZReport-parent.json` conserva entradas y salidas tipadas obtenidas del código de App.tsx en develop 9a363b8 antes de la extracción. Se ejecutaron sus bloques originales sin efectos, con reloj fijo y se retiraron solo id/numeración/closedAt/syncStatus. Cuatro casos contrastan la salida completa: defaults, medianoche con devolución/caja/abono, aliases y métodos mixtos, monedas y precisión. Incluyen características que ERP aún puede bloquear: son caracterización de POS, no perfiles aprobados. No se modificaron vectores históricos de auditoría. La zona horaria del corpus se fija para contrastar los anexos por hora que ya dependían del entorno.

Esta ampliación pasó 82 pruebas y build; lint sigue bloqueado por la configuración base ausente. El recorrido de preparación con reporte nativo se prueba en SQLite de archivo, incluyendo reapertura, mismos IDs y anexos, falta de número y rechazo de configuración discrepante. El productor no calcula journal ERP, no inventa sello ni crea evidencia privada. La UI de recuperación y la aceptación operacional aún no están conectadas.

## Contraste integrado con productor ERP

`tests/recoveryNativePacket.test.ts` ejecuta ClosePreparation y el productor nativo POS reales sobre SQLite en archivo, recibe los originales en PostgreSQL 18.4 y llama al productor ERP real de `52f533bb` mediante su RPC readonly `erp_pos_recovered_close_material` bajo service_role. Aplica las seis migraciones únicamente en un cluster temporal nuevo en loopback; no lee DATABASE_URL ni contacta una base existente.

```sh
CLIC_ERP_REVIEW_PATH=/ruta/al/checkout/CLIC-ERP \
CLIC_EMBEDDED_POSTGRES_MODULE=/tmp/clic-original-pg-tests/node_modules/embedded-postgres/dist/index.js \
npx tsx --test tests/recoveryNativePacket.test.ts
```

Resultado: PASS para dos TICKET DOP que cruzan medianoche. El reporte preparado completo produce la proyección JSON esperada y journal por 150; después de cerrar/reabrir SQLite, conserva preparación y packetJson. Declaración cambiada, referencias omitidas y evento FAILED rechazan; el contenido de inbox, series, journals, commits, asignaciones y evidencia permanece intacto durante producción y rechazo. En POS no aparecen Z ni avances de series. El RPC permitido por el adaptador de prueba es exclusivamente el lector de material.

Los originales y la preparación provienen de los productores POS, pero los eventos comerciales APPLIED/deferred y sus links contables se instalan como fixtures sintéticos: no se ejecuta un applier comercial ni se prueba autenticación/takeover real. Las tablas ERP son el esquema mínimo del harness, no una certificación de compatibilidad con producción. Esta prueba no demuestra aceptación, corte autenticado, semántica de todos los canales ni coordinación operacional. No añade endpoint ni conecta UI. El kernel de mantenimiento aislado no se usa.

Validación conjunta: 83 pruebas POS/integración PASS sin skips, build PASS; 59 pruebas ERP y 44 escenarios PostgreSQL ERP reproducidos independientemente. Lint permanece bloqueado por la configuración base ausente. El fixture SQLite compartido se extrajo de las pruebas existentes sin cambiar su comportamiento. Sin escrituras remotas, dispositivos ni operaciones reales.

## Imagen de configuración usada por el productor nativo

Las nuevas preparaciones nativas incluyen `nativeConfiguration:{version:1,profile:'pos.native-z.configuration.v1',body,bodySha256,sourceConfigurationSha256}`. Su body usa el codec tipado existente. El hash de la configuración completa observada sigue en request.nativeZ.configurationSha256; el hash del subconjunto congelado es distinto, sin conversión implícita a intención o sello.

La proyección conserva presencia/tipos, orden y ambigüedad de monedas/métodos/impuestos/terminales; copia únicamente los campos que consume el productor Z actual y sus resolvers (incluidos códigos de impuesto, aliases de terminal, impuestos por defecto y opciones Z por usuario). Excluye integración, credenciales, hardware y opciones ajenas. Rechaza estructuras no admitidas en campos escalares. No se restaura como config operacional ni modifica configuración del dispositivo.

Cada preparación calcula el contenido con la configuración completa y con la proyección, y exige igualdad de la salida tipada completa antes de guardar. Una diferencia bloquea con CONFIGURATION_INCOMPLETE; no corrige el cálculo ni reduce la selección. Esta comparación acredita solo la ejecución concreta, no cobertura universal de ramas, configuración histórica de cada venta, autoridad del usuario ni contexto de zona horaria/localización. `configurationCoverage=INCOMPLETE` permanece.

La imagen queda dentro del mismo documento atómico que el reporte, sus miembros y declaración. Reabrir SQLite conserva los bytes; un cambio posterior de config invalida resume pero no sustituye la imagen anterior. El productor ERP 3a8d7e0e consume este subconjunto verificando el artifact congelado y ambos hashes. La ruta legacy de laboratorio que recibe la configuración completa sigue siendo diferente; con artifact presente no permite sustituirlo por esa imagen completa.

Pruebas: cuatro salidas completas del corpus padre reproducidas con la proyección, precedencia de métodos duplicados, presencia/undefined/null, exclusión de credenciales y persistencia en SQLite. No se modifican vectores históricos ni se habilita cierre. La prueba cruzada actual usa el artifact proyectado contra ERP 3a8d7e0e. Reabre SQLite y obtiene nativeReport, closeControl, configuración y declaración de los bytes persistidos; no necesita una copia externa de configuración para producir el mismo packetJson. Las referencias de recepción ERP siguen siendo material explícito de la prueba, no una cola perdida reconstruida.

Validación del consumo de configuración congelada: 13 pruebas dirigidas PASS (incluida integración SQLite/PostgreSQL), build PASS. ERP expone en trace el hash de proyección, el hash de fuente y el perfil por separado. Se comprueba que son hashes distintos, que la imagen completa no sustituye silenciosamente el artifact y que configuraciones alteradas rechazan sin efectos. Esta prueba usa las seis migraciones versionadas del harness local; no aplica la migración de coordinación de recursos aún pendiente de entrega. No valida ni autoriza cierre.
