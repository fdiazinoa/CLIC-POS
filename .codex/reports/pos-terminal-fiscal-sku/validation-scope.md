# Validación previa al APK

Base f904f83543b387b60ca4b82ea9f0be8bdda31e01, rama fix/pos-terminal-fiscal-sku,
PR destino develop. Principal con cherry-pick ajeno conflictivo: se conserva y
se usa worktree aislada /Users/felixdiaz/.codex/worktrees/pos-terminal-fiscal-sku/CLIC-POS.

Usuario reporta caja de Clicsuite y versión «creo que1477»; probablemente1.1.477,
sin verificar instalación. Fuente actual no certifica versión/despliegue dispositivo.
Capturas sin B04 asignado; los próximos B01/B02 coinciden entre global y terminal,
por lo que las capturas no prueban qué cursor consumió el APK.

Baseline independiente QA /root/fiscal_sku_qa:195 pruebas aprobadas, build exitoso,
lint0 errores/39 advertencias; fixture visual real supermercado1600×900.
Node local24.11.1 frente Node22 CI: registrar diferencia, sin afirmar equivalencia.
Plan crítico aprobado por /root, distinto de /root/fiscal_sku_analyst.
Developer /root/fiscal_sku_developer implementa; root solo coordina/documenta.

Roles separados mediante collaboration sessions genéricas (selector de rol
registrado no disponible): root orchestrator/plan-approver, fiscal_sku_analyst,
fiscal_sku_developer, fiscal_sku_reviewer, fiscal_sku_qa, fiscal_sku_sync,
fiscal_sku_performance, fiscal_sku_internal_deploy, fiscal_sku_release.
Identidades de tareas/JSON son declaraciones auditables, no firmas.
Candidato y reportes finales se congelan en expediente externo de la tarea y PR;
los resultados técnicos del autor no equivalen a revisión ni aprobación.

## Smoke de aceptación

Solo empresa/terminal/datos de prueba; no emitir comprobantes productivos.

1. Terminal A: asignar B01/B02/B14 sin B04; auxiliar global B04 activo.
   Intentar devolución directa, mixta e histórica. Esperado: error accionable,
   sin gateway/payment/wallet/deuda/stock/documento interno ni NCF de venta.
2. Asignar B04 activo únicamente a A. Dar A rango4001..4010 y global próximo2.
   Emitir dos documentos de prueba:4001/4002, global intacto y B intacta.
3. Deshabilitar/revocar/agotarlo y repetir; no usar rango global ni buffer antiguo
   sin terminal. Probar configuración vacía explícita y snapshot que omite el campo.
4. Volver a cargar offline/reiniciar; conservar asignación/punteros y no retroceder
   con un push antiguo. Repetir prepared refund ERP: no reservar segundo NCF.
5. Probar LEGACY_B, ELECTRONIC/E34 y NONE sin cambiar política ni duplicar documento.
6. En supermercado usar SKU distinto de barcode, SKU de variante, fallback sin SKU
   y referencia larga. Cabeceras/SKU legibles en escritorio y terminal estrecha;
   editar filas con teclado/clic/contexto, cantidades/importes intactos.

## Límites y gates

Fixtures web/DB mock no prueban SQLite físico ni emisor/receiver ERP desplegado.
El fixture tests/fixtures/supermarket-ticket.html no ejecuta ventas/persistencia:
sirve para inspección visual; sus handlers no-op no permiten medir latencia POS.
Performance exige100 muestras válidas por operación en3 sesiones, baseline/candidato
comparables e instrumentación input→visible/interactivo. Falta esa evidencia;
no reemplazarla con tiempos SSR/Node ni inventar PASS.

Sin receiver/dispositivo requerido, sync/offline/device/performance integrado
permanecen BLOCKED y no se aprueba APK. El PR puede ser draft para revisión de
código; CODE_VALIDATED, INTERNAL_TESTING o READY_FOR_RELEASE no se deducen de tests.
No build/install/deploy APK autorizado en esta tarea, no promoción automática.
Rollback de código por revert en rama/PR; nunca reset/uninstall/downgrade de datos.
