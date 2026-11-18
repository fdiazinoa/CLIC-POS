# Impresión de los siete informes de consulta — 80 mm

## Inspección y alcance

Antes del cambio, `PosReportPrinter.ts` envolvía texto libre a 32 columnas mediante
el formatter de vouchers; el HTML alternativo declaraba un cuerpo de 48 mm.
Ese camino no fijaba explícitamente Font A ni el tamaño normal.

- `PrintRouterService` selecciona la impresora TICKET y deriva al bridge nativo o
  al agente local. Se conserva íntegramente su selección y contratos.
- `android/app/build.gradle` incorpora `native-stubs/android` como fuentes Java.
  `ClicPOSNativePrinterBridge.printEscPos` decodifica base64 y transmite bytes por
  Bluetooth, USB o TCP. `printHtml` quita etiquetas/estilos y lo transforma en
  texto; por eso los informes nativos usan ESC/POS directamente.
- El agente `server/kds_service.py` escribe `job.html` y lo envía a `lp`/`lpr`.
  No consume `dataBase64`. Los informes web ahora le envían HTML no vacío, en vez
  de un trabajo raw cuyo campo HTML estaba vacío. No se cambia el agente.
- Los stubs Electron no son evidencia de transporte físico implementado.
- `PrinterDevice` no expone modelo, DPI, ancho imprimible ni modo de columnas.
  No existe negociación de esas capacidades ni un equipo físico conectado.

No se cambian consultas, filtros, aritmética, impuestos, devoluciones ni reglas
financieras. La construcción del documento agrega metadatos de presentación en
los mismos puntos donde se obtienen los valores originales. La salida heredada
se conserva para las pruebas de regresión de cálculos.

No se modifica ningún formatter/driver compartido ni la impresión fiscal, de
facturas, recibos, vouchers o cierres X/Z. El historial Z sigue su camino anterior.

## Perfil compatible

El perfil activo es papel de 80 mm, área HTML de 72 mm, **Font A, 42 columnas**,
tamaño normal, sin espaciado adicional entre caracteres y tabla **PC858** para
conservar acentos españoles, ñ, ü y euro en un byte por celda.

El dato «80–88 mm» no demuestra 48 columnas. Epson documenta 42 en modo estándar
de TM-T88 y 48 en el modo correspondiente. El motor también admite el perfil
`QUERY_THERMAL_80MM_48`, reservado para un equipo/modo cuya capacidad se haya
verificado; no se activa automáticamente ni se cambia la memoria persistente.
El perfil acepta papel de 88 mm con la misma área de contenido. No se afirma
compatibilidad física con todos los protocolos, modelos o páginas de caracteres.

No se fuerza `GS W` sin conocer modelo/DPI. ESC/POS usa el área nativa de la
impresora; la aplicación limita las líneas a las columnas del perfil. El HTML
usa fuente monoespaciada, dimensiones en mm y página de altura calculada por el
contenido, sin permitir que el navegador envuelva importes automáticamente.

Referencias primarias:

- [Epson TM-T88VII: modos y especificaciones](https://files.support.epson.com/pdf/pos/bulk/tm-t88vii_trg_en_revg.pdf).
- [ESC M: selección de fuente](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_cm.html).
- [ESC t: tabla 19, PC858](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_lt.html).
- [GS W: límites y unidades del área de impresión](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_cw.html).

## Plantilla y columnas

Un único motor produce la vista previa, las líneas ESC/POS y el HTML:

| Informe | Detalle |
|---|---|
| Resumen de ventas | Concepto / total; venta neta destacada |
| Formas de pago | Forma y moneda original / aplicado en su moneda base |
| Productos vendidos | Producto / cantidad / importe de línea |
| Ventas por cajero | Cajero / tickets / neto; detalle de ventas, devoluciones y promedio |
| Ventas por hora | Hora local / tickets / neto; detalle de ventas y devoluciones |
| Descuentos y devoluciones | Concepto / total; detalle de documento, fecha, importe, origen, motivo y autorizador guardado |
| Movimientos de efectivo | Fecha y usuario/caja; motivo / importe; entradas, salidas y balance |

Encabezado común centrado: negocio, informe, período DD/MM/YYYY, caja y emisión
DD/MM/YYYY HH:mm. Siempre indica **CONSULTA — NO REALIZA CIERRE DE CAJA**.
Los totales financieros ya existentes se destacan; no se agregan nuevos cálculos
consolidados en productos ni formas de pago.

Los anchos numéricos se calculan con el mayor valor de cada columna. El concepto
recibe el espacio restante y envuelve palabras de forma controlada. Si los
importes dejan poco espacio, se presentan en líneas propias alineadas a la
derecha. Nunca se parten fechas, cantidades, importes o códigos de documento.
Un valor indivisible que exceda incluso una línea completa rechaza el envío antes
de imprimir, en vez de truncarlo. Los caracteres fuera de PC858 se rechazan en
vez de borrarlos silenciosamente. Controles y tabulaciones se neutralizan.

Se mantienen signos, moneda y redondeo original `toFixed`; solo se añaden
separadores de miles y presentación uniforme. Las cantidades conservan los tres
decimales máximos existentes. No se reinterpretan cifras desde cadenas impresas.

## Validación y límites físicos

Ejecutar las suites de layout, transporte, cálculos, impresión Z y facturas:

```
npx tsx --test tests/posReportThermalLayout.test.ts tests/posReportPrinter.test.ts tests/posReports.test.ts tests/zReportPaymentSummary.test.ts tests/zReportTerminalName.test.ts tests/retailReceiptContext.test.ts
```

Se cubren los siete informes, 42/48 columnas, papel 80/88 mm, alineación, números
grandes y negativos, conceptos largos, códigos/fechas indivisibles, acentos,
escape HTML y comandos de control. Los transportes nativo y HTML son simulados.
La comparación con una ejecución previa al cambio mantuvo idénticos los siete
textos heredados con el mismo conjunto de datos.

No hay una impresora física disponible en esta sesión. Pendiente imprimir los
siete informes, confirmar Font A/PC858 y el modo real de columnas de cada modelo,
comprobar importes grandes y verificar corte sin apertura de cajón. No se genera,
instala ni publica un APK con esta tarea de código.
