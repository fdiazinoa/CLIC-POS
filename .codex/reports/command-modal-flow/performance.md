# PERFORMANCE independiente: evaluación exploratoria

- Tarea: command-modal-flow.
- Rol/sessionId: PERFORMANCE, `/root/performance`, distinto de developer, reviewer, QA y sync-validator.
- Base exacta: `bcbc46c02d74246da16698cae54e3887a11e6ffd`.
- Candidato medido final: `0473b58238d229c3bd1f53b5a37ab6011d9dd30e`. `/root/qa` confirmó QA UI final PASS antes de ejecutar sus muestras.
- Estado: exploración completada; gate completo **BLOCKED** por cobertura/capturas insuficientes. No autoriza release/deploy/APK.
- Contratos consultados: `.codex/agents/performance.md`, AGENTS.md, WORKFLOW.md, checklist performance, PERFORMANCE_ARCHITECTURE y SELECTIVE previamente leídos; `analysis.md` y `qa-baseline.md` de esta tarea leídos.

## Baseline congelado

Checkout detached exclusivo `/tmp/command-modal-flow-perf-baseline`, desde base exacta. `components/ModifierModal.tsx` permanece intacto (SHA256 `c6ff4e89bcef05488318c7c23b6fc3d5328dac8bac84e4a1df4deaa179921441`). El harness `.perf-command-modal-flow/main.tsx` copia la fixture QA de nueve extras y tres bebidas, con imports ajustados a este checkout. Incluye `index.css` global y config Vite/Tailwind de la base. SHA256 del harness antes de instrumentar: `93ee32e62ead655eaf60eb260a90f9e60c4794420a7b67b2221305f9ab17fe3a`.

`node_modules` enlaza dependencias compartidas, pero el harness NO vive dentro de ese symlink ni importa componente candidato. Ruta compartida a QA para comparar payload de baseline. No se editó código funcional.

Servir desde baseline con `./node_modules/.bin/vite --host 127.0.0.1 --port 4181`; URL `http://127.0.0.1:4181/.perf-command-modal-flow/index.html`. Captura inicial ya obtenida por QA en `baseline-initial-landscape.png`, viewport 1440×900, hash registrado en qa-baseline.md; el agente PERFORMANCE no la presenta como captura propia.

## Medición preparada

Una vez candidato congelado y QA funcional PASS, usar dos controles idénticos en mismo Chrome/viewport1440×900/DPR/fixture/flags/buildmode. Registrar n/p50/p95/p99/max nearest-rank y deltas con warmup explícito, sin quitar outliers; duración y >=3 sesiones/100 muestras por operación son requisito del gate completo. Una ejecución menor solo es exploratoria.

- Extras: click recibido→estado seleccionado/total actualizado en DOM; confirmar que MutationObserver observa cambio relevante (aria-checked/texto) y no mutación ajena. Registrar oportunidad de frame por doble rAF por separado; no equivale a primer frame presentado ni latencia hardware→pantalla. Seleccionar y deseleccionar mismo Bacon en baseline/candidato conserva comparabilidad.
- Single: separar respuesta inmediata de selección (objetivo p95<=50ms) del **delay UX explícito aproximadamente250ms**, más el coste de transición posterior. No sumar ese timer al tiempo de procesamiento, ni retirarlo de un total reportado sin desglosarlo. El baseline no autoavanza: el tiempo de autoavance es métrica nueva del candidato, no comparación artificial contra cero.
- Navegación manual/paginación nuevas: registrar muestras candidato como operaciones nuevas, sin inventar equivalentes baseline.
- LongTasks, cambios DOM/renders, tiempo de instrumentación y muestras descartadas/drops se informan honestamente. Observer setup no valida overhead total. Control sin observer/alternancia si se pretende atribución de diferencias pequeñas. Sin Perfetto/compositor no certificar presentación física.
- Persistencia, impresión, proveedor y sync no forman parte del callback del harness y se declaran no medidos. Fixture usa fake-indexeddb sobre adaptador real; no extrapolar a SQLite/WebView ni al POS completo.

El timer UX permitido por petición no puede tapar un bloqueo de render: selección/total deben reflejarse antes de avanzar. Cancelación del timer en navegación/close/unmount/reselección y ausencia de doble salto/callback son contratos QA, no se certifican por medir elapsed solamente.

No se midió candidato antes de QA. Baseline fuente/harness quedan preservados para ejecución posterior y paridad del payload; n/p50/p95/p99/max de esta tarea todavía NO MEDIDOS. No se construyó/instaló APK ni se accedió datos operativos.


## Resultados tras QA final (2026-09-19)

