# Kiosco y catálogo V3

El kiosco recibía `App.products`, intencionadamente vacío en builds V3. POS y Ajustes ya tenían lectores nativos independientes. Se incorpora una frontera de lectura y venta V3 para kiosco, conservando la ruta legacy cuando el flag está apagado.

Las páginas nativas enumeran hasta 30 IDs; cada artículo se vuelve a resolver mediante SaleCatalog/OperationalCatalog, incluidos precio, impuestos y restricciones avanzadas. El filtro de categoría operacional se aplica antes del límite SQL; no cambia consultas administrativas que no lo solicitan. Se conserva el cursor incluso si todos los candidatos de una página resultan incompatibles. Categorías, búsqueda y páginas posteriores no dependen de hidratar productos legacy.

El contexto retiene terminal/dispositivo/tenant/empresa, tarifa y almacén autorizados, sesión y proyección de configuración sin guardar esa proyección globalmente. Las consultas y validaciones rechazan contexto/identidad/baseline revocados. Los efectos de React descartan resultados tardíos, reinician navegación al cambiar contexto y escuchan inventario/catálogo.

El pago V3 usa exclusivamente efectivo sin cupón/descuento, validación previa y el commit financiero atómico existente. Tarjeta, wallet y cupón muestran HOLD antes de proveedor o mutaciones. El intento comparte pulsaciones simultáneas, retiene el borrador ante error de commit y devuelve la identidad confirmada; no se promete recuperar una intención no persistida tras cerrar el proceso. Las recetas/modificadores incompatibles siguen excluidos y se muestran sus motivos. La ausencia de ruta de producción conserva el bloqueo previo al cobro.

Pruebas sintéticas: SQLite real, categorías por ID y etiqueta, más de 30 artículos, páginas incompatibles, cambios de identidad/contexto/inventario, errores SQL, callback de App y doble pulsación/reintento. No se consultaron ni modificaron artículos reales de Caja 4. La validación física Android y los gates independientes corresponden al candidato exacto; este documento no aprueba release ni un APK nuevo.
