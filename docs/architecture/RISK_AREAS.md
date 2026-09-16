# Áreas de riesgo y límites

Auditoría estática: 2026-09-16. Fuente: `origin/develop` en `669f9624c85de40129169e6779aa6983f1441fea`. No certifica comportamiento en hardware ni estado desplegado del ERP. Las referencias son relativas a la raíz del repositorio.


Son riesgos inferidos de la fuente, no incidentes reproducidos ni certificados como resueltos por esta tarea documental.

| Prioridad | Riesgo / evidencia | Regresión probable | Gate requerido |
|---|---|---|---|
| Crítica | App central y estado duplicado React/DB/singletons | Closure vieja, efectos repetidos, carrito/mesas/catálogo desalineados | Review estado/cleanup + functional/regression + performance si camino interactivo |
| Crítica | Legacy persiste venta/ledger/tracking por pasos; atomicidad durable depende de flag/adaptador | Escritura parcial, deuda/stock/venta divergentes tras caída | Offline/restart/failure injection en fixtures; SQLite y web separados |
| Crítica | PaymentIntent/servicios proveedor y success/print separados | Timeout ambiguo o doble click causa cargo duplicado | Cobro/idempotencia/conciliación + QA proveedor de prueba |
| Crítica | Identidades tenant/device/local terminal/ERP terminal, tokens y PIN distintos | Datos cruzados, takeover incompleto, permisos vencidos | Auth/setup/regression/sync en topologías pertinentes |
| Crítica | Locks/move/merge mesas con clientes master | Pérdida de líneas o mesa retenida | QA multi terminal, partial/full move/cancel/close y offline |
| Crítica | Z/membership/history/recovery/series comparten ventas | Reapertura de venta cerrada, cierre doble, secuencia incorrecta | Z + tickets + recuperación + sync/restart |
| Crítica | Inbox receiver ERP externo; ACK no equivale a apply | Venta local sync pero documento ERP ausente | Verificar documento/ledger ERP y dispositions por evento |
| Alta | Catálogo admite edits locales, snapshots/deltas/flags y scopes | Rebote de precio/impuestos/config tras sync | test:catalog-sync + roundtrip real master/cliente/ERP |
| Alta | IndexedDB fallback/heavy collections y SyncMetrics usan JSON/localStorage síncrono | Long Tasks/GC/cuota/stalls periódicos | Baseline/candidate con datos grandes y sync activa + offline persistencia |
| Alta | Background, polling, Realtime y heartbeat compiten con UI | Pausas periódicas, tormentas retry o señal perdida | Idle/activo/degraded + counters/network/drain + performance |
| Alta | Inventario recursivo + recálculo ledger postventa en timeout existente | Stock obsoleto/GC coste creciente | Kits/unidades/tracking y medición desde input hasta estado correcto |
| Alta | Impuestos/fiscal normalización contempla fallback 18% | Resultado distinto de tasa efectiva | Tasas múltiples/exento/incluido/excluido/descuentos/NCF |
| Alta | Kotlin nativo compilado desde native-stubs y WebView bridges | Web pasa pero APK falla, teclado/print/master bloquear | Build APK + hardware/compatibilidad + regresión Android |
| Alta | Instrumentación tiene overhead y modo control no equivale a release limpio | Métrica optimista, drops o contaminación baseline | Protocolo SELECTIVE, clocks/drops, capturas release/control/diagnostic |
| Alta | Config ESLint ausente, suite heterogénea, contratos de texto | Falso gate verde o cobertura E2E asumida | Registrar fallo/bloqueo; nunca reemplazar QA por contract test |

## Objetivo de rendimiento

Objetivo general p95 <= 50 ms para respuesta interactiva, con boundary input → estado visible e interactivo definido antes de medir. Medir también duración hasta commit correcto/print/proveedor/sync por separado; no exigir que una red/impresión termine en 50 ms ni excluir su bloqueo del indicador de UI. La golden baseline actual permite salesTablesNavigationP95MsMax=500: es un umbral legacy existente, no acredita cumplir 50 ms. No modificar baseline ni relajarlo para conseguir un PASS.

Toda mejora de performance exige QA funcional. Long Tasks JS >50 ms, forced synchronous layout, renders inútiles, main-thread sync work, storage bloqueante, GC, red crítica y pausas periódicas deben localizarse con captura. No usar loaders artificiales, timers arbitrarios, quitar funciones, apagar sync ni seleccionar muestras para esconder incumplimientos. Los timers existentes son parte de la auditoría; esta tarea no los cambia.

## Elementos no determinados

- Estado y contrato completo del ERP desplegado, receptor Inbox/batch, RLS/Realtime authorization y esquema cloud completo: no hay acceso/entorno corroborado en esta ejecución.
- Flags efectivos, tamaño de datos y configuración de terminales en producción; defaults no prueban rollout.
- Baseline actual cuantitativa p95 para catálogo, venta, Mesas, Tickets, cobro y navegación en dispositivos objetivo.
- Compatibilidad real de cada impresora, cajón, visor, cámara y lector biométrico; no hubo sesión hardware.
- Protección de ramas/reviews obligatorios y confianza/carga de agentes en cada versión cliente Codex; la configuración documental no crea permisos remotos.
- Cobertura funcional real de tests contractuales sin ejecutar E2E. Comandos/resultados de esta ejecución se registran en AUDIT_VALIDATION.md.

## Recomendaciones

1. Adoptar el expediente de WORKFLOW para la próxima tarea y mantener evidencia ligada al SHA exacto.
2. Medir escenarios iguales web/Android con catálogo e histórico representativos, actividad sync e idle; mantener captura bruta.
3. Completar fixtures/E2E de venta/cobro/mesas/Z/reconexión y fault injection antes de ampliar rollout durable/recovery.
4. Reparar lint y deuda de build/test en tareas separadas desde develop; no mezclar cambios funcionales con instalación del protocolo.
5. Configurar protección de develop/main y checks obligatorios mediante administración autorizada; esta ejecución no cambia settings remotos.
6. Mantener iguales contratos Node/Kotlin con pruebas de transporte en hardware; registrar receptor ERP/flags usados.

## Actualización de auditoría: procedimiento interno

Fuente actual develop `669f9624c85de40129169e6779aa6983f1441fea`. Se reenumeraron 1055 archivos y se escanearon 818 fuentes. Se contrastó el delta operativo desde la auditoría anterior: App y masterOperationalApi ahora validan master vinculado/tenant/rol antes de usar rutas de mesas y otras operaciones; los timeouts de login cliente empiezan después de esa validación. Ver `tests/orderTakerMasterRouting.test.ts`, `tests/loginDestinationPerformance.test.ts`, `utils/terminalLoginLabel.ts` y `utils/interactionPerformance.ts`. No se cambió este código durante la instalación.

Cloud-Admin se inspeccionó en otro repo local; ver [CLOUD_ADMIN_DEPLOYMENT.md](CLOUD_ADMIN_DEPLOYMENT.md). El procedimiento separa code/internal/deployment/testing/production/released. Fuente inspeccionada no certifica estado desplegado ni rollout flags.
