# Identidad persistente fuera de SQLite

Base origin/develop 6251e9c. Cambios mínimos en fix/master-device-identity-recovery.

## Evidencia

La master mostró sucesivamente identidades divergentes; no existe todavía auditoría suficiente para atribuir cada cambio físico a una operación concreta. No se borraron datos ni se transfirieron bindings desde este hilo. La solicitud administrativa de CAJA-2 para DEV-KMMSTBHZ se observó APPROVED/binding_authorized=true; se tocó únicamente Actualizar estado con esa aprobación ya existente. La app avanzó a restauración y login, cuyo pie muestra POS-001: su rol/terminal operativos deben revisarse por separado antes de certificar recuperación de CAJA-2.

## Defectos demostrables en source

- ApiSyncAdapter.resolveCurrentDeviceId evaluaba resolveOrCreateLocalDeviceId como argumento de pickFirstString aunque ya hubiese credenciales. JavaScript evalúa todos los argumentos: una lectura de red podía generar y persistir identidad antes de recuperar Preferences.
- ConsignmentSyncService tenía un generador independiente que escribía otra identidad al faltar caché.
- Un fallo al leer Preferences se interpretaba como almacenamiento vacío y podía generar identidad nueva.
- Dos inicializaciones concurrentes sin identidad podían generar IDs distintos.
- Settings ofrecía resetear la identidad del mismo dispositivo y borrar configuración. No se demuestra que el usuario utilizara ese botón, pero se elimina por la regla solicitada: limpiar BD no debe cambiar equipo.

## Corrección

Preferences Android con clave clic_pos_persistent_device_id sigue siendo la fuente persistente fuera de SQLite. Lectores de red no generan ni escriben identidades. El accessor síncrono no crea fallback. Inicialización asíncrona única, lectura nativa antes de caché y publicación local solo después de confirmar escritura persistente. Fallo de lectura/escritura bloquea la recuperación, nunca genera/publica un reemplazo como solución. La eliminación de BD no llama Preferences.clear.

No se obtiene el ID autorizado desde ERP para adoptarlo como identidad física ni se cambia ningún binding. Preferences conserva identidad entre borrado SQLite y adb install -r; desinstalación o borrado de datos Android puede eliminar Preferences y no se afirma resistencia frente a esas acciones. El cambio real de equipo requiere identidad propia y autorización administrativa.

## QA

Prueba con adaptador de almacenamiento equivalente al usado en producción: caché vacía con identidad nativa, lectura síncrona antes del bootstrap, fallo de lectura, 12 inicializadores concurrentes y segunda limpieza de caché conservando el ID. Contratos de red impiden generación y Settings no expone reset.

QA físico pendiente del nuevo APK expresamente solicitado: registrar identidad/config/binding sin secretos, actualizar con replace, reiniciar y verificar mismo ID. No borrar BD en estos equipos: cubrir limpieza SQLite en entorno aislado autorizado con respaldo. Aún pendiente auditoría ERP de cambios históricos y revisión de rol/terminal de CAJA-2. No declarar recuperación operacional ni promoción a partir de login solamente.