Base y candidato se sirvieron desde worktrees detached exactas independientes, puertos4183/4182. Se congeló candidato en `/tmp/command-modal-flow-perf-candidate`. Ambos usaron copia idéntica del harness baseline con CSS global de su checkout, fixture de nueve extras/tres bebidas, Vite desarrollo y fake-indexeddb. El rótulo auxiliar BASELINE del harness también aparece en candidato por esa copia idéntica; versión se identifica por checkout SHA, no ese rótulo. No se modificó código funcional.

Entorno real registrado por páginas: mismo Chrome152.0.0.0, mismo tab en host macOS (UA Intel Mac OS X10_15_7), viewport1488×929 y DPR1. Se usó viewport natural idéntico, en lugar de1440×900 previsto. No extrapolar a móvil/WebView. Orden baseline→candidate, sin alternancia A/B repetida. Cada versión recibió22 clicks confiables `isTrusted=true` de Bacon para seleccionar/deseleccionar; dos warmup iniciales fuera del cálculo, veinte muestras conservadas sin retirar outliers. Una sesión por versión.

Instrumentación temporal idéntica: click capture con performance.now; observer de DOM termina cuando cambia clase o aria-checked de la tarjeta pulsada; segundo rAF posterior da proxy de oportunidad de frame. Se comprobó estado después de pulsaciones. Inicio excluye hardware/input queue previo al listener. DOM actualizado no equivale a commit React exacto, y doble rAF no prueba presentación física ni color completamente estabilizado de una transición CSS. Métricas de respuesta visual real/primer frame necesitan captura compositor. No se presentan estas cifras como medición input hardware→visible exacta.

| Métrica (ms) | Versión | n | p50 | p95 | p99 | max |
|---|---|---:|---:|---:|---:|---:|
| Click→DOM seleccionado | baseline |20|7.4|8.9|11.2|11.2|
| Click→DOM seleccionado | candidato0473 |20|3.8|4.6|4.9|4.9|
| Click→doble rAF | baseline |20|12.8|14.3|16.5|16.5|
| Click→doble rAF | candidato0473 |20|6.3|7.8|8.0|8.0|

Nearest-rank. Delta p95 DOM−4.3ms/−48.3%; frame proxy−6.5ms/−45.5%. Estos bloques describen menor tiempo observado en el control candidato; una sesión/n20 no demuestra mejora causal universal. Ambos proxies quedan por debajo50ms en estas muestras; eso no certifica SLA UI real global.

### Delay UX separado

Cinco selecciones de Agua con Gas en candidato final, primera tras bloque caliente y cuatro tras reload de página. Sin warmup excluido en este control pequeño; modo mixto documentado. Cada operación observó selección y luego textarea de Nota tras autoavance, sin pulsar Continuar a Nota. No invocó onConfirm.

| Métrica candidato (ms) | n | p50 | p95 | p99 | max |
|---|---:|---:|---:|---:|---:|
| Click→DOM selección bebida |5|4.5|4.9|4.9|4.9|
| Click→doble rAF selección |5|13.7|16.0|16.0|16.0|
| Click→DOM Nota por autoavance |5|260.7|263.5|263.5|263.5|

Timer UX configurado250ms, total observado257.2–263.5ms. El excedente7.2–13.5ms engloba scheduling, handlers/render y observer; **no se atribuye como duración exacta de una función**. La respuesta inmediata se observó separada del delay; no se resta250ms para proclamar SLA de toda la transición. Baseline no autoavanza: no hay delta baseline aplicable para esa operación nueva.

### Overhead, evidencia y límites

Observer setup0–0.1ms; no valida overhead total<=5%. LongTasks observadas en bloques de extras:0. Los22 clicks de cada bloque produjeron22 registros; no se vio pérdida en ese contador, pero no existe auditoría de drops de trazas. Sin Zone/fiber profiler, Perfetto o calibración A/B sin observers. Ningún timer añadido a lógica productiva para medir; rAF solo instrumenta harness.

Muestras a0.1ms y metadata en `/tmp/command-modal-flow-perf-samples.json`, SHA256 `5e58b1f7614b3a025f7e4abd92e89f69ffe5e45ddbbcdbc89ca5c83df8c81fbb`. Floats exactos y clocks de cada muestra permanecen en outputs cua de esta sesión. Harness instrumentado reproducible en `.perf-command-modal-flow/main.tsx` de ambos checkouts temporales. Se hizo un bloque preliminar7c0be6f antes del ajuste final y se repitió0473 después de QA final; la tabla reporta exclusivamente0473, sin reasignar muestras antiguas.

**Gate completo BLOCKED**: n20/<100 y una sesión/<3, respuesta física visible sin captura, overhead no validado, sin perfil de renders no afectados ni trazas main-thread/GC/layout del POS completo, sin sync activa/reconnect ni Android candidato. El estado funcional lo aprueba QA; este informe no lo sustituye. No hay regresión observada en estos proxies acotados. Commit/print/proveedor/persistencia real/sync no medidos por este harness; no APK, instalación ni publicación.
