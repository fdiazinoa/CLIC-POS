import {hasOfflineFiscalHeader} from '../fiscal/OfflineFiscalCharge';
import {captureTrackingSourceMetadata} from '../tracking/TrackingSourceMetadata';
import {isOfflineTableFiscalTransaction,assertTableFiscalSaleContext} from '../fiscal/OfflineTableFiscalCheckout';
import {presentationInventoryQuantity} from '../inventoryPresentations/selection';
import {calculateInventoryDeductions} from '../../utils/inventoryEngine';
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
import { getLargeMasterSyncV3OperationalSession, getLargeMasterSyncV3RetainedSession, v3InventoryBaselineKey } from './LargeMasterSyncV3OperationalSession';
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
    || Math.abs(Number(transaction.netAmount) + Number(transaction.taxAmount) + (hasOfflineFiscalHeader(transaction)?Number(transaction.serviceChargeAmount||0):0) - Math.abs(Number(transaction.total))) > 0.02) {
    throw new LargeMasterSyncV3Error('SYNC_V3_FROZEN_FISCAL_INVALID');
  }
};

const resolveRecipeClosure = async (line: CartItem, resolveArticle: (id: string) => Promise<Record<string, unknown> | null>): Promise<Record<string, unknown>[]> => {
  const products: Record<string, unknown>[] = [];
  const visited = new Set<string>();
  const queue: string[] = (line.recipeDetails || []).map(detail => detail.childItemId).filter(Boolean);
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const article = await resolveArticle(id);
    if (!article) throw new LargeMasterSyncV3Error('SYNC_V3_RECIPE_CHILD_MISSING');
    products.push(article);
    for (const detail of (article.recipeDetails as { childItemId?: string }[]) || []) if (detail.childItemId) queue.push(detail.childItemId);
  }
  return products;
};

export const buildV3InventoryLedger = async (transaction: Transaction, warehouseId: string, binding: string,
  refund = false, conditions?: Map<string, 'SELLABLE' | 'DAMAGED'>,
  resolveArticle?: (id: string) => Promise<Record<string, unknown> | null>): Promise<InventoryLedgerEntry[]> => {
  const seen = new Set<string>();
  const entries: InventoryLedgerEntry[] = [];
  for (const line of transaction.items) {
    if (!line.cartId || seen.has(line.cartId) || !line.v3SaleAuthority
      || line.v3SaleAuthority.binding !== binding || line.v3SaleAuthority.warehouseId !== warehouseId) {
      throw new LargeMasterSyncV3Error('SYNC_V3_MOVEMENT_AUTHORITY_INVALID');
    }
    seen.add(line.cartId);
    if (line.type === 'SERVICE' || line.isInventoriable !== true) continue;
    const quantity = Math.abs(presentationInventoryQuantity(line));
    if (!Number.isFinite(quantity) || quantity === 0) throw new LargeMasterSyncV3Error('SYNC_V3_LINE_INVALID');
    if (refund && conditions?.get(line.cartId) === 'DAMAGED') continue;
    let deductionRows: { productId: string; quantity: number; unitCost: number }[];
    if (line.recipeDetails?.length) {
      if (!resolveArticle) throw new LargeMasterSyncV3Error('SYNC_V3_RECIPE_RESOLVER_REQUIRED');
      const closure = await resolveRecipeClosure(line, resolveArticle);
      const allProducts = [line as unknown as Record<string, unknown>, ...closure];
      const deductions = calculateInventoryDeductions(line, quantity, allProducts as any);
      deductionRows = deductions.map(d => {
        const product = allProducts.find(p => p.id === d.productId) as any;
        return { productId: d.productId, quantity: d.quantityToDeduct, unitCost: product?.cost || 0 };
      });
    } else {
      deductionRows = [{ productId: line.id, quantity, unitCost: line.cost || 0 }];
    }
    if (line.recipeDetails?.length) {
      (line as any).v3InventoryConsumption = { schemaVersion: 1, mode: 'COMPONENTS',
        source: { syncId: line.v3SaleAuthority!.syncId, syncVersion: line.v3SaleAuthority!.syncVersion },
        entries: deductionRows.map(row => ({ productId: row.productId, quantity: row.quantity, unitCost: row.unitCost })) };
    }
    for (const row of deductionRows) {
      const isDirect = row.productId === line.id;
      entries.push({ id: isDirect ? `V3-${transaction.id}-${encodeURIComponent(line.cartId)}` : `V3-${transaction.id}-${encodeURIComponent(line.cartId)}-${encodeURIComponent(row.productId)}`,
        createdAt: transaction.date, warehouseId, productId: row.productId,
        ...(transaction.trackingCheckoutId && isDirect ? { trackingCheckoutId: transaction.trackingCheckoutId } : {}),
        concept: refund ? 'DEVOLUCIÓN_VENTA' : 'VENTA', documentRef: transaction.id,
        qtyIn: refund ? row.quantity : 0, qtyOut: refund ? 0 : row.quantity,
        unitCost: row.unitCost, balanceQty: 0, balanceAvgCost: row.unitCost,
        terminalId: transaction.terminalId, variantId: isDirect ? (line.variantId || line.variantSku) : undefined,
        syncStatus: 'PENDING', v3Binding: binding,
        v3InventoryBaseline: v3InventoryBaselineKey(binding, line.v3SaleAuthority) });
    }
  }
  return entries;
};

