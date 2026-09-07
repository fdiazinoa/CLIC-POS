# Conservación y restauración de originales — primera implementación

Estado: rama de desarrollo, función apagada por defecto. No activar en equipos de clientes. ERP asociado: `251ef7e9`, PR CLIC-ERP #2012 hacia `clean-erp`. POS parte de `origin/develop` (`4817cc6`). No modifica los vectores ni conclusiones históricos.

## Qué hace

- Conserva una imagen tipada de cada escritura de transactions/history, cashMovements, collections, wallet_transactions y zReports, junto con la escritura operacional en una transacción local. No hay llamadas de red durante ese guardado.
- `transactionService.create` adjunta entrada del productor, documento construido antes del normalizador y documento normalizado. Las demás escrituras conservan la imagen al llegar a persistencia: `originalStage=LOCAL_PERSISTENCE`, que no acredita el origen ni recupera campos previamente descartados. Los originales y revisiones recibidos se conservan sin reconstruirlos desde documentos ERP.
- El codec conserva presencia, undefined, Date, aliases discrepantes, extensiones enumerables y valores numéricos especiales. Rechaza ciclos, funciones, accesores y prototipos no admitidos. La proyección de configuración guarda monedas, impuestos, métodos sin credenciales de integración y ajustes operacionales/workflow; **no es todavía una configuración histórica completa**.
- El worker existente envía lotes a `/api/sync/originals/batch`, con identidad, revisión y hash estables en reintentos. El ACK marca exclusivamente la recepción técnica del original. No modifica el estado de la cola comercial.
- La pantalla de sincronización descarga a staging, persiste cursor, verifica bytes/hash/corte y publica en una transacción separada. Se mantienen IDs, tipos, relaciones y revisiones; no se aplican ventas, cobros, inventario, cartera ni asientos. Tampoco se restauran contadores antiguos.
- Los Z nuevos, con la función habilitada, conservan IDs explícitos de sus miembros. Un miembro cerrado recuperado se conserva cerrado; no se infiere pertenencia por fecha. Los originales no se limitan al día calendario.
- Colisiones locales, revisiones del mismo documento en épocas diferentes y cierres sin miembros explícitos bloquean la publicación completa. No se sobrescriben operaciones locales para resolverlos. Documentos recuperados quedan fuera del reenvío comercial y de la recaptura automática.

## Activación de laboratorio

`VITE_PENDING_OPERATIONS_RECOVERY_ENABLED=true` únicamente en build de laboratorio. Usa la autenticación, terminal canónica y takeover existentes; no hay pairing alternativo. Requiere las rutas y migración ERP instaladas **solo en el entorno de prueba autorizado**. Si capabilities está deshabilitado, no descarga ni envía. No se instaló migración remota ni se modificó un dispositivo.

El importador conserva `businessApplication=UNKNOWN`, `exactZEligible=false` y `closeAuthorization=NOT_GRANTED`. La pantalla lo informa y handleZReport bloquea un cierre que incluya documentos recuperados. Desactivar el flag no elimina los marcadores ni habilita su reenvío.

## Validación reproducible

Node 24, dependencias del lockfile; better-sqlite3 necesita su binario local (`npm rebuild better-sqlite3` si se instaló con ignore-scripts).

```sh
npx tsx --test tests/pendingOperationsRecovery.test.ts tests/recoveryAtomicAdapters.test.ts tests/durableOutboxBatchSender.test.ts tests/durableOutboxV2.test.ts
npx tsx --test tests/masterNumberRangeSqlite.test.ts tests/closeReportOptions.test.ts tests/zReportPaymentSummary.test.ts tests/zReportDeclarationScreen.test.ts
npm run build
CLIC_ERP_REVIEW_PATH=/ruta/al/checkout/ERP npx tsx --test tests/recoveryErpTransport.test.ts
```

