import type { BusinessConfig, CartItem, Customer, InventoryLedgerEntry, Transaction, Wallet } from '../../types';
import type { DurableDocumentMutation, DurableOutboxEventInput } from '../db/DatabaseAdapter';
import { dbAdapter } from '../db';
import { db } from '../../utils/db';
import { durableOutboxRepository } from './DurableOutboxRepository';
import { isSyncFeatureEnabled } from './SyncFeatureFlags';
import { buildSalePostedPayload, buildPaymentPostedPayload } from './SalePostedContract';
import { getLargeMasterSyncV3OperationalSession, v3InventoryBaselineKey } from './LargeMasterSyncV3OperationalSession';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';
import { buildV3RefundOriginalMutations } from './LargeMasterSyncV3RefundAuthority';
import { validateV3FrozenLineFiscalAmounts } from './LargeMasterSyncV3LineSource';
import { V3_FINANCIAL_MUTABLE_FIELDS } from '../db/LargeMasterSyncV3FinancialRetention';

export const isV3FinancialDocument = (transaction: Partial<Transaction>): boolean =>
  (transaction.items || []).some(line => Boolean(line.v3SaleAuthority));

/** This path never reconstructs fiscal totals from legacy taxes or 18%. */
export const validateV3FrozenFiscalAmounts = (transaction: Partial<Transaction>): void => {
  if (!isV3FinancialDocument(transaction)) return;
  const lines = transaction.items || [];
  const stamp = lines[0]?.v3SaleAuthority;
  if (!stamp || typeof stamp.taxIncluded !== 'boolean'
    || (transaction.isTaxIncluded !== undefined && transaction.isTaxIncluded !== stamp.taxIncluded)
    || !lines.every(line => line.v3SaleAuthority && JSON.stringify(line.v3SaleAuthority) === JSON.stringify(stamp))
    || ![transaction.netAmount, transaction.taxAmount, transaction.total].every(value => typeof value === 'number' && Number.isFinite(value))
    || Number(transaction.netAmount) < 0 || Number(transaction.taxAmount) < 0
    || Math.abs(Number(transaction.netAmount) + Number(transaction.taxAmount) - Math.abs(Number(transaction.total))) > 0.02) {
    throw new LargeMasterSyncV3Error('SYNC_V3_FROZEN_FISCAL_INVALID');
  }
};

export const buildV3InventoryLedger = (transaction: Transaction, warehouseId: string, binding: string,
  refund = false, conditions?: Map<string, 'SELLABLE' | 'DAMAGED'>): InventoryLedgerEntry[] => {
  const seen = new Set<string>();
  return transaction.items.flatMap(line => {
    if (!line.cartId || seen.has(line.cartId) || !line.v3SaleAuthority
      || line.v3SaleAuthority.binding !== binding || line.v3SaleAuthority.warehouseId !== warehouseId) {
      throw new LargeMasterSyncV3Error('SYNC_V3_MOVEMENT_AUTHORITY_INVALID');
    }
    seen.add(line.cartId);
    if (line.type === 'SERVICE' || line.isInventoriable !== true) return [];
    if (line.type !== 'PRODUCT' || line.trackingData?.length || line.recipeDetails?.length) {
      throw new LargeMasterSyncV3Error('SYNC_V3_ADVANCED_ARTICLE_CONTRACT_REQUIRED');
    }
    const quantity = Math.abs(line.quantity);
    if (!Number.isFinite(quantity) || quantity === 0) throw new LargeMasterSyncV3Error('SYNC_V3_LINE_INVALID');
    if (refund && conditions?.get(line.cartId) === 'DAMAGED') return [];
    return [{ id: `V3-${transaction.id}-${encodeURIComponent(line.cartId)}`,
      createdAt: transaction.date, warehouseId, productId: line.id,
      concept: refund ? 'DEVOLUCIÓN_VENTA' : 'VENTA', documentRef: transaction.id,
      qtyIn: refund ? quantity : 0, qtyOut: refund ? 0 : quantity,
      unitCost: line.cost || 0, balanceQty: 0, balanceAvgCost: line.cost || 0,
      terminalId: transaction.terminalId, variantId: line.variantId || line.variantSku,
      syncStatus: 'PENDING', v3Binding: binding,
      v3InventoryBaseline: v3InventoryBaselineKey(binding, line.v3SaleAuthority) }];
  });
};

const financialIdentity = (transaction: Transaction): string => {
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort()
      .filter(key => ![...V3_FINANCIAL_MUTABLE_FIELDS, 'relatedTransactions', 'syncStatus', 'syncError', 'cloudSyncStatus', 'cloudSyncError', 'cloudSyncedAt',
        'updatedAt', 'status', 'v3InventoryBaseline', 'v3Binding', 'v3WarehouseId', 'v3CommitFingerprint', 'fiscalStatus',
        'fiscalResponseMessage', 'fiscalResponseCode', 'fiscalSignedXml', 'fiscalQrCode'].includes(key))
      .map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(transaction));
};

