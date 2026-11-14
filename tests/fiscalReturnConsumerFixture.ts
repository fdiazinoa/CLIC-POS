import { v3InventoryBaselineKey } from '../services/sync/LargeMasterSyncV3OperationalSession';
import assert from 'node:assert/strict';
import { financialIdentity } from '../services/db/LargeMasterSyncV3FinancialRetention';
import { fiscalStatusSourceChecksum } from '../services/fiscal/FiscalStatusProof';
import { v3StockSource } from '../services/sync/LargeMasterSyncV3StockAuthority';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { nativeFixture, id } from './articleFormatsNativeFixture';
import { offlineFiscalAuthorityFromConfig } from '../services/fiscal/OfflineFiscalLeaseContext';
import { allocationHash } from '../services/fiscal/OfflineFiscalAllocation';
import { createFiscalWorkflowV2Client } from '../services/fiscal/FiscalWorkflowV2Client';
import { createFiscalReturnConsumer } from '../services/fiscal/FiscalReturnConsumer';
import { returnDigest, RETURN_PROFILE, RETURN_DIGEST_WIRE_SCHEME, returnJSON } from '../services/fiscal/FiscalReturnV1';
import type { ReturnCommand, ReturnPreparation, ReturnCapability } from '../services/fiscal/FiscalReturnV1';
import type { Transaction } from '../types';
export async function returnFixture(database?: any, seed = true, server?: {
    preparations: Map<string, ReturnPreparation>;
}, external?: any) {
    const f = await nativeFixture(database, seed), scope = external?.scope || { tenantId: id(1), companyId: id(2), storeId: id(3), terminalId: id(4), deviceId: id(50) };
    const credentials = { ...scope, erpTenantId: scope.tenantId, erpTerminalId: scope.terminalId, deviceToken: 'synthetic', authStatus: 'BOUND' };
    const values = new Map([['clic_terminal_credentials_v1', JSON.stringify(credentials)], ['CLIC_POS_DEVICE_ID', scope.deviceId]]);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) || null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
    (globalThis as any).window = { dispatchEvent: () => { } };
    const range = { id: external?.returnRange || id(100), type: 'E34', prefix: 'E34', startNumber: 1, endNumber: 1000000, isActive: true, expiryDate: '2099-12-31' };
    const allocation = { id: external?.returnAllocation || id(101), terminalId: scope.terminalId, fiscalRangeId: range.id, ncfType: 'E34', prefix: 'E34', reservedStart: 1, reservedEnd: 1000000, nextNumber: 1, status: 'ACTIVE', releasedAt: null };
    let config: any, original: Transaction, grant: any;
    const stamp = external?.source.transaction.items[0].v3SaleAuthority || { binding: JSON.stringify([id(1), id(4), id(50), 'https://erp.invalid', 'https://erp.invalid']), warehouseId: id(5), syncId: id(60), syncVersion: 32, inventoryVersion: 4, inventoryCursor: 'inventory-cursor', tariffId: id(6), taxIncluded: true };
    if (seed) {
        config = { id: 'current', companyInfo: { rnc: '101010101' }, currencies: [{ code: 'DOP', isBase: true }], taxes: [{ id: 'TX', name: 'ITBIS', type: 'VAT', rate: .18 }], terminals: [{ id: scope.terminalId, config: { erpTerminalId: scope.terminalId, currentDeviceId: scope.deviceId, erpBinding: scope, isPrimaryNode: true, syncConfig: { mode: 'MASTER' }, fiscal: { providerId: 'MSELLER', mode: 'ECF', enabled: true, environment: 0, credentialKey: '101010101', fiscalRanges: [range], fiscalAllocations: [allocation] } } }] };
        if (external) {
            config.companyInfo.rnc = external.authority.issuerRnc;
            config.terminals[0].config.fiscal.credentialKey = external.authority.issuerRnc;
            config.terminals[0].config.fiscal.environment = external.authority.environment;
            config.currencies = [{ code: 'DOP', isBase: true }];
            config.taxes = external.source.transaction.taxBreakdown.map((tax: any) => ({ ...tax, name: tax.name || tax.id, active: true }));
        }
        for (const [collection, doc] of [['config', config], ['fiscalRanges', range], ['fiscalAllocations', allocation]])
            await f.adapter.saveDocument(collection as string, doc as any);
        original = { id: id(201), displayId: 'SALE-1', date: new Date().toISOString(), terminalId: scope.terminalId, documentType: 'TICKET', status: 'COMPLETED', ncfType: 'E32', ncf: 'E320000000001', currency: 'DOP', exchangeRate: 1, isTaxIncluded: true,
            v3Binding: stamp.binding, v3InventoryBaseline: JSON.stringify([stamp.binding, stamp.syncId, stamp.syncVersion, stamp.inventoryVersion, stamp.inventoryCursor]), v3WarehouseId: id(5), fiscalMode: 'ECF', fiscalProvider: 'MSELLER', total: 10, netAmount: 8.47, taxAmount: 1.53, discountAmount: 0, pendingBalance: 0, relatedTransactions: [], customerSnapshot: { taxId: '101010102', name: 'Synthetic buyer' }, userId: 'user', userName: 'User',
            items: [{ category: 'Synthetic', images: [], attributes: [], variants: [], tariffs: [], id: id(7), cartId: 'line', name: 'Synthetic', type: 'PRODUCT', quantity: 1, price: 10, isInventoriable: true, taxable: true, taxRate: .18, appliedTaxIds: ['TX'], netAmount: 8.47, taxAmount: 1.53, totalAmount: 10, cost: 35, v3SaleAuthority: stamp }], payments: [{ id: id(202), method: 'CASH', methodId: 'cash', amount: 10, timestamp: new Date().toISOString() }] } as unknown as Transaction;
        if (external) {
            original = structuredClone(external.source.transaction);
            // The ERP fixture changes scope on the frozen line authority but retains a
            // root local-baseline string from its template. Seed only POS-local metadata.
            const stock = v3StockSource(stamp);
            original.v3Binding = stamp.binding;
            original.v3InventoryBaseline = JSON.stringify([stamp.binding, stock.syncId, stock.syncVersion, stamp.inventoryVersion, stamp.inventoryCursor]);
            original.v3WarehouseId = stamp.warehouseId;
            assert.equal(financialIdentity(original), financialIdentity(external.source.transaction));
            assert.equal(await fiscalStatusSourceChecksum(original), await fiscalStatusSourceChecksum(external.source.transaction));
            assert.deepEqual(original.items, external.source.transaction.items);
        }
        await f.adapter.saveDocument('transactions', original);
        await f.adapter.saveDocument('transactionHistory', original);
        const local = await offlineFiscalAuthorityFromConfig(config, credentials, scope.deviceId);
        const unsigned: any = { contractVersion: 2, authorizationKind: 'OFFLINE_FISCAL_ALLOCATION_V2', authorizationId: id(102), scope, issuerRnc: '101010101', provider: 'MSELLER', environment: 0, issuedAt: new Date(Date.now() - 1000).toISOString(), bindingFingerprint: 'a'.repeat(64), allocations: [{ allocationId: allocation.id, fiscalRangeId: range.id, ncfType: 'E34', prefix: 'E34', padding: 10, start: 1, end: 1000000, rangeStart: 1, rangeEnd: 1000000, expiryDate: range.expiryDate }] };
        grant = external?.authority || { ...unsigned, authorityHash: await allocationHash(unsigned) };
        await f.adapter.fiscalWorkflowStore.saveAllocation!(grant, local, new Date().toISOString());
    }
    else {
        config = await f.adapter.getDocument('config', 'current');
        original = (await f.adapter.getDocument<Transaction>('transactions', id(201)))!;
        grant = JSON.parse((f.db.prepare('SELECT authority_json FROM pos_offline_fiscal_allocations_v2').get() as any).authority_json);
    }
    if (external) {
        f.db.prepare('UPDATE master_v3_state SET active_sync_id=?,active_version=? WHERE singleton=1').run(stamp.syncId, stamp.syncVersion);
        f.db.prepare('UPDATE master_v3_operational_owner SET sync_id=?,sync_version=?,binding=? WHERE singleton=1').run(stamp.syncId, stamp.syncVersion, stamp.binding);
        f.db.prepare('UPDATE master_v3_inventory_state SET sync_id=?,sync_version=?,inventory_version=?,cursor=? WHERE singleton=1').run(stamp.inventorySyncId || stamp.syncId, stamp.inventorySyncVersion || stamp.syncVersion, stamp.inventoryVersion, stamp.inventoryCursor);
        f.db.prepare('INSERT OR REPLACE INTO master_v3_catalog_owners VALUES(?,?,?,?,?,?,?)').run(stamp.syncId, stamp.syncVersion, stamp.binding, stamp.inventorySyncId || stamp.syncId, stamp.inventorySyncVersion || stamp.syncVersion, stamp.inventoryVersion, stamp.inventoryCursor);
        for (const line of original.items)
            f.db.prepare('INSERT OR REPLACE INTO master_v3_inventory_balances VALUES(?,?,?,?,?,?)').run(line.id, stamp.warehouseId, 100, 0, 0, 'synthetic');
    }
    let capability: ReturnCapability = { schemaVersion: 1, version: 1, capability: 'fiscalReturnV1', profile: RETURN_PROFILE, enabled: true, ready: true, operationKind: 'RETURN', ncfType: 'E34', birthSchemaVersion: 3, eventSchemaVersion: 1, scope, bindingAuthorityHash: 'b'.repeat(64), authorizationId: grant.authorizationId, authorityHash: grant.authorityHash, environment: 0, issuerRnc: '101010101', requiresOnlinePreparation: true, readiness: { admission: true, recovery: true, bank: false }, transport: { requiresPreservedOuterContract: true, batch: { enabled: true, path: '/api/sync/inbox/batch' }, singular: { enabled: true, path: '/api/sync/inbox' } } };
    const parent: any = { transactionId: original.id, mode: 'WORKFLOW', sourceKind: 'ORDINARY_SOURCE_V2', signature: { synthetic: true }, decision: 'ACCEPTED', documentId: id(203), checksumV1: 'c'.repeat(64), ncf: original.ncf, issuerRnc: '101010101', environment: 0 };
    parent.originalReference = { documentId: parent.documentId, transactionId: parent.transactionId, ncf: parent.ncf, issuerRnc: parent.issuerRnc, environment: parent.environment, sourceChecksum: parent.checksumV1 };
    const localClient = createFiscalWorkflowV2Client({ store: () => f.adapter.fiscalWorkflowStore, readOfflineAuthority: () => offlineFiscalAuthorityFromConfig(config, credentials, scope.deviceId), readAuth: () => { throw Error('NO_PUBLIC_NETWORK'); } } as any);
    const preparations = server?.preparations || new Map<string, ReturnPreparation>();
    let commitTransform: ((tx:Transaction)=>Transaction)|undefined;
    let proofTransform: ((p: ReturnPreparation) => ReturnPreparation) | undefined;
    let prepareCalls: string[] = [], offline = false, losePrepare = false, deny = false;
    const prepare = async (bytes: string) => {
        prepareCalls.push(bytes);
        if (offline)
            throw Error('FISCAL_RETURN_UNAVAILABLE');
        if (deny)
            throw Error('FISCAL_RETURN_BUYER_PRINT_CONTRACT_REQUIRED');
        const c: ReturnCommand = JSON.parse(bytes);
        let p = preparations.get(c.operationId);
        if (!p) {
            const prior = [...preparations.values()].reduce((n, p) => n + p.returnSnapshot.lines[0].quantity, 0), q = c.lines[0].quantity;
            if (prior + q > 1)
                throw Error('FISCAL_RETURN_QUANTITY_EXCEEDED');
            const round = (v: number) => Math.round(v * 100) / 100, net = round(8.47 * (prior + q)) - round(8.47 * prior), total = round(10 * q), tax = round(total - net);
            const l = { cartId: 'line', itemId: id(7), unitPrice: 10, quantity: q, originalQuantity: 1, stockDisposition: 'RESTOCK', netAmount: net, taxAmount: tax, totalAmount: total, discountAmount: 0, originalItem: original.items[0], sourceFiscalSnapshot: { appliedTaxIds: ['TX'] }, inventoryEntries: [{ itemId: id(7), quantity: q, unitCost: 35 }] };
            const snapshot = { schemaVersion: 1, profile: RETURN_PROFILE, loyaltyDisposition: 'NO_EFFECT_VERIFIED', loyaltyProofDigest: 'd'.repeat(64), originalReference: c.originalReference, originalDate: original.date, originalDisplayId: original.displayId, buyer: original.customerSnapshot, currency: 'DOP', exchangeRate: 1, lines: [l], netAmount: net, taxAmount: tax, vatAmount: tax, total, discountAmount: 0, sourceServiceChargeAmount: 0, paidAmount: total, pendingBalance: 0, sourceCustomerId: null, modificationCode: q === 1 ? 1 : 3, warehouseId: id(5), taxBreakdown: [{ id: 'TX', name: 'ITBIS', type: 'VAT', rate: .18, amount: tax, taxableBase: net, total }], paymentCommands: c.payments.map(x => ({ ...x, method: 'CASH' })) };
            p = { schemaVersion: 1, profile: RETURN_PROFILE, preparationId: crypto.randomUUID(), operationId: c.operationId, checkoutId: c.checkoutId, transactionId: c.transactionId, financialEventId: c.financialEventId, inventoryMovementIds: c.inventoryMovementIds, authorizationId: c.authorizationId, authorityHash: c.authorityHash, scope, environment: 0, issuerRnc: '101010101', originalReference: c.originalReference, originalProofDigest: 'e'.repeat(64), returnSnapshot: snapshot, returnSnapshotDigest: await returnDigest(snapshot), reservationState: 'PREPARED', preparedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() };
            p.returnSnapshotDigestScheme = RETURN_DIGEST_WIRE_SCHEME;
            p.returnSnapshotDigestInput = returnJSON({ schemaVersion: 1, source: 'ERP_POS_FISCAL_RETURN_V1', value: snapshot });
            preparations.set(c.operationId, p);
        }
        if (losePrepare) {
            losePrepare = false;
            throw Error('FISCAL_RETURN_UNAVAILABLE');
        }
        return proofTransform ? proofTransform(structuredClone(p)) : p;
    };
    // Only retained-session/catalog boundaries are fixture ports; financial writer, SQLite, allocation and Outbox are real.
    const state: any = { inventoryBaseline: v3InventoryBaselineKey, adapter: f.adapter, config, stamp };
    (globalThis as any).__returnConsumerFixture = state;
    const modules: Record<string, string> = {
        '../db': 'export const dbAdapter=globalThis.__returnConsumerFixture.adapter;',
        '../services/db': 'export const dbAdapter=globalThis.__returnConsumerFixture.adapter;',
        './sync/BackgroundSyncManager': 'export const backgroundSyncManager={triggerSync:async()=>{}};',
        '../../utils/db': `export const db={getDocument:(n,id)=>globalThis.__returnConsumerFixture.adapter.getDocument(n,id),assertFiscalTransactionAuthority:async()=>{}};`,
        '../utils/db': `export const db={getDocument:(n,id)=>globalThis.__returnConsumerFixture.adapter.getDocument(n,id),assertFiscalTransactionAuthority:async()=>{}};`,
        './SyncFeatureFlags': 'export const isSyncFeatureEnabled=()=>true;',
        './DurableOutboxRepository': 'export const durableOutboxRepository={commitFinancialTransaction:i=>globalThis.__returnConsumerFixture.adapter.commitFinancialTransaction(i)};',
        './LargeMasterSyncV3OperationalSession': `const s={binding:${JSON.stringify(stamp.binding)},ready:{runtime:{version:{syncId:${JSON.stringify(stamp.syncId)},syncVersion:${stamp.syncVersion}}}},assertCurrent:async()=>{},projectConfig:async c=>c,projectRefundConfig:async c=>c,validate:async(c,items,t,w,intent,validated)=>{items.forEach(l=>validated?.(l,l));},stockRequirements:async()=>[]};export const getLargeMasterSyncV3OperationalSession=async()=>s;export const getLargeMasterSyncV3RetainedSession=async()=>s;export const v3InventoryBaselineKey=(b,s)=>globalThis.__returnConsumerFixture.inventoryBaseline(b,s);`,
    };
    const code = await build({ entryPoints: [new URL('../services/sync/LargeMasterSyncV3FinancialCommit.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'retained-boundaries', setup(b) { b.onResolve({ filter: /.*/ }, a => modules[a.path] ? { path: a.path, namespace: 'fixture' } : undefined); b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: modules[a.path], loader: 'js' })); } }] });
    const generated = mkdtempSync(join(tmpdir(), 'clic-return-fixture-'));
    const file = join(generated, 'financial.mjs');
    writeFileSync(file, code.outputFiles[0].text);
    const financial = await import(file);
    const commitSource = async (tx: Transaction, attempt: any) => {
        if(commitTransform)tx=commitTransform(structuredClone(tx));
        (globalThis as any).__returnConsumerFixture = state;
        const current = (await f.adapter.getDocument<Transaction>('transactions', original.id))!;
        const history = await f.adapter.getDocument<Transaction>('transactionHistory', original.id);
        const updated = { ...current, status: 'PARTIAL_REFUND' as const, relatedTransactions: [...(current.relatedTransactions || []), tx.id], syncStatus: 'PENDING' as const };
        const result = await financial.persistV3FinancialTransaction(tx, config, stamp.warehouseId, { refund: true, fiscalReturnAttemptId: attempt.id, original: updated, expectedOriginal: current, expectedOriginalHistory: history, originalCollection: 'transactions', adjustCustomerBalance:Number(attempt.preparation.returnSnapshot.pendingBalance)>0, skipWalletDeposit: true, conditions: new Map(original.items.map(l => [l.cartId, 'SELLABLE'])) });
        return result.transaction;
    };
    const client = createFiscalReturnConsumer({ adapter: f.adapter, transport: { context: () => ({ descriptor: scope, assertCurrent: () => { } } as any), capability: async () => { if (offline)
                throw Error('FISCAL_RETURN_UNAVAILABLE'); return capability; }, prepare }, workflow: { ...localClient, consult: async () => parent }, readOriginal: async () => (await f.adapter.getDocument<Transaction>('transactions', original.id))!,
        commit: commitSource });
    const run = (q = 1) => client.process(original, [{ ...original.items[0], quantity: q }], new Map([['line', 'SELLABLE']]), 'Synthetic return', id(10), { id: 'user', name: 'User' });
    return { ...f, cleanup: () => { f.db.close(); rmSync(generated, { recursive: true, force: true }); }, scope, config, original, parent, grant, client, run, commitSource, preparations, prepareCalls, setCommitTransform:(transform:(tx:Transaction)=>Transaction)=>commitTransform=transform, setProofTransform: (transform?: (p: ReturnPreparation) => ReturnPreparation) => proofTransform = transform, setOffline: (v: boolean) => offline = v, setLosePrepare: () => losePrepare = true, setDenied: (v: boolean) => deny = v, setCapability: (v: Partial<ReturnCapability>) => { capability = { ...capability, ...v }; }, localClient };
}
