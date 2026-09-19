# Análisis y plan: flujo progresivo del modal de comandas

Rol ANALYST; agente `/root/sync_review`; tarea `command-modal-flow`; base `bcbc46c02d74246da16698cae54e3887a11e6ffd`; rama comunicada `feature/pos-command-modal-flow`. Estado PLAN_READY, pendiente aprobación independiente. Sin código funcional editado. AGENTS.md, WORKFLOW.md y contrato analyst consultados; mapas arquitectónicos previamente leídos documentan SHA `669f9624…`, anterior a la base actual: rutas siguientes contrastadas en código actual.

## Solicitud y evidencia

Especificación del usuario: `/Users/felixdiaz/.codex/attachments/7577c0be-1cdf-4de3-83fa-f53df8844dc5/Pasted text.txt`; referencia visual inspeccionada: `/var/folders/kw/66_3pf9n6ks5b7bmyt_jwrym0000gn/T/codex-clipboard-38c6ff16-fd43-43f7-b34d-fde2d1556f55.png`.

Componente real: `components/ModifierModal.tsx`. Caller `components/POSInterface.tsx:9565` entrega producto, moneda, themeColor y callbacks; confirmación llama addToCart y cierra. El modal no calcula impuestos ni escribe DB/sync: devuelve precio/config al caller, cuya ruta existente conserva tributación y persistencia del pedido. No hay causa de sync que resolver en esta tarea.

Actual: panel max-w-2xl, todos los grupos/fracciones/nota visibles simultáneamente, opciones sin paginación, una o dos columnas, tarjetas de mínimo 72 px y contador/alerta roja inmediatamente por requisitos incumplidos. Footer deshabilita agregar antes de interacción. Estado de selecciones permanece en useState mientras el modal sigue montado. Objetivo: sección activa única, indicador dinámico y navegación reversible; cuadrícula/paginación táctil, footer fijo y validación bajo intento.

## Contratos que se preservan

- `ModifierModalProps` y firma onConfirm intactos. Ningún cambio a Product/Modifier/ComboGroup, resolver de catálogo, sincronización ni impuestos.
- Grupos estructurados filtrados por active !== false y ordenados por sort_order; fallback availableModifiers permanece.
- Estado por group.id, option.id y parte: selectedModifiersByGroup, selectedCombosByGroup, selectedFractions, note. Navegar no reinicia selecciones, orden de selección ni nota; cerrar/remontar conserva el comportamiento actual de descarte temporal. No introducir localStorage, sesión global ni persistencia nueva.
- SINGLE reemplaza elección; toggle permite deselección como ahora. MULTIPLE respeta max_select. Combo utiliza su max_select con default 1; no imponer semántica distinta.
- Mínimo efectivo: required → max(1,min_select||1); opcional → min_select||0. Grupo opcional con mínimo positivo conserva ese mínimo. No relajar grupos mal configurados/sin opciones.
- Fracciones: HIGHEST_PRICE=max; AVERAGE_PRICE y SUM_PARTS=sum(price/parts); BASE_PLUS_DIFF=base+max(0,maxPart-base). Antes de completar partes se conserva base original. FRACTIONABLE requiere selección; cualquier fracción iniciada exige todas las partes.
- Modificadores: price_delta ?? price ?? 0. REMOVE y affects_price=false no suman; free_quantity se consume en el orden actual de selección de modificadores cobrables. No ordenar selecciones de otro modo al paginar. Combos suman price_delta.
- Total = base de fracciones + modificadores + combos. Desglose footer: Base representa base efectiva de fracciones; Extras suma modificadores y combos; Total suma ambos. Precio base del encabezado sigue product.price. No recalcular impuestos en UI.
- onConfirm conserva labels, finalPrice, note.trim() y restaurantConfig: modifierGroups, comboGroups, fractions, selected_modifiers, selected_fraction_parts, selected_combo_items, product_type, production_area_id, note. Los IDs y estructura de snapshots permanecen intactos; no introducir metadatos de navegación en contrato.
- addNotePreset conserva concatenación y deduplicación existentes; nota se incluye en labels/snapshot igual que antes.

