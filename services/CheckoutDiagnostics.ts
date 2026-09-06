import { v4 as uuidv4 } from 'uuid';
import { diagnosticEvent } from './CheckoutDiagnosticDelivery';
/** Diagnostic-only recorder: never changes checkout data, validates a sale or awaits I/O. */
export type CheckoutDiagnosticInput = {
    items?: unknown; payments?: unknown; total?: unknown;
    transactionId?: unknown; displayId?: unknown; eventId?: unknown; aggregateId?: unknown;
    tableId?: unknown; orderId?: unknown; terminalId?: unknown; deviceId?: unknown;
    status?: unknown; reason?: unknown; summaryItemCount?: unknown; expectedItemCount?: unknown;
};
export interface TrackingSession { id: string; startedAt: string; expiresAt: string; versionName: string | null; versionCode: number | null; terminalId: string | null; deviceId: string | null }
export type CaptureContext = { mode: 'RETAIL' | 'RESTAURANT' | null; versionName: string | null; versionCode: number | null };
let captureContext: CaptureContext = { mode:null, versionName:null, versionCode:null };
export const setCheckoutCaptureContext = (patch: Partial<CaptureContext>) => { captureContext = {...captureContext,...patch}; };
// Read native version once per boot, outside checkout; never infer it from a restored session.
if (typeof window !== 'undefined') {
    void import('./version/posApkUpdateService').then(m=>m.readInstalledPosApkVersion())
        .then(v=>setCheckoutCaptureContext({versionName:v.versionName,versionCode:v.versionCode})).catch(()=>{});
}
export interface CheckoutDiagnosticRecord {
    id: string; at: string; checkoutId: string | null; stage: string; session: TrackingSession | null;
    data: Record<string, unknown>; anomaly: boolean; capture?: CaptureContext;
}
export interface CheckoutDiagnosticIncident { id: string; at: string; records: CheckoutDiagnosticRecord[] }
export type DiagnosticWriter = (records: CheckoutDiagnosticRecord[], incidents: CheckoutDiagnosticIncident[]) => Promise<void>;
const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 160) : typeof value === 'number' ? String(value) : null;
const number = (value: unknown) => value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const fields = ['transactionId', 'displayId', 'eventId', 'aggregateId', 'tableId', 'orderId', 'terminalId', 'deviceId', 'status', 'reason'] as const;

export class CheckoutDiagnosticRecorder {
    private readonly bootId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    private sequence = 0;
    private checkoutId: string | null = null;
    private paymentOpen = false;
    private committed = false;
    private previousItemCount: number | null = null;
    private readonly transactionCheckouts = new Map<string, string>();
    private recent: CheckoutDiagnosticRecord[] = [];
    private pending: CheckoutDiagnosticRecord[] = [];
    private incidents: CheckoutDiagnosticIncident[] = [];
    private pendingIncidents: CheckoutDiagnosticIncident[] = [];
    private writing = false;
    private session: TrackingSession | null = null;

    setSession(session: TrackingSession | null) { this.session = session; this.checkoutId = null; this.paymentOpen = false; this.committed = false; this.transactionCheckouts.clear(); }

    constructor(private readonly writer: DiagnosticWriter, private readonly schedule: () => void = () => {}) {}

