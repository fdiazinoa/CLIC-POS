import { absoluteFiscalRecoveryIdentity } from '../fiscal/AbsoluteFiscalRecoveryIdentity';
import { cartDigest } from '../fiscal/FiscalWorkflowRetirement';
import { fiscalWorkflowScopeKey, type FiscalWorkflowCheckoutV2, type FiscalWorkflowScope } from '../fiscal/FiscalWorkflowV2Types';
import { allocationHash, type OfflineFiscalAllocation } from '../fiscal/OfflineFiscalAllocation';
import { offlineFiscalAuthorityFromConfig } from '../fiscal/OfflineFiscalLeaseContext';
import { assertRetirementHasNoEffects, FISCAL_RETIREMENT_WRITER_SCHEMA } from './FiscalWorkflowRetirementStore';
import { NATIVE_FISCAL_HISTORY_FIELDS } from './NativeFiscalReservation';

type SQL = { query(sql: string, values?: any[]): Promise<{ values?: any[] }>; run(sql: string, values?: any[], transaction?: boolean): Promise<any> };
type Identity = NonNullable<ReturnType<typeof absoluteFiscalRecoveryIdentity>>;
export type AbsoluteFiscalRecoveryCandidate = Identity & { snapshotHash: string };

const markerPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:payment:0$/i;
const fail = (reason: string): never => { throw Error(`ABSOLUTE_FISCAL_RECOVERY_HELD: ${reason}`); };
const one = async (sql: SQL, statement: string, values: any[] = []) => (await sql.query(statement, values)).values?.[0];

export const ABSOLUTE_FISCAL_RECOVERY_SCHEMA = `
CREATE TABLE IF NOT EXISTS pos_absolute_fiscal_recovery_v2 (
 incident INTEGER PRIMARY KEY CHECK(incident=1), checkout_id TEXT NOT NULL UNIQUE REFERENCES pos_fiscal_checkouts_v2(checkout_id),
 transaction_id TEXT NOT NULL UNIQUE, scope_key TEXT NOT NULL, operation_id TEXT NOT NULL, authorization_id TEXT NOT NULL,
 issuer_rnc TEXT NOT NULL CHECK(issuer_rnc='131397662'), environment INTEGER NOT NULL CHECK(environment=2),
 allocation_id TEXT NOT NULL, buffer_id TEXT NOT NULL, authority_hash TEXT NOT NULL CHECK(length(authority_hash)=64), ncf TEXT NOT NULL CHECK(ncf GLOB 'E32[0-9]*' AND length(ncf)=13),
 sequence INTEGER NOT NULL, payment_id TEXT NOT NULL UNIQUE, checkout_json TEXT NOT NULL, actor TEXT NOT NULL,
 created_at TEXT NOT NULL, remote_reference TEXT NOT NULL CHECK(length(remote_reference)=64 AND remote_reference NOT GLOB '*[^0-9a-f]*'), reason TEXT NOT NULL CHECK(reason='SUPERVISOR_CONFIRMED_UNPAID_AND_REMOTE_ABSENT'),
 CHECK(substr(checkout_id,1,9)='496e3827-' AND json_extract(scope_key,'$.tenantId') IS 'b2e01916-309a-414f-b9f0-636352d25318' AND json_extract(scope_key,'$.companyId') IS '39ac760d-bd18-4611-8251-84eaec00dea1' AND json_extract(scope_key,'$.storeId') IS '7f3a2d1a-4d10-4f9c-afed-9b4d55f417c2' AND json_extract(scope_key,'$.terminalId') IS '31d2162e-1767-4f74-8e72-7c73a3341e96')
);
CREATE TRIGGER IF NOT EXISTS pos_absolute_recovery_immutable_update_v2 BEFORE UPDATE ON pos_absolute_fiscal_recovery_v2 BEGIN SELECT RAISE(ABORT,'ABSOLUTE_FISCAL_RECOVERY_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS pos_absolute_recovery_immutable_delete_v2 BEFORE DELETE ON pos_absolute_fiscal_recovery_v2 BEGIN SELECT RAISE(ABORT,'ABSOLUTE_FISCAL_RECOVERY_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS pos_absolute_recovery_immutable_replace_v2 BEFORE INSERT ON pos_absolute_fiscal_recovery_v2 WHEN EXISTS(SELECT 1 FROM pos_absolute_fiscal_recovery_v2) BEGIN SELECT RAISE(ABORT,'ABSOLUTE_FISCAL_RECOVERY_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS pos_absolute_recovery_checkout_insert_v2 BEFORE INSERT ON pos_fiscal_checkouts_v2 WHEN EXISTS(SELECT 1 FROM pos_absolute_fiscal_recovery_v2 WHERE checkout_id=NEW.checkout_id COLLATE NOCASE OR transaction_id=NEW.transaction_id COLLATE NOCASE OR (scope_key=NEW.scope_key AND operation_id=json_extract(NEW.checkout_json,'$.operationId') COLLATE NOCASE)) BEGIN SELECT RAISE(ABORT,'ABSOLUTE_FISCAL_RECOVERY_FENCED');END;
CREATE TRIGGER IF NOT EXISTS pos_absolute_recovery_checkout_update_v2 BEFORE UPDATE ON pos_fiscal_checkouts_v2 WHEN EXISTS(SELECT 1 FROM pos_absolute_fiscal_recovery_v2 WHERE checkout_id=OLD.checkout_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'ABSOLUTE_FISCAL_RECOVERY_FENCED');END;
CREATE TRIGGER IF NOT EXISTS pos_absolute_recovery_pointer_insert_v2 BEFORE INSERT ON pos_fiscal_checkout_current_v2 WHEN EXISTS(SELECT 1 FROM pos_absolute_fiscal_recovery_v2 WHERE checkout_id=NEW.checkout_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'ABSOLUTE_FISCAL_RECOVERY_FENCED');END;
CREATE TRIGGER IF NOT EXISTS pos_absolute_recovery_pointer_update_v2 BEFORE UPDATE ON pos_fiscal_checkout_current_v2 WHEN EXISTS(SELECT 1 FROM pos_absolute_fiscal_recovery_v2 WHERE checkout_id=OLD.checkout_id COLLATE NOCASE OR checkout_id=NEW.checkout_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'ABSOLUTE_FISCAL_RECOVERY_FENCED');END;
`;

