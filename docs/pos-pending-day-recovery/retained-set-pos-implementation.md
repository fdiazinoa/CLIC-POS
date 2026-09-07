# Restauración de un conjunto local conservado

Implementación POS para `pos.retained-capture-set.v1` y descriptor ERP `erp.retained-local-set.v1`. Depende del lector de PR ERP #2023 (b32d6864 o posterior). No modifica el cálculo ni la autorización de cierre.

## Flujo implementado

1. `checkpointRetainedSet()` envía originales pendientes y exige ACK de cada revisión seleccionada. Bajo la cola local existente valida todas las ubicaciones de transactions, transactionHistory, cashMovements, collections, wallet_transactions y zReports. Compara la representación JSON realmente persistida con la imagen capturada; conserva intacto el original más rico (incluido undefined).
2. Captura MEMBERSHIP con ID estable por intento, corte de secuencia y referencias exactas. Repetir sin cambios reutiliza la captura. Solo escribe tablas técnicas locales. Es una API interna explícita para esta prueba; todavía no se programa automáticamente ni se sella un conjunto vacío al iniciar una base perdida.
3. Después del ACK del manifiesto, `download(true)` descarga un snapshot nuevo. `preflightRetainedSet()` consulta al ERP, verifica descriptor, todos los hashes, referencias y cobertura, incluidas revisiones no seleccionadas. No escribe operaciones.
4. `restore()` detecta el manifiesto y utiliza `restoreRetained()`. Si el descriptor falla, no vuelve silenciosamente a la selección legacy. Restaura las ubicaciones explícitas en una transacción local; las dos ubicaciones de una venta no son dos ventas ni dos revisiones a sumar. Conserva datos locales distintos y bloquea colisiones. Marca cada documento `_posRecovery` para que los emisores existentes no repitan efectos comerciales.

Series, inventario, clientes y cierres nuevos no se escriben. Una colocación activa cuyo original ya tenga zReportId queda bloqueada. La prueba no autoriza cerrar ni acredita propietarios ERP históricos ausentes.

## Verificación

```
CLIC_ERP_REVIEW_PATH=/ruta/CLIC-ERP-recovery-contract node --import tsx --test tests/recoveryRetainedSet.test.ts
npm run build
```

Los tests usan SQLite temporal y el constructor independiente ERP: aliases local/ERP, tarjeta USD, conflicto con datos locales, rollback ante fallo intermedio, repetición sin recaptura, originales intactos, negativos con descriptorHash recalculado y stage alterado.

El 7-sep-2026 se ejecutó además sobre una copia privada de los dos tickets reales del emulador: RD$1,650 efectivo y US$25 tarjeta a tasa 60 (RD$1,500). Se restauraron cuatro ubicaciones (dos ventas y dos entradas de historial), idénticas a su representación SQLite. Las 18 referencias no seleccionadas permanecieron explícitas; no se sumaron revisiones históricas. El manifiesto y la respuesta de propietarios de ESA prueba fueron sintéticos: no demuestra el endpoint desplegado ni autenticidad remota. El emulador y ERP no fueron modificados por ese ensayo.

## Pendiente antes del borrado de prueba

- Desplegar lector ERP y su RPC de lectura tras revisión; no se han desplegado desde esta tarea.
- Generar/instalar APK con esta implementación y conservar la corrección Object.hasOwn de 1.1.301.
- Capturar y recibir un manifiesto real, descargar un snapshot posterior y obtener preflight HTTP válido.
- Entonces borrar únicamente las ubicaciones operacionales autorizadas en la terminal de prueba, restaurar y comparar originales/cobros y salida Z sin emitir un cierre.
- Integración automática del checkpoint fuera del camino de cobro y continuidad tras pérdida de la base requieren trabajo adicional; esta API explícita no las demuestra.

Legacy UNKNOWN; exactZEligible=false; closeAuthorization=NOT_GRANTED. No se certifica recuperabilidad universal.
