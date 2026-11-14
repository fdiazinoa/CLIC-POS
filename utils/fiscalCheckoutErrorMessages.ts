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
/** The ERP rejected the terminal's own fiscal assignment, not this sale. */
const TERMINAL_ASSIGNMENT_REQUIRED = /FISCAL_WORKFLOW_ASSIGNMENT_REQUIRED/;
const ISSUER_SCOPE_REQUIRED = /FISCAL_WORKFLOW_ISSUER_SCOPE_REQUIRED/;
const ERP_ACTIVATION_REQUIRED = /FISCAL_WORKFLOW_ERP_ACTIVE_REQUIRED/;
/** The immutable local ledger already owns this NCF: reusing it would duplicate an issued receipt. */
const NCF_ALREADY_ISSUED = /NATIVE_FISCAL_(NUMBER_ALREADY_ISSUED|HISTORICAL_COLLISION)/;

export const RETIREMENT_DISABLED_ACTION =
  'El ERP tiene desactivado el retiro fiscal en línea. Pide a soporte que active POS_FISCAL_WORKFLOW_V2_ENABLED en el ERP; mientras siga apagado, la caja no puede retirar un intento anterior.';

export const PAID_ATTEMPT_ACTION =
  'El intento fiscal anterior ya registró un pago. Revisa el voucher: si el cobro existe, confírmalo; si no, soporte debe retirar el intento en el ERP.';

export const TERMINAL_ASSIGNMENT_ACTION =
  'El ERP rechazó la configuración fiscal de esta caja. Si el cobro fue con tarjeta, revisa el voucher antes de reintentar. Soporte debe asignarle proveedor MSeller activo, modo ECF y ambiente; después usa "Renovar reserva fiscal" en el diagnóstico fiscal.';

export const ISSUER_SCOPE_ACTION =
  'El RNC emisor de la empresa no coincide con la credencial de facturación electrónica de la caja. No se realizó ningún pago: soporte debe alinear el RNC y la credencial en el ERP.';

export const ERP_ACTIVATION_ACTION =
  'La activación fiscal de la empresa o de la caja no está vigente en el ERP. No se realizó ningún pago: completa la activación fiscal en el ERP y vuelve a intentar.';

export const NCF_ALREADY_ISSUED_ACTION =
  'La caja intentó reutilizar un comprobante (NCF) que ya fue emitido y no puede volver a usarse. Si el cobro fue con tarjeta, revisa el voucher antes de reintentar. Sincroniza la autorización con "Renovar reserva fiscal" en el diagnóstico fiscal; si el error continúa, soporte debe reasignar el rango de numeración de esta caja.';

/** Returns null when the message carries no fiscal meaning (the caller keeps its own text). */
export const describeFiscalCheckoutFailure = (message: string | null | undefined): string | null => {
  const text = String(message || '').trim();
  if (!text) return null;
  if(/DISPATCH_SERVICE_CHARGE_NOT_READY/.test(text))return 'Este recargo todavía no admite despacho por almacén. No se realizó ningún pago; conserva el ticket y revisa su configuración.';
  if(/DISPATCH_PREVIOUS_PAYMENT_RECONCILIATION_REQUIRED/.test(text))return 'Quedó un pago anterior pendiente en esta caja. Recupera su recibo antes de iniciar otro cobro; no se liberaron sus cupos.';
  if (NCF_ALREADY_ISSUED.test(text)) return NCF_ALREADY_ISSUED_ACTION;
  if (TERMINAL_ASSIGNMENT_REQUIRED.test(text)) return TERMINAL_ASSIGNMENT_ACTION;
  if (ISSUER_SCOPE_REQUIRED.test(text)) return ISSUER_SCOPE_ACTION;
  if (ERP_ACTIVATION_REQUIRED.test(text)) return ERP_ACTIVATION_ACTION;
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
