import type { Transaction, TaxDefinition, FiscalClassificationProjection } from '../types';
import { sha256Utf8 } from '../services/sync/LargeMasterSyncV3Client';
import { authorizeV3TaxClassification } from '../services/sync/LargeMasterSyncV3TaxClassification';

export const MSELLER_UNSUPPORTED_VAT_ERROR = 'MSeller: tasa de ITBIS no soportada; requiere clasificación fiscal explícita (no sumar propina al ITBIS).';
const hasExtendedProviderProof = (tx: Transaction): boolean => ['fiscalResponseCode', 'fiscalSignedXml', 'fiscalQrCode'].some(key =>
  String((tx as Transaction & Record<string, unknown>)[key] ?? '').trim().length > 0);

const assertClassificationFinancialSource = (tx: Transaction): void => {
  if (![tx.netAmount, tx.taxAmount, tx.total].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    || tx.total <= 0 || !tx.taxBreakdown?.length
    || tx.taxBreakdown.some(row => ![row.rate, row.amount, row.taxableBase, row.total].every(value =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0) || row.rate > 1)
    || Math.abs(tx.taxBreakdown.reduce((sum,row) => sum + row.amount,0) - tx.taxAmount!) > 0.005
    || Math.abs(tx.netAmount! + tx.taxAmount! - tx.total) > 0.005) throw new Error('FISCAL_CLASSIFICATION_SOURCE_INVALID');
};

/** Exact deterministic local/ERP totals rejection, never a generic transport error or NOT_FOUND. */
export const canProjectFiscalClassification = (tx: Transaction): boolean => tx.fiscalProvider === 'MSELLER'
  && !hasExtendedProviderProof(tx) && !tx.fiscalClassificationAttemptedAt && tx.fiscalSyncStatus === 'ERROR' && tx.fiscalSyncError === MSELLER_UNSUPPORTED_VAT_ERROR
  && tx.fiscalResponseMessage === MSELLER_UNSUPPORTED_VAT_ERROR
  && tx.fiscalProviderStatus === 'V3_ISSUE_REQUESTED'
  && !tx.fiscalReferenceId && !tx.fiscalCertifiedNcf && !tx.fiscalSyncedAt && !tx.fiscalQrUrl && !tx.fiscalSecurityCode
  && Boolean(tx.electronicNcf || tx.ncf) && ['E31','E32'].includes(String(tx.ncfType));

/** Monetary/source identity hash excludes delivery status, which explicit retry may update. */
export const fiscalClassificationChecksum = (tx: Transaction): Promise<string> => sha256Utf8(JSON.stringify([
  tx.id, tx.terminalId, tx.ncf, tx.electronicNcf, tx.ncfType, tx.customerId, tx.customerSnapshot,
  tx.items, tx.payments, tx.netAmount, tx.taxAmount, tx.total, tx.discountAmount, tx.discountType,
  tx.discountValue, tx.taxBreakdown, tx.serviceChargeAmount, tx.serviceTaxPolicySnapshot, tx.date,
]));

export const createFiscalClassificationProjection = async (tx: Transaction, taxes: TaxDefinition[], actorId: string,
  reason: string, binding: string): Promise<FiscalClassificationProjection> => {
  if (!canProjectFiscalClassification(tx) || !actorId || !reason.trim() || !binding
    || tx.items.some(line => line.v3SaleAuthority?.binding !== binding)) throw new Error('FISCAL_CLASSIFICATION_CORRECTION_DENIED');
  assertClassificationFinancialSource(tx);
  const before = tx.taxBreakdown;
  if (!before?.length || new Set(before.map(row => row.id)).size !== before.length) throw new Error('FISCAL_CLASSIFICATION_SOURCE_INVALID');
  const after = before.map(row => {
    const matches = taxes.filter(tax => tax.id === row.id);
    if (matches.length !== 1 || matches[0].active === false || matches[0].rate !== row.rate) throw new Error('FISCAL_CLASSIFICATION_SOURCE_INVALID');
    const target = matches[0];
    return target.type === row.type ? { ...row } : { ...row, type: target.type,
      ...(target.type === 'SERVICE_CHARGE' && target.rate === 0.1 ? { fiscalAdditionalTaxCode: '001' as const } : {}) };
  });
  const changes = authorizeV3TaxClassification(before.map(row => ({ ...row, active: true })), after.map(row => ({ ...row, active: true })));
  if (!changes.length || before.some(row => ![row.rate,row.amount,row.taxableBase,row.total].every(Number.isFinite))
    || Math.abs(before.reduce((sum,row) => sum + row.amount,0) - Number(tx.taxAmount)) > 0.005
    || Math.abs(Number(tx.netAmount) + Number(tx.taxAmount) - tx.total) > 0.005) throw new Error('FISCAL_CLASSIFICATION_SOURCE_INVALID');
  if (tx.fiscalClassificationProjection) {
    const existing = tx.fiscalClassificationProjection;
    if (existing.sourceChecksum !== await fiscalClassificationChecksum(tx) || JSON.stringify(existing.after) !== JSON.stringify(after)) throw new Error('FISCAL_CLASSIFICATION_STALE');
    return existing;
  }
  return { version: 1, sourceChecksum: await fiscalClassificationChecksum(tx), binding, correctedAt: new Date().toISOString(),
    correctedById: actorId, reason: reason.trim(), before: structuredClone(before), after };
};

/** Returns only a wire copy; financial and provider history is never rewritten. */
export const applyFiscalClassificationProjection = async (tx: Transaction): Promise<Transaction> => {
  const projection = tx.fiscalClassificationProjection;
  if (!projection) return tx;
  assertClassificationFinancialSource(tx);
  if (hasExtendedProviderProof(tx) || tx.fiscalProvider !== 'MSELLER' || tx.fiscalProviderStatus !== 'V3_ISSUE_REQUESTED'
    || tx.fiscalReferenceId || tx.fiscalCertifiedNcf || tx.fiscalSyncedAt || tx.fiscalQrUrl || tx.fiscalSecurityCode
    || projection.version !== 1 || projection.sourceChecksum !== await fiscalClassificationChecksum(tx)
    || tx.items.some(line => line.v3SaleAuthority?.binding !== projection.binding)
    || JSON.stringify(tx.taxBreakdown) !== JSON.stringify(projection.before)) throw new Error('FISCAL_CLASSIFICATION_STALE');
  const changes = authorizeV3TaxClassification(projection.before.map(row => ({ ...row, active: true })), projection.after.map(row => ({ ...row, active: true })));
  if (!changes.length || projection.after.some((row,index) => {
    const { type: _oldType, fiscalAdditionalTaxCode: _oldCode, ...old } = projection.before[index];
    const { type: _newType, fiscalAdditionalTaxCode: _newCode, ...next } = row;
    return JSON.stringify(old) !== JSON.stringify(next);
  })) throw new Error('FISCAL_CLASSIFICATION_SOURCE_INVALID');
  return { ...tx, taxBreakdown: structuredClone(projection.after) };
};

/** Durable one-shot consumption must commit by CAS before any issue request. */
export const consumeFiscalClassificationAttempt = async (tx: Transaction): Promise<Transaction> => {
  if (!tx.fiscalClassificationProjection || !canProjectFiscalClassification(tx)) throw new Error('FISCAL_CLASSIFICATION_RECONCILIATION_REQUIRED');
  await applyFiscalClassificationProjection(tx);
  return { ...tx, fiscalClassificationAttemptedAt: new Date().toISOString() };
};
