import type { BusinessConfig, Customer, ParkedTicket, Table, TerminalConfig } from '../types';
import { calculateTaxBreakdownFromItems, consolidateTaxBreakdownForDisplay } from './fiscalBreakdown';
import { resolveAppliedServiceTaxPolicy } from './serviceTaxPolicy';
import { shouldApplyRestaurantServiceCharge } from './orderServiceType';
import { applyPromotions } from './promotionEngine';

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Same DINE_IN tax/discount/legal-tip sequence used by the POS cart. */
export const buildTableAccountFiscalSummary = (
  ticket: ParkedTicket,
  table: Table,
  config: BusinessConfig,
  terminalConfig: TerminalConfig | undefined,
  isTaxIncluded: boolean,
  terminalId = 'T1',
  customer?: Customer,
) => {
  // POS checkout applies promotions to a derived cart. Keep parked line identity and
  // prices untouched; only the fiscal/printed representation uses processed items.
  const items = applyPromotions(ticket.items || [], config, terminalId, customer);
  const subtotal = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  const discountValue = Number(ticket.discountValue);
  const hasDiscountRule = ticket.discountValue != null && Number.isFinite(discountValue)
    && (ticket.discountType === 'PERCENT' || ticket.discountType === 'FIXED');
  const discountTotal = Math.min(subtotal, Math.max(0, hasDiscountRule
    ? ticket.discountType === 'PERCENT' ? subtotal * (discountValue / 100) : discountValue
    : Number(ticket.discountAmount || 0)));
  // Checkout prefers the current customer record over the snapshot captured
  // when the table was parked; only fall back when the customer is unavailable.
  const taxExempt = customer ? customer.isTaxExempt === true : ticket.customerSnapshot?.isTaxExempt === true;
  const policy = resolveAppliedServiceTaxPolicy(config, terminalConfig, 'DINE_IN');
  const taxBreakdown = consolidateTaxBreakdownForDisplay(calculateTaxBreakdownFromItems(items, config, {
    discountAmount: discountTotal,
    isTaxIncluded,
    terminalConfig,
    allowedTaxIds: policy.taxIds,
    taxExempt,
  }), config.taxes);
  const taxTotal = round2(taxBreakdown.reduce((sum, tax) => sum + tax.amount, 0));
  const netSubtotal = subtotal - discountTotal - (isTaxIncluded ? taxTotal : 0);
  const shouldApplyTip = shouldApplyRestaurantServiceCharge({
    isRestaurantMode: true,
    serviceType: 'DINE_IN',
    serviceCharge: config.tipsConfig?.serviceCharge,
    grossAfterDiscount: subtotal - discountTotal,
    guests: Number(table.guests || 0),
    legalTipPolicy: policy.legalTip,
  });
  const serviceChargeRate = shouldApplyTip
    ? Number(policy.legalTip?.percentage ?? config.tipsConfig?.serviceCharge?.percentage ?? 0)
    : 0;
  const serviceChargeAmount = shouldApplyTip
    ? (subtotal - discountTotal) * (serviceChargeRate / 100)
    : 0;
  const total = round2(netSubtotal + taxTotal + serviceChargeAmount);
  return { items, subtotal, netSubtotal, discountTotal, taxBreakdown, taxTotal, serviceChargeAmount, serviceChargeRate, total, isTaxIncluded, taxExempt };
};

export const getPaymentFractionFiscalDifference = (ticket: ParkedTicket, fiscalTotal: number): number => {
  const plan = ticket.paymentFraction;
  if (!plan || plan.parts.length < 2) return 0;
  const partsTotal = round2(plan.parts.reduce((sum, part) => sum + Number(part.amount || 0), 0));
  const difference = Math.max(Math.abs(Number(plan.originalTotal || 0) - fiscalTotal), Math.abs(partsTotal - fiscalTotal));
  return difference > 0.01 ? round2(difference) : 0;
};
