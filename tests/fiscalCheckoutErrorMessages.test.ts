import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAID_ATTEMPT_ACTION,
  RETIREMENT_DISABLED_ACTION,
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
