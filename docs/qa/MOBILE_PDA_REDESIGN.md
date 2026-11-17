# Rediseño de ventas para móvil/PDA

Base: `origin/develop` (`2f8ffdf5`). Rama: `codex/mobile-pda-redesign`.

## Alcance

- Presentación compacta sólo para el perfil físico `HANDHELD` en Supermercado o Restaurante; kiosco queda excluido.
- Cabecera compartida, navegación Productos/Pedido–Ticket/Cuenta, catálogo en dos columnas, nombres completos y resumen del total en el flujo normal del layout.
- Ticket móvil reutilizado en ambos modos: cantidades, edición, descuentos y cobro conservan sus handlers y permisos existentes.
- Preferencias compactas para el dispositivo físico móvil/PDA, con formato y modo de operación priorizados. Campos, herencia y guardado existentes.
- POS normal y tablet mantienen su selección de layout y sus estilos. No se modifican servicios, dependencias, datos persistidos ni versión Android.

## Validación local

- `npm run lint`: termina con código 0, 0 errores; 43 advertencias de mantenimiento en archivos ajenos a este cambio.
- `npm run build`: TypeScript y Vite correctos. Advertencia por chunks mayores de 700 kB.
- `npx tsx --test tests/handheldPresentation.test.ts tests/deviceProfile.test.ts tests/catalogViewportWindow.test.ts tests/mobileSidebarActionsContract.test.ts tests/cartItemEditPermissions.test.ts tests/quantityPresentation.test.ts`: 20/20 pruebas aprobadas.
- `git diff --check`: sin errores.

Smoke con Chromium headless sobre los componentes reales `POSInterface` y `TerminalSettings`, mediante fixture temporal con dependencias de datos simuladas. Se bloquearon llamadas de red a APIs y dominios externos. Sin errores de ejecución en los escenarios siguientes:

| Escenario | Resultado |
| --- | --- |
| Supermercado HANDHELD, 390×844 y 320×740 | Cabecera y catálogo compactos; sin desbordamiento horizontal |
| Restaurante HANDHELD, 390×844 y 844×390 | Navegación Pedido/Cuenta/Mesas; catálogo y total visibles; sin desbordamiento horizontal |
| Filtro Bebidas | 4 productos coincidentes del catálogo de prueba |
| Agregar producto y abrir ticket | Cantidad 1; total RD$100.00 |
| Aumentar cantidad desde el ticket | Cantidad 2; total RD$200.00, mediante el handler existente |
| Abrir acciones rápidas | Panel accesible desde la cabecera |
| POS normal, 1280×800 | Rediseño compacto desactivado |
| Tablet restaurante, 800×1100; tablet supermercado, 390×844 | Rediseño compacto desactivado, incluso en viewport estrecho |
| Ajustes HANDHELD | Cuatro formatos disponibles y selección actual conservada |
| Ajustes gobernados por maestra | Controles de formato permanecen deshabilitados |
| Nombre de producto de 114 caracteres | Texto completo; altura virtual ajustada; sin recorte ni desbordamiento |

La fixture temporal se retiró después del smoke. Las comprobaciones de perfiles no equivalen a una comparación de píxeles con el APK instalado. No se probó un flujo fiscal real ni se generó/instaló APK; no se desplegaron servicios ni se tocaron clientes reales.
