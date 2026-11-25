import { createUuid } from '../../utils/uuid';
import type { Transaction, CartItem, BusinessConfig } from '../../types';
import type { DatabaseAdapter } from '../db/DatabaseAdapter';
import type { NativeFiscalReturnStore } from '../db/NativeFiscalReturnStore';
import { fiscalWorkflowScopeKey } from './FiscalWorkflowV2Types';
import type { FiscalWorkflowCheckoutV2, FiscalWorkflowStateV2 } from './FiscalWorkflowV2Types';
import { captureFiscalStatusBoundContext } from './FiscalBoundContext';
import { assertReturnAdmission, assertReturnSettlementCapability, assertReturnPreparation, assertReturnSnapshotDigest, buildReturnSource, returnFiscalTime, returnJSON, returnNeed, sameReturn, validOrdinaryReturnReference, originalReferencePendingCode, type ReturnAttempt, type ReturnCapability, type ReturnPreparation, type ReturnCommand } from './FiscalReturnV1';
import { sha256Utf8 } from '../sync/LargeMasterSyncV3Client';
import { financialIdentity } from '../db/LargeMasterSyncV3FinancialRetention';

class UncertainReturnPreparationResponse extends Error {
    constructor(cause?: unknown) {
        super('FISCAL_RETURN_UNAVAILABLE', { cause });
    }
}

const transientPreparationStatus = (status: number) => [408, 429, 500, 502, 503, 504].includes(status);

