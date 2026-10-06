# Opciones POS por terminal desde ERP

Implementación basada en `origin/develop` 004bd38 y contrato de
`fdiazinoa/CLIC-ERP`, rama `feature/terminales-paridad-pos`:
`src/utils/terminalPosOptions.js` y `docs/terminales-paridad-pos-prompt.md`.
No agrega transporte, endpoint, tabla ni migración. No modifica ERP ni APK.

## Recorrido y persistencia

Pairing/bootstrap (`services/setup/erpTerminalSetup.ts` y setupRoutes), refresco
(`SyncManager.refreshTerminalResolvedConfig` y terminalConfigRoutes) y push
CONFIG_PUSH_V2 (`utils/erpSyncLifecycle.ts`) llegan a
`applyTerminalConfigSnapshot`. La capa común recibe opciones desde config,
resolved, resolved.terminal.config y envelopes business_config/businessConfig.
El bootstrap conserva además UX, security y agenda enviados en la raíz.

`terminalPosOptions.ts` valida únicamente preferencias explícitas, combina los
objetos de reservas/delivery/órdenes y conserva valores locales omitidos.
Booleanos canónicos false prevalecen sobre aliases true. Admite booleanos y las
representaciones legacy true/false/1/0; tipos desconocidos y rangos inválidos se
ignoran. Los valores por defecto se usan al crear una terminal. El ERP solo
controla enabled del número de orden: nextNumber/prefix/padding siguen locales.
La terminal destino recibe preferencias; las demás conservan su configuración.

CONFIG_PUSH_V2 mantiene fencing de identidad y versión/hash, rollback y ACK
posterior a persistencia. La verificación por lectura ahora incluye operational,
security, UX y agenda: si el adaptador pierde preferencias, tampoco se envía
APPLIED. El estado React se actualiza por el evento existente configUpdated.

## Consumidores

- POSInterface: UX de tarjetas/imágenes, RETAIL/supermercado y catálogo ampliado
  mediante expandTicket; reservas, orden local y consignaciones.
- POSInterface: delivery exige isDeliveryTerminal y autoOpenUberEatsModal para
  abrir automáticamente; isDeliveryTerminal=false apaga esa opción. Toast es
  independiente. No se crea integración de marketplaces.
- TableMap desde App: bloqueo_meseros.
- TicketHistory y PermissionService: showGlobalSales false limita a alias local/
  ERP de la terminal incluso si es maestra. El detalle usa la lista filtrada y
  una devolución ERP de otra terminal también queda bloqueada.
- useSupervisorAuth: políticas de PIN para anulación/descuento fuerzan el modal
  existente aun con permiso del usuario. False conserva controles RBAC y límites
  de descuento. Reembolsos con política activa solicitan autorización existente;
  permisos de devolución siguen siendo necesarios.
- LoginScreen/ModernLoginScreen: allowBiometrics sigue condicionado al hardware.
- App: startWithAgenda se consulta en bootstrap; cambios en caliente no navegan
  fuera de una venta. **Requiere próximo arranque**. Las demás preferencias se
  reflejan cuando llega configUpdated; el coordinador puede aplazarlas durante
  una ventana crítica de venta/cobro/impresión.

showProductImages solo controla presentación de imágenes disponibles. No cambia
catalog.sendItemImages ni inicia descargas masivas.

## Validación automatizada

Tests de preferencias/snapshot, CONFIG_PUSH_V2 y política de autorización cubren
false, ausencia, valores inválidos, envelopes mixtos, mezcla parcial, contador,
terminal B, serialización/reload offline, defaults nuevos, persistencia fallida
y silenciosa, identidad incorrecta e idempotencia. Suites existentes verifican
restauración operativa, binding, pairing order taker y eventos de arranque.

Build: `npm run build`. Lint: `npm run lint` (advertencias existentes registradas
en el PR). Las pruebas con almacenamiento en memoria y serialización **no**
certifican SQLite físico, persistencia después de muerte de proceso ni transporte
ERP desplegado. No se ejecutó smoke integrado con dos dispositivos ni APK.

## Smoke pendiente con dos terminales

1. Vincular A y B al mismo tenant y guardar configuración/consecutivo de ambas.
2. Desde ERP seleccionar A: cambiar imágenes, RETAIL, ticket ampliado, bloqueo,
   ventas globales, consignaciones y enabled de órdenes; guardar/enviar.
3. Verificar persistencia y UI en A, ACK/versiones y ausencia de cambios en B.
   Emitir dos órdenes: consecutivo continúa, incluyendo prefijo y padding locales.
4. Enviar solo printCopies; comprobar que vigencia/anticipo/porcentaje se conservan.
   Apagar requireAdvance: el porcentaje no cambia. Validar anticipo al activarlo.
5. Activar delivery/modal; generar una alerta y verificar toast/modal. Desmarcar
   delivery: no debe abrir modal, aunque otro campo local lo hubiera habilitado.
6. Activar PIN de anulación/descuento; con cajero y supervisor probar permisos y
   límites. Desactivar PIN no concede permisos. Probar devolución autorizada y
   biometría solo en equipo compatible. Limpiar borrador también exige PIN activo.
7. Enviar agenda durante venta: no navegar. Reiniciar A offline y verificar agenda,
   preferencias y contador. Reiniciar B: conserva valores anteriores.
8. Repetir push con misma versión/hash: sin reaplicar ni descargar. Simular fallo
   de almacenamiento: FAILED, sin avance de versiones; reintentar tras recuperarlo.

La integración ERP/POS queda pendiente de este smoke y verificación física.
