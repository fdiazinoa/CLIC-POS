import {hasOfflineFiscalHeader,assertDirectFiscalCharge} from '../fiscal/OfflineFiscalCharge';
import {assertTrackingLine} from '../tracking/TrackingLine';
import {validateV3RestaurantSelection} from '../../utils/v3RestaurantSelection';
import {isOfflineTableFiscalTransaction} from '../fiscal/OfflineTableFiscalCheckout';
import { validWeightPresentation } from '../../utils/scaleWeight';
import { hasV3KilogramContract } from '../../utils/weightedProduct';
import type { BusinessConfig, CartItem, Product, Transaction, V3SaleAuthorityStamp } from '../../types';
import { calculateTaxBreakdownFromItems, calculateLineFiscalValuesForTransaction, calculateUncoveredServiceChargeBase, freezeAuthoritativeLineFiscalAmounts } from '../../utils/fiscalBreakdown';
import { resolveAppliedServiceTaxPolicy } from '../../utils/serviceTaxPolicy';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

/** A valid stamp cannot authorize changing the source's inventory or fiscal semantics. */
export const validateV3PinnedLineSource = (line: CartItem, product: Product, authority: V3SaleAuthorityStamp): void => {
  // The authoritative line is rebuilt from the source by the commit callback, so a stale copy of
  // the descriptive fields (type, inventariable, taxable, tax ids, production area) is corrected
  // there instead of blocking the sale. Only the identity that affects stock and fiscal binding is
  // enforced here: the article itself, the tariff treatment, the weight contract and the variant.
  if (line.id !== product.id) throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_SOURCE_CHANGED:identity');
  if (line.v3SaleAuthority && line.v3SaleAuthority.taxIncluded !== authority.taxIncluded) {
    throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_SOURCE_CHANGED:tariff');
  }
  if (!validWeightPresentation(line.weightPresentation, product.measurementUnit)) {
    throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_SOURCE_CHANGED:weight');
  }
  if (line.operationalFlags?.isWeighted || product.operationalFlags?.isWeighted) {
    if (!hasV3KilogramContract(line) || !hasV3KilogramContract(product)
      || line.measurementUnit !== product.measurementUnit || line.purchaseUnit !== product.purchaseUnit
      || line.conversionFactor !== product.conversionFactor
      || line.operationalFlags?.integersOnly !== product.operationalFlags?.integersOnly
      || line.operationalFlags?.trackInventory !== product.operationalFlags?.trackInventory
      || line.variantId || line.variantSku || line.variants?.length
      || line.recipeDetails?.length || line.modifiers?.length) {
      throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_SOURCE_CHANGED:weight-contract');
    }
  }
  if (line.variantId || line.variantSku) {
    const matches = (product.variants || []).filter(variant => line.variantId
      ? variant.id === line.variantId : variant.sku === line.variantSku);
    if (matches.length !== 1 || (line.variantSku && matches[0].sku !== line.variantSku)) {
      throw new LargeMasterSyncV3Error('SYNC_V3_VARIANT_SOURCE_CHANGED');
    }
  }
  validateV3RestaurantSelection(line,product);
  assertTrackingLine(line,product);
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
  const uncoveredBase = calculateUncoveredServiceChargeBase(transaction.items, config, options);
  const maximumCharge = policy.legalTip?.enabled === true
    ? round(uncoveredBase * Number(policy.legalTip.percentage || 0) / 100) : 0;
  // Direct positive sales use the UI's aggregated tax header before freezing
  // the final-line residual. Refunds and retained snapshots keep their own algebra.
  const directSaleHeader = transaction.documentType === 'TICKET' && transaction.items.every(line => line.quantity > 0)
    && !transaction.originalTransactionId && !transaction.v3ReservationClaimId && !transaction.reservationId
    && !transaction.v3RestoredTicketId && !transaction.restaurantOrderId && !transaction.restaurantTableId;
  const expectedTax = directSaleHeader
    ? round(calculateTaxBreakdownFromItems(transaction.items, config, { ...options, fallbackTaxRate: 0 })
      .reduce((sum, tax) => sum + tax.amount, 0))
    : round(calculated.reduce((sum, row) => sum + row.taxAmount, 0));
  const separateCharge=hasOfflineFiscalHeader(transaction);
  if(separateCharge&&!isOfflineTableFiscalTransaction(transaction))assertDirectFiscalCharge(transaction,config);
  if(separateCharge&&charge>0&&JSON.stringify(transaction.serviceTaxPolicySnapshot)!==JSON.stringify(policy))throw new LargeMasterSyncV3Error('SYNC_V3_FROZEN_FISCAL_SOURCE_CHANGED');
  const expectedNet = directSaleHeader
    ? round(transaction.items.reduce((sum, line) => sum + line.price * line.quantity, 0)
      - options.discountAmount - (options.isTaxIncluded ? expectedTax : 0) + (separateCharge?0:charge))
    : round(calculated.reduce((sum, row) => sum + row.netAmount, 0) + (separateCharge?0:charge));
  const expectedTotal = round(expectedNet + expectedTax + (separateCharge?charge:0));
  if (!Number.isFinite(charge) || charge < 0 || charge > maximumCharge + 0.02
    || ![transaction.netAmount, transaction.taxAmount, Math.abs(transaction.total)]
    .every((value, index) => typeof value === 'number' && Math.abs(value - [expectedNet, expectedTax, expectedTotal][index]) <= 0.02)) {
    throw new LargeMasterSyncV3Error('SYNC_V3_FROZEN_FISCAL_SOURCE_CHANGED');
  }
  const frozen = freezeAuthoritativeLineFiscalAmounts(transaction.items, config, { ...options,
    transactionNetAmount: expectedNet, transactionTaxAmount: expectedTax, transactionTotal: expectedTotal-(separateCharge?charge:0) });
  for (let index = 0; index < frozen.length; index++) {
    if (!['netAmount', 'taxAmount', 'totalAmount'].every(key => {
      const actual = (transaction.items[index] as any)[key];
      return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - (frozen[index] as any)[key]) <= 0.02;
    })) throw new LargeMasterSyncV3Error('SYNC_V3_FROZEN_FISCAL_SOURCE_CHANGED');
  }
};