type FinancialEntry = { transaction: Transaction; options?: V3FinancialOptions };
type FinancialResult = { transaction: Transaction; created: boolean };
const allocationDraftIdentity=(transaction:Transaction,warehouseId:string,options:V3FinancialOptions)=>financialOperationIdentity(transaction.fiscalAllocationAuthorizationId?{...transaction,globalSequence:undefined,displayId:undefined,seriesNumber:undefined}:transaction,warehouseId,options);
const assertFinancialReplay=(stored:Transaction|null,transaction:Transaction,identity:string,warehouseId?:string,options:V3FinancialOptions={}):void=>{
  if(transaction.fiscalAllocationAuthorizationId&&stored&&(['globalSequence','displayId','seriesNumber'] as const).some(key=>transaction[key]!==undefined&&transaction[key]!==stored[key]))throw new LargeMasterSyncV3Error('SYNC_V3_DUPLICATE_TRANSACTION_MISMATCH');
  if(!stored||(transaction.fiscalAllocationAuthorizationId?financialIdentity({...stored,globalSequence:undefined,displayId:undefined,seriesNumber:undefined})!==financialIdentity({...transaction,globalSequence:undefined,displayId:undefined,seriesNumber:undefined}):financialIdentity(stored)!==financialIdentity(transaction))||stored.v3CommitFingerprint!==(transaction.fiscalAllocationAuthorizationId&&warehouseId?financialOperationIdentity(stored,warehouseId,options):identity))
    throw new LargeMasterSyncV3Error('SYNC_V3_DUPLICATE_TRANSACTION_MISMATCH');
};
/** A committed receipt is checked with the same canonical identity as the financial writer, never by ID alone. */
export const readV3CommittedRefundReplay=async(transaction:Transaction,warehouseId:string,options:V3FinancialOptions):Promise<Transaction|null>=>{
  const [active,history]=await Promise.all([db.getDocument('transactions',transaction.id),db.getDocument('transactionHistory',transaction.id)]) as [Transaction|null,Transaction|null];
  if(!active&&!history)return null;
  const session=await getLargeMasterSyncV3RetainedSession();await session.assertCurrent();
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
  const identities = entries.map(({transaction,options={}})=>allocationDraftIdentity(transaction,warehouseId,options));
  const identity = JSON.stringify([entries.map(entry => entry.transaction.id), identities,entries.map(({transaction})=>transaction.fiscalAllocationAuthorizationId?[transaction.globalSequence,transaction.displayId,transaction.seriesNumber]:null)]);
  const pending = entries.map(entry => commits.get(entry.transaction.id)).find(Boolean);
  if (pending) return pending.identity === identity ? pending.promise
    : Promise.reject(new LargeMasterSyncV3Error('SYNC_V3_DUPLICATE_TRANSACTION_MISMATCH'));
  const commit = (async (): Promise<FinancialResult[]> => {
    // A pure reversal batch posts against the documents it reverses, so it must never negotiate a
    // master; any batch that also contains a sale keeps the live-catalog authority.
    const reversalOnly = entries.every(entry => entry.options?.refund === true);
    const session = await (reversalOnly ? getLargeMasterSyncV3RetainedSession() : getLargeMasterSyncV3OperationalSession());
    await session.assertCurrent();
    const existing = await Promise.all(entries.map(entry => db.getDocument('transactions', entry.transaction.id) as Promise<Transaction | null>));
    if (existing.some(Boolean)) {
      existing.forEach((stored,index)=>assertFinancialReplay(stored,entries[index].transaction,identities[index],warehouseId,entries[index].options||{}));
      for(const stored of existing)if(stored?.fiscalAllocationAuthorizationId)await db.assertFiscalTransactionAuthority(stored);
      return existing.map(transaction => ({ transaction: transaction!, created: false }));
    }
    for (const { transaction } of entries) {
      session.assertFinancialOfflineAuthority?.(transaction);
      await db.assertFiscalTransactionAuthority(transaction,
        config.terminals?.find(terminal => terminal.id === transaction.terminalId || terminal.config?.erpTerminalId === transaction.terminalId)?.config);
    }
    const projected = await session.projectConfig(config);
    const documents: DurableDocumentMutation[] = [];
    const events: DurableOutboxEventInput[] = [];
    const intentIds: string[] = [];
    const fiscalAllocationPreconditions:NonNullable<import('../db/DatabaseAdapter').FinancialCommitInput['fiscalAllocationPreconditions']>=[];
    const trackingCommits:NonNullable<import('../db/DatabaseAdapter').FinancialCommitInput['trackingCommits']>=[];
    const fiscalWorkflowCommits: NonNullable<import('../db/DatabaseAdapter').FinancialCommitInput['fiscalWorkflowCommits']> = [];
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
    const trackingSelections=transaction.items.flatMap(line=>line.trackingData||[]);
    if(trackingSelections.length){if(!transaction.trackingCheckoutId||options.refund)throw Error('TRACKING_CHECKOUT_SOURCE_REQUIRED');trackingCommits.push({checkoutId:transaction.trackingCheckoutId,transactionId:transaction.id,selections:trackingSelections});}
    if(transaction.fiscalAllocationAuthorizationId){
      if(entries.length!==1||!transaction.fiscalWorkflowCheckoutId||!dbAdapter.fiscalWorkflowStore?.allocationCommitPreconditions)throw Error('OFFLINE_FISCAL_NATIVE_REQUIRED');
      const checkout=await dbAdapter.fiscalWorkflowStore.readCheckout(transaction.fiscalWorkflowCheckoutId);if(!checkout?.allocation)throw Error('OFFLINE_FISCAL_ALLOCATION_REQUIRED');
      fiscalAllocationPreconditions.push(...await dbAdapter.fiscalWorkflowStore.allocationCommitPreconditions(checkout));
      if(!options.refund){
        const series=await db.getDocument('internalSequences',transaction.seriesId!) as any,counter=await db.getDocument('globalSequenceCounter' as any,'value') as any;
        const planned=planFinancialNumbers({seriesId:transaction.seriesId,documentType:transaction.documentType,global:true},series,counter);
        transaction={...transaction,globalSequence:planned.result.globalSequence,displayId:planned.result.displayId,seriesNumber:planned.result.seriesNumber};
        documents.push({collectionName:'internalSequences',document:planned.series!,expectedDocument:JSON.stringify(series)},{collectionName:'globalSequenceCounter',document:planned.counter!,...(counter?{expectedDocument:JSON.stringify(counter)}:{requireAbsent:true})});
      }
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
    const ledger = await buildV3InventoryLedger({ ...transaction, items: authoritativeLines }, warehouseId, session.binding, options.refund, options.conditions, session.ready.runtime?.getOperationalArticle?.bind(session.ready.runtime));
    const document: Transaction = { ...transaction, items: authoritativeLines, syncStatus: 'PENDING', v3Binding: session.binding,
      v3WarehouseId: warehouseId, v3CommitFingerprint: identities[index],
      v3InventoryBaseline: v3InventoryBaselineKey(session.binding, stamp!) };
    // Draft identity coordinates retries before numbering. The immutable source fingerprint
    // covers the final numbered/validated document written with receipt, history and Outbox.
    if(document.fiscalAllocationAuthorizationId)document.v3CommitFingerprint=financialOperationIdentity(document,warehouseId,options);
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
        ...(transaction.items.some(line=>line.inventoryPresentation!==undefined)?{inventoryPresentationPrecondition:await session.presentationProof(projected,transaction.items)}:{}),
        ...(retained ? { v3ExpectedRetainedDocument: { collection: retained.collection, id: retained.id, expected: retained.expected } } : {}),
        v3StockRequirements: await session.stockRequirements(projected, transaction.items, warehouseId, options.refund ? 'REFUND' : 'SALE') },
      { collectionName: 'transactionHistory', document: document as any, requireAbsent: true,
        ...(retained ? { v3ExpectedRetainedDocument: { collection: retained.collection, id: retained.id, expected: retained.expected } } : {}) },
      ...ledger.map(document => ({ collectionName: 'inventoryLedger', document, requireAbsent: true })),
    );
    const redeemedCoupons = (document as any).coupons as { id: string }[] | undefined;
    if (redeemedCoupons?.length) {
      const configDoc = await db.getDocument('config', 'current') as any;
      if (configDoc?.coupons) {
        const redeemedIds = new Set(redeemedCoupons.map(coupon => coupon.id));
        const configAfter = { ...configDoc, coupons: configDoc.coupons.map((coupon: any) => redeemedIds.has(coupon.id)
          ? { ...coupon, status: 'REDEEMED', ticketRef: document.displayId || document.id, terminalId: document.terminalId, redeemedAt: document.date }
          : coupon) };
        mergeMutation({ collectionName: 'config', document: configAfter, expectedDocument: JSON.stringify(configDoc) });
      }
    }
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
    if (isSyncFeatureEnabled('sqlite_outbox_v2')||document.items.some(line=>line.trackingData?.length)) {
      if (options.refund) {
        const fiscalSourceMetadata = {...captureNewV3FiscalSourceMetadata(document,projected,session.binding,{refund:true,retained:Boolean(retained),offlineTableAccount:false}),...captureTrackingSourceMetadata(document,projected)};
        const paymentIntentIds = (document.payments || []).map((payment: any) => payment.paymentIntentId).filter(Boolean);
        let fiscalWorkflowBirth: import('../fiscal/FiscalWorkflowV2Types').FiscalWorkflowBirthV2 | undefined;
        if(document.fiscalWorkflowCheckoutId){
          if(!dbAdapter.fiscalWorkflowStore)throw Error('FISCAL_WORKFLOW_NEW_SOURCE_REQUIRED');
          const checkout=await dbAdapter.fiscalWorkflowStore.readCheckout(document.fiscalWorkflowCheckoutId);
          if(!checkout||checkout.transactionId!==document.id||!checkout.allocation)throw Error('FISCAL_WORKFLOW_CHECKOUT_REQUIRED');
          fiscalWorkflowBirth={schemaVersion:3,authorizationKind:'OFFLINE_FISCAL_ALLOCATION_V2',authorizationId:checkout.allocation.authorizationId,authorityHash:checkout.allocation.authorityHash,checkoutId:checkout.checkoutId,transactionId:checkout.transactionId};
          fiscalWorkflowCommits.push({checkoutId:checkout.checkoutId,transactionId:document.id,birth:fiscalWorkflowBirth});
        }
        events.push({ eventId: createUuid(), eventType: 'SALES_CREDIT_NOTE_POSTED', aggregateType: 'TRANSACTION',
            aggregateId: document.id, schemaVersion: 1,
            payload: buildSalePostedPayload(document, { ...fiscalSourceMetadata, ...(fiscalWorkflowBirth?{fiscalWorkflowBirth}:{}), inventoryMovementIds: ledger.map(row => row.id), paymentIntentIds }), createdAt: document.date });
        const paymentPosted = buildPaymentPostedPayload(document, { ...fiscalSourceMetadata, paymentIntentIds });
        if (paymentPosted) events.push({ eventId: createUuid(), eventType: 'PAYMENT_POSTED',
            aggregateType: 'TRANSACTION', aggregateId: document.id, schemaVersion: 1, payload: paymentPosted, createdAt: document.date });
        intentIds.push(...paymentIntentIds);
      } else {
      const offlineTable=isOfflineTableFiscalTransaction(document);
      if(offlineTable)await assertTableFiscalSaleContext(document,retained);
      const fiscalSourceMetadata = {...captureNewV3FiscalSourceMetadata(document,projected,session.binding,{refund:false,retained:Boolean(retained),offlineTableAccount:offlineTable}),...captureTrackingSourceMetadata(document,projected)};
      let fiscalWorkflowBirth: import('../fiscal/FiscalWorkflowV2Types').FiscalWorkflowBirthV2 | undefined;
      if(document.fiscalWorkflowCheckoutId){
        if(options.refund||retained&&!offlineTable||!dbAdapter.fiscalWorkflowStore)throw Error('FISCAL_WORKFLOW_NEW_SOURCE_REQUIRED');
        const checkout=await dbAdapter.fiscalWorkflowStore.readCheckout(document.fiscalWorkflowCheckoutId);
        if(!checkout||checkout.transactionId!==document.id||offlineTable&&(!(checkout.permit?.leaseId||checkout.allocation)||JSON.stringify(checkout.fiscalSaleContext)!==JSON.stringify(document.fiscalSaleContext)))throw Error('FISCAL_WORKFLOW_CHECKOUT_REQUIRED');
        if(checkout.allocation)fiscalWorkflowBirth={schemaVersion:3,authorizationKind:'OFFLINE_FISCAL_ALLOCATION_V2',authorizationId:checkout.allocation.authorizationId,authorityHash:checkout.allocation.authorityHash,checkoutId:checkout.checkoutId,transactionId:checkout.transactionId};
        else if(checkout.permit)fiscalWorkflowBirth={schemaVersion:2,permitId:checkout.permit.permitId,transactionId:checkout.transactionId,nonce:checkout.permit.nonce,checkoutId:checkout.checkoutId};
        fiscalWorkflowCommits.push({checkoutId:checkout.checkoutId,transactionId:document.id,birth:fiscalWorkflowBirth||null});
      }

      const paymentIntentIds = (document.payments || []).map((payment: any) => payment.paymentIntentId).filter(Boolean);
      const claim = retained?.reservation ? JSON.parse(retained.expected) : undefined;
      // ADVANCE records a prior application in SALE_POSTED; PAYMENT_POSTED represents only newly received settlement.
      const newPayments = claim ? document.payments.filter(payment=>payment.method !== 'ADVANCE') : document.payments;
      const paymentPosted = buildPaymentPostedPayload(claim ? {...document,payments:newPayments,
        settlementAppliedBase:newPayments.reduce((sum,payment)=>sum+Number(payment.amountApplied ?? payment.appliedAmount ?? payment.amount),0)} : document, { ...fiscalSourceMetadata, paymentIntentIds });
      events.push({ eventId: claim?.saleEventId || createUuid(), eventType: 'SALE_POSTED', aggregateType: 'TRANSACTION',
          aggregateId: document.id, schemaVersion: 1,
          payload: buildSalePostedPayload(document, { ...fiscalSourceMetadata,...(fiscalWorkflowBirth?{fiscalWorkflowBirth}:{}), inventoryMovementIds: ledger.map(row => row.id), paymentIntentIds }), createdAt: document.date });
      if (paymentPosted) events.push({ eventId: claim?.paymentEventId || createUuid(), eventType: 'PAYMENT_POSTED',
          aggregateType: 'TRANSACTION', aggregateId: document.id, schemaVersion: 1, payload: paymentPosted, createdAt: document.date });
      intentIds.push(...paymentIntentIds);
      }
    }
    results.push({ transaction: document, created: true });
    }
    for (const mutation of documents) {
      if (mutation.document.v3InventoryBaseline) mutation.v3CurrentCatalog = { ...session.ready.runtime.version, binding: session.binding };
    }
    await session.assertCurrent();
    for (const { transaction } of entries) {
      session.assertFinancialOfflineAuthority?.(transaction);
      await db.assertFiscalTransactionAuthority(transaction,
        config.terminals?.find(terminal => terminal.id === transaction.terminalId || terminal.config?.erpTerminalId === transaction.terminalId)?.config);
    }
    if (events.length) {
      await durableOutboxRepository.commitFinancialTransaction({ documents, outboxEvent: events[0],
        additionalOutboxEvents: events.slice(1), paymentIntentIds: intentIds,fiscalWorkflowCommits,trackingCommits,...(fiscalAllocationPreconditions.length?{fiscalAllocationPreconditions}:{}) });
    } else {
      if(trackingCommits.length)throw Error('TRACKING_ATOMIC_OUTBOX_REQUIRED');
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