export const ABSOLUTE_FISCAL_RECOVERY_WRITER_SCHEMA = FISCAL_RETIREMENT_WRITER_SCHEMA
    .replaceAll('retired_', 'absolute_recovered_')
    .replaceAll('pos_fiscal_checkout_retirements_v1', 'pos_absolute_fiscal_recovery_v2')
    .replaceAll('permit_id', 'operation_id')
    .replaceAll("'$.fiscalWorkflowBirth.permitId'", "'$.transaction.fiscalCheckoutOperationId'")
    .replaceAll("'wallet_transactions','recoveryOriginals'", "'wallet_transactions','nativeFiscalReservations','recoveryOriginals'")
    .replaceAll('IN (r.transaction_id,r.checkout_id,r.operation_id)', 'IN (r.transaction_id,r.checkout_id,r.operation_id,r.payment_id)')
    .replaceAll('FISCAL_WORKFLOW_RETIREMENT_FENCED', 'ABSOLUTE_FISCAL_RECOVERY_FENCED')
    + ['INSERT', 'UPDATE'].map(event => `CREATE TRIGGER IF NOT EXISTS pos_absolute_recovery_payment_${event.toLowerCase()}_v2 BEFORE ${event} ON payment_intents_v2 WHEN EXISTS(SELECT 1 FROM pos_absolute_fiscal_recovery_v2 WHERE payment_id=NEW.payment_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'ABSOLUTE_FISCAL_RECOVERY_FENCED');END;`).join('\n');

export async function absoluteFiscalRecoveryCandidate(checkout: FiscalWorkflowCheckoutV2 | null, scope: FiscalWorkflowScope): Promise<AbsoluteFiscalRecoveryCandidate | null> {
    const identity = absoluteFiscalRecoveryIdentity(scope, checkout);
    return identity ? { ...identity, snapshotHash: await cartDigest(JSON.stringify(checkout)) } : null;
}

