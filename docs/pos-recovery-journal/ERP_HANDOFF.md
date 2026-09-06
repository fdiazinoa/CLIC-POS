# Entrega POS J1 para contraste ERP

Esta es una solicitud de revisión documental, no de implementación. Entrada ERP: R4 invariantes `a7e490d6`; fuente POS auditada: `2e200a2`. Los dos huecos R4 (igualdades conjuntas y una revisión por identidad) están atendidos por el paquete recibido. Proponemos ahora concretar el journal/commit local y las preimágenes sin habilitar recuperación.

Leer README.md, source-evidence.json y vectors.json de este directorio. Ejecutar los dos verificadores offline; no se necesita repositorio POS externo para los vectores, ni se deben ejecutar servicios o bases. Los originales de hashing son sintéticos y parciales, no nuevos perfiles nativos aprobados.

Responder punto por punto:

1. Ratificar o corregir la preimagen originalContentHash R4 y las nuevas preimágenes genesis/entry/chain/seal/acceptance. Comprobar bytes y SHA256 independientemente; añadir vectores propios. Hash no equivale a autenticidad ni ausencia de cola.
2. Acordar que el sello/Z es control persistido fuera de la secuencia operacional que referencia, para evitar circularidad. Debe guardarse con el cierre y reintentarse con el mismo closeEventId, sin doble aplicación. Precisar retención y recepción durable, sin inventar endpoint implementado.
3. Acordar acceptanceDigest como identidad de contenido para reintentos; auth fresca primero, lookup de aceptación antes de CAS de nuevo cierre. No depender del activationId nuevo para desconocer uno ya aceptado.
4. Progreso: proponemos proposedThrough; sealedThrough solo para final. R4 validationStage sigue siendo obligatorio mientras no se acuerde cambio. No renombrar silenciosamente ni declarar compatibilidad automática.
5. Comprobar orden UTF-16 de arrays de miembros y claves JSON. Python sorted() natural difiere para U+1F600/U+E000; JSON.stringify de un objeto con claves numéricas puede reordenarlas. Los vectores incluyen ambos casos.
6. Ratificar configuration.calculationInputOrder con arrays por tipo de referencias a la revisión seleccionada; preserva orden real de cálculo sin usar el orden lexicográfico del manifiesto. Este snapshot debe incluir valores históricos/configuración/entorno, no solo digest. Perfil completo todavía pendiente.
7. Confirmar historial de revisiones separado de membresía: una actualización fiscal/abono sobre venta cerrada no reabre ni vuelve a sumar esa venta. Describir cómo se prueba revisión precedente tras sustitución de base; UNKNOWN no se rellena.
8. Dar estado y dependencia concreta para Collection/Advance/wallet independiente, CAS compartido, cuarentena de reserva completa no reutilizable y series internas. La base POS no demuestra esas capacidades ERP.

El adaptador Android ofrece una frontera parcial reutilizable, pero hoy su duplicate eventId puede preservar outbox antiguo mientras actualiza documento. Web tiene fallbacks no atómicos; Z, abono, NC y wallet usan escrituras separadas. No afirmar que la propuesta está implementada por disponer de SQLite.

El caso de tablet perdida antes del sello final seguirá UNKNOWN aunque coincidan todos los contadores recibidos. No se debe prometer cierre Z exacto de esa cola. Conservar `exactZEligible=false`, `closeAuthorization=NOT_GRANTED`; recepción y aplicación separadas; sin endpoints, migraciones, producción, ventas/cierres de prueba ni rediseño de takeover.
