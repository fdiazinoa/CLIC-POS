# Traslado POS PR #888–#893 a develop

Base: origin/develop `4d6d19c0` (PR #887). La rama conserva por ancestralidad el commit fuente del APK operativo 1.1.519 `ef16b05f`.

## Procedencia y resolución

- #888: arranque/cleanup/reintento ya portados en `5b40c8cd`; StartupRetry coincide byte a byte. Se conserva el adapter nativo completo de develop.
- #889: parche de catálogo aplicado en `ef16b05f`, con regresión existente. Los artículos sin saldo permanecen visibles; la política de venta sin stock se conserva.
- #890: DTO, decimal.js 10.6.0, snapshots, selector, persistencia, consumidor, diario y guardas trasladados.
- #891: sigue abierto; su corrección de grilla/variantes ya está incluida en #892 (equivalencia de cuatro archivos funcionales). El prompt antiguo se conserva marcado histórico.
- #892: adaptadores de maestros/eventos y pruebas trasladados. No se sustituye el shell, scanner, impresión, colas de ventas ni sincronización propios de develop.
- #893: return_context v1, autorización del ACK, HOLD por conflicto y reenvío inmutable conservados.

Se aplica únicamente el delta entre `d461db0a` y `dd3dc603`, más el documento histórico de #891. No se fusiona la historia completa de main.

## Adaptaciones nativas

`CapacitorSQLiteAdapter.articleFormatSQL()` comparte el mismo writer lock de documentos y V3. Los postings y ACK usan `documents`, con upsert selectivo por ID dentro del mismo executeSet que pagos, secuencias, inventario, diario y Outbox. No se crea un almacén paralelo collections. Los triggers protegen documentos pertenecientes a formatos sin bloquear escrituras ordinarias legacy/V3.

Se conservan las autoridades y triggers de inventario/finanzas V3. Un posting de formatos con propietario normalizado V3 se rechaza antes de escribir (`POS_FORMAT_V3_POSTING_NOT_READY`): todavía no está demostrado el puente de posting normalizado. Esto es un bloqueo explícito de activación, no integración operativa completa de formatos. El POS vigente con formatos apagados sigue utilizando su posting V3 existente.

TerminalConfig.capabilities sigue siendo string[]. La capacidad de formatos usa articleFormatCapabilities; ningún valor se activa. El selector de variantes conserva ProductVariant y variantInfo en sus callbacks y resuelve ERP_ID ↔ SKU explícitamente. Se preservan performAddToCart/addQueue, scanQueue, impuestos, pesos y fences V3.

## Validación y límites

Las pruebas trasladadas se adaptan al contrato operativo moderno de develop; conservan sus aserciones de devoluciones, precios, snapshots y guardas. Las pruebas adicionales ejecutan SQLite real mediante el puerto del adapter nativo: rollback en cada escritura, commit incierto, replay tras reapertura, contexto de devolución, ACK selectivo, lock compartido y parser Java real del plugin instalado.

Readiness conserva sus seis campos false. No se habilitan empresas, terminales, flags, capabilities ni grants. Las pruebas ERP son únicamente locales aisladas; no acreditan endpoints desplegados. La validación del APK con formatos apagados y la promoción de producción son gates separados de estas pruebas.