## Plan mínimo

1. Crear descriptors de pasos de presentación estables: fracciones cuando existan (preservar orden previo antes de modificadores), grupos modificadores en su orden actual, combos en su orden actual y Nota final siempre presente. Nombres y cantidad derivados de datos; no hardcodear Extras/Bebida. Fracciones se presentan como pasos dinámicos Parte 1…N para aplicar la misma cuadrícula sin ocultar partes; validar también el conjunto en confirmación. Preservar opcionalidad: producto no FRACTIONABLE puede dejar todas las partes vacías; una vez iniciada cualquier fracción, confirmación exige completarlas todas y dirige al primer hueco. FRACTIONABLE exige todas. No introducir obligatoriedad nueva por partir visualmente la sección.
2. ActiveStep, visited/completed y páginas por stepId son estado de presentación separado de selecciones. Solo sección activa montada. Steps completados muestran check y resumen compacto de elección, y permiten regreso. Completion depende de intento válido/selección válida, no solo visita. Regresar y quitar selección invalida completion. Nunca saltar requisitos en confirmación aunque se navegue por indicador.
3. Cuadrícula: página de ocho opciones; landscape POS/tablet cuatro columnas y dos filas de altura uniforme; portrait/mobile dos columnas, hasta cuatro filas. Reservar dos filas landscape y cuatro portrait para ocho posiciones mediante altura/grid o placeholders invisibles no interactivos. Espacios sin opción quedan vacíos, sin estirar última tarjeta ni insertar botones ficticios interactivos. Orden DOM row-major. Cards >=88px de alto, uniforme, ancho definido por grid. Evitar scroll interno de grid; cuerpo central puede desplazarse en viewports bajos conservando header/footer. Definir media query por ancho y orientación para no tratar tablet portrait ancha como landscape. Capturar ambos casos.
4. Cada tarjeta es botón totalmente táctil, nombre legible, precio o Sin costo y control checkbox/radio integrado según semántica real. Estado seleccionado azul claro/borde azul/control azul/check blanco y aria-checked o equivalente semántico; no depender solo de color. Mantener precios negativos representables sin alterar fórmula. Contador y límites visibles.
5. Paginación Anterior/Siguiente e indicador X de Y, targets grandes. Persiste página por sección o política explícita estable, pero siempre conserva selecciones de todas páginas. Guardar índice acotado si cambia cantidad de opciones.
6. MULTIPLE siempre avance manual, incluido alcanzar máximo (autoavance al máximo era opcional, se omite). SINGLE/combo max=1 con elección válida avanza tras breve confirmación visual, aproximadamente 200–250ms. El timer responde a requisito explícito UX y no simula trabajo. Cancelar al cambiar selección, deseleccionar, navegar, cerrar, desmontar o cambiar identidad del producto; nunca usar closure vieja para avanzar desde otro paso, nunca ejecutar onConfirm automáticamente. La selección y total se pintan inmediatamente antes del timer.
7. CTA dinámico Continuar a {next.name} → y en último paso Agregar al pedido · {moneda}{total}. Mantener activo para que intento inválido pueda producir guía. Al intentar continuar validar solo paso; al confirmar validar todos y dirigir al primero inválido. Error breve junto a encabezado solo tras intento, mantener selecciones y enfocar primera opción del grupo, o encabezado si grupo vacío. No mostrar rojo preventivo. Click doble/timer concurrente no debe saltar dos pasos ni agregar dos veces.
8. Encabezado y pie shrink-0 siempre visibles; modal ancho limitado apropiado para cuatro tarjetas. Nota final con textarea y presets conserva contenido. Sin animaciones continuas ni dependencias nuevas. Extraer tarjeta memoizada con props/callbacks estables para que cambiar una elección no reconstruya todas las tarjetas; IDs estables incluyen grupo/tipo/parte para evitar colisiones.
9. Pruebas de interacción y paridad del payload, lint/build y gates workflow sobre candidato congelado. Capturas solicitadas y medición performance independiente tras QA funcional. Ningún APK, deploy ni publicación: usuario exige aprobación futura para esos actos. Push/PR hacia develop conforme flujo Git, sin main.

