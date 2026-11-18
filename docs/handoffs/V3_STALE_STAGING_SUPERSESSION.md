# Catálogo pendiente obsoleto: recuperación conservando la base operativa

La ruta de actualización solo-catálogo priorizaba siempre `findIncomplete()` y no negociaba otra sesión mientras existiera una descarga pendiente. Una sesión ya validada con semántica incompatible podía permanecer bloqueada aunque el ERP publicara un catálogo corregido.

Ahora consulta primero el catálogo que ofrece el ERP. Si coincide con la sesión pendiente, conserva la reanudación de sus chunks. Una sesión distinta solo puede sustituir el staging si su versión es estrictamente superior a la pendiente y a la activa. No se admite otra identidad con la misma versión ni volver atrás. Si falla la red o la validación del manifiesto, no se cambia el staging local.

`prepareCatalogOnly` admite un snapshot esperado de la sesión pendiente (ID, versión y estado). En su misma transacción `BEGIN IMMEDIATE` comprueba la vinculación, catálogo activo, owner, autoridad de inventario y puntero exacto de staging. Marca exclusivamente esa sesión no activa como `FAILED` con `error_code=SUPERSEDED`, conserva todas sus filas/chunks/progreso y prepara la nueva sesión. Un error o discrepancia revierte todas esas escrituras de metadata. No reemplaza sesiones activas ni el ancla de inventario; no admite colisiones de versión.

La activación posterior sigue ejecutando las protecciones semánticas y de inventario existentes. Un catálogo nuevo todavía incompatible sigue bloqueado. No se borran documentos, ventas, tickets, movimientos, saldos, históricos ni vinculación; no se restaura ni reinicia la BD, ni se descarga otra base de inventario por este camino.

Pruebas con SQLite real cubren negociación nueva, mismo staging, fallos de red/manifiesto, CAS obsoleto, vinculación/owner/ancla cambiados, igual versión/downgrade, colisión de versión, fallos SQL y rollback de punteros/estados. La comprobación física de Master-01 queda pendiente: una prueba automatizada no confirma que ese equipo haya sincronizado.
