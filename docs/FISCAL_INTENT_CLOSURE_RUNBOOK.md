# Cerrar un intento fiscal pendiente (runbook de caja)

Cuando una caja no puede cobrar porque quedó un intento fiscal de un cobro anterior, el
procedimiento es siempre el mismo y no emite ni anula comprobantes por sí solo.

## 1. Ver el estado real

Ajustes → **Sistema y Auditoría** → **Diagnóstico fiscal**. La pantalla dice, sin adivinar:

| Campo | Qué significa |
|---|---|
| Autorización de la terminal | La caja está vinculada y autenticada con el ERP. |
| Capacidad fiscal V2 | El ERP habilita el flujo fiscal (necesario para permisos y retiro). |
| Sesión de la terminal | «sin vencimiento» es lo esperado; una fecha concreta es un aviso. |
| Reserva fiscal local | Comprobantes disponibles para cobrar sin red. |
| Intento fiscal guardado | Fase e identificador: `PREPARED`, `EFFECT_POSSIBLE`, `COMMITTED`, `ACKNOWLEDGED`. |
| Cobros ligados al intento | Los cobros que impiden descartarlo. `DECLINED` no es dinero; cualquier otro sí. |
| Retiro fiscal en el ERP | Si el despliegue del ERP tiene activo `POS_FISCAL_WORKFLOW_V2_ENABLED`. |

«Copiar» pega el diagnóstico completo en un mensaje para soporte.

## 2. Elegir la salida

El botón **Cerrar intento pendiente** decide por sí solo, en este orden:

1. **Intento offline** (reserva local): su prueba de abandono es local y basta. Se descarta sin
   comprobante, aunque tenga un pago marcado como posible.
2. **Intento online `PREPARED` sin pagos**: se libera en la caja; no hay efecto posible.
3. **Intento online con pagos** (`EFFECT_POSSIBLE`): **solo el ERP puede retirarlo**. La caja pide
   el PIN de un supervisor con permiso de cobro y envía el retiro con ese operador. El ERP
   responde con el comprobante de retiro o con el motivo del rechazo (`DOCUMENT_EXISTS`,
   `EFFECTS_HELD`, …), y en ese caso no se toca nada.
4. **Sin permiso del ERP** (`FISCAL_WORKFLOW_DISABLED`): la caja ofrece la liberación de
   emergencia con PIN de supervisor. Solo procede si el intento **no tiene cobros sin resolver**:
   si alguno está `DECLINED` puede liberarse; si está autorizado, conciliado o sin respuesta, no.

## 3. Si el intento tenía un cobro con tarjeta sin respuesta

Primero se resuelve el dinero, no el intento:

- El cobro existe → **Confirmar con el voucher** en la pantalla de cobro (queda aprobado y la
  venta continúa con el mismo intento fiscal).
- El cobro no existe → **No apareció en el voucher**: el intento de tarjeta queda `DECLINED`.
  Con eso, el cierre del intento fiscal ya no encuentra dinero posible.

## 4. Qué necesita el ERP

- `POS_FISCAL_WORKFLOW_V2_ENABLED=true` en el despliegue que atiende a la caja.
- Verificación en un paso: `GET /api/sync/version` → `fiscalWorkflowV2: { enabled, retirement }`.
  La caja muestra el mismo dato en «Retiro fiscal en el ERP».
- Un usuario con `POS_CHECKOUT` para autorizar el retiro de un intento con pagos.

## 5. Caja 2 (incidente abierto)

Estado conocido: intento online `EFFECT_POSSIBLE` con un pago, caja inaccesible por red
(`10.0.0.196` no responde; ARP incompleto). Cuando vuelva a estar en línea:

```bash
adb connect 10.0.0.196:5555
adb install -r Clic-Pos-<version>-release.apk
```

1. Abrir **Diagnóstico fiscal** y comprobar «Retiro fiscal en el ERP: activo».
2. Mirar «Cobros ligados al intento»: si dice `DECLINED`, cerrar el intento; si dice
   `RECONCILIATION_REQUIRED` o `AUTHORIZED`, primero resolver el cobro con el voucher.
3. **Cerrar intento pendiente** con un PIN de supervisor (`POS_CHECKOUT`).
4. Cobrar de nuevo. La traza queda en Ajustes → **Traza de Auditoría**.
