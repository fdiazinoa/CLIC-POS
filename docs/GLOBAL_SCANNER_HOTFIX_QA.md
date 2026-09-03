# Autoescaneo de ventas: hotfix y QA

## Alcance

Base: `origin/develop` 73d4fb6, que ya incluye PR #502 (unión de mesas).
Recupera HID global con Enter/Tab, ráfagas sin sufijo y entrada completa
IME/input de Android en los dos buscadores del POS. No cambia el contrato de
productos, inventario, pairing, impuestos ni pagos.

La captura comparte un único buffer para evitar duplicar keydown/input/Enter.
Una nueva lectura del mismo SKU es otra operación; no se descarta por código.
Los buscadores recuperan foco al entrar en ventas y tras acciones de la pantalla,
sin quitarlo de formularios ni solicitar que se abra el teclado Android.
Los modales bloquean tanto productos como rutas de documentos/tickets.

## Límites explícitos

- Detección HID por tiempo: hasta 100 ms entre caracteres, reposo de 250 ms.
- Sin sufijo: una ráfaga completa de al menos seis caracteres o un bloque IME
  completo de tres o más caracteres. SKU corto HID requiere Enter/Tab.
- Escritura lenta, pegado manual, edición/composición, otros campos y atajos
  quedan en el flujo manual. La detección por velocidad es una heurística, no
  una identificación física del lector.
- Lectores IME necesitan entregar eventos `input` al buscador; foco programático
  los prepara, pero lectores por intent propietario requieren su propio contrato.
- El hotfix no certifica todavía el comportamiento de un lector físico Android.

## Validación ejecutada

- `npm ci`: completado.
- `npm run build`: completado, TypeScript + Vite.
- `tests/globalBarcodeCapture.test.ts`: 20/20 aprobadas.
- Suite operacional obligatoria más pruebas de inventario PDA, unión de mesas,
  cabecera de servicio y supermercado: 102/102 aprobadas (incluye las 20 nuevas).
- Fixture React aislada: `tests/fixtures/global-scanner.html`. Probada con Chrome
  headless y eventos de teclado reales: foco inicial, Enter, reposo+Tab, IME+Enter
  tardío, repetición del mismo SKU, sin foco, escritura manual, campo de cliente,
  bloqueo modal, ausencia de doble procesamiento y errores del navegador.
- Fixture sin APIs, sin persistencia y sin crear ventas/pagos/cierres.
- `git diff --check`: aprobado.
- `npm run lint`: bloqueado por configuración ESLint 9 ausente (preexistente).

## Pendiente antes de certificar hardware

Generar e instalar el APK solo cuando se solicite. Probar el lector real en modo
supermercado/restaurante: al abrir ventas sin tocar lupa, después de agregar
artículos, repetir mismo SKU, variantes, código desconocido, Enter/Tab/sin sufijo
según dispositivo, y escanear durante cobro o edición sin alterar el ticket.
