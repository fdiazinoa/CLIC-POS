/**
 * Turn the internal fiscal tokens into one sentence the cashier (or support) can act on.
 *
 * The codes stay in the trace and in the payment diagnostics; on screen they are replaced by
 * the cause and the next step, because "FISCAL_WORKFLOW_DISABLED" tells nobody what to do.
 */

const RETIREMENT_DISABLED = /FISCAL_WORKFLOW_DISABLED/;
const PAID_ATTEMPT = /ya tiene un pago/i;
const ATTEMPT_BLOCKED = /FISCAL_WORKFLOW_(CHECKOUT_)?RECONCILIATION_REQUIRED/;
const PERMIT_REQUIRED = /FISCAL_WORKFLOW_PERMIT_REQUIRED/;
const CARD_UNKNOWN = /PAYMENT_INTENT_RECONCILIATION_REQUIRED/;

export const RETIREMENT_DISABLED_ACTION =
  'El ERP tiene desactivado el retiro fiscal en línea. Pide a soporte que active POS_FISCAL_WORKFLOW_V2_ENABLED en el ERP; mientras siga apagado, la caja no puede retirar un intento anterior.';

export const PAID_ATTEMPT_ACTION =
  'El intento fiscal anterior ya registró un pago. Revisa el voucher: si el cobro existe, confírmalo; si no, soporte debe retirar el intento en el ERP.';

/** Returns null when the message carries no fiscal meaning (the caller keeps its own text). */
export const describeFiscalCheckoutFailure = (message: string | null | undefined): string | null => {
  const text = String(message || '').trim();
  if (!text) return null;
  if (RETIREMENT_DISABLED.test(text)) {
    return PAID_ATTEMPT.test(text)
      ? `${RETIREMENT_DISABLED_ACTION} ${PAID_ATTEMPT_ACTION}`
      : RETIREMENT_DISABLED_ACTION;
  }
  if (ATTEMPT_BLOCKED.test(text) && PAID_ATTEMPT.test(text)) return PAID_ATTEMPT_ACTION;
  if (ATTEMPT_BLOCKED.test(text)) {
    return 'Quedó un intento fiscal anterior que esta caja no puede cerrar sola. No se cobró nada en este intento: soporte debe retirarlo en el ERP antes de volver a cobrar.';
  }
  if (PERMIT_REQUIRED.test(text)) {
    return 'No hay autorización fiscal disponible para esta venta. No se realizó ningún pago: espera la sincronización y vuelve a cobrar.';
  }
  if (CARD_UNKNOWN.test(text)) {
    return 'El cobro con tarjeta quedó sin confirmación del procesador. Revisa el voucher antes de reintentar.';
  }
  return null;
};
