# Arranque y navegación de mesas en tablet

Fecha: 2026-09-03. Base: `origin/develop` / `3d469d0`.

## Evidencia del problema

El emulador Android conectado ejecuta `com.clicpos.app` 1.1.244 (1244).
Se inspeccionaron sus logs ya existentes y Resource Timing sin reiniciar,
reinstalar, vender, cerrar caja ni cambiar configuración.

- Base local lista: 12:53:44.036 UTC.
- `isDataLoaded = true`: 12:53:50.035 UTC, 5.999 segundos después.
- Inicializaciones completas de SyncManager: 12:53:45.587, 47.618, 48.031,
  49.644 y 50.359 UTC. Cuatro durante el bloqueo inicial y otra inmediatamente
  después. Los eventos `configUpdated` podían volver a inicializar los servicios
  mientras el bootstrap seguía en curso.
- La consulta inicial `refreshTerminalResolvedConfig` no recibía plazo máximo.
  Incluso con un plazo, el temporizador se limpiaba al recibir headers, antes
  de leer el JSON: una respuesta incompleta podía prolongar la espera.
- El perfil tablet usa 900 px para `isMobile`, pero los contenedores del ticket,
  encabezados y botón flotante usaban CSS `md` (768 px). La botonera de
  restaurante desaparecía en móvil y el catálogo no ofrecía acceso directo a
  mesas u opciones; había que descubrir esas acciones dentro del carrito.

El diff entre los commits de release 1.1.243 (`da1bcfd`) y 1.1.244 (`2acd2e6`)
no cambia App.tsx ni el arranque de sincronización. Se confirma el comportamiento
en 1.1.244, pero no se atribuye su introducción exclusivamente a esa versión.
La tablet Samsung de las fotografías no está conectada para mediciones físicas.

## Corrección

- Los eventos de configuración actualizan el estado durante el arranque sin
  reiniciar los servicios que el bootstrap ya está inicializando.
- La descarga inicial de configuración tiene un presupuesto de 8 s. Los
  suplementos de clientes/proveedores se descargan en segundo plano. El plazo
  cubre headers y lectura del body, y cancela la petición; las demás consultas
  de configuración sin presupuesto explícito tienen un máximo de 15 s por intento.
- Se conservan las comprobaciones de licencia, autorización y usuarios. No se
  declara listo el POS antes de su bootstrap de seguridad. Los 8 s son el límite
  de esta descarga, no una promesa sobre la duración total del arranque.
- Se registran tiempos por etapa `[POS_BOOT]`, sin headers ni credenciales.
- El catálogo móvil muestra Mesas (cuando la terminal usa mesas) y Opciones,
  aunque el ticket esté vacío. Mesas usa el mismo flujo de salida del mapa que
  escritorio, conservando las protecciones de la comanda activa.
- La visibilidad de catálogo/ticket, encabezados, pie y carrito flotante usa
  `isMobile` de forma consistente. La primera renderización respeta el ancho.

## Validación

50 pruebas pasaron:

```sh
npx tsx --test tests/tabletNavigation.test.tsx \
  tests/startupConfigEvents.test.ts tests/startupConfigTimeout.test.ts \
  tests/mobileSidebarActionsContract.test.ts tests/posProductGridTwoByFour.test.ts \
  tests/posCategoryTwoRowLayout.test.ts tests/posTableHeader.test.ts \
  tests/terminalConfigRequestCoordinator.test.ts tests/terminalUpgradePersistence.test.ts \
  tests/licenseGuard.test.ts
```

`npm run build` pasó (TypeScript + Vite). Vite mantiene su advertencia de bundles
mayores de 700 kB. `git diff --check` pasó.

`npm run lint` no puede ejecutarse: el repositorio no contiene
`eslint.config.js/mjs/cjs`, requerido por ESLint 9. No se cambió esa configuración.

Prueba visual y funcional con los componentes reales POSInterface y TableMap,
datos ficticios y red deshabilitada en un harness local:

- 800×1280: catálogo → Mesas → Mesa 1 → Opciones; encabezado `QA · M01`.
- 600×960: catálogo → Mesas → Mesa 12 → Opciones; encabezado `QA · M12`.
- Controles Salas, Control, Unir, Subtotal, Mover, Fraccionar, Dividir y Editar
  visibles en el mapa vertical. Coordenadas verificadas dentro del viewport.
- Giro a 1280×800: vuelve la botonera de escritorio y conserva `QA · M12`.
- Sin desbordamiento horizontal en los tamaños de 600 y 1280 px comprobados.
- No se pulsaron acciones de venta, pago, cierre, envío ni impresión.

## Validación pendiente en APK

No se generó ni instaló otro APK en esta tarea. Antes de desplegar, generar un
release según el protocolo oficial y medir `[POS_BOOT]` en la tablet afectada,
conservar identidad/SQLite y probar su modo Cliente→Maestra real. No se afirma
una mejora temporal medida en un APK nuevo: por ahora se verificó la eliminación
de reinicializaciones durante bootstrap en pruebas aisladas y el comportamiento
responsive en navegador.
