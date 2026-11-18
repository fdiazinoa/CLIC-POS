# Informes POS en ticket térmico

Acceso: **Ajustes → Informes POS**, junto a **Sistema y Auditoría**. Requiere
`REPORTS_VIEW_SALES`; el historial y la reimpresión Z requieren además
`POS_CLOSE_Z`. Consultar e imprimir no ejecuta cierres ni modifica documentos.

## Informes y criterios

- **Resumen de ventas**: mismas reglas de ventas/devoluciones que las estadísticas
  del cierre Z. Una venta marcada como devuelta sigue contando como venta; su
  documento REFUND/B04 descuenta la devolución. Los descuentos globales son
  informativos y ya están aplicados al total. Los impuestos son los registrados;
  se advierte cuando falta el desglose, sin estimar valores históricos.
- **Formas de pago**: nombres y montos aplicados del cierre Z, excluyendo cambio,
  con créditos pendientes incluidos. Agrupación por moneda del pago e importe
  aplicado expresado en moneda base del documento. No se convierten importes con
  tasas actuales ni se suman monedas diferentes.
- **Productos vendidos**: cantidad neta de devoluciones e importe al precio de
  línea. No prorratea descuento global. Presentaciones diferentes se separan.
  Orden descendente por cantidad; top 10, top 20 o todos.
- **Ventas por cajero**: tickets, ventas, devoluciones, venta neta y ticket
  promedio por usuario y moneda. Atribuye cada documento a quien lo registró;
  el promedio usa ventas antes de devoluciones, igual que el cierre.
- **Ventas por hora**: horas locales ordenadas de 00 a 23, acumuladas durante
  el período, con tickets, ventas, devoluciones y venta neta por moneda.
- **Descuentos y devoluciones**: descuentos globales y de líneas en ventas,
  excluyendo cambios manuales de precio; detalle del ticket, usuario y autorizador
  cuando existe. Las notas de crédito muestran importe, origen y motivo guardado.
  No deduce otra vez descuentos ya aplicados ni interpreta el estado de una venta
  como una segunda devolución.
- **Movimientos de efectivo**: entradas, salidas, motivo, usuario y balance por
  moneda. Ese balance no representa el efectivo esperado de caja.
- **Historial Z**: vista previa y reimpresión del documento guardado completo,
  mediante la ruta de impresión existente, sin crear otro cierre.

Fechas locales inclusivas (hoy, ayer o rango) y filtro de caja que reconoce ID
local y ERP. La fuente es la base local: `transactions`, `transactionHistory`,
`cashMovements` y `zReports`. Los documentos se deduplican por ID y la copia
activa prevalece sobre la archivada. Se excluyen pendientes y documentos ajenos
a ventas. El alcance entre cajas depende de los datos disponibles en ese POS.

Los informes nuevos se envían a la impresora TICKET de la terminal actual, una
copia, con el perfil térmico de 80 mm y Font A de 42 columnas. Android transmite
ESC/POS; web envía HTML monoespaciado de ancho físico al agente o al diálogo de
impresión. No se abre el cajón. Ver [perfil y evidencia](./POS_QUERY_THERMAL_80MM.md).
Los errores usan los avisos y la protección contra envíos simultáneos existentes.

## Validación

`npx tsx --test tests/posReports.test.ts tests/zReportPaymentSummary.test.ts tests/zReportTerminalName.test.ts`

Además: `npm run lint`, `npm run build` y smoke de interfaz con datos sintéticos
para los informes, filtros, vista previa Z, envío térmico simulado y ancho
móvil. La salida real en papel requiere prueba en impresora física. Esta tarea
no genera, instala ni publica un APK.

La selección de informes usa una cuadrícula adaptable; los filtros y la acción
Imprimir permanecen dentro del ancho disponible. Los siete informes de consulta
comparten un motor tabular que calcula columnas y conserva indivisibles importes,
fechas y códigos. La vista previa utiliza las mismas líneas que la impresión.
