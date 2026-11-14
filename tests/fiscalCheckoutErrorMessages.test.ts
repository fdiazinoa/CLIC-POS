import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ERP_ACTIVATION_ACTION,
  ISSUER_SCOPE_ACTION,
  NCF_ALREADY_ISSUED_ACTION,
  PAID_ATTEMPT_ACTION,
  RETIREMENT_DISABLED_ACTION,
  TERMINAL_ASSIGNMENT_ACTION,
  describeFiscalCheckoutFailure,
} from '../utils/fiscalCheckoutErrorMessages';

test('un retiro fiscal apagado en el ERP dice qué falta y qué hacer', () => {
  const texto = describeFiscalCheckoutFailure(
    'FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED:El ERP no retiró el intento bf6a1ab2: FISCAL_WORKFLOW_DISABLED (503)',
  );
  assert.equal(texto, RETIREMENT_DISABLED_ACTION);
  assert.match(texto!, /POS_FISCAL_WORKFLOW_V2_ENABLED/);
  // Nada de códigos internos en pantalla.
  assert.doesNotMatch(texto!, /FISCAL_WORKFLOW_(DISABLED|CHECKOUT)/);
});

test('si además el intento tiene un pago se explica la revisión del voucher', () => {
  const texto = describeFiscalCheckoutFailure(
    'FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED:no se liberó porque ya tiene un pago; FISCAL_WORKFLOW_DISABLED',
  );
  assert.equal(texto, `${RETIREMENT_DISABLED_ACTION} ${PAID_ATTEMPT_ACTION}`);
  assert.match(texto!, /voucher/);
});

test('un intento bloqueado sin pago y una venta sin autorización fiscal', () => {
  assert.match(
    describeFiscalCheckoutFailure('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED:revisa el intento pendiente')!,
    /No se cobró nada/,
  );
  assert.match(
    describeFiscalCheckoutFailure('FISCAL_WORKFLOW_PERMIT_REQUIRED')!,
    /No se realizó ningún pago/,
  );
  assert.match(
    describeFiscalCheckoutFailure('PAYMENT_INTENT_RECONCILIATION_REQUIRED')!,
    /voucher/,
  );
});

test('un mensaje ajeno se deja intacto', () => {
  assert.equal(describeFiscalCheckoutFailure('No se pudo agregar el pago.'), null);
  assert.equal(describeFiscalCheckoutFailure(''), null);
  assert.equal(describeFiscalCheckoutFailure(null), null);
});

test('la caja sin asignación fiscal en el ERP dice qué configurar y no muestra el token', () => {
  // Texto real que arma POSInterface para una mesa sin autorización offline.
  const texto = describeFiscalCheckoutFailure(
    'La caja todavía no tiene preparada su autorización fiscal offline (FISCAL_WORKFLOW_ASSIGNMENT_REQUIRED). Conserva la cuenta; no se realizó ningún pago.',
  );
  assert.equal(texto, TERMINAL_ASSIGNMENT_ACTION);
  assert.match(texto!, /MSeller/);
  assert.match(texto!, /ECF/);
  assert.match(texto!, /Renovar reserva fiscal/);
  assert.doesNotMatch(texto!, /FISCAL_WORKFLOW_/);
});

test('un RNC emisor o una activación fiscal inválida se explican por separado', () => {
  assert.equal(describeFiscalCheckoutFailure('FISCAL_WORKFLOW_ISSUER_SCOPE_REQUIRED'), ISSUER_SCOPE_ACTION);
  assert.equal(describeFiscalCheckoutFailure('FISCAL_WORKFLOW_ERP_ACTIVE_REQUIRED'), ERP_ACTIVATION_ACTION);
  assert.match(ISSUER_SCOPE_ACTION, /RNC/);
  assert.match(ERP_ACTIVATION_ACTION, /activación fiscal/);
});

test('un NCF ya emitido se rechaza sin sugerir que se borre el comprobante', () => {
  for (const code of ['NATIVE_FISCAL_NUMBER_ALREADY_ISSUED', 'NATIVE_FISCAL_HISTORICAL_COLLISION']) {
    const texto = describeFiscalCheckoutFailure(`Error al finalizar venta: ${code}`);
    assert.equal(texto, NCF_ALREADY_ISSUED_ACTION);
    assert.match(texto!, /NCF/);
    assert.match(texto!, /reasignar el rango/);
    assert.doesNotMatch(texto!, /NATIVE_FISCAL_/);
  }
});

test('los rechazos alcanzables tras autorizar la tarjeta no afirman que no hubo pago', () => {
  // El NCF se reserva/consume en el commit y el ERP puede rechazar dentro de onConfirm,
  // ambos después de authorizePendingGatewayPayments: nunca prometer "no se realizó ningún pago".
  for (const code of [
    'NATIVE_FISCAL_NUMBER_ALREADY_ISSUED',
    'FISCAL_WORKFLOW_ASSIGNMENT_REQUIRED',
  ]) {
    const texto = describeFiscalCheckoutFailure(code)!;
    assert.doesNotMatch(texto, /No se realizó ningún pago/i);
    assert.match(texto, /voucher/);
  }
});

test('el alert de POSInterface usa el traductor fiscal', async () => {
  const { readFileSync } = await import('node:fs');
  const panel = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  // Sin este cableado, el token volvería a mostrarse tal cual al cajero.
  assert.match(panel, /alert\(`Error al finalizar venta: \$\{describeFiscalCheckoutFailure\(error\?\.message\) \|\| error\?\.message \|\| 'Error desconocido'\}`\)/);
});

test('el diagnóstico fiscal nombra el retiro en línea del ERP', async () => {
  const { readFileSync } = await import('node:fs');
  const cliente = readFileSync(new URL('../services/fiscal/FiscalWorkflowV2Client.ts', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../components/FiscalDiagnostics.tsx', import.meta.url), 'utf8');
  // La caja consulta /version del ERP (sin autenticación) y publica el estado en el diagnóstico.
  assert.match(cliente, /async erpDeployment\(\)/);
  assert.match(cliente, /fiscalWorkflowV2/);
  assert.match(cliente, /onlineRetirement:flag\.retirement\?'activo':'desactivado'/);
  assert.match(cliente, /erpRetirement/);
  assert.match(panel, /Retiro fiscal en el ERP/);
});