    record(stage: string, input: CheckoutDiagnosticInput = {}): void {
        try {
            if (stage === 'CHECKOUT_OPEN') {
                this.checkoutId = `${this.bootId}:checkout-${this.sequence + 1}`;
                this.paymentOpen = true;
                this.committed = false;
                this.previousItemCount = Array.isArray(input.items) ? input.items.length : null;
            }
            if (stage === 'FINANCIAL_COMMIT_OK' || stage === 'LEGACY_PERSIST_OK') this.committed = true;
            if (stage === 'PAYMENT_CLOSE') this.paymentOpen = false;
            const data: Record<string, unknown> = {};
            for (const key of fields) if (input[key] !== undefined) data[key] = text(input[key]);
            for (const key of ['total', 'summaryItemCount', 'expectedItemCount'] as const) {
                if (input[key] !== undefined) data[key] = number(input[key]);
            }
            if ('items' in input) {
                data.itemCount = Array.isArray(input.items) ? input.items.length : null;
                data.itemsType = Array.isArray(input.items) ? 'array' : input.items === undefined ? 'absent' : typeof input.items;
                data.linesTruncated = Array.isArray(input.items) && input.items.length > 100;
                data.lines = (Array.isArray(input.items) ? input.items.slice(0, 100) : []).map(value => {
                    const item = object(value);
                    return { id: text(item.id), cartId: text(item.cartId), name: text(item.name),
                        quantity: number(item.quantity), price: number(item.price), total: number(item.totalAmount),
                        net: number(item.netAmount), tax: number(item.taxAmount) };
                });
            }
            if (Array.isArray(input.payments)) {
                data.paymentCount = input.payments.length;
                data.payments = input.payments.slice(0, 20).map(value => {
                    const payment = object(value);
                    return { id: text(payment.id), method: text(payment.method), amount: number(payment.amount),
                        applied: number(payment.appliedAmount ?? payment.amountApplied), change: number(payment.changeAmount) };
                });
            }
            const transactionId = text(input.transactionId);
            if (transactionId && ['TRANSACTION_CREATED', 'FINANCIAL_COMMIT_START'].includes(stage) && this.checkoutId) {
                this.transactionCheckouts.set(transactionId, this.checkoutId);
                if (this.transactionCheckouts.size > 100) this.transactionCheckouts.delete(this.transactionCheckouts.keys().next().value!);
            }
            const emptyFinancial = ['CHECKOUT_CONFIRM', 'TRANSACTION_CREATED', 'FINANCIAL_COMMIT_START', 'OUTBOX_BUILD', 'OUTBOX_SEND'].includes(stage)
                && (!Array.isArray(input.items) || input.items.length === 0);
            const clearedWhilePaying = stage === 'CART_RENDER' && this.paymentOpen && !this.committed
                && Number(this.previousItemCount) > 0 && data.itemCount === 0;
            const record: CheckoutDiagnosticRecord = {
                id: `${this.bootId}:${++this.sequence}`, at: new Date().toISOString(), stage, session: this.session ? { ...this.session } : null,
                checkoutId: transactionId ? this.transactionCheckouts.get(transactionId) || null : this.checkoutId,
                data, capture: {...captureContext}, anomaly: emptyFinancial || clearedWhilePaying,
            };
            this.recent.push(record);
            if (this.recent.length > 128) this.recent.shift();
            this.pending.push(record);
            if (this.pending.length > 256) this.pending.shift();
            if (record.anomaly) {
                const incident = { id: record.id, at: record.at, records: this.recent.slice(-40) };
                this.incidents.push(incident);
                this.pendingIncidents.push(incident);
                if (this.incidents.length > 10) this.incidents.shift();
                if (this.pendingIncidents.length > 10) this.pendingIncidents.shift();
            }
            if (stage === 'CART_RENDER') this.previousItemCount = number(data.itemCount);
            this.schedule();
        } catch { /* Diagnostics must never alter operation, including malformed input. */ }
    }

    async flush(): Promise<void> {
        if (this.writing || (!this.pending.length && !this.pendingIncidents.length)) return;
        this.writing = true;
        const records = this.pending.splice(0);
        const incidents = this.pendingIncidents.splice(0);
        try {
            await this.writer(records, incidents);
        } catch {
            this.pending = [...records, ...this.pending].slice(-256);
            this.pendingIncidents = [...incidents, ...this.pendingIncidents].slice(-10);
        } finally { this.writing = false; }
    }

    snapshot() { return { recent: this.recent.slice(), incidents: this.incidents.slice() }; }
}

