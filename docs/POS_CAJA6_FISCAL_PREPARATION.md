# Preparación manual de una nueva operación de Caja 6

Estado: código de selección y consulta preparado para revisión. Esta entrega no genera APK, no instala, no crea ventas y no emite comprobantes. Los despliegues ERP2259 y2278 se aceptan como evidencia externa suministrada; no se repiten sus migraciones ni su campaña de integración.

## Entrada disponible en el código

En Ajustes, una sección limitada a la terminal Caja6 permite **Marcar la próxima venta nueva**. El operador debe acordar antes los artículos y el importe de una futura prueba; el botón no crea esa operación. Únicamente el siguiente commit nativo normal observado por esta instancia puede seleccionar un original si devuelve `created:true`. Un replay, una fila histórica, un ID escrito manualmente, un segundo checkout concurrente o un escaneo de pendientes no conceden selección. Sin selección armada, el wrapper delega directamente la misma promesa nativa sin lecturas, hashes, copias ni red.

Tras el commit se muestra ticket, NCF, fecha, total y cantidad de líneas del original. **Consultar preparación en ERP** ejecuta exclusivamente el consumidor real GET `/api/fiscal/v2/documents/applied-receipt`, autenticado mediante el contexto bound existente y sin redirects/fallback. No escribe claims, receipts independientes, marcadores financieros ni eventos. Una observación READY no es permiso para emitir ni aceptación DGII.

## Alcance y autoridad

La política exige tenant `9eda7d73-76e4-4432-ad13-4934fefe8f69`, company `6b6153ce-501e-4702-9ae9-34a3f1ab9042`, store `de8dd318-12e7-4a3f-b0e8-4ea1bdb70c07`, terminal `351d5ae1-c8c9-4d09-a1fe-42096496778e` y SHA256 literal UTF8 del dispositivo `a1b588a89bd26bca0e43e81d0ca060cc0f1622f8f46d2a1901a1880273fdf9fe`. La huella histórica se corroboró contra el productor QA; no se publica el dispositivo original ni tokens. El código productivo calcula la huella usando `sha256Utf8`, sin trim, normalización, JSON, prefijo ni sal.

El origin bound autorizado existente es `https://clic-erp-production.up.railway.app`, compartido productivo; esta preparación no lo convierte en laboratorio dedicado ni cambia pairing. Se conserva separadamente el origen de descarga original del binding. La política requiere proveedor MSELLER, ECF, entrega DELEGATED_ERP explícita y concordante en el registro fiscal ERP autoritativo y configuración terminal, ambiente original numérico0, emisor130090752 y E32 del rango `1e778cf9-23c5-4530-b15a-b4182817bf48`. Se exige asignación nativa original no nula, bloque original500–1000 y número efectivamente reservado dentro de ese bloque. No se elige el próximo513 ni se completa autoridad desde maestros actuales.

Se validan el original V3 completo, sus espejos, stamps, fiscalIssuance, Outbox literal y secuencias locales posteriores a la intención armada. Datos incompletos, delivery ausente/DIRECT/conflictivo, cualquier scope/dispositivo/rango/emisor/ambiente ajeno, intentos previos, E34, devoluciones, reservas, restauraciones y post-Z quedan HOLD antes del GET. La política no abre Pancuvi ni otras cajas. NoFiscal, Legacy y otros proveedores mantienen sus rutas.

## Estado efímero y límites de emisión

La intención, selección y PreparedAppliedReceipt literal quedan sólo en memoria privada. Cancelar, cambiar usuario/dispositivo o reiniciar invalidan la selección; no se guarda en localStorage, URL o transacción financiera ni se recupera por listar históricos. Un fallo del observador después de un commit exitoso retiene sólo la preparación y devuelve intacto el resultado exitoso del checkout. La configuración se fija de forma estricta: si una actualización normal cambia su snapshot entre armado, commit y consulta, se retiene la preparación; no se repara ni adopta otra fuente.

La factoría productiva expone únicamente arm/commit real/prepare/cancel/status/subscribe. No tiene acción Enviar ni puerto de autorización de emisión. `App.syncFiscalDocument`, fiscalService, scheduler, historial y dispatcher global conservan `FISCAL_ERP_APPLIED_RECEIPT_REQUIRED`; esta entrada manual no modifica sus cierres.

Una composición separada mediante puertos de validación sintéticos prueba el mismo consumidor y política con `createMSellerDispatcher`. Sólo esos tests reciben un comando cerrado sobre una capacidad privada de una selección, consumida antes de awaits; el factory nativo nunca recibe ese puerto. Si una nueva observación difiere en contenido sustantivo del Prepared original, incluido su digest opaco, no se adopta y no hay claim/POST. Sólo observedAt puede refrescarse para comparar; el recibo original completo, incluido su observedAt, se conserva literalmente para el claim, sin reemplazar el pin. El futuro flujo reutiliza el CAS existente de cuatro mutaciones para receipt/expectation/anchors/claim junto a ambos espejos/config, y conserva POST único y recuperación GET-only ante resultados desconocidos. No añade schema, lease, TTL, reset ni permiso creado por READY o ID. Conectar una emisión real requiere otra autorización y revisión de código para la operación acordada.

## Evidencia y pruebas

Las pruebas dirigidas crean fuentes nuevas mediante constructor y commit SQLite reales sobre puente Node explícitamente sintético. El endpoint HTTP local entrega DTOs sintéticos; su proveedor se simula sólo en el test. Se comprueban selección exclusiva, replays rechazados, error de observación sin cambiar checkout, concurrencia, drift, redirects, pin A frente a B, CAS nativo, POST único, respuesta perdida y reapertura de SQLite. Esto no es prueba Android, ejecución contra el ERP desplegado, MSeller real, aceptación DGII ni impresión. Se reutilizan las regresiones del consumidor/dispatcher existentes y no se repite la campaña ERP10.

Formatos, E34 negativo e históricos post-Z permanecen retenidos. No se cambian credenciales, flags, grants, configuración operativa, bindings ni SQL remoto.