export function createFiscalReturnTransport(readAuth = captureFiscalStatusBoundContext, fetcher: typeof fetch = fetch) {
    const returnPath = 'fiscal/workflow/v2/return/';
    const request = async (path: string, bytes?: string, root = returnPath) => {
        const auth = readAuth(), controller = new AbortController();
        const isPreparation = root === returnPath && path === 'prepare';
        // Use the QA preparation budget for both attempts. Other requests keep their existing timeout.
        const timer = setTimeout(() => controller.abort(), isPreparation ? 30_000 : 10_000);
        const attempt = async () => {
            auth.assertCurrent();
            let response: Response;
            let text: string;
            try {
                response = await fetcher(`${auth.base}/${root}${path}`, { method: bytes === undefined ? 'GET' : 'POST', headers: { ...auth.headers, ...(root === returnPath && (path === 'capability' || path === 'prepare') ? { 'X-POS-Capabilities': 'fiscalReturnConsumerFinalE32' } : {}), ...(bytes === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: bytes, signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
                returnNeed(Number(response.headers.get('content-length') || 0) <= 2000000, 'FISCAL_RETURN_RESPONSE_INVALID');
                text = await response.text();
            } catch (error) {
                if (isPreparation && !controller.signal.aborted &&
                    ['TypeError', 'NetworkError', 'TimeoutError', 'AbortError'].includes((error as Error)?.name))
                    throw new UncertainReturnPreparationResponse(error);
                throw error;
            }
            returnNeed(text.length <= 1000000, 'FISCAL_RETURN_RESPONSE_INVALID');
            auth.assertCurrent();
            let data: any;
            try {
                data = JSON.parse(text);
            }
            catch (error) {
                if (isPreparation && (response.ok || transientPreparationStatus(response.status)))
                    throw new UncertainReturnPreparationResponse(error);
                throw Error('FISCAL_RETURN_UNAVAILABLE');
            }
            if (!response.ok) {
                if (typeof data?.code === 'string' && /^FISCAL_RETURN_[A-Z0-9_]+$/.test(data.code))
                    throw Error(data.code);
                if (isPreparation && transientPreparationStatus(response.status))
                    throw new UncertainReturnPreparationResponse();
                throw Error('FISCAL_RETURN_UNAVAILABLE');
            }
            return data;
        };
        try {
            return await attempt();
        } catch (error) {
            if (!(error instanceof UncertainReturnPreparationResponse) || controller.signal.aborted)
                throw error;
            // Reuse the sealed command and the original deadline. The ERP replays its stored preparation.
            return await attempt();
        }
        finally {
            clearTimeout(timer);
        }
    };
    return { context: () => readAuth(), capability: () => request('capability') as Promise<ReturnCapability>, prepare: (bytes: string) => request('prepare', bytes) as Promise<ReturnPreparation>,
        async deliver(events: any[]) {
            const auth = readAuth(), cap = await request('capability') as ReturnCapability;
            auth.assertCurrent();
            returnNeed(cap?.schemaVersion === 1 && cap.version === 1 && cap.profile === 'ORDINARY_RETURN_DOP_V1' && cap.capability === 'fiscalReturnV1' && cap.transport?.requiresPreservedOuterContract === true, 'FISCAL_RETURN_TRANSPORT_REQUIRED');
            const scope = { tenantId: auth.descriptor.tenantId, companyId: auth.descriptor.companyId, storeId: auth.descriptor.storeId, terminalId: auth.descriptor.terminalId, deviceId: auth.descriptor.deviceId };
            returnNeed(sameReturn(cap.scope, scope), 'FISCAL_RETURN_SCOPE_MISMATCH');
            for (const event of events.filter(e => e.payload?.fiscalReturnContract))
                for (const [key, alias] of Object.entries({ tenantId: 'tenant_id', companyId: 'company_id', storeId: 'store_id', terminalId: 'terminal_id', deviceId: 'device_id' }))
                    returnNeed(event.payload[alias] === (scope as any)[key], 'FISCAL_RETURN_SCOPE_MISMATCH');
            if (cap.transport.batch?.enabled === true && cap.transport.batch.path === '/api/sync/inbox/batch')
                return request('inbox/batch', JSON.stringify({ events }), '');
            returnNeed(cap.transport.singular?.enabled === true && cap.transport.singular.path === '/api/sync/inbox', 'FISCAL_RETURN_TRANSPORT_REQUIRED');
            const results = [];
            for (const event of events) {
                const response = await request('inbox', JSON.stringify(event), '');
                const result = response.result || response;
                returnNeed((result.eventId || result.event_id) === event.eventId, 'FISCAL_RETURN_ACK_INVALID');
                results.push(result);
            }
            return { results };
        } };
}
interface ConsumerPorts {
    adapter: DatabaseAdapter;
    transport: Pick<ReturnType<typeof createFiscalReturnTransport>, 'context' | 'capability' | 'prepare'>;
    workflow: {
        consult: (id: string, signal?: AbortSignal, timeoutMs?: number) => Promise<FiscalWorkflowStateV2>;
        reserveReturnCheckout: (cart: string, operation: string) => Promise<FiscalWorkflowCheckoutV2>;
        allocationDraft: (checkout: FiscalWorkflowCheckoutV2) => Promise<{ fiscalEnvironment: number; fiscalTimeMs: number }>;
        recordPayment: (checkout: FiscalWorkflowCheckoutV2, paymentId: string) => Promise<void>;
    };
    readOriginal?: (source: Transaction) => Promise<Transaction>;
    commit: (source: Transaction, attempt: ReturnAttempt) => Promise<Transaction>;
    now?: () => number;
}
const RETURN_ORIGINAL_STATUS_TIMEOUT_MS = 20_000;
const inflight = new Map<string, Promise<Transaction>>();
export function createFiscalReturnConsumer(ports: ConsumerPorts) {
    return { async process(original: Transaction, items: CartItem[], conditions: Map<string, 'SELLABLE' | 'DAMAGED'>, reason: string, seriesId: string, user: {
            id: string;
            name: string;
        }, destination?: import('./FiscalReturnV1').ReturnSettlementDestination): Promise<Transaction> {
            const auth = ports.transport.context(), scope = { tenantId: auth.descriptor.tenantId, companyId: auth.descriptor.companyId, storeId: auth.descriptor.storeId, terminalId: auth.descriptor.terminalId, deviceId: auth.descriptor.deviceId };
            const store = ports.adapter.fiscalReturnStore;
            returnNeed(store, 'FISCAL_RETURN_NATIVE_REQUIRED');
            // These historical documents are deliberately outside this consumer's recovery domain.
            returnNeed(!['E340000000003', 'E340000000006'].includes(original.ncf || ''), 'FISCAL_RETURN_HISTORICAL_RECONCILIATION_REQUIRED');
            // A lost local commit response wins over a new partial-return frontier and needs no new admission.
            const active = await readActiveReturn(store!, scope, original.id);
            if (active?.phase === 'COMMITTED' && active.committedSource) {
                const archived = await ports.adapter.getDocument<Transaction>('transactionHistory', active.committedSource.id);
                returnNeed(archived && financialIdentity(archived) === financialIdentity(active.committedSource), 'FISCAL_RETURN_COMMIT_RECEIPT_REQUIRED');
                return archived!;
            }
            original = await (ports.readOriginal?.(original) || Promise.resolve(original));
            const slot = await sha256Utf8(returnJSON([scope, original.id, [...(original.relatedTransactions || [])].sort()]));
            const selected = [...items].sort((a, b) => a.cartId.localeCompare(b.cartId));
            const lines = selected.map(l => ({ cartId: l.cartId, quantity: Math.abs(l.quantity), stockDisposition: l.type === 'SERVICE' ? 'SERVICE' as const : conditions.get(l.cartId) === 'DAMAGED' ? 'DAMAGED' as const : 'RESTOCK' as const }));
            const payments = original.payments.filter(p => p.method !== 'CREDIT' && p.amount > 0);
            const legacyPayments = async () => {
                const refunds=await ports.adapter.getCollection<Transaction>('transactionHistory'),prior=refunds.filter(t=>t.originalTransactionId===original.id);
                const total=Math.round(selected.reduce((n,l)=>{const old=original.items.find(x=>x.cartId===l.cartId);returnNeed(old&&l.quantity>0,'FISCAL_RETURN_LINES_REQUIRED');return n+(old!.totalAmount??old!.price*old!.quantity)*l.quantity/old!.quantity;},0)*100)/100;
                let remaining=Math.min(total,Math.max(0,original.total-Number(original.pendingBalance||0)-prior.reduce((n,t)=>n+t.payments.reduce((m,p)=>m+p.amount,0),0)));
                return payments.map(p=>{const methodId=p.methodId||p.method,used=prior.flatMap(t=>t.payments).filter(x=>(x.methodId||x.method)===methodId).reduce((n,x)=>n+x.amount,0);
                    const amount=Math.round(Math.min(remaining,Math.max(0,Number(p.appliedAmount??p.amount)-used))*100)/100;remaining=Math.round((remaining-amount)*100)/100;
                    return {methodId,amount,currency:'DOP' as const};}).filter(p=>p.amount>0);
            };
            const priorIntent=active?JSON.parse(active.intent):null;
            const isLegacy=Boolean(active&&!priorIntent.settlementRequested);
            const requestedSelection=priorIntent?.settlementRequested||{schemaVersion:1 as const,destination:destination||'ORIGINAL_PAYMENT'};
            if(active&&destination)returnNeed(!isLegacy&&requestedSelection.destination===destination,'FISCAL_RETURN_IDEMPOTENCY_CONFLICT');
            const legacyRequested=isLegacy?await legacyPayments():null;
            const intent=returnJSON({originalId:original.id,lines,...(isLegacy?{payments:legacyRequested}:{settlementRequested:requestedSelection,...(active?(Object.hasOwn(priorIntent,'settlementRequired')?{settlementRequired:priorIntent.settlementRequired}:{}):{settlementRequired:Boolean(destination)})}),reason,seriesId,user});
            let a=active||await store!.begin(slot,intent,scope,payments.length);
            returnNeed(a.intent===intent,'FISCAL_RETURN_IDEMPOTENCY_CONFLICT');
            returnNeed(!payments.some(p=>p.gatewayProvider||p.gatewayIntegrationId||p.paymentIntentId),'FISCAL_RETURN_GATEWAY_PROOF_REQUIRED');
            const pending = inflight.get(a.id);
            if (pending)
                return pending;
            const work = (async () => {
                let c = await ports.transport.capability();
                auth.assertCurrent();
                assertReturnAdmission(c, scope);
                const selection=a.commandBytes?JSON.parse(a.commandBytes).settlement:a.settlementSelection||(!isLegacy&&c.settlement?.enabled?requestedSelection:undefined);
                if(selection)assertReturnSettlementCapability(c,scope);
                if(!a.commandBytes&&(JSON.parse(a.intent).settlementRequired||requestedSelection.destination==='CUSTOMER_CREDIT')&&!selection)throw Error('FISCAL_RETURN_SETTLEMENT_DISABLED');
                if(selection&&!a.settlementSelection)a=await store!.save(a,{...a,settlementSelection:selection});
                const requested=selection?[]:legacyRequested||await legacyPayments();
                if (!a.checkout) {
                    const consultOriginal = () => ports.workflow.consult(original.id, undefined, RETURN_ORIGINAL_STATUS_TIMEOUT_MS);
                    const parent = await consultOriginal().catch(error => {
                        if (error?.name !== 'AbortError') throw error;
                        auth.assertCurrent();
                        // Only retry the authenticated GET. No checkout or ERP preparation exists yet.
                        return consultOriginal();
                    });
                    const reference = parent.originalReference;
                    returnNeed(reference, originalReferencePendingCode(parent.originalReferenceReason));
                    returnNeed(parent.mode === 'WORKFLOW' && parent.sourceKind === 'ORDINARY_SOURCE_V2' && parent.signature && ['ACCEPTED', 'ACCEPTED_CONDITIONAL'].includes(parent.decision) && validOrdinaryReturnReference(original, parent), 'FISCAL_RETURN_ACCEPTED_ORIGINAL_REQUIRED');
                    auth.assertCurrent();
                    // This genuine native reservation is PREPARED only: no issued counter, payment or stock effect.
                    const cart = returnJSON({ items: selected, customerId: original.customerId ?? null, fiscalType: 'E34', originalTransactionId: original.id,
                        serviceChargeAmount: 0, serviceType: original.serviceType, serviceTaxPolicySnapshot: original.serviceTaxPolicySnapshot });
                    const native = ports.adapter.fiscalWorkflowStore;
                    const scopeKey = fiscalWorkflowScopeKey(scope);
                    let current = await native?.currentCheckout(scopeKey);
                    if (current && current.phase !== 'ACKNOWLEDGED' &&
                        current.operationId !== (a.replacementOperationId ?? a.operationId)) {
                        await store!.releaseUnsubmittedReturn(scope, current);
                        current = null;
                    }
                    if (!a.replacementOperationId) {
                        if (current?.phase === 'PREPARED' && current.permit?.leaseId && !current.allocation &&
                            current.operationId === a.operationId && current.cartIdentity === cart) {
                            returnNeed(native?.abandonOfflinePrepared, 'OFFLINE_FISCAL_ABANDON_NOT_SAFE');
                            await native!.abandonOfflinePrepared!(current);
                        }
                        const abandoned = await native?.abandonedOfflineOperation?.(scopeKey, a.operationId);
                        if (abandoned) {
                            returnNeed(abandoned.phase === 'PREPARED' && !abandoned.paymentIds.length &&
                                abandoned.cartIdentity === cart && !abandoned.allocation, 'FISCAL_RETURN_RECOVERY_REQUIRED');
                            // Persist before reserving so retries reuse the same replacement even after an interrupted response.
                            a = await store!.save(a, { ...a, replacementOperationId: createUuid() });
                        }
                    }
                    const operationId = a.replacementOperationId ?? a.operationId;
                    const checkout = await ports.workflow.reserveReturnCheckout(cart, operationId);
                    returnNeed(checkout.allocation?.authorizationId === c.authorizationId && checkout.allocation?.authorityHash === c.authorityHash && checkout.phase === 'PREPARED' && checkout.operationId === operationId, 'FISCAL_RETURN_AUTHORITY_REQUIRED');
                    const command: ReturnCommand = { schemaVersion: 1, capability: 'fiscalReturnV1', operationId, checkoutId: checkout.checkoutId, transactionId: checkout.transactionId,
                        authorizationId: c.authorizationId, authorityHash: c.authorityHash, originalReference: reference!, lines,
                        payments: requested.map((p, i) => ({ ...p, id: a.paymentIds[i] })), ...(selection?{settlement:selection}:{}), financialEventId: a.financialEventId,
                        inventoryMovementIds: selected.filter(l => l.type !== 'SERVICE' && l.isInventoriable === true && conditions.get(l.cartId) !== 'DAMAGED').map(l => `V3-${checkout.transactionId}-${encodeURIComponent(l.cartId)}`) };
                    a = await store!.save(a, { ...a, checkout, commandBytes: JSON.stringify(command), phase: 'PREPARING' });
                }
                if (!a.preparation) {
                    const preparation = await ports.transport.prepare(a.commandBytes!);
                    auth.assertCurrent();
                    await assertReturnPreparation(preparation, a);
                    a = await store!.save(a, { ...a, preparation, phase: 'PREPARED' });
                }
                if (a.preparation && a.preparation.returnSnapshotDigestScheme === undefined && a.preparation.returnSnapshotDigestInput === undefined && !a.preparationDigestProof) {
                    // Historical DTOs are immutable. Replay the exact durable command and
                    // retain only its new write-once proof after checking every original field.
                    const recovered = await ports.transport.prepare(a.commandBytes!);
                    auth.assertCurrent();
                    const { returnSnapshotDigestScheme, returnSnapshotDigestInput, ...originalFields } = recovered;
                    returnNeed(sameReturn(originalFields, a.preparation), 'FISCAL_RETURN_PREPARATION_RECOVERY_CONFLICT');
                    await assertReturnSnapshotDigest(recovered);
                    a = await store!.save(a, { ...a, preparationDigestProof: { returnSnapshotDigestScheme: returnSnapshotDigestScheme!, returnSnapshotDigestInput: returnSnapshotDigestInput! } });
                }
                await assertReturnPreparation(a.preparation!, a);
                // Historical prepare replay after revocation/flag OFF never authorizes a fresh financial commit.
                c = await ports.transport.capability();
                auth.assertCurrent();
                if(selection)assertReturnSettlementCapability(c,scope);
                const draft = await ports.workflow.allocationDraft(a.checkout!);
                auth.assertCurrent();
                returnNeed(draft.fiscalEnvironment === a.preparation!.environment, 'FISCAL_RETURN_AUTHORITY_REQUIRED');
                const fiscalTime = returnFiscalTime(a.preparation!, ports.now?.() ?? draft.fiscalTimeMs);
                assertReturnAdmission(c, scope, a.preparation, fiscalTime);
                const checkedAt = new Date(Date.now()).toISOString();
                if (!a.localCommittedAt) {
                    const localCommittedAt = new Date(fiscalTime).toISOString();
                    a = await store!.save(a, { ...a, localCommittedAt, source: buildReturnSource(a, original, seriesId, user), phase: 'SEALED', admission: { capability: c, checkedAt } });
                }
                else
                    a = await store!.save(a, { ...a, admission: { capability: c, checkedAt } });
                await store!.fence(a.id);
                const source = await ports.commit(a.source!, a);
                return source;
            })();
            inflight.set(a.id, work);
            try {
                return await work;
            }
            finally {
                if (inflight.get(a.id) === work)
                    inflight.delete(a.id);
            }
        } };
}
async function readActiveReturn(store: NativeFiscalReturnStore, scope: any, originalId: string) { return store.active(scope, originalId); }
