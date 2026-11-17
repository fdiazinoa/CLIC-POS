# Corrección compacta de móvil/PDA

Base: `origin/develop` (`bad9005e`, APK candidato 1.1.648). Alcance limitado al perfil físico HANDHELD en Supermercado y Restaurante, mediante `isCompactHandheld`.

## Corrección

- Un único Ajustes, con la tarifa activa junto a él en la cabecera compartida. Se conserva `canChangeTariff` y el handler `changeActiveTariff`.
- El Ajustes del catálogo y la barra antigua del ticket ya no se renderizan en HANDHELD. La ocultación previa dependía de `:has()`, incompatible con el WebView 101 observado en el emulador.
- Categorías e iconos más compactos; catálogo con tarjetas de 120 px, ajustables a nombres largos.
- Acciones secundarias reunidas una vez en Opciones, reutilizando sus handlers. El pie del ticket contiene total y acción primaria. Borrar artículos nuevos y vaciar el ticket conservan sus operaciones distintas, con etiquetas explícitas dentro de Opciones.
- Estado fiscal resumido con detalle desplegable nativo y agotamiento explícito. La representación existente del estado se conserva en los demás perfiles.
- No hay cambios en tipos/configuración persistida, precios, impuestos, permisos, servicios ni versión Android. Los nuevos parámetros de presentación de componentes compartidos tienen valor predeterminado desactivado.

## Verificación

Pruebas dirigidas: 26/26 aprobadas (chrome compacto, límite de perfiles, perfiles ERP, acciones móviles, categorías de dos filas, grid 2×4 y permisos de edición). Build TypeScript/Vite aprobado. Lint sin errores; 43 advertencias en archivos ajenos al cambio.

Smoke de los componentes reales con fixture temporal y dependencias de datos simuladas, sin conexiones a APIs o dominios externos:

- Supermercado y Restaurante a 360×640: un Ajustes, una tarifa, ningún Ajustes/tarifa antiguo en el catálogo, sin desbordamiento horizontal.
- Cabecera de 121 px y banda de categorías de 41 px; tarjetas de 120 px. Pie de ticket de 73 px, con un único botón de cobro y sin barra de utilidades repetida.
- Sin barra antigua de tabs del ticket en el DOM compacto. Acciones secundarias sin IDs duplicados; Ajustes permanece únicamente en la cabecera.
- Vista de productos a DPR 3 (1080×1920): un único Ajustes.
- Tarifa deshabilitada para un rol sin `POS_CHANGE_TARIFF`. Cero escrituras mediante `onUpdateConfig` durante el smoke.
- Sin errores de ejecución del navegador.

Comparación de capturas PNG del código anterior y de la corrección, con iguales datos simulados y viewport. Los cinco resultados fueron idénticos byte a byte:

| Perfil | Modo | Viewport | SHA256 de ambas capturas |
|---|---|---|---|
| POS normal | Supermercado | 1280×800 | `79f3a243a73b85da5d1f92743bef20d85ca2f84974c03e958aef2bd36b860f76` |
| POS normal | Restaurante | 1280×800 | `d4c48a3a1efc128d8bf6938949d954b162c66bc96b227099b9a13cf296af7fe3` |
| Tablet | Restaurante | 800×1100 | `3c617b2031e607b4e9462209327c37b2e0738d510012dcf3fda955c584b77c15` |
| Tablet | Supermercado | 390×844 | `02f86b5ce06d683398e247301cd96b55e6f7a9d007b9518e6e96ff24772787de` |
| Perfil físico kiosco, rol POS estándar | Supermercado | 800×1100 | `230e150e71387774f9914fcc61627f113f2ba8c7d693d4ec32efaae11be9dda9` |

También se comprobó que las reglas CSS de ajustes compactos previas se conservan sin cambios. La fixture temporal se retiró después del smoke.

Consulta ADB de sólo lectura: emulador `127.0.0.1:6555`, resolución física 1080×1920, densidad 480 dpi y WebView 101.0.4951.61. La corrección se inspeccionó en Chromium con viewport equivalente; no se instaló en el emulador. El QA nativo, la generación de un nuevo APK y cualquier promoción siguen pendientes.
