# Pantalla de recuperación y cierre recibido

## Uso

Con `pending_operations_recovery` habilitado en un entorno de pruebas, Ajustes → Sincronización → Recuperar movimientos permite descargar, reanudar y restaurar. El progreso se relee de almacenamiento tras remontar la pantalla. Actualizar POS carga los movimientos restaurados.

El cierre Z habitual detecta una jornada recuperada antes del bloque operacional legacy y abre **Cerrar movimientos recuperados**. Se conserva la declaración del usuario. **Revisar jornada con ERP** crea una preparación durable y solicita la observación; **Confirmar o consultar cierre** usa esa misma intención. No avanza la serie ni aplica efectos por una observación o capability.

**Consultar cierre pendiente**, en el panel de recuperación, descubre revisiones persistidas después de reiniciar. Tras ACK confirmado y fallo SQLite muestra **Terminar guardado**. Tras publicación exitosa **Actualizar POS** recarga la base; no reejecuta el cierre legacy ni su reset global. La impresión sigue disponible en el historial habitual con la configuración actual; este flujo no añade impresión automática.

Una revisión que aún no obtuvo candidato puede descartarse: elimina únicamente su registro UI, conserva originales y preparación, y no envía cancelaciones. Un candidato observado o un ACK nunca se descarta mediante ese botón. Si las fuentes cambiaron después de observar, la intención se bloquea y permanece conservada; la resolución de ese conflicto no está implementada.

## Disponibilidad y alcance

ERP requerido: **651a4864a5df377c0ebe404108cd91ae77d328fd**, PR CLIC-ERP #2020, sobre clean-erp. POS base origin/develop **ec99fc0** (incluye #573).

GET `/api/sync/originals/capabilities` debe anunciar `receivedClose` version 1, enabled true, profile `erp.received-ticket-dop-cash.v1`, scope autenticado completo, RECEIVED_ONLY, exactZEligible false y NOT_GRANTED. El alcance no se obtiene de defaults locales. Un contrato faltante, incompatible o sin conexión no habilita la acción. El flag sigue apagado por defecto; el router normal ERP sin productor nativo anuncia disabled. No se habilitó producción.

El perfil de aceptación sigue siendo el de laboratorio: tickets CASH DOP, tasa 1, sin cambio/impuestos/descuentos/crédito y renglones consistentes. La pantalla no amplía ese perfil. Cash/collections/wallet pendientes, mezcla local/recuperada o múltiples snapshots bloquean la jornada completa. La selección solicitada debe contener todos los IDs activos; no se filtran operaciones para obtener aceptación.

Se utiliza la serie interna persistida asignada al Z, sin fallback de número. Los IDs de cierre y el cuerpo de la solicitud quedan congelados; ApiSyncAdapter envía los bytes exactos sin enriquecimiento comercial ni reautenticación/reintento automático. Sólo el 404 con `CLOSE_RESULT_NOT_FOUND` en la consulta significa resultado ausente; no autoriza publicación.

## Evidencia reproducible

```sh
CLIC_ERP_REVIEW_PATH=/Users/felixdiaz/.gemini/antigravity/playground/tensor-planetoid/CLIC-ERP-recovery-contract CLIC_EMBEDDED_POSTGRES_MODULE=/tmp/clic-original-pg-tests/node_modules/embedded-postgres/dist/index.js node --import tsx --test tests/recovery*.test.ts tests/closePreparation.test.ts tests/nativeZ*.test.ts
npm run build
npm run dev -- --host 127.0.0.1 --port 5183
```

- La prueba `recoveryReceivedCloseRoundTrip.test.ts` ahora usa el controlador de pantalla, el método ApiSyncAdapter y el GET capability real contra router HTTP/PG. Conserva pérdida real de SQLite temporal, NEVER_SENT ausente, ACK perdido, seis ACK alterados, fallo de publicación, reinicio y resultado único de 150 DOP. Añade bloqueo de selección parcial, segundo comando, capability deshabilitada y descarte de candidato observado.
- La adquisición de credenciales y el mecanismo fetch/retry se inyectan en laboratorio; ERP usa sus helpers reales de autorización sobre una terminal fixture persistida. No demuestra pairing remoto ni transporte Capacitor en un Android físico.
- Fixture visual `/tests/fixtures/recovery-close-screen.html`: revisar 2 movimientos/150 DOP → confirmar (fallo simulado) → mensaje de ACK pendiente de guardado → terminar → éxito. Ejecutada mediante navegador; este fixture usa controlador doble, sin efectos ni red ERP. La durabilidad se acredita por la prueba anterior, no por la imagen.
- 24 pruebas PASS, cero skips, build PASS. Lint mantiene el impedimento previo de ESLint 9 sin eslint.config.*. Sin cambios de cálculo, migraciones remotas, APK, producción ni merge propio.

Para habilitar a clientes todavía hace falta validar la configuración/canales reales y montar el productor autorizado en el entorno correspondiente. Esta entrega conecta la UI al circuito verificado; no transforma fixtures mínimos en soporte universal ni recupera operaciones que nunca se enviaron.
