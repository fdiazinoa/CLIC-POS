import { createUuid } from '../../utils/uuid';
import { assertReturnPreparation, assertReturnAdmission, buildReturnSource, returnContract, returnJSON, sameReturn, returnNeed, type ReturnAttempt } from '../fiscal/FiscalReturnV1';
import type { FiscalWorkflowScope } from '../fiscal/FiscalWorkflowV2Types';
import type { FinancialCommitInput } from './DatabaseAdapter';
import { planFinancialNumbers } from './FinancialNumberReservation';
import { financialIdentity } from './LargeMasterSyncV3FinancialRetention';
type SQL = {
    query: (sql: string, values?: any[]) => Promise<{
        values?: any[];
    }>;
    run: (sql: string, values?: any[], transaction?: boolean) => Promise<any>;
};
export const FISCAL_RETURN_SCHEMA = `
CREATE TABLE IF NOT EXISTS pos_fiscal_return_attempts_v1(id TEXT PRIMARY KEY,slot TEXT NOT NULL UNIQUE,transaction_id TEXT UNIQUE,data TEXT NOT NULL,phase TEXT NOT NULL CHECK(phase IN('WAITING_AUTHORITY','PREPARING','PREPARED','SEALED','COMMITTED')));
CREATE TRIGGER IF NOT EXISTS pos_return_phase_v1 BEFORE UPDATE ON pos_fiscal_return_attempts_v1
WHEN (CASE NEW.phase WHEN 'WAITING_AUTHORITY' THEN 0 WHEN 'PREPARING' THEN 1 WHEN 'PREPARED' THEN 2 WHEN 'SEALED' THEN 3 ELSE 4 END)<(CASE OLD.phase WHEN 'WAITING_AUTHORITY' THEN 0 WHEN 'PREPARING' THEN 1 WHEN 'PREPARED' THEN 2 WHEN 'SEALED' THEN 3 ELSE 4 END)
OR NEW.phase IN('PREPARING','PREPARED','SEALED','COMMITTED') AND json_extract(NEW.data,'$.commandBytes') IS NULL
OR NEW.phase IN('PREPARED','SEALED','COMMITTED') AND json_extract(NEW.data,'$.preparation') IS NULL
OR NEW.phase IN('SEALED','COMMITTED') AND (json_extract(NEW.data,'$.source') IS NULL OR json_extract(NEW.data,'$.localCommittedAt') IS NULL)
BEGIN SELECT RAISE(ABORT,'FISCAL_RETURN_PHASE_CONFLICT');END;
CREATE TRIGGER IF NOT EXISTS pos_return_no_delete_v1 BEFORE DELETE ON pos_fiscal_return_attempts_v1 BEGIN SELECT RAISE(ABORT,'FISCAL_RETURN_RECOVERY_REQUIRED');END;
CREATE TRIGGER IF NOT EXISTS pos_return_identity_v1 BEFORE UPDATE ON pos_fiscal_return_attempts_v1
WHEN OLD.id<>NEW.id OR OLD.slot<>NEW.slot OR OLD.transaction_id IS NOT NULL AND OLD.transaction_id IS NOT NEW.transaction_id
OR json_extract(OLD.data,'$.intent')<>json_extract(NEW.data,'$.intent') OR json_extract(OLD.data,'$.scope')<>json_extract(NEW.data,'$.scope')
OR json_extract(OLD.data,'$.operationId')<>json_extract(NEW.data,'$.operationId') OR json_extract(OLD.data,'$.paymentIds')<>json_extract(NEW.data,'$.paymentIds')
OR json_extract(OLD.data,'$.financialEventId')<>json_extract(NEW.data,'$.financialEventId') OR json_extract(OLD.data,'$.paymentEventId')<>json_extract(NEW.data,'$.paymentEventId')
OR json_extract(OLD.data,'$.commandBytes') IS NOT NULL AND json_extract(OLD.data,'$.commandBytes') IS NOT json_extract(NEW.data,'$.commandBytes')
OR json_extract(OLD.data,'$.preparation') IS NOT NULL AND json_extract(OLD.data,'$.preparation') IS NOT json_extract(NEW.data,'$.preparation')
OR json_extract(OLD.data,'$.localCommittedAt') IS NOT NULL AND json_extract(OLD.data,'$.localCommittedAt') IS NOT json_extract(NEW.data,'$.localCommittedAt')
OR json_extract(OLD.data,'$.checkout') IS NOT NULL AND json_extract(OLD.data,'$.checkout') IS NOT json_extract(NEW.data,'$.checkout')
OR json_extract(OLD.data,'$.source') IS NOT NULL AND json_extract(OLD.data,'$.source') IS NOT json_extract(NEW.data,'$.source')
OR OLD.phase='COMMITTED' AND OLD.data<>NEW.data BEGIN SELECT RAISE(ABORT,'FISCAL_RETURN_IDENTITY_CONFLICT');END;
`;
export class NativeFiscalReturnStore {
    constructor(private connection: () => SQL, private locked: <T>(work: () => Promise<T>) => Promise<T>, private transaction: <T>(work: () => Promise<T>) => Promise<T>) { }
    private async read(column: string, value: string) { const r = (await this.connection().query(`SELECT data FROM pos_fiscal_return_attempts_v1 WHERE ${column}=?`, [value])).values?.[0]; return r ? JSON.parse(r.data) as ReturnAttempt : null; }
    get(id: string) { return this.locked(() => this.read('id', id)); }
    byTransaction(id: string) { return this.locked(() => this.read('transaction_id', id)); }
    active(scope: FiscalWorkflowScope, originalId: string) {
        return this.locked(async () => {
            const rows = (await this.connection().query("SELECT data FROM pos_fiscal_return_attempts_v1 r WHERE json_extract(json_extract(data,'$.intent'),'$.originalId')=? AND NOT EXISTS(SELECT 1 FROM pos_fiscal_checkouts_v2 c WHERE c.transaction_id=r.transaction_id AND c.phase='ACKNOWLEDGED')", [originalId])).values || [];
            const pending = rows.map(r => JSON.parse(r.data) as ReturnAttempt).filter(a => sameReturn(a.scope, scope));
            returnNeed(pending.length <= 1, 'FISCAL_RETURN_RECOVERY_REQUIRED');
            return pending[0] || null;
        });
    }
    acknowledgeApplied(eventId: string) {
        return this.transaction(async () => {
            const row = (await this.connection().query("SELECT data FROM pos_fiscal_return_attempts_v1 WHERE phase='COMMITTED' AND (json_extract(data,'$.financialEventId')=? OR json_extract(data,'$.paymentEventId')=?)", [eventId, eventId])).values?.[0];
            if (!row)
                return;
            const a = JSON.parse(row.data) as ReturnAttempt;
            const ids = [a.financialEventId, ...(a.preparation!.returnSnapshot.paymentCommands.length ? [a.paymentEventId] : [])];
            for (const id of ids) {
                const event = (await this.connection().query('SELECT status,payload_json FROM sync_outbox_v2 WHERE event_id=?', [id])).values?.[0];
                if (event?.status !== 'APPLIED_ERP')
                    return;
                returnNeed(sameReturn(JSON.parse(event.payload_json).fiscalReturnContract, returnContract(a)), 'FISCAL_RETURN_ACK_CONFLICT');
            }
            const current = (await this.connection().query('SELECT checkout_json FROM pos_fiscal_checkouts_v2 WHERE checkout_id=?', [a.checkout!.checkoutId])).values?.[0];
            const checkout = current && JSON.parse(current.checkout_json);
            returnNeed(checkout && ['COMMITTED', 'ACKNOWLEDGED'].includes(checkout.phase), 'FISCAL_RETURN_COMMIT_RECEIPT_REQUIRED');
            checkout.phase = 'ACKNOWLEDGED';
            await this.connection().run("UPDATE pos_fiscal_checkouts_v2 SET phase='ACKNOWLEDGED',checkout_json=? WHERE checkout_id=?", [JSON.stringify(checkout), checkout.checkoutId], false);
            await this.connection().run("UPDATE documents SET data=json_set(data,'$.syncStatus','APPLIED_ERP') WHERE collection_name IN('transactions','transactionHistory') AND doc_id=?", [checkout.transactionId], false);
        });
    }
    fence(id: string) {
        return this.transaction(async () => {
            const a = await this.read('id', id);
            returnNeed(a?.phase === 'SEALED' && a.preparation && a.admission, 'FISCAL_RETURN_PREPARATION_REQUIRED');
            assertReturnAdmission(a!.admission.capability, a!.scope, a!.preparation);
            const row = (await this.connection().query('SELECT checkout_json FROM pos_fiscal_checkouts_v2 WHERE checkout_id=?', [a!.checkout!.checkoutId])).values?.[0];
            const checkout = row && JSON.parse(row.checkout_json);
            returnNeed(checkout && ['PREPARED', 'EFFECT_POSSIBLE'].includes(checkout.phase) && checkout.transactionId === a!.preparation!.transactionId && checkout.operationId === a!.operationId && checkout.offlineSaleDate === a!.checkout!.offlineSaleDate, 'FISCAL_RETURN_CHECKOUT_CONFLICT');
            checkout.phase = 'EFFECT_POSSIBLE';
            checkout.paymentIds = a!.preparation!.returnSnapshot.paymentCommands.map((p: any) => p.id);
            checkout.offlineEffectAt = checkout.offlineEffectAt || a!.localCommittedAt;
            await this.connection().run("UPDATE pos_fiscal_pending_numbers_v2 SET state='EFFECT_POSSIBLE' WHERE checkout_id=? AND state IN('PREPARED','EFFECT_POSSIBLE')", [checkout.checkoutId], false);
            await this.connection().run("UPDATE pos_fiscal_checkouts_v2 SET phase='EFFECT_POSSIBLE',checkout_json=? WHERE checkout_id=?", [JSON.stringify(checkout), checkout.checkoutId], false);
        });
    }
    begin(slot: string, intent: string, scope: FiscalWorkflowScope, paymentCount: number) {
        return this.transaction(async () => {
            const prior = await this.read('slot', slot);
            if (prior) {
                returnNeed(prior.intent === intent && sameReturn(prior.scope, scope), 'FISCAL_RETURN_IDEMPOTENCY_CONFLICT');
                return prior;
            }
            const attempt: ReturnAttempt = { id: createUuid(), slot, scope, intent, operationId: createUuid(), financialEventId: createUuid(), paymentEventId: createUuid(), paymentIds: Array.from({ length: paymentCount }, () => createUuid()), phase: 'WAITING_AUTHORITY' };
            await this.connection().run('INSERT INTO pos_fiscal_return_attempts_v1 VALUES(?,?,NULL,?,?)', [attempt.id, slot, JSON.stringify(attempt), attempt.phase], false);
            return attempt;
        });
    }
    save(expected: ReturnAttempt, next: ReturnAttempt) {
        return this.transaction(async () => {
            returnNeed(next.id === expected.id, 'FISCAL_RETURN_IDEMPOTENCY_CONFLICT');
            const current = await this.read('id', expected.id);
            returnNeed(sameReturn(current, expected), 'FISCAL_RETURN_IDEMPOTENCY_CONFLICT');
            await this.connection().run('UPDATE pos_fiscal_return_attempts_v1 SET transaction_id=?,data=?,phase=? WHERE id=?', [next.checkout?.transactionId || null, JSON.stringify(next), next.phase, next.id], false);
            return next;
        });
    }
}
/** Runs INSIDE the existing native financial transaction. All assertions precede durable publication. */
export async function consumeNativeFiscalReturn(sql: SQL, input: FinancialCommitInput) {
    const events = [input.outboxEvent, ...(input.additionalOutboxEvents || [])];
    const source = input.documents.find(x => x.collectionName === 'transactions' && x.document.documentType === 'REFUND' && x.document.ncfType === 'E34' && !x.document.articleFormatWire);
    if (!source)
        return;
    const rows = (await sql.query('SELECT data FROM pos_fiscal_return_attempts_v1 WHERE transaction_id=?', [source.document.id])).values || [];
    returnNeed(rows.length === 1, 'FISCAL_RETURN_PREPARATION_REQUIRED');
    const a = JSON.parse(rows[0].data) as ReturnAttempt;
    returnNeed(a.phase === 'SEALED' && a.source && a.preparation && a.localCommittedAt && a.admission, 'FISCAL_RETURN_PREPARATION_REQUIRED');
    await assertReturnPreparation(a.preparation!, a);
    assertReturnAdmission(a.admission.capability, a.scope, a.preparation);
    returnNeed(Date.now() - Date.parse(a.admission.checkedAt) >= 0 && Date.now() - Date.parse(a.admission.checkedAt) < 15000, 'FISCAL_RETURN_ADMISSION_EXPIRED');
    const local = Date.parse(a.localCommittedAt!), p = a.preparation!;
    const civil = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(n);
    returnNeed(Date.parse(p.preparedAt) <= local && local <= Date.parse(p.expiresAt) && Date.parse(a.checkout!.offlineSaleDate!) <= local && civil(local) === civil(Date.parse(a.checkout!.offlineSaleDate!)), 'FISCAL_RETURN_LOCAL_COMMIT_TIME_REQUIRED');
    const originalRow = (await sql.query("SELECT data FROM documents WHERE collection_name IN('transactions','transactionHistory') AND doc_id=? ORDER BY CASE collection_name WHEN 'transactions' THEN 0 ELSE 1 END LIMIT 1", [p.originalReference.transactionId])).values?.[0];
    returnNeed(originalRow, 'FISCAL_RETURN_ORIGINAL_REQUIRED');
    const intent = JSON.parse(a.intent), expected = buildReturnSource(a, JSON.parse(originalRow.data), intent.seriesId, intent.user);
    const withoutNumber = (t: any) => ({ ...t, displayId: undefined, seriesNumber: undefined, globalSequence: undefined });
    returnNeed(financialIdentity(withoutNumber(source.document)) === financialIdentity(withoutNumber(a.source)) && financialIdentity(withoutNumber(source.document)) === financialIdentity(withoutNumber(expected)), 'FISCAL_RETURN_SOURCE_MISMATCH');
    const seriesRow = (await sql.query("SELECT data FROM documents WHERE collection_name='internalSequences' AND doc_id=?", [source.document.seriesId])).values?.[0];
    const series = seriesRow && JSON.parse(seriesRow.data);
    const number = planFinancialNumbers({ seriesId: source.document.seriesId, documentType: 'REFUND', global: false }, series, undefined);
    const mutation = input.documents.filter(d => d.collectionName === 'internalSequences');
    returnNeed(mutation.length === 1 && mutation[0].expectedDocument === seriesRow?.data && sameReturn(mutation[0].document, number.series) && source.document.displayId === number.result.displayId && source.document.seriesNumber === number.result.seriesNumber, 'FISCAL_RETURN_NUMBER_PLAN_CHANGED');
    const nc = events.find(e => e.eventType === 'SALES_CREDIT_NOTE_POSTED');
    returnNeed(nc?.eventId === a.financialEventId && sameReturn(nc.payload.fiscalReturnContract, returnContract(a)) && nc.payload.fiscalWorkflowBirth?.checkoutId === a.checkout!.checkoutId && sameReturn(nc.payload.inventoryMovementIds, p.inventoryMovementIds), 'FISCAL_RETURN_EVENT_MISMATCH');
    const payment = events.find(e => e.eventType === 'PAYMENT_POSTED');
    returnNeed(p.returnSnapshot.paymentCommands.length ? payment?.eventId === a.paymentEventId && sameReturn(payment.payload.fiscalReturnContract, returnContract(a)) && sameReturn(payment.payload.payments, p.returnSnapshot.paymentCommands) : !payment, 'FISCAL_RETURN_PAYMENT_INVALID');
    const ledger = input.documents.filter(d => d.collectionName === 'inventoryLedger');
    returnNeed(sameReturn(ledger.map(d => d.document.id).sort(), [...p.inventoryMovementIds].sort()), 'FISCAL_RETURN_STOCK_IDENTITY_REQUIRED');
    for (const l of p.returnSnapshot.lines)
        for (const stock of l.inventoryEntries) {
            const movement = ledger.find(d => d.document.id === `V3-${p.transactionId}-${encodeURIComponent(l.cartId)}`)?.document;
            returnNeed(movement?.productId === stock.itemId && movement?.qtyIn === stock.quantity && movement?.qtyOut === 0 && movement?.unitCost === stock.unitCost, 'FISCAL_RETURN_STOCK_MISMATCH');
        }
    // The same transaction commits this receipt, source/history, counters, allocation and Outbox.
    const committed = { ...a, phase: 'COMMITTED' as const, committedSource: source.document };
    await sql.run("UPDATE pos_fiscal_return_attempts_v1 SET phase='COMMITTED',data=? WHERE id=? AND phase='SEALED'", [JSON.stringify(committed), a.id], false);
}
