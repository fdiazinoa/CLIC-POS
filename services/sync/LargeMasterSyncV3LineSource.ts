import { hasV3KilogramContract } from '../../utils/weightedProduct';
import type { BusinessConfig, CartItem, Product, Transaction, V3SaleAuthorityStamp } from '../../types';
import { calculateLineFiscalValuesForTransaction, freezeAuthoritativeLineFiscalAmounts } from '../../utils/fiscalBreakdown';
import { resolveAppliedServiceTaxPolicy } from '../../utils/serviceTaxPolicy';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

/** A valid stamp cannot authorize changing the source's inventory or fiscal semantics. */
export const validateV3PinnedLineSource = (line: CartItem, product: Product, authority: V3SaleAuthorityStamp): void => {
  if (line.id !== product.id || line.type !== product.type || line.isInventoriable !== product.isInventoriable
    || line.taxable !== product.taxable || line.v3SaleAuthority?.taxIncluded !== authority.taxIncluded
    || JSON.stringify(line.appliedTaxIds) !== JSON.stringify(product.appliedTaxIds)) {
    throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_SOURCE_CHANGED');
  }
  if (line.operationalFlags?.isWeighted || product.operationalFlags?.isWeighted) {
    if (!hasV3KilogramContract(line) || !hasV3KilogramContract(product)
      || line.measurementUnit !== product.measurementUnit || line.purchaseUnit !== product.purchaseUnit
      || line.conversionFactor !== product.conversionFactor
      || line.operationalFlags?.integersOnly !== product.operationalFlags?.integersOnly
      || line.operationalFlags?.trackInventory !== product.operationalFlags?.trackInventory
      || line.variantId || line.variantSku || line.variants?.length
      || line.recipeDetails?.length || line.modifiers?.length) {
      throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_SOURCE_CHANGED');
    }
  }
  if (line.variantId || line.variantSku) {
    const matches = (product.variants || []).filter(variant => line.variantId
      ? variant.id === line.variantId : variant.sku === line.variantSku);
    if (matches.length !== 1 || (line.variantSku && matches[0].sku !== line.variantSku)) {
      throw new LargeMasterSyncV3Error('SYNC_V3_VARIANT_SOURCE_CHANGED');
    }
  }
};

/** Recompute from V3 taxes and the permitted final price/discount, never a legacy fallback rate. */
export const validateV3FrozenLineFiscalAmounts = (transaction: Transaction, config: BusinessConfig): void => {
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const terminal = (config.terminals || []).find(row => row.id === transaction.terminalId)?.config;
  const policy = resolveAppliedServiceTaxPolicy(config, terminal, transaction.serviceType || 'DINE_IN');
  const options = { discountAmount: transaction.discountAmount || 0,
    isTaxIncluded: transaction.items[0].v3SaleAuthority!.taxIncluded,
    terminalConfig: terminal, taxExempt: transaction.customerSnapshot?.isTaxExempt === true,
    allowedTaxIds: policy.taxIds };
  const calculated = calculateLineFiscalValuesForTransaction(transaction.items, config, options);
  const charge = Number(transaction.serviceChargeAmount || 0);
  const gross = transaction.items.reduce((sum, line) => sum + Math.abs(line.price * line.quantity), 0);
  const maximumCharge = policy.legalTip?.enabled === true
    ? round(Math.max(0, gross - options.discountAmount) * Number(policy.legalTip.percentage || 0) / 100) : 0;
  const expectedNet = round(calculated.reduce((sum, row) => sum + row.netAmount, 0) + charge);
  const expectedTax = round(calculated.reduce((sum, row) => sum + row.taxAmount, 0));
  const expectedTotal = round(expectedNet + expectedTax);
  if (!Number.isFinite(charge) || charge < 0 || charge > maximumCharge + 0.02
    || ![transaction.netAmount, transaction.taxAmount, Math.abs(transaction.total)]
    .every((value, index) => typeof value === 'number' && Math.abs(value - [expectedNet, expectedTax, expectedTotal][index]) <= 0.02)) {
    throw new LargeMasterSyncV3Error('SYNC_V3_FROZEN_FISCAL_SOURCE_CHANGED');
  }
  const frozen = freezeAuthoritativeLineFiscalAmounts(transaction.items, config, { ...options,
    transactionNetAmount: expectedNet, transactionTaxAmount: expectedTax, transactionTotal: expectedTotal });
  for (let index = 0; index < frozen.length; index++) {
    if (!['netAmount', 'taxAmount', 'totalAmount'].every(key => {
      const actual = (transaction.items[index] as any)[key];
      return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - (frozen[index] as any)[key]) <= 0.02;
    })) throw new LargeMasterSyncV3Error('SYNC_V3_FROZEN_FISCAL_SOURCE_CHANGED');
  }
};
