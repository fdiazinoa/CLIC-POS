# Baseline QA visual e interactivo

- Rol / sessionId: QA independiente, `/root/qa`.
- Tarea: `command-modal-flow`.
- Base exacta: `bcbc46c02d74246da16698cae54e3887a11e6ffd`.
- Estado: PREPARACIÓN BASELINE. No es QA PASS ni aprobación del candidato.
- Entorno: componente React real `components/ModifierModal.tsx`, Vite y CSS global `index.css`; fixture sintética persistida, desconectada y reabierta mediante `IndexedDBAdapter` con `fake-indexeddb` aislado.

## Fixture preparada

Harness temporal ignorado por Git: `node_modules/.qa-command-modal-flow/`.

- Producto base RD$550, COMBO y tributación sintética conservada.
- Grupo MULTIPLE Extras: nueve opciones, `max_select=4`; ADD, REMOVE y `affects_price=false`.
- Grupo SINGLE/Combo Bebida: tres opciones, requerido 1/1.
- Tres presets y texto libre de nota.
- Callback captura labels, precio, nota, restaurantConfig, tax IDs y taxable sin simular hooks ni handlers.

## Baseline observado

En viewport landscape 1440×900:

- Modal estrecho y cuadrícula de dos columnas; no cumple todavía 4×2.
- Las nueve opciones aparecen en una sola sección sin paginación; no existe `Anterior`, `Siguiente` ni `1 de 2`.
- Extras, Bebida y Nota pertenecen al mismo cuerpo con scroll; no existe flujo progresivo ni indicador dinámico.
- La validación roja `Seleccione Bebida` aparece al abrir, antes de intentar continuar.
- Footer muestra solo Total Item y Agregar al Pedido; no desglosa Base/Extras ni ofrece CTA al paso siguiente.
- Header/footer permanecen visibles, pero el cuerpo muestra parcialmente Bebida por exceso vertical.

Captura durable: `baseline-initial-landscape.png`, 1440×900, SHA-256 `1d8db2ff41784a1e79d33ebca6e9d8fae87c7fdac98d84aa0ce0a156c171597c`.

## Matriz preparada para candidato

Capturas finales requeridas en `.codex/reports/command-modal-flow/`:

1. `candidate-extras-4x2-landscape.png` — ocho tarjetas, cuatro columnas por dos filas.
2. `candidate-extras-two-selected.png` — contador, estado no dependiente solo de color y total actualizado.
3. `candidate-drink-active.png` — paso Bebida activo después de avance manual desde MULTIPLE.
4. `candidate-flow-completed.png` — Nota/final, resumen de pasos y CTA con total.
5. `candidate-required-incomplete.png` — error solo después del intento, foco y selecciones conservadas.

Capturas responsive adicionales: `candidate-tablet-portrait.png` y `candidate-mobile.png`. Se probarán 9 y 17 opciones para paginación/selección persistente; SINGLE con autoavance cancelable; MULTIPLE manual; min/max; note presets/texto; free_quantity; fracciones; payload profundo e impuestos intactos.

No se modificó código funcional ni tests versionados. No se usó APK ni emulador.
