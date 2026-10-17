import {captureNewV3FiscalSourceMetadata} from './NewV3FiscalSourceMetadata';
export type {V3FinancialOptions} from '../db/LargeMasterSyncV3FinancialRetention';
import { planReservationCommitmentRelease } from './LargeMasterSyncV3ReservationCommitments';
import { assertV3ReservationInvoice,assertV3ReservationLines,reservationClaimId,reservationInvoiceId } from './LargeMasterSyncV3ReservationAuthority';
import { planFinancialNumbers } from '../db/FinancialNumberReservation';
import { v3StockSource } from './LargeMasterSyncV3StockAuthority';
import { isVerifiedV3RetainedContext, type V3RetainedContext } from './LargeMasterSyncV3RetainedCheckout';
import { createUuid } from '../../utils/uuid';
import type { BusinessConfig, CartItem, Customer, InventoryLedgerEntry, Transaction, Wallet, Reservation } from '../../types';
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
import { financialIdentity,financialOperationIdentity,type V3FinancialOptions } from '../db/LargeMasterSyncV3FinancialRetention';

export const isV3FinancialDocument = (transaction: Partial<Transaction>): boolean =>
  (transaction.items || []).some(line => Boolean(line.v3SaleAuthority));

/** This path never reconstructs fiscal totals from legacy taxes or 18%. */
export const validateV3FrozenFiscalAmounts = (transaction: Partial<Transaction>, retained?: V3RetainedContext): void => {
  if (!isV3FinancialDocument(transaction)) return;
  const lines = transaction.items || [];
  const stamp = lines[0]?.v3SaleAuthority;
  if (!stamp || typeof stamp.taxIncluded !== 'boolean'
    || (transaction.isTaxIncluded !== undefined && transaction.isTaxIncluded !== stamp.taxIncluded)
    || !lines.every(line => line.v3SaleAuthority && (JSON.stringify(line.v3SaleAuthority) === JSON.stringify(stamp) || isVerifiedV3RetainedContext(retained)
      && line.v3SaleAuthority.binding === stamp.binding && line.v3SaleAuthority.warehouseId === stamp.warehouseId
      && line.v3SaleAuthority.tariffId === stamp.tariffId && line.v3SaleAuthority.taxIncluded === stamp.taxIncluded
      && JSON.stringify(v3StockSource(line.v3SaleAuthority)) === JSON.stringify(v3StockSource(stamp))
      && line.v3SaleAuthority.inventoryVersion === stamp.inventoryVersion && line.v3SaleAuthority.inventoryCursor === stamp.inventoryCursor))
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

type FinancialEntry = { transaction: Transaction; options?: V3FinancialOptions };
type FinancialResult = { transaction: Transaction; created: boolean };
const assertFinancialReplay=(stored:Transaction|null,transaction:Transaction,identity:string):void=>{
  if(!stored||financialIdentity(stored)!==financialIdentity(transaction)||stored.v3CommitFingerprint!==identity)
    throw new LargeMasterSyncV3Error('SYNC_V3_DUPLICATE_TRANSACTION_MISMATCH');
};
/** A committed receipt is checked with the same canonical identity as the financial writer, never by ID alone. */
export const readV3CommittedRefundReplay=async(transaction:Transaction,warehouseId:string,options:V3FinancialOptions):Promise<Transaction|null>=>{
  const [active,history]=await Promise.all([db.getDocument('transactions',transaction.id),db.getDocument('transactionHistory',transaction.id)]) as [Transaction|null,Transaction|null];
  if(!active&&!history)return null;
  const session=await getLargeMasterSyncV3OperationalSession();await session.assertCurrent();
  const identity=financialOperationIdentity(transaction,warehouseId,options);
  if(!options.refund||!history||!active&&!history.zReportId||history.v3Binding!==session.binding||active&&active.v3Binding!==session.binding)
    throw new LargeMasterSyncV3Error('SYNC_V3_DUPLICATE_TRANSACTION_MISMATCH');
  assertFinancialReplay(history,transaction,identity);if(active)assertFinancialReplay(active,transaction,identity);
  return history.zReportId?history:active!;
};
const commits = new Map<string, { identity: string; promise: Promise<FinancialResult[]> }>();

/** Prepare every document before one native transaction; no split publication can precede its companion. */
export const persistV3FinancialBatch = (entries: FinancialEntry[], config: BusinessConfig, warehouseId: string): Promise<FinancialResult[]> => {
  if (!entries.length || new Set(entries.map(entry => entry.transaction.id)).size !== entries.length) {
    return Promise.reject(new LargeMasterSyncV3Error('SYNC_V3_DUPLICATE_TRANSACTION_MISMATCH'));
  }
  const identities = entries.map(({transaction,options={}})=>financialOperationIdentity(transaction,warehouseId,options));
  const identity = JSON.stringify([entries.map(entry => entry.transaction.id), identities]);
  const pending = entries.map(entry => commits.get(entry.transaction.id)).find(Boolean);
  if (pending) return pending.identity === identity ? pending.promise
    : Promise.reject(new LargeMasterSyncV3Error('SYNC_V3_DUPLICATE_TRANSACTION_MISMATCH'));
  const commit = (async (): Promise<FinancialResult[]> => {
    const session = await getLargeMasterSyncV3OperationalSession();
    await session.assertCurrent();
    const existing = await Promise.all(entries.map(entry => db.getDocument('transactions', entry.transaction.id) as Promise<Transaction | null>));
    if (existing.some(Boolean)) {
      existing.forEach((stored,index)=>assertFinancialReplay(stored,entries[index].transaction,identities[index]));
      return existing.map(transaction => ({ transaction: transaction!, created: false }));
    }
    for (const { transaction } of entries) {
      await db.assertFiscalTransactionAuthority(transaction,
        config.terminals?.find(terminal => terminal.id === transaction.terminalId || terminal.config?.erpTerminalId === transaction.terminalId)?.config);
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
    let { transaction, options = {} } = entries[index];
    const stamp = transaction.items[0]?.v3SaleAuthority;
    const authoritativeLines: CartItem[] = [];
    const retained = await session.validate(projected, transaction.items, stamp?.tariffId || '', warehouseId,
      options.refund ? 'REFUND' : 'SALE', (line, source) => {
        authoritativeLines.push({ ...line, type: source.type, isInventoriable: source.isInventoriable,
          taxable: source.taxable, appliedTaxIds: [...(source.appliedTaxIds || [])],
          v3SaleAuthority: { ...line.v3SaleAuthority! } });
      }, { ticketId: transaction.restaurantOrderId, tableId: transaction.restaurantTableId, claimId: transaction.v3RestoredTicketId,
        originalTransactionId: options.expectedOriginal?.id || transaction.originalTransactionId, reservationId: transaction.v3ReservationClaimId ? transaction.reservationId : undefined, reservationClaimId:transaction.v3ReservationClaimId });
    if (!options.refund && retained && retained.collection !== 'transactions' && retained.collection !== 'transactionHistory') {
      documents.push({ collectionName: 'v3TicketSettlements', document: { id: retained.id, transactionId: transaction.id, binding: session.binding },
        requireAbsent: true, v3ExpectedRetainedDocument: { collection: retained.collection, id: retained.id, expected: retained.expected } });
    }
    if (retained?.collection === 'v3RestoredTicketSources') {
      documents.push({ collectionName: retained.collection, document: { ...JSON.parse(retained.expected), state: 'SETTLED' },
        expectedDocument: retained.expected, v3ExpectedRetainedDocument: { collection: retained.collection, id: retained.id, expected: retained.expected } });
    }
    if (transaction.v3ReservationClaimId) {
      const reservation = retained?.reservation;
      if (!reservation || retained.collection !== 'v3RestoredTicketSources') throw new LargeMasterSyncV3Error('SYNC_V3_RESERVATION_SOURCE_REQUIRED');
      assertV3ReservationInvoice(reservation,transaction);
      const claim = JSON.parse(retained.expected);
      if (claim.invoiceDate !== transaction.date || !claim.saleEventId || !claim.paymentEventId) throw new LargeMasterSyncV3Error('SYNC_V3_RESERVATION_SOURCE_CHANGED');
      documents.push({collectionName:'reservations',document:{...reservation,status:'INVOICED',invoicedTransactionId:transaction.id,
        invoicedAt:transaction.date,updatedAt:transaction.date},expectedDocument:JSON.stringify(reservation),
        v3ExpectedRetainedDocument:{collection:retained.collection,id:retained.id,expected:retained.expected}});
      documents.push(...await planReservationCommitmentRelease(reservation,(collection,id)=>db.getDocument(collection as any,id),transaction.date));
      const series = await db.getDocument('internalSequences',transaction.seriesId!) as any;
      const counter = await db.getDocument('globalSequenceCounter' as any,'value') as any;
      const issuance = planFinancialNumbers({seriesId:transaction.seriesId,documentType:transaction.documentType,global:true},series,counter);
      transaction = {...transaction,globalSequence:issuance.result.globalSequence,displayId:issuance.result.displayId,seriesNumber:issuance.result.seriesNumber};
      documents.push({collectionName:'internalSequences',document:issuance.series!,expectedDocument:JSON.stringify(series)},
        {collectionName:'globalSequenceCounter',document:issuance.counter!,...(counter ? {expectedDocument:JSON.stringify(counter)} : {requireAbsent:true})});
    }
    validateV3FrozenFiscalAmounts(transaction, retained);
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
        ...(retained ? { v3ExpectedRetainedDocument: { collection: retained.collection, id: retained.id, expected: retained.expected } } : {}),
        v3StockRequirements: await session.stockRequirements(projected, transaction.items, warehouseId, options.refund ? 'REFUND' : 'SALE') },
      { collectionName: 'transactionHistory', document: document as any, requireAbsent: true,
        ...(retained ? { v3ExpectedRetainedDocument: { collection: retained.collection, id: retained.id, expected: retained.expected } } : {}) },
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
      const originalMutations = buildV3RefundOriginalMutations(options.expectedOriginal, options.original,
        transaction.id, options.expectedOriginalHistory || null, options.originalCollection);
      for (const mutation of originalMutations) if (mutation.document.v3InventoryBaseline) {
        mutation.v3ExpectedRetainedDocument = {collection:options.originalCollection || 'transactions',id:options.expectedOriginal.id,expected:JSON.stringify(options.expectedOriginal)};
      }
      documents.push(...originalMutations);
    }
    if (isSyncFeatureEnabled('sqlite_outbox_v2') && !options.refund) {
      const fiscalSourceMetadata = captureNewV3FiscalSourceMetadata(document,projected,session.binding,{refund:options.refund,retained:Boolean(retained)});
      const paymentIntentIds = (document.payments || []).map((payment: any) => payment.paymentIntentId).filter(Boolean);
      const claim = retained?.reservation ? JSON.parse(retained.expected) : undefined;
      // ADVANCE records a prior application in SALE_POSTED; PAYMENT_POSTED represents only newly received settlement.
      const newPayments = claim ? document.payments.filter(payment=>payment.method !== 'ADVANCE') : document.payments;
      const paymentPosted = buildPaymentPostedPayload(claim ? {...document,payments:newPayments,
        settlementAppliedBase:newPayments.reduce((sum,payment)=>sum+Number(payment.amountApplied ?? payment.appliedAmount ?? payment.amount),0)} : document, { ...fiscalSourceMetadata, paymentIntentIds });
      events.push({ eventId: claim?.saleEventId || createUuid(), eventType: 'SALE_POSTED', aggregateType: 'TRANSACTION',
          aggregateId: document.id, schemaVersion: 1,
          payload: buildSalePostedPayload(document, { ...fiscalSourceMetadata, inventoryMovementIds: ledger.map(row => row.id), paymentIntentIds }), createdAt: document.date });
      if (paymentPosted) events.push({ eventId: claim?.paymentEventId || createUuid(), eventType: 'PAYMENT_POSTED',
          aggregateType: 'TRANSACTION', aggregateId: document.id, schemaVersion: 1, payload: paymentPosted, createdAt: document.date });
      intentIds.push(...paymentIntentIds);
    }
    results.push({ transaction: document, created: true });
    }
    for (const mutation of documents) {
      if (mutation.document.v3InventoryBaseline) mutation.v3CurrentCatalog = { ...session.ready.runtime.version, binding: session.binding };
    }
    await session.assertCurrent();
    for (const { transaction } of entries) {
      await db.assertFiscalTransactionAuthority(transaction,
        config.terminals?.find(terminal => terminal.id === transaction.terminalId || terminal.config?.erpTerminalId === transaction.terminalId)?.config);
    }
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


/** Read a completed operation only with its entire original source/claim/history/settlement proof.
 * This is receipt recovery, never permission to post an inactive reservation again. */
export async function readV3CompletedReservation(input: {
  reservationId: string; claimId: string; expectedSource?: Reservation; lines?: CartItem[]; customerId?: string; candidate?: Transaction;
}): Promise<Transaction | null> {
  const session = await getLargeMasterSyncV3OperationalSession(); await session.assertCurrent();
  if (input.claimId !== reservationClaimId(input.reservationId)) throw new LargeMasterSyncV3Error('SYNC_V3_RESERVATION_SCOPE_CHANGED');
  const id = reservationInvoiceId(input.reservationId);
  const transaction = await db.getDocument('transactions',id) as Transaction | null;
  if (!transaction) return null;
  const [history,claim,reservation,settlement] = await Promise.all([
    db.getDocument('transactionHistory',id),db.getDocument('v3RestoredTicketSources' as any,input.claimId),
    db.getDocument('reservations',input.reservationId),db.getDocument('v3TicketSettlements' as any,input.claimId),
  ]) as [Transaction | null,any,Reservation | null,any];
  const fail = (): never => { throw new LargeMasterSyncV3Error('SYNC_V3_RESERVATION_COMPLETION_CONFLICT'); };
  if (!history || !claim || !reservation || !settlement || claim.state !== 'SETTLED' || claim.sourceCollection !== 'reservations'
    || claim.sourceId !== input.reservationId || claim.v3Binding !== session.binding || reservation.status !== 'INVOICED'
    || reservation.invoicedTransactionId !== id || settlement.transactionId !== id || settlement.binding !== session.binding
    || transaction.v3Binding !== session.binding || transaction.v3ReservationClaimId !== input.claimId
    || transaction.reservationId !== input.reservationId || transaction.date !== claim.invoiceDate
    || !transaction.v3CommitFingerprint || transaction.v3CommitFingerprint !== history.v3CommitFingerprint
    || !Number.isSafeInteger(transaction.globalSequence) || transaction.globalSequence! <= 0
    || !Number.isSafeInteger(transaction.seriesNumber) || transaction.seriesNumber! <= 0 || !transaction.displayId
    || JSON.stringify([transaction.globalSequence,transaction.seriesNumber,transaction.displayId,transaction.seriesId])
      !== JSON.stringify([history.globalSequence,history.seriesNumber,history.displayId,history.seriesId])) fail();
  let original: Reservation;
  try { original = JSON.parse(claim.sourceExpected); } catch { return fail(); }
  if (original.id !== input.reservationId || original.warehouseId !== transaction.v3WarehouseId
    || input.expectedSource && JSON.stringify(input.expectedSource) !== claim.sourceExpected
    || input.customerId && input.customerId !== original.customerId) fail();
  const expectedDisposition = {...original,status:'INVOICED',invoicedTransactionId:id,invoicedAt:transaction.date,updatedAt:transaction.date};
  if (JSON.stringify(reservation) !== JSON.stringify(expectedDisposition)) fail();
  assertV3ReservationInvoice(original,transaction,Date.parse(transaction.date));
  if (input.lines) assertV3ReservationLines(original,input.lines);
  const expectedFingerprint = JSON.stringify([financialIdentity(transaction),transaction.v3WarehouseId,false,[],false,false,null]);
  if (expectedFingerprint !== transaction.v3CommitFingerprint || financialIdentity(transaction) !== financialIdentity(history)
    || input.candidate && financialIdentity(transaction) !== financialIdentity(input.candidate)) fail();
  await session.assertCurrent();
  return transaction;
}