export type V3FinancialOptions = { refund?: boolean; conditions?: Map<string, 'SELLABLE' | 'DAMAGED'>; original?: Transaction;
    expectedOriginal?: Transaction; expectedOriginalHistory?: Transaction | null;
    adjustCustomerBalance?: boolean; skipWalletDeposit?: boolean };
type FinancialEntry = { transaction: Transaction; options?: V3FinancialOptions };
type FinancialResult = { transaction: Transaction; created: boolean };
const commits = new Map<string, { identity: string; promise: Promise<FinancialResult[]> }>();

/** Prepare every document before one native transaction; no split publication can precede its companion. */
export const persistV3FinancialBatch = (entries: FinancialEntry[], config: BusinessConfig, warehouseId: string): Promise<FinancialResult[]> => {
  if (!entries.length || new Set(entries.map(entry => entry.transaction.id)).size !== entries.length) {
    return Promise.reject(new LargeMasterSyncV3Error('SYNC_V3_DUPLICATE_TRANSACTION_MISMATCH'));
  }
  const identities = entries.map(({ transaction, options = {} }) => JSON.stringify([financialIdentity(transaction), warehouseId, options.refund === true,
    [...(options.conditions || new Map()).entries()].sort(), options.adjustCustomerBalance === true, options.skipWalletDeposit === true,
    options.original ? financialIdentity(options.original) : null]));
  const identity = JSON.stringify([entries.map(entry => entry.transaction.id), identities]);
  const pending = entries.map(entry => commits.get(entry.transaction.id)).find(Boolean);
  if (pending) return pending.identity === identity ? pending.promise
    : Promise.reject(new LargeMasterSyncV3Error('SYNC_V3_DUPLICATE_TRANSACTION_MISMATCH'));
  const commit = (async (): Promise<FinancialResult[]> => {
    const session = await getLargeMasterSyncV3OperationalSession();
    await session.assertCurrent();
    const existing = await Promise.all(entries.map(entry => db.getDocument('transactions', entry.transaction.id) as Promise<Transaction | null>));
    if (existing.some(Boolean)) {
      if (existing.some((stored, index) => !stored || financialIdentity(stored) !== financialIdentity(entries[index].transaction)
        || stored.v3CommitFingerprint !== identities[index])) throw new LargeMasterSyncV3Error('SYNC_V3_DUPLICATE_TRANSACTION_MISMATCH');
      return existing.map(transaction => ({ transaction: transaction!, created: false }));
    }
    const projected = await session.projectConfig(config);
    const documents: DurableDocumentMutation[] = [];
    const events: DurableOutboxEventInput[] = [];
    const intentIds: string[] = [];
    const results: FinancialResult[] = [];
    const stagedCustomers = new Map<string, Customer>();
    const stagedWallets = new Map<string, Wallet>();
    const mergeMutation = (mutation: DurableDocumentMutation) => {
      const previous = documents.find(row => row.collectionName === mutation.collectionName && row.document.id === mutation.document.id);
      if (previous) previous.document = mutation.document;
      else documents.push(mutation);
    };
    for (let index = 0; index < entries.length; index++) {
    const { transaction, options = {} } = entries[index];
    const stamp = transaction.items[0]?.v3SaleAuthority;
    const authoritativeLines: CartItem[] = [];
    await session.validate(projected, transaction.items, stamp?.tariffId || '', warehouseId,
      options.refund ? 'REFUND' : 'SALE', (line, source) => {
        authoritativeLines.push({ ...line, type: source.type, isInventoriable: source.isInventoriable,
          taxable: source.taxable, appliedTaxIds: [...(source.appliedTaxIds || [])],
          v3SaleAuthority: { ...line.v3SaleAuthority! } });
      });
    validateV3FrozenFiscalAmounts(transaction);
    validateV3FrozenLineFiscalAmounts(transaction, projected);
    if (authoritativeLines.length !== transaction.items.length) throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_SOURCE_CHANGED');
    const ledger = buildV3InventoryLedger({ ...transaction, items: authoritativeLines }, warehouseId, session.binding, options.refund, options.conditions);
    const document: Transaction = { ...transaction, items: authoritativeLines, syncStatus: 'PENDING', v3Binding: session.binding,
      v3WarehouseId: warehouseId, v3CommitFingerprint: identities[index],
      v3InventoryBaseline: v3InventoryBaselineKey(session.binding, stamp!) };
    let customerUpdate: Customer | null = null;
    let customerBefore: Customer | null = null;
    let walletDelta = options.refund ? Number(document.walletDepositAmount || 0) : -Number(document.walletPaymentAmount || 0);
    const debtAddition = !options.refund ? Number(document.pendingBalance || 0) : 0;
    if (document.customerId && (debtAddition || walletDelta || options.adjustCustomerBalance)) {
      const customer = stagedCustomers.get(document.customerId)
        || await db.getDocument('customers', document.customerId) as Customer | null;
      if (!customer) throw new LargeMasterSyncV3Error('SYNC_V3_CREDIT_CUSTOMER_REQUIRED');
      customerBefore = customer;
      const reduction = options.adjustCustomerBalance && options.original?.pendingBalance
        ? Math.min(customer.currentDebt || 0, document.total) : 0;
      if (options.adjustCustomerBalance && !options.skipWalletDeposit) walletDelta += document.total - reduction;
      customerUpdate = { ...customer, currentDebt: Math.round(((customer.currentDebt || 0) + debtAddition - reduction) * 100) / 100 };
    }
    documents.push(
      { collectionName: 'transactions', document: document as any, requireAbsent: true,
        v3StockRequirements: await session.stockRequirements(projected, transaction.items, warehouseId, options.refund ? 'REFUND' : 'SALE') },
      { collectionName: 'transactionHistory', document: document as any, requireAbsent: true },
      ...ledger.map(document => ({ collectionName: 'inventoryLedger', document, requireAbsent: true })),
    );
    if (walletDelta) {
      if (!document.customerId || !customerBefore) throw new LargeMasterSyncV3Error('SYNC_V3_WALLET_CUSTOMER_REQUIRED');
      const wallets = await db.get('wallets' as any) as Wallet[] || [];
      const before = stagedWallets.get(document.customerId) || wallets.find(row => row.customerId === document.customerId);
      const wallet: Wallet = before ? { ...before } : { id: `WLT-${document.customerId}`, customerId: document.customerId,
        balance: 0, currency: 'DOP', status: 'ACTIVE', lastActivity: document.date, transactions: [] };
      if (wallet.status !== 'ACTIVE' || wallet.balance + walletDelta < -0.01) throw new LargeMasterSyncV3Error('SYNC_V3_WALLET_BALANCE_INVALID');
      wallet.balance = Math.round((wallet.balance + walletDelta) * 100) / 100;
      wallet.lastActivity = document.date;
      mergeMutation({ collectionName: 'wallets', document: wallet, requireAbsent: !before,
        ...(before ? { expectedDocument: JSON.stringify(before) } : {}) });
      stagedWallets.set(document.customerId, wallet);
      documents.push({ collectionName: 'wallet_transactions', requireAbsent: true,
        document: { id: `V3-WALLET-${document.id}`, walletId: wallet.id, type: walletDelta > 0 ? 'DEPOSIT' : 'PAYMENT',
          amount: walletDelta, referenceId: document.displayId || document.id, timestamp: document.date,
          createdAt: document.date, terminalId: document.terminalId, operationalChannel: 'WALLET', syncStatus: 'PENDING' } });
      if (customerUpdate) customerUpdate.wallet = wallet;
    }
    if (customerUpdate) {
      mergeMutation({ collectionName: 'customers', document: customerUpdate, expectedDocument: JSON.stringify(customerBefore) });
      stagedCustomers.set(customerUpdate.id, customerUpdate);
    }
    if (options.original) {
      if (!options.expectedOriginal) {
        throw new LargeMasterSyncV3Error('SYNC_V3_REFUND_ORIGINAL_CHANGED');
      }
      documents.push(...buildV3RefundOriginalMutations(options.expectedOriginal, options.original,
        transaction.id, options.expectedOriginalHistory || null));
    }
    if (isSyncFeatureEnabled('sqlite_outbox_v2') && !options.refund) {
      const paymentIntentIds = (document.payments || []).map((payment: any) => payment.paymentIntentId).filter(Boolean);
      const paymentPosted = buildPaymentPostedPayload(document, { paymentIntentIds });
      events.push({ eventId: crypto.randomUUID(), eventType: 'SALE_POSTED', aggregateType: 'TRANSACTION',
          aggregateId: document.id, schemaVersion: 1,
          payload: buildSalePostedPayload(document, { inventoryMovementIds: ledger.map(row => row.id), paymentIntentIds }), createdAt: document.date });
      if (paymentPosted) events.push({ eventId: crypto.randomUUID(), eventType: 'PAYMENT_POSTED',
          aggregateType: 'TRANSACTION', aggregateId: document.id, schemaVersion: 1, payload: paymentPosted, createdAt: document.date });
      intentIds.push(...paymentIntentIds);
    }
    results.push({ transaction: document, created: true });
    }
    await session.assertCurrent();
    if (events.length) {
      await durableOutboxRepository.commitFinancialTransaction({ documents, outboxEvent: events[0],
        additionalOutboxEvents: events.slice(1), paymentIntentIds: intentIds });
    } else {
      if (!dbAdapter.saveDocumentsAtomically) throw new LargeMasterSyncV3Error('SYNC_V3_ATOMIC_COMMIT_REQUIRED');
      await dbAdapter.saveDocumentsAtomically(documents);
    }
    window.dispatchEvent(new CustomEvent('v3InventoryUpdated'));
    return results;
  })();
  for (const entry of entries) commits.set(entry.transaction.id, { identity, promise: commit });
  void commit.finally(() => { for (const entry of entries) commits.delete(entry.transaction.id); }).catch(() => undefined);
  return commit;
};

export const persistV3FinancialTransaction = async (transaction: Transaction, config: BusinessConfig, warehouseId: string,
  options: V3FinancialOptions = {}): Promise<FinancialResult> =>
  (await persistV3FinancialBatch([{ transaction, options }], config, warehouseId))[0];
