# Checklist performance

Cada punto pertinente requiere esperado/observado y enlace a evidencia para candidate SHA. N/A solo si analista propone y validador independiente justifica ausencia de impacto; nunca por falta de entorno. Checklist completada no sustituye ejecución.

- [ ] Baseline SHA y candidate SHA, builds, hardware/OS/WebView, flags/config/datos/red iguales registrados.
- [ ] Definir input→visible/interactivo, handler, commit correcto, print/proveedor y sync por separado.
- [ ] Medir apertura POS, catálogo, agregar artículo, abrir/cerrar Mesas, cambio mesa, abrir/cerrar Tickets, cobro y navegación pertinentes.
- [ ] Al menos 100 muestras válidas por operación/modo para decisión p95, en >=3 sesiones; warmup documentado y frío separado. Menos muestras = exploratorio/BLOCKED para gate.
- [ ] Calcular p95 nearest-rank sorted[ceil(q*n)-1], q=0.50/0.95/0.99, n/p50/p95/p99/max y deltas absolutos/%; no excluir outliers salvo error de captura documentado.
- [ ] Objetivo interactivo p95 <=50 ms y ausencia de regresión >5% o >5 ms respecto baseline (cualquiera dispara investigación/repetición y FAIL si confirmado).
- [ ] Umbral legacy APK 500 ms también se informa; no sustituye objetivo 50 ms ni se cambia baseline automáticamente.
- [ ] Capturas con sync activa/idle/reconnect, catálogo/histórico representativo y acciones funcionalmente completas.
- [ ] Long Tasks >50ms, forced synchronous layout/getBoundingClientRect crítico, WebView stalls/timers y renders React innecesarios y main-thread sync work localizados.
- [ ] Storage bloqueante, JSON/GC/heap, red en critical path, pausas periódicas y reconstrucción de componentes evaluados.
- [ ] SELECTIVE vigente, modo control/release distinguido, clocks alineados/drops/observer overhead registrados.
- [ ] Capturas brutas conservadas; métricas estimadas no se presentan como mediciones exactas.
- [ ] Sin loaders artificiales/timers arbitrarios/quitar funciones/apagar sync/ocultar sin quitar trabajo/manipular muestras.
- [ ] QA funcional independiente PASS; performance por sí sola no valida release.
