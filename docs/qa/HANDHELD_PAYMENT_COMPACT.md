# Cobro compacto móvil/PDA: Finalizar siempre accesible

Base: `origin/develop` (`402c98c6`, candidato 1.1.649).

## Cambio

El modal de cobro recibía una altura `100dvh` sin alternativa compatible con el WebView 101 observado y agrupaba resumen/finalización antes del panel de captura. Con métodos, importes y teclado, el contenido podía quedar recortado.

Sólo `isCompactHandheld` activa la nueva presentación: resumen acotado, panel de captura desplazable y fila de finalización independiente en un grid de altura limitada al viewport. El botón de 44 px permanece fuera del teclado y su scroll. Se compactan tipografía, iconos, métodos, denominaciones y teclado. Los avisos de error y resultados de tarjeta conservan su contenido y controles; su cuerpo puede desplazarse sin expulsar la acción primaria.

- No se cambian las reglas, la configuración ni los permisos de pago.
- El parámetro nuevo `compactHandheld` es opcional y está desactivado por defecto.
- Los cuerpos de `handleNumPad`, `handleAddPayment`, `handleRemovePayment` y `handleFinalize` son idénticos a la base, comprobados mediante AST.
- No hay cambios en la pantalla de éxito, servicios, dependencias ni versión Android.

## Pruebas

46 pruebas dirigidas aprobadas: layout, límite de perfiles, teclados Android, regresión fiscal, etiquetas de operación, cierre de modal, recibos y métodos ERP. Se completó el mock de una prueba de cierre que ya fallaba en la base por no proporcionar dos refs y el setter de recibo existentes; se añadieron las aserciones de reinicio de esas refs sin cambiar el handler real.

Build TypeScript/Vite aprobado. Lint: cero errores y 43 advertencias en archivos ajenos al cambio.

Smoke en Chromium con `PaymentModal` real y dependencias simuladas, con APIs y dominios externos bloqueados:

| Caso móvil/PDA | Resultado |
|---|---|
| 360×640, 360×600, 320×568, 640×360 y 320×480 | Acción primaria completa y alcanzable, altura 44 px, sin overflow horizontal |
| 360×600 con 12 métodos, propinas y aviso de cambio de total | Acción primaria visible; contenido secundario desplazable |
| Pago parcial e importe digitado borrado | Finalizar permanece deshabilitado |
| Dos pagos simulados de RD$500 para RD$1,000 | Finalizar habilitado, sin ejecutar confirmación automáticamente |
| Confirmación simulada que devuelve error | Error visible y Finalizar sigue accesible; no hubo venta ni cobro real |

Comparaciones PNG del modal antes/después, con datos y viewport idénticos: iguales byte a byte.

| Perfil | Viewport | SHA256 de ambas capturas |
|---|---|---|
| POS normal | 1280×800 | `f5ef0d9f9d62d14ce19765d6aed51fd9b1bc01017039948cb8f49224d46edc4f` |
| Tablet | 800×1100 | `a3cb89900e9e8811b240df8b5c6ec7752dedf7e0fa974a3b046b2cd36645f82b` |
| Tablet | 390×844 | `7c1477b4a792597f51489cf856f85c108baf3a96e923f89489f014301e6b2204` |
| Perfil físico kiosco | 800×1100 | `a3cb89900e9e8811b240df8b5c6ec7752dedf7e0fa974a3b046b2cd36645f82b` |

Sin errores de ejecución del navegador. La fixture temporal se retiró después del smoke. No se generó ni instaló un APK; queda pendiente probar el modal nuevo en WebView Android y los flujos nativos de pasarela/impresión.