/** Runs on the already-owned native transaction. An absent or stale grant still blocks any new payment. */
export async function releaseAbsoluteFiscalAttempt(sql: SQL, scope: FiscalWorkflowScope, expected: AbsoluteFiscalRecoveryCandidate, observedNcf: string, remoteReference: string, actor: string): Promise<void> {
    if (actor.length < 2 || actor.length > 120 || observedNcf !== expected.ncf || !/^[0-9a-f]{64}$/.test(remoteReference)) fail('CONFIRMATION_MISMATCH');
    const scopeKey = fiscalWorkflowScopeKey(scope);
    const row = await one(sql, `SELECT c.* FROM pos_fiscal_checkout_current_v2 p JOIN pos_fiscal_checkouts_v2 c
        ON p.checkout_id=c.checkout_id AND p.scope_key=c.scope_key WHERE p.scope_key=? AND p.checkout_id=?`, [scopeKey, expected.checkoutId]);
    const checkout: FiscalWorkflowCheckoutV2 | null = row ? JSON.parse(row.checkout_json) : null;
    const candidate = await absoluteFiscalRecoveryCandidate(checkout, scope);
    if (!checkout || !candidate || Object.keys(candidate).some(key => candidate[key as keyof AbsoluteFiscalRecoveryCandidate] !== expected[key as keyof AbsoluteFiscalRecoveryCandidate])) fail('CHECKOUT_MISMATCH');
    if (row.phase !== checkout.phase || row.transaction_id !== checkout.transactionId || row.permit_id !== null || row.cart_identity !== checkout.cartIdentity) fail('CHECKOUT_MISMATCH');
    const allocation = checkout.allocation!;
    const [marker] = checkout.paymentIds;
    if (checkout.paymentIds.length !== 1 || !markerPattern.test(marker)) fail('PAYMENT_MARKER_MISMATCH');
    const cart = JSON.parse(checkout.cartIdentity);
    if (checkout.fiscalSaleContext || cart.fiscalType !== 'E32' || cart.fiscalSaleContext || cart.serviceType || cart.originalTransactionId || (cart.documentType !== undefined && cart.documentType !== 'TICKET')
        || !Array.isArray(cart.items) || !cart.items.length || cart.items.some((line: any) => !line || line.articleFormat || line.trackingData?.length || line.recipeDetails?.length)) fail('UNSUPPORTED_RETAIL_ATTEMPT');
    const config = await one(sql, "SELECT data FROM documents WHERE collection_name='config' AND doc_id='current'");
    const local = await offlineFiscalAuthorityFromConfig(JSON.parse(config?.data ?? 'null'));
    if (fiscalWorkflowScopeKey(local.scope) !== scopeKey || local.issuerRnc !== '131397662' || local.environment !== 2) fail('LOCAL_AUTHORITY_MISMATCH');
    const grantRow = await one(sql, 'SELECT * FROM pos_offline_fiscal_allocations_v2 WHERE authorization_id=? AND scope_key=?', [allocation.authorizationId, scopeKey]);
    if (!grantRow || grantRow.revoked !== 0) fail('LOCAL_GRANT_UNAVAILABLE');
    const grant: OfflineFiscalAllocation = JSON.parse(grantRow.authority_json);
    const { authorityHash, ...unsigned } = grant;
    if (grant.contractVersion !== 2 || grant.authorizationKind !== 'OFFLINE_FISCAL_ALLOCATION_V2' || grant.provider !== 'MSELLER' || grant.issuerRnc !== local.issuerRnc || grant.environment !== local.environment
        || grant.authorizationId !== allocation.authorizationId || fiscalWorkflowScopeKey(grant.scope) !== scopeKey || authorityHash !== allocation.authorityHash || await allocationHash(unsigned) !== authorityHash
        || !grant.allocations.some(member => member.allocationId === allocation.allocationId && member.fiscalRangeId === allocation.fiscalRangeId && member.ncfType === 'E32' && allocation.sequence >= member.start && allocation.sequence <= member.end)
        || allocation.ncf !== `E32${String(allocation.sequence).padStart(10, '0')}`) fail('LOCAL_GRANT_MISMATCH');

    const claim = await one(sql, 'SELECT * FROM pos_fiscal_pending_numbers_v2 WHERE checkout_id=?', [checkout.checkoutId]);
    if (!claim || claim.state !== 'EFFECT_POSSIBLE' || claim.account_key !== null || claim.transaction_id !== checkout.transactionId || claim.authorization_id !== allocation.authorizationId
        || claim.issuer_rnc !== local.issuerRnc || claim.environment !== local.environment || claim.allocation_id !== allocation.allocationId || claim.buffer_id !== allocation.bufferId
        || claim.ncf !== allocation.ncf || claim.sequence !== allocation.sequence) fail('PENDING_NUMBER_MISMATCH');
    for (const table of ['pos_dispatch_precharge_v1', 'pos_tracking_checkout_v1']) {
        if (await one(sql, `SELECT 1 FROM ${table} WHERE checkout_id=? OR transaction_id=? LIMIT 1`, [checkout.checkoutId, checkout.transactionId])) fail('RELATED_CHECKOUT_EXISTS');
    }
    if (await one(sql, 'SELECT 1 FROM pos_fiscal_return_attempts_v1 WHERE transaction_id=? LIMIT 1', [checkout.transactionId])) fail('RELATED_CHECKOUT_EXISTS');
    if (await one(sql, 'SELECT 1 FROM payment_intents_v2 WHERE transaction_id=? COLLATE NOCASE OR payment_id=? COLLATE NOCASE LIMIT 1', [checkout.transactionId, marker])) fail('PAYMENT_INTENT_EXISTS');

    const aliases = [...new Set(Array.from({ length: 10 }, (_, index) => `E32${String(allocation.sequence).padStart(index + 1, '0')}`))];
    const placeholders = aliases.map(() => '?').join(',');
    if (await one(sql, `SELECT 1 FROM documents WHERE collection_name='nativeFiscalReservations' AND UPPER(TRIM(json_extract(data,'$.ncf'))) IN (${placeholders})
        AND (json_extract(data,'$.issuerRnc') IS NULL OR json_extract(data,'$.issuerRnc')=?) AND (json_extract(data,'$.environment') IS NULL OR json_extract(data,'$.environment')=?) LIMIT 1`, [...aliases, local.issuerRnc, local.environment])) fail('LOCAL_RECEIPT_EXISTS');
    for (const field of NATIVE_FISCAL_HISTORY_FIELDS) {
        if (await one(sql, `SELECT 1 FROM documents WHERE collection_name IN ('transactions','transactionHistory') AND UPPER(TRIM(json_extract(data,'$.${field}'))) IN (${placeholders}) LIMIT 1`, aliases)) fail('LOCAL_RECEIPT_EXISTS');
    }
    await assertRetirementHasNoEffects(sql, { checkoutId: checkout.checkoutId, transactionId: checkout.transactionId, permitId: checkout.operationId }, { targetedQueues: true });
    await assertRetirementHasNoEffects(sql, { checkoutId: checkout.checkoutId, transactionId: checkout.transactionId, permitId: marker }, { targetedQueues: true });

    await sql.run(`INSERT INTO pos_absolute_fiscal_recovery_v2(incident,checkout_id,transaction_id,scope_key,operation_id,authorization_id,issuer_rnc,environment,allocation_id,buffer_id,authority_hash,ncf,sequence,payment_id,checkout_json,actor,created_at,remote_reference,reason)
        VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'SUPERVISOR_CONFIRMED_UNPAID_AND_REMOTE_ABSENT')`,
    [checkout.checkoutId, checkout.transactionId, scopeKey, checkout.operationId, allocation.authorizationId, local.issuerRnc, local.environment,
        allocation.allocationId, allocation.bufferId, authorityHash, allocation.ncf, allocation.sequence, marker, row.checkout_json, actor, new Date().toISOString(), remoteReference], false);
    await sql.run("UPDATE pos_fiscal_pending_numbers_v2 SET state='ABANDONED' WHERE checkout_id=? AND state='EFFECT_POSSIBLE'", [checkout.checkoutId], false);
    if (Number((await one(sql, 'SELECT changes() AS n'))?.n) !== 1) fail('PENDING_NUMBER_NOT_RELEASED');
    await sql.run('DELETE FROM pos_fiscal_checkout_current_v2 WHERE scope_key=? AND checkout_id=?', [scopeKey, checkout.checkoutId], false);
    if (Number((await one(sql, 'SELECT changes() AS n'))?.n) !== 1) fail('CURRENT_CHECKOUT_NOT_RELEASED');
}