38 pruebas POS/outbox, 17 regresiones de series y Z y una prueba cruzada con ERP: PASS (56 en total). El test cruzado usa las rutas y validación ERP reales de `251ef7e9` sobre loopback, con RPC simulado; **no demuestra durabilidad de la base ERP**. IndexedDB usa fake-indexeddb; el bridge SQLite usa SQLite en memoria y fallos inyectados, no un dispositivo Android. Las regresiones de outbox usan better-sqlite3 real. No son ventas/cierres operacionales.

Build: PASS, con aviso de chunks grandes. `npm run lint` no puede ejecutarse porque la base carece de eslint.config para ESLint 9; no se modificó su configuración global.

## Prueba de persistencia de extremo a extremo entre servicios

`tests/recoveryDurableRoundTrip.test.ts` conecta el adaptador POS a SQLite en archivo, las rutas HTTP ERP reales y sus RPC reales a PostgreSQL 18.4 bajo `service_role`. Crea un cluster nuevo en loopback; nunca lee `DATABASE_URL` ni utiliza una base existente. Borra exclusivamente su directorio temporal al terminar.

```sh
# Dependencia del laboratorio, fuera del repositorio:
npm install --prefix /tmp/clic-original-pg-tests embedded-postgres@18.4.0-beta.17
CLIC_ERP_REVIEW_PATH=/ruta/al/checkout/ERP \
CLIC_EMBEDDED_POSTGRES_MODULE=/tmp/clic-original-pg-tests/node_modules/embedded-postgres/dist/index.js \
npx tsx --test tests/recoveryDurableRoundTrip.test.ts
```

Resultado: PASS. Conservó 104 originales/revisiones y restauró ocho documentos. El ACK se perdió después del commit y el reintento no duplicó filas. PostgreSQL fue detenido/reiniciado; SQLite de destino fue cerrado/reabierto con la primera página persistida. Se completaron tres solicitudes de página, sin publicar una descarga incompleta. Se mantuvieron historia cerrada, orden de efectivo, abono de agenda y su asignación, sin escribir series ni crear cola comercial. La operación nunca enviada estuvo ausente: los conteos recibidos **no** prueban cobertura completa.

Los helpers nativos actuales de resumen de pagos, estadísticas Z y anexos dieron la misma salida antes/después para el caso DOP entre medianoches ensayado. No se ejecutó el cierre operacional ni se asignó número fiscal. Esta prueba añade almacenamiento real a la anterior; la frontera de autenticación y el bridge Android siguen siendo adaptadores de prueba. No acredita revinculación real en una tablet, todos los canales, declaración completa, ni autorización del Z.

## Qué falta antes de usarlo para continuar una jornada

1. Completar el recorrido en POS de laboratorio con autenticación/takeover reales y bridge Android. El recorrido entre servicios con SQLite/PostgreSQL y reinicios ya pasó; sus fronteras simuladas no reemplazan esta validación del dispositivo.
2. Completar cobertura de productores, dependencias/configuración histórica y demostrar equivalencia nativa de Z. El snapshot conserva únicamente lo recibido: legacy sigue UNKNOWN y no prueba que la cola perdida hubiera salido del equipo.
3. Resolver pertenencia y continuidad durable de época/apertura, conciliación del estado comercial ERP, aceptación concurrente del Z y autoridad de series/reservas. Los IDs locales storageEpoch/openSetId actuales son contexto de captura; no acreditan una apertura ni un checkpoint sellado. No hay rollover de jornada autorizado ni restauración de series.
4. Mantener pendiente custodia, disponibilidad y retención. No hay borrado por ACK, purga automática ni recuperación de operaciones nunca enviadas. La cola conserva revisiones y necesita una política de capacidad antes del despliegue.

Esta primera entrega permite conservar, transportar y restaurar documentos recibidos bajo control, pero todavía no permite concluir el objetivo operacional de cerrar la jornada recuperada. Se entrega como PR draft, sin merge, despliegue ni APK. La reimpresión seguirá la configuración normal vigente.