## Tests legacy y alcance

`tests/modifierGroupVisuals.test.ts` exige seis colores distintos por grupo (azul/ámbar/etc.) y rotación. Es incompatible con nueva referencia: activo azul, pendientes grises, completados check. Sustituir esas aserciones por las nuevas de pasos/selección/estado constituye actualización al requisito del usuario, no eliminación de cobertura para ocultar fallo. No conservar exports de paleta muertos solo para pasar tests. No eliminar pruebas de lógica comercial; añadir regresiones relevantes.

Archivos previstos: ModifierModal.tsx; helper puramente UI si reduce complejidad; CSS local/global únicamente si media query lo requiere; pruebas dedicadas y expediente. Sin cambios funcionales en POSInterface, tipos, App, DB ni sync; revisar cualquier desviación con aprobador.

## Matriz y aceptación

| Área | Criterio medible / validación |
|---|---|
| Pasos dinámicos | 0/1/varios grupos, nombres arbitrarios, combos y fracciones conservados; Nota siempre final; un contenido activo |
| Layout | 4×2 landscape, 2 columnas portrait/mobile; ocho máximo por página; card >=88 px; header/footer visibles y sin scroll interno de grid |
| Paginación | 0/1/8/9/17 opciones; última accesible; selecciones página 1 y 3 sobreviven navegar/regresar |
| Multiple | Seleccionar/deseleccionar, min/max y free_quantity; ningún avance automático |
| Single | Radio y sustitución; feedback inmediato; avance con timer; cancelar timer en back/close/reselect/unmount; no doble salto |
| Validación | Sin alerta al abrir; intento inválido conserva paso/selección, mensaje y foco; final vuelve al primer grupo inválido |
| Precios | Base550 + Bacon60 + queso30 + REMOVE0 =640; ADD/REMOVE/affects_price/free_quantity, combos delta y todas reglas fracciones iguales a base |
| Payload | Callback capturado deepEqual a base para mismas selecciones/nota; una invocación al agregar; no cambios de impuestos ni cart snapshots |
| Nota | Texto libre/presets deduplicados y trim; persiste navegar; recibido por onConfirm |
| Regreso | Check/resumen de completadas, cambio de selección y posterior validación; no pérdida temporal |
| Rendimiento | Ocho tarjetas activas máximo; claves/callbacks estables; contador de renders verifica tarjetas no afectadas; n/p50/p95/p99/max baseline/candidate y p95<=50ms de respuesta interactiva excluyendo solo delay UX explícito (reportarlo separado) |
| Regresión | Suites seleccionadas por workflow (ventas/cobro/tickets/mesas y shared conservador), lint y build; smoke real agregar línea con configuración |

Capturas obligatorias: Extras 4×2; dos opciones seleccionadas; Bebida activa; flujo completado/Nota; obligatorio incompleto. Agregar landscape/portrait/mobile para demostrar responsive. Usar fixture sintético con ocho o más opciones, no mutar catálogo operativo para capturas.

Comandos base: npm run lint; npm run build; pruebas específicas mediante tsx --test; ejecutar selector workflow-gate plan antes de implementar y reconfirmar diff committed. QA/reviewer/performance distintos del autor; sync-validator si selector conservador lo exige, sin declarar NOT REQUIRED por falta de entorno. No certificar hardware con SSR. No existe baseline runtime nueva en este análisis: debe capturarse en entorno comparable antes de candidato para performance. Capturas y device/gates requeridos faltantes se registran BLOCKED, sin inventar PASS.

## Riesgo y rollback

HIGH por interacción crítica de pedido, navegación, timers y formularios; riesgo de precio alterado al reordenar selecciones/free_quantity y pérdida de fracciones si se simplifican como simples extras. Mitigación: mantener funciones comerciales existentes, test payload/precio de paridad y cancelar timer en lifecycle. No introducir flag de negocio/sync en rediseño local; rollout mediante PR revisado y ninguna publicación autorizada. Rollback por rama/PR revert, sin resetear catálogo o pedidos y sin push main.
