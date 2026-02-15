# Handoff AG: Bug Catalogo T1 (muestra 2 categorias/productos incorrectos)

## Contexto del problema
- Terminal afectada: `t1` (Master).
- Síntoma:
  - En `Terminal Settings -> Catalogo`, `t1` tiene todas las categorias seleccionadas.
  - En POS de `t1`, solo aparecen chips de categoria `Electrodomesticos` y `Snacks`.
  - Solo se ven 2 productos (`iPhone 17 Pro Max`, `Nutella chocolate edit`) que no corresponden al catalogo esperado.
- Referencia de control:
  - `t4` sí muestra el catalogo esperado (y ya recibe imágenes correctamente).

## Reproducción mínima
1. Abrir `t1`.
2. Ir a POS: observar que solo aparecen 2 categorias/chips.
3. Ir a `Terminal Settings -> Catalogo`: confirmar categorias marcadas ampliamente (todas).
4. Volver a POS: el filtro sigue mostrando solo 2.

## Hechos verificados
- En `server/db.sqlite`, tabla `products` hay catalogo amplio (`119` productos), no solo 2.
- En `settings.key='config'`, `t1.config.catalog.allowedCategories` incluye múltiples categorias.
- Por lo tanto, el desajuste no parece venir de la configuracion central, sino de estado local/sync/runtime en `t1`.

## Hipótesis técnicas a validar por AG
1. **Drift de cursor/version en delta sync**:
   - `t1` podría tener `sync_version_products` inconsistente respecto al servidor.
   - El endpoint delta puede devolver vacío aunque local esté incompleto (catalogo parcial viejo).
2. **Hidratación de estado en memoria desfasada**:
   - `App` puede renderizar `products` stale aun cuando IndexedDB ya cambió.
3. **Identidad/rol terminal en runtime**:
   - En incidentes previos se observó apertura con identidad incorrecta (`t1`/master desde otra terminal).
   - Revisar `currentDeviceId -> terminalId` al iniciar sesión y en POS.
4. **Datos locales históricos mezclados**:
   - IndexedDB de `t1` puede conservar snapshot antiguo (incluyendo iPhone/Nutella) y no recibir full refresh.

## Checklist de diagnóstico (obligatorio)
1. En `t1`, inspeccionar en DevTools:
   - `localStorage`: `sync_version_products`, `CLIC_POS_MASTER_URL`, `pos_device_id`, `pos_master_ip`.
   - IndexedDB colección `products` (count y muestra real).
2. Comparar con backend:
   - `GET /api/sync/collections/products/metadata` (version/itemCount).
   - `GET /api/sync/delta/products?sinceVersion=<local>` (items/isFullDownload/latestVersion).
3. Confirmar mapping en runtime:
   - terminal detectada por `currentDeviceId`.
   - `activeTerminalId` enviado a `POSInterface`.
4. Verificar fuente de config que consume sync:
   - `GET /api/sync/config` debe devolver el `settings.key='config'` correcto.
5. Si hay drift:
   - Forzar pull completo de `products` y luego validar que chips/categories reflejen catálogo real.

## Criterio de aceptación
- En `t1`, con todas las categorias seleccionadas, POS debe mostrar todas las categorias presentes en el catalogo real.
- No deben aparecer productos residuales que no existan en el catalogo operativo esperado para la sucursal.
- Debe mantenerse la sincronización de imágenes ya funcional en `t4`.

## Nota
- Este commit es solo de handoff/diagnóstico para AG (sin cambios funcionales adicionales).
