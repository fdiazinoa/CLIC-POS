import type { BusinessConfig, Transaction } from '../types';
import { calculateLineFiscalValuesForTransaction, resolveEffectiveTaxes } from '../utils/fiscalBreakdown';
import { resolveAppliedServiceTaxPolicy } from '../utils/serviceTaxPolicy';

/** Provider projection uses persisted line amounts, including refund/discount rounding. */
export const buildV3FrozenFiscalProviderTransaction = (transaction: Transaction, config: BusinessConfig): Transaction => {
  const terminal = config.terminals?.find(row => row.id === transaction.terminalId)?.config;
  const policy = transaction.serviceTaxPolicySnapshot || transaction.service_tax_policy_snapshot
    || resolveAppliedServiceTaxPolicy(config, terminal, transaction.serviceType || 'DINE_IN');
  const taxExempt = transaction.customerSnapshot?.isTaxExempt === true;
  const calculated = calculateLineFiscalValuesForTransaction(transaction.items, config, {
    discountAmount: transaction.discountAmount || 0,
    isTaxIncluded: transaction.items[0]?.v3SaleAuthority?.taxIncluded === true,
    terminalConfig: terminal, taxExempt, allowedTaxIds: policy.taxIds,
  });
  const breakdown = new Map<string, any>();
  for (const [index, line] of transaction.items.entries()) {
    if (![line.netAmount, line.taxAmount, line.totalAmount].every(value => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error('SYNC_V3_FROZEN_FISCAL_INVALID');
    }
    const lineTaxes = taxExempt ? [] : resolveEffectiveTaxes(line, config, terminal, 0, 'Impuesto', policy.taxIds)
      .filter(tax => tax.rate > 0);
    const rate = lineTaxes.reduce((sum, tax) => sum + tax.rate, 0);
    if (line.taxAmount && !rate) throw new Error('SYNC_V3_FROZEN_FISCAL_INVALID');
    for (const tax of lineTaxes) {
      const amount = Number(line.taxAmount) * tax.rate / rate;
      if (!amount) continue;
      const row = breakdown.get(tax.id) || { id: tax.id, name: tax.name, rate: tax.rate,
        amount: 0, taxableBase: 0, total: 0, lineCount: 0 };
      row.amount += amount;
      // Header residuals frozen into the last line include non-taxed service charges.
      // Use the fiscal base before that residual, preserving the frozen tax amount.
      row.taxableBase += calculated[index].netAmount;
      row.total += calculated[index].netAmount + amount;
      row.lineCount++;
      breakdown.set(tax.id, row);
    }
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  const taxBreakdown = [...breakdown.values()].map(row => ({ ...row, amount: round(row.amount),
    taxableBase: round(row.taxableBase), total: round(row.total) }));
  if (Math.abs(taxBreakdown.reduce((sum, row) => sum + row.amount, 0) - Number(transaction.taxAmount)) > 0.02) {
    throw new Error('SYNC_V3_FROZEN_FISCAL_INVALID');
  }
  return { ...transaction, taxBreakdown };
};

/** Epoch prevents work from a previous mount surviving StrictMode cleanup/remount. */
export class V3OperationalUILifetime {
  private epoch = 0;
  private active = true;

  activate(): void { this.active = true; }
  retire(): void { this.active = false; this.epoch++; }
  capture(): () => boolean {
    const epoch = this.epoch;
    return () => this.active && epoch === this.epoch;
  }
}

export const assertV3UIContext = (isCurrent: () => boolean): void => {
  if (!isCurrent()) throw new Error('SYNC_V3_UI_CONTEXT_CHANGED');
};

export const authorizeV3UIContext = async (isCurrent: () => boolean, authorize: () => Promise<boolean>): Promise<boolean> => {
  assertV3UIContext(isCurrent);
  const allowed = await authorize();
  assertV3UIContext(isCurrent);
  return allowed;
};

/** Serializes async candidate mutations and rejects work from a retired UI context. */
export class V3OperationalUIQueue {
  private pending: Promise<unknown> = Promise.resolve();

  run<T>(isCurrent: () => boolean, operation: () => Promise<T>): Promise<T> {
    const task = this.pending.then(async () => {
      if (!isCurrent()) throw new Error('SYNC_V3_UI_CONTEXT_CHANGED');
      const result = await operation();
      if (!isCurrent()) throw new Error('SYNC_V3_UI_CONTEXT_CHANGED');
      return result;
    });
    this.pending = task.catch(() => undefined);
    return task;
  }
}