let diagnosticsDb: Promise<IDBDatabase> | undefined;
const openDiagnosticsDb = () => diagnosticsDb ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('clic_pos_checkout_diagnostics_v1', 2);
    request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { autoIncrement: true });
        if (!db.objectStoreNames.contains('incidents')) db.createObjectStore('incidents', { keyPath: 'id' }).createIndex('at', 'at');
        const delivery = db.createObjectStore('delivery', { keyPath: 'sequence', autoIncrement: true });
        delivery.createIndex('recordId','event.record_id',{unique:true});
        delivery.createIndex('priority','priority');
        db.createObjectStore('deliveryState', {keyPath:'id'});
        // Upgrade existing local logs once, retaining their original session and identity.
        const cursor = request.transaction!.objectStore('records').openCursor();
        cursor.onsuccess = () => { if (cursor.result) { queueDiagnostic(delivery,cursor.result.value); cursor.result.continue(); } else trimDelivery(delivery); };
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); diagnosticsDb = undefined; }; resolve(request.result); };
    request.onerror = () => { diagnosticsDb = undefined; reject(request.error); };
});
const trimStore = (store: IDBObjectStore, limit: number, chronological = false) => {
    const count = store.count();
    count.onsuccess = () => {
        let remaining = count.result - limit;
        if (remaining <= 0) return;
        const cursor = chronological ? store.index('at').openCursor() : store.openCursor();
        cursor.onsuccess = () => {
            if (cursor.result && remaining-- > 0) { cursor.result.delete(); cursor.result.continue(); }
        };
    };
};
const queueDiagnostic = (store: IDBObjectStore, record: CheckoutDiagnosticRecord) => {
    if (!record.session?.terminalId || !record.session.deviceId || !record.session.versionName) return;
    if (Date.parse(record.session.expiresAt) <= Date.now()) return;
    const row = { session:record.session,event:diagnosticEvent(record,0),priority:record.anomaly?1:0 };
    const added=store.add(row);
    added.onsuccess=()=>store.put({...row,sequence:Number(added.result),event:{...row.event,local_sequence:Number(added.result)}});
};
const trimDelivery = (store: IDBObjectStore) => {
    const count=store.count();count.onsuccess=()=>{let extra=count.result-500;if(extra<=0)return;
        const cursor=store.index('priority').openCursor();cursor.onsuccess=()=>{if(cursor.result&&extra-->0){cursor.result.delete();cursor.result.continue();}};
    };
};
let deliveryTimer: ReturnType<typeof setTimeout> | undefined;
let transport: Awaited<ReturnType<typeof import('./CheckoutDiagnosticTransport')['createDiagnosticTransport']>> | undefined;
const scheduleDelivery = () => {
    if(typeof window==='undefined'||deliveryTimer) return;
    deliveryTimer=setTimeout(()=>{ deliveryTimer=undefined;
        void import('./CheckoutDiagnosticTransport').then(async module=>{
            transport ||= module.createDiagnosticTransport(openDiagnosticsDb);
            if(await transport.run()) scheduleDelivery();
        }).catch(()=>scheduleDelivery());
    },10000);
};
export const readCheckoutDeliveryStatus = async () => {
    const module=await import('./CheckoutDiagnosticTransport');return module.deliveryStatus(await openDiagnosticsDb());
};
// Resume persisted delivery after an app restart, even if capture was subsequently disabled.
if(typeof window!=='undefined') scheduleDelivery();
const writeDiagnostics: DiagnosticWriter = async (records, incidents) => {
    const database = await openDiagnosticsDb();
    await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(['records', 'incidents', 'delivery'], 'readwrite');
        const rows = transaction.objectStore('records');
        const pinned = transaction.objectStore('incidents');
        records.forEach(record => { rows.add(record); queueDiagnostic(transaction.objectStore('delivery'),record); });
        trimDelivery(transaction.objectStore('delivery'));
        incidents.forEach(incident => pinned.put(incident));
        trimStore(rows, 1000);
        trimStore(pinned, 10, true);
        transaction.oncomplete = () => { scheduleDelivery(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
};
let scheduled = false;
const scheduleFlush = () => {
    if (scheduled || typeof window === 'undefined') return;
    scheduled = true;
    window.setTimeout(() => {
        const flush = () => { scheduled = false; void checkoutDiagnostics.flush(); };
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(flush);
        else window.setTimeout(flush, 0);
    }, 5000);
};
export const checkoutDiagnostics = new CheckoutDiagnosticRecorder(writeDiagnostics, scheduleFlush);
const SESSION_KEY = 'clic_pos_checkout_tracking_session_v1';
let activeSession: TrackingSession | null = (() => {
    try {
        const saved = typeof window !== 'undefined' ? window.localStorage.getItem(SESSION_KEY) : null;
        const session = saved ? JSON.parse(saved) : null;
        return session?.id && Date.parse(session.expiresAt) > Date.now() ? session as TrackingSession : null;
    } catch { return null; }
})();
let activeUntil = activeSession ? Date.parse(activeSession.expiresAt) : 0;
checkoutDiagnostics.setSession(activeSession);
export const getCheckoutTrackingSession = (): TrackingSession | null =>
    activeSession && Date.parse(activeSession.expiresAt) > Date.now() ? { ...activeSession } : null;
export const setCheckoutTrackingEnabled = (enabled: boolean, metadata: Partial<TrackingSession> = {}): TrackingSession | null => {
    const session: TrackingSession | null = enabled ? {
        id: uuidv4(), startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        versionName: text(metadata.versionName), versionCode: number(metadata.versionCode),
        terminalId: text(metadata.terminalId), deviceId: text(metadata.deviceId),
    } : null;
    // This write is performed only by the Settings action, never by checkout.
    if (typeof window !== 'undefined') {
        if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        else window.localStorage.removeItem(SESSION_KEY);
    }
    if (!enabled && activeSession) checkoutDiagnostics.record('TRACKING_DISABLED');
    activeSession = session;
    activeUntil = session ? Date.parse(session.expiresAt) : 0;
    checkoutDiagnostics.setSession(session);
    if (session) checkoutDiagnostics.record('TRACKING_ENABLED');
    return session;
};
export const recordCheckoutDiagnostic = (stage: string, input?: CheckoutDiagnosticInput): void => {
    // Disabled path: no projection, storage, timers, logging or network.
    if (!activeSession || Date.now() >= activeUntil) return;
    checkoutDiagnostics.record(stage, input);
};
export const readCheckoutDiagnostics = async () => {
    await checkoutDiagnostics.flush();
    try {
        const database = await openDiagnosticsDb();
        const read = (name: string) => new Promise<any[]>((resolve, reject) => {
            const request = database.transaction(name).objectStore(name).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        const [recent, incidents] = await Promise.all([read('records'), read('incidents')]);
        return { format: 1, exportedAt: new Date().toISOString(), persistence: 'indexeddb', recent, incidents, memory: checkoutDiagnostics.snapshot() };
    } catch {
        return { format: 1, exportedAt: new Date().toISOString(), persistence: 'unavailable', ...checkoutDiagnostics.snapshot() };
    }
};
