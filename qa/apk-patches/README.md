# Parches para el código fuente de APK conservado

`main` contiene el fix de arranque del PR #888. El APK 1.1.517 utiliza además módulos V3 que todavía no existen en `main`. Para preservar todos sus fixes sin reemplazarlo por el frontend legado de main, el candidato firmado parte del commit fuente del APK anterior.

`pos-catalog-without-balances.patch` registra en main el cambio solicitado: mostrar artículos con saldo ausente como disponibilidad cero y dejar la autorización de venta a las reglas de stock negativo del producto o de la terminal. Incluye la prueba con la sesión operativa real: saldo cero bloquea venta sin permiso; el permiso de producto o terminal permite validación; una bandera manipulada en el carrito no otorga permiso.

El parche se valida y compila sobre la fuente conservada de APK, nunca sobre una copia sin commits. El commit fuente final y la equivalencia con este parche se registran en el reporte firmado. No se fusiona develop en main ni se restablece SQLite para aplicar este cambio.
