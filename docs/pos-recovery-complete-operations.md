# Recuperación de originales completos y operaciones pendientes de Z

## Comportamiento

El POS conserva el original íntegro antes de cualquier payload comercial: renglones (`id` de producto / `cartId` de línea), impuestos, descuentos, pagos, monedas, cantidades recibidas/aplicadas, cambio, referencias fiscales, extensiones y relaciones. El archivo typed preserva presencia/undefined y valores originales; SQLite mantiene su proyección JSON habitual. La comparación con el productor Z nativo evita aceptar una proyección que cambie su resultado.

La configuración histórica ahora utiliza la proyección nativa con `taxRate` y `terminals[].config` correctamente anidados. No incluye credenciales de integración. Los originales anteriores no se reescriben ni se completan con configuración supuesta.

Descargar/restaurar no crea Z. Antes de importar se consulta `/originals/snapshots/:snapshotId/pending`: ERP identifica por referencias exactas operaciones pendientes, antecedentes necesarios, operaciones cerradas y contexto. POS verifica hash, alcance, snapshot, referencias y cobertura de las revisiones seleccionadas. No restaura como activas operaciones que pertenecen a un Z recibido. Una factura cerrada requerida por una devolución/abono se conserva en historial, nunca vuelve a sumarse. La copia raw descargada sigue disponible como evidencia.

El cierre posterior es explícito. El controlador conserva las tres entradas del cálculo existente: transactions, cashMovements y collections. No convierte abonos de agenda en facturas: siguen siendo Collection con bookingActivityId. Wallet, incluido un depósito independiente sin referencia a factura, se conserva como dependencia y no se suma de nuevo como venta. No se corrigen signos, aliases, precedencias ni redondeos del cálculo actual.

Al revisar se envían los originales locales pendientes y se obtiene un nuevo snapshot fuera del camino de cobro. Se exige referencia recibida exacta para cada operación nueva o recuperada; no se excluye una fila sin respaldo para que el cierre pase. Las dependencias conservan sus revisiones originales. La zona horaria IANA actual del POS queda congelada en request.nativeZ.timeZone antes del hash. ERP ejecuta el productor real versionado en un proceso aislado con esa zona, sin cambiar la zona global del servidor. El contexto técnico del comando queda congelado en receivedContext; el perfil explícito de múltiples orígenes permite conservar recibos de la base anterior y la nueva sin afirmar que sean una sesión durable. Una nueva operación durante la descarga/aceptación invalida la selección; no se hace un cierre parcial silencioso.

## Estados separados

El perfil `erp.received-native-operations.v1` acepta el Z del conjunto recibido. COMMITTED significa recepción durable de la intención/miembros/Z. No significa que todos los cobros o ventas estén aplicados financieramente.

El ACK liga `financialState` y `operationStates` al packetHash; `journal:null` y `journalId:null` impiden aparentar un asiento. ERP conserva trabajo financiero pendiente por recibo/commit. El POS muestra si la aplicación financiera sigue pendiente o fallida. Ni recepción ni restauración provocan reenvío comercial de documentos recuperados.

Un único guardado local archiva ventas, marca cash/collections con el Z sin perder sus campos/asignaciones, guarda el reporte y avanza la serie sin retroceder. La selección pendiente utiliza pertenencia explícita para recuperados, no fecha. ACK perdido se consulta; fallo SQLite revierte publicación y permite reanudar con el mismo ACK. Los antecedentes no se modifican.

La base local puede proyectar Date/undefined como JSON; eso no reemplaza el original typed. La autenticidad del conjunto depende del endpoint ERP autenticado y su almacenamiento, no del hash calculado por un paquete local.

## Evidencia

- `tests/fixtures/nativeRecoveryOperations.ts`: formas nativas anonimizadas de checkout/refund, CashMovement, AccountReceivableModal y AgendaService; DOP/USD, pagos mixtos y cambio, ITBIS, descuento, REFUND positivo con tarjeta/VOID, entradas/salidas, abono con allocations y anticipo booking.
- `recoveryCompleteOriginals.test.ts`: pérdida SQLite, conservación íntegra de originales y proyección de runtime, igualdad del Z nativo completo antes/después, dependencia de factura cerrada sin reabrir.
- `recoveryCashTransport.test.ts`: original cash vs payload final, aliases/timestamps/extensiones preservados, repetición del mismo binding y rechazo de ámbito/contenido distinto.
- `recoveryNativeOperationsRoundTrip.test.ts`: router HTTP ERP + PostgreSQL efímero + SQLite + productor empaquetado ERP (`receivedNativeCloseOptions` habilitado solo en la prueba), selección autenticada antes de restaurar, hashes recalculados con omisiones/scope/duplicados/cierre falso, cierre explícito con aplicación financiera pendiente, ACK perdido, conservación de allocations y segunda recuperación sin reabrir lo cerrado. Incluye trabajo nuevo después de restaurar.
- Pruebas previas de adapters, descarga interrumpida, estados comerciales, snapshot, preparación y oráculo permanecen.
- Resultado local: 27 pruebas PASS, cero SKIP; build PASS. Lint sigue bloqueado por configuración previa ausente de ESLint 9. La prueba HTTP usa 11 originales iniciales y una operación nueva después de restaurar; cierra 8 miembros y conserva 3 dependencias sin sumarlas. No crea documentos comerciales ni asientos.

Procedimiento, con las dependencias de laboratorio ya instaladas:

```sh
CLIC_ERP_REVIEW_PATH=/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/CLIC-ERP-recovery-contract CLIC_EMBEDDED_POSTGRES_MODULE=/tmp/clic-original-pg-tests/node_modules/embedded-postgres/dist/index.js node --import tsx --test tests/recovery*.test.ts tests/closePreparation.test.ts tests/nativeZ*.test.ts
npm run build
```

Las fixtures son datos efímeros, no ventas de clientes. No se despliega ni se ejecutan migraciones remotas. Pairing/takeover se reutilizan. El flag sigue apagado por defecto; activar un entorno/dispositivo es una decisión posterior a esta integración. Lo que nunca salió del equipo no puede recuperarse. Legacy ambiguo sin pertenencia verificable no se convierte en evidencia exacta por fechas o conteos.

El script `scripts/build-recovery-oracle.mjs <directorio>` reproduce el bundle del productor puro con manifiesto SHA256 de sus entradas y verifica que coincidan con el commit declarado. El montaje ERP permanece apagado por defecto; no requiere un productor alternativo ni un archivo externo al proyecto al desplegar.
