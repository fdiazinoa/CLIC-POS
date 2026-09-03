# Limpieza del campo tras escaneo

## Causa y alcance

El listener global de PR #503 emitía el código pero dejaba la limpieza del
buscador al consumidor. En POS, el código desconocido no limpiaba searchTerm:
el siguiente bloque IME se concatenaba y no era reconocido como nueva lectura.
La prueba anterior limpiaba desde el callback y ocultaba esta condición.

La captura ahora consume el input marcado antes de enrutar: vacía el valor
nativo con su setter y notifica input a React para mantener su estado controlado
sin texto residual. Esa notificación no reingresa al buffer. Se conserva el
control del sufijo tardío y cada lectura repetida es una operación diferente.
POS también limpia al comenzar el procesamiento y muestra Código no encontrado
si ninguna ruta reconoce la lectura. No modifica lookup, cantidades ni stock.

No se borran búsquedas manuales lentas ni campos de otros formularios. Los
modales siguen bloqueando la captura. No se amplían heurísticas de velocidad
ni se inventa integración por intent para lectores propietarios.

## Pruebas

- 23 casos de globalBarcodeCapture, incluyendo códigos desconocidos seguidos,
  limpieza con Enter/Tab/reposo y conservación de búsqueda manual.
- Fixture React sin limpieza dentro de onScan: seis lecturas consecutivas,
  IME y HID, mismo código repetido, sufijo tardío, valor DOM y estado React
  vacíos después de cada lectura; sin APIs ni datos de negocio.
- Matriz ampliada: 247 pruebas aprobadas (incluye los fixes #502, #503 y #504).
- npm ci y npm run build aprobados. git diff --check aprobado.
- Lint bloqueado por ausencia preexistente de eslint.config.* para ESLint 9.

## QA física pendiente

Con el APK instalado, comprobar en supermercado y restaurante con el lector
real: código válido, desconocido, dos diferentes consecutivos, mismo código
dos veces, variante, y escaneo durante un modal sin cambiar el ticket. Confirmar
que no hace falta limpiar ni tocar la lupa entre lecturas. Este hotfix no
certifica dispositivos físicos no conectados. No se crean ventas/cierres en QA.
