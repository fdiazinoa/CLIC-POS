import type { CheckoutDiagnosticRecord, TrackingSession } from './CheckoutDiagnostics';

const stages: Record<string, string> = {
    TRACKING_ENABLED: 'CART_CHANGED', TRACKING_DISABLED: 'CART_CHANGED',
    CHECKOUT_OPEN: 'CHECKOUT_OPENED', CHECKOUT_CONFIRM: 'CHECKOUT_OPENED',
    PAYMENT_MODAL_CONFIRM: 'CHECKOUT_OPENED', PAYMENT_RESULT: 'PAYMENT_CONFIRMED', PAYMENT_CLOSE: 'CART_CHANGED',
    CART_RENDER: 'CART_CHANGED', CART_CLEAR_REQUEST: 'CART_CLEARED', TABLE_CART_CLEAR: 'TABLE_HYDRATED', TABLE_CART_REPLACE: 'TABLE_HYDRATED',
    TRANSACTION_CREATE_INPUT: 'TRANSACTION_CREATED', TRANSACTION_CREATED: 'TRANSACTION_CREATED',
    LEGACY_PERSIST_OK: 'TRANSACTION_PERSISTED', FINANCIAL_COMMIT_START: 'OUTBOX_CREATED', FINANCIAL_COMMIT_OK: 'TRANSACTION_PERSISTED',
    OUTBOX_BUILD: 'OUTBOX_CREATED', OUTBOX_SEND: 'OUTBOX_SEND_STARTED', OUTBOX_RESULT: 'OUTBOX_SEND_RESULT',
    PRINT_DELIVERY_PLAN: 'PRINT_RESULT', PRINT_REQUEST: 'PRINT_REQUESTED', PRINT_RESULT: 'PRINT_RESULT',
};
const scalar = (v: unknown) => typeof v === 'string' ? v.slice(0,160) : typeof v === 'number' && Number.isFinite(v) ? v : null;
const phaseLabels: Record<string,string> = {
    TRACKING_ENABLED:'Seguimiento activado', TRACKING_DISABLED:'Seguimiento desactivado',
    PAYMENT_MODAL_CONFIRM:'Confirmación solicitada en la pantalla de cobro', CHECKOUT_CONFIRM:'Confirmación recibida por el POS',
    TRANSACTION_CREATE_INPUT:'Preparación de la transacción', TRANSACTION_CREATED:'Transacción construida',
    FINANCIAL_COMMIT_START:'Guardado de venta y evento iniciado', FINANCIAL_COMMIT_OK:'Transacción guardada', LEGACY_PERSIST_OK:'Transacción guardada',
    PAYMENT_RESULT:'Cobro finalizado', CART_CLEAR_REQUEST:'Limpieza de carrito solicitada',
    PRINT_DELIVERY_PLAN:'Salida de comprobante prevista', PRINT_REQUEST:'Impresión solicitada', PRINT_RESULT:'Resultado del sistema de impresión; no confirma papel',
};
export const diagnosticBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
export function diagnosticEvent(record: CheckoutDiagnosticRecord, sequence: number) {
    const d = record.data;
    const hasTotal = typeof d.total === 'number' && Number.isFinite(d.total);
    const label = record.stage === 'PAYMENT_RESULT' && d.status !== 'RETURNED' ? 'Cobro sin transacción devuelta' : phaseLabels[record.stage] || record.stage;
    const output = record.stage === 'PRINT_DELIVERY_PLAN' ? ({MANUAL_PRINT_BUTTON:'Pendiente del botón Imprimir',EMAIL_ONLY:'Comprobante por correo',AUTO_GATEWAY_PRINT:'Impresión automática del procesador',INSTALLMENT_FLOW:'Flujo de abono'}[String(d.status)] || 'Salida no determinada') : '';
    const message = `${label}${output ? ': '+output : ''}. ${!hasTotal ? 'Total: No registrado. ' : ''}${d.itemCount == null ? 'Renglones: No registrado.' : ''}`.trim();
    const event = {
        record_id: record.id, local_sequence: sequence, occurred_at: record.at,
        message,
        stage: stages[record.stage] || 'CART_CHANGED', severity: record.anomaly ? 'WARN' : 'INFO',
        anomaly_code: record.anomaly ? 'POS_ITEMS_MISSING' : null,
        ticket_id: scalar(d.displayId), transaction_id: scalar(d.transactionId), event_id: scalar(d.eventId),
        table_id: scalar(d.tableId), order_id: scalar(d.orderId),
        commercial: { item_count: scalar(d.itemCount), total: hasTotal ? Number(d.total) : undefined, lines: (Array.isArray(d.lines) ? d.lines.slice(0,50) : []).map(line => ({
            line_id: scalar(line.cartId), product_id: scalar(line.id), quantity: scalar(line.quantity), unit_amount: scalar(line.price), line_amount: scalar(line.total),
        })) },
        counters: { expected_items: scalar(d.expectedItemCount), summary_items: scalar(d.summaryItemCount), payments_count: scalar(d.paymentCount) },
        details: { operating_mode:record.capture?.mode ?? null, captured_apk_version:record.capture?.versionName ?? null, captured_apk_code:record.capture?.versionCode ?? null, phase:record.stage, total_recorded:hasTotal, items_recorded:d.itemCount != null, source_stage: record.stage.slice(0,100), checkout_id: record.checkoutId, reason: scalar(d.reason), status: scalar(d.status),
            aggregate_id: scalar(d.aggregateId), lines_truncated: Boolean(d.linesTruncated) || Number(d.itemCount) > 50,
            payments: (Array.isArray(d.payments) ? d.payments.slice(0,20) : []).map(p => ({ id: scalar(p.id), method: scalar(p.method), amount: scalar(p.amount), applied: scalar(p.applied), change: scalar(p.change) })) },
    };
    // Truncate detail only; retain actual counts and totals. Leave room for a growing sequence.
    while (diagnosticBytes(event) > 7900 && event.commercial.lines.length) { event.commercial.lines.pop(); event.details.lines_truncated = true; }
    while (diagnosticBytes(event) > 7900 && event.details.payments.length) event.details.payments.pop();
    return event;
}
export type DeliveryRow = { sequence?: number; session: TrackingSession; event: ReturnType<typeof diagnosticEvent> };
export type DeliveryState = { id: string; opened?: boolean; blocked?: string; lastAckAt?: string; lastError?: string; acked?: number };
export type DeliveryContext = { base: string; terminalId: string; deviceId: string; headers: Record<string,string> };
export type DeliveryResponse = { status: number; data: any; retryAfterMs?: number };
export interface DeliveryDependencies {
    rows(): Promise<DeliveryRow[]>;
    state(id: string): Promise<DeliveryState>;
    save(state: DeliveryState): Promise<void>;
    acknowledge(rows: DeliveryRow[], ids: string[], state: DeliveryState): Promise<void>;
    context(): Promise<DeliveryContext | null>;
    post(context: DeliveryContext, path: string, body: unknown): Promise<DeliveryResponse>;
}
export class DiagnosticDeliveryWorker {
    private running = false;
    private retryAt = 0;
    private failures = 0;
    constructor(private deps: DeliveryDependencies, private now = Date.now, private random = Math.random) {}
    async run(): Promise<boolean> {
        if (this.running || this.now() < this.retryAt) return true;
        this.running = true;
        let current: DeliveryState | undefined;
        try {
            const rows = await this.deps.rows();
            if (!rows.length) return false;
            const context = await this.deps.context();
            if (!context) return true;
            let selected: DeliveryRow | undefined;
            for (const row of [...new Map(rows.map(r=>[r.session.id,r])).values()]) {
                const state = await this.deps.state(row.session.id);
                if (state.blocked) continue;
                if (row.session.terminalId !== context.terminalId || row.session.deviceId !== context.deviceId) {
                    await this.deps.save({...state, blocked:'IDENTITY_MISMATCH', lastError:'IDENTITY_MISMATCH'}); continue;
                }
                if (Date.parse(row.session.expiresAt) <= this.now()) {
                    await this.deps.save({...state, blocked:'SESSION_EXPIRED', lastError:'SESSION_EXPIRED'}); continue;
                }
                selected = row; current = state; break;
            }
            if (!selected || !current) return false;
            const session = selected.session;
            const handleFailure = async (response: DeliveryResponse) => {
                const code = String(response.data?.code || `HTTP_${response.status}`).slice(0,100);
                const retryable = response.status === 429 || response.status >= 500;
                if (retryable) this.retryAt = this.now() + Math.max(response.retryAfterMs || Number(response.data?.retry_after_ms) || 0, Math.min(300000, 10000 * 2 ** Math.min(this.failures++,5)) + this.random()*3000);
                await this.deps.save({...current!, lastError:code, ...(!retryable ? {blocked:code} : {})});
                return retryable || rows.some(r=>r.session.id!==session.id);
            };
            if (!current.opened) {
                const response = await this.deps.post(context,'/diagnostics/sessions', {
                    session_id:session.id, device_id:session.deviceId, apk_version:session.versionName,
                    started_at:session.startedAt, expires_at:session.expiresAt, metadata:{reason:'CHECKOUT_TRACKING'},
                });
                if (![200,201].includes(response.status)) return await handleFailure(response);
                if (response.data?.session_id !== session.id) throw new Error('INVALID_SESSION_ACK');
                current = {...current,opened:true,lastError:undefined}; await this.deps.save(current);
            }
            const batch: DeliveryRow[] = [];
            for (const row of rows.filter(r=>r.session.id===session.id)) {
                if (batch.length >= 25 || diagnosticBytes({events:[...batch,row].map(r=>r.event)}) > 240000) break;
                batch.push(row);
            }
            const response = await this.deps.post(context,`/diagnostics/sessions/${encodeURIComponent(session.id)}/events`,{events:batch.map(r=>r.event)});
            if (response.status!==202) return await handleFailure(response);
            const ack = new Set(Array.isArray(response.data?.acked_record_ids) ? response.data.acked_record_ids : []);
            const ids = batch.filter(r=>ack.has(r.event.record_id)).map(r=>r.event.record_id);
            if (!ids.length || response.data?.session_id!==session.id) throw new Error('INVALID_EVENT_ACK');
            await this.deps.acknowledge(batch,ids,{...current,lastAckAt:new Date(this.now()).toISOString(),lastError:undefined,acked:(current.acked||0)+ids.length});
            this.failures=0; this.retryAt=this.now()+10000;
            return rows.length>ids.length;
        } catch {
            this.retryAt=this.now()+Math.min(300000,10000*2**Math.min(this.failures++,5))+this.random()*3000;
            if(current) try { await this.deps.save({...current,lastError:'NETWORK_OR_STORAGE_ERROR'}); } catch { /* never affects checkout */ }
            return true;
        } finally { this.running=false; }
    }
}
