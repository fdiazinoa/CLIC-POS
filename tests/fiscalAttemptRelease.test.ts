import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NativeFiscalWorkflowV2Store, FISCAL_WORKFLOW_V2_SCHEMA } from '../services/db/FiscalWorkflowV2Store';
import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';
import { DURABLE_OUTBOX_SCHEMA_SQL } from '../services/sync/DurableOutboxSchema';
import { createFiscalWorkflowV2Client } from '../services/fiscal/FiscalWorkflowV2Client';
import { fiscalWorkflowScopeKey } from '../services/fiscal/FiscalWorkflowV2Types';
import type { FiscalWorkflowPermitV2 } from '../services/fiscal/FiscalWorkflowV2Types';

const scope = { tenantId: 'tenant', companyId: 'company', storeId: 'store', terminalId: 'terminal', deviceId: 'device' };
const key = fiscalWorkflowScopeKey(scope);
const base = 'https://erp.example.invalid/api/sync';
const headers = { 'X-Tenant-Id': 'tenant', 'X-Terminal-Id': 'terminal', 'X-Device-Id': 'device', 'X-Sync-Token': 'synthetic' };

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(FISCAL_WORKFLOW_V2_SCHEMA + DURABLE_OUTBOX_SCHEMA_SQL
    + "CREATE TABLE documents(collection_name TEXT,doc_id TEXT,data TEXT,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id));"
    + "CREATE TABLE IF NOT EXISTS sync_queue(id TEXT PRIMARY KEY,payload TEXT);");
  const bridge = {
    query: async (q: string, v: any[] = []) => ({ values: sql.prepare(q).all(...v) }),
    run: async (q: string, v: any[] = []) => ({ changes: sql.prepare(q).run(...v) }),
    execute: async (q: string) => { sql.exec(q); },
  };
  const adapter = new CapacitorSQLiteAdapter();
  Object.assign(adapter, { db: bridge, isReady: true });
  const store = adapter.fiscalWorkflowStore;
  const permit = (index: number): FiscalWorkflowPermitV2 => ({
    schemaVersion: 2, permitId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    transactionId: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`, nonce: `nonce-${index}`,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), scope,
    issuerRnc: '101010101', environment: 0, authorityHash: 'a'.repeat(64), operationKind: 'SALE', state: 'PERMIT',
  });
  return { sql, store, permit };
}

const receiptFor = (proof: any): any => ({
  schemaVersion: 1, commandId: proof.commandId, checkoutId: proof.checkoutId, permitId: proof.permitId,
  transactionId: proof.transactionId, originalOperationId: proof.originalOperationId,
  cartIdentitySha256: proof.cartIdentitySha256, reason: proof.reason, scope, state: 'HELD' as const,
  closedAt: new Date().toISOString(), historyId: '20000000-0000-4000-8000-000000000001',
});

const proofFor = async (checkout: any) => {
  const { cartDigest, retirementReason } = await import('../services/fiscal/FiscalWorkflowRetirement');
  return {
    schemaVersion: 1 as const, commandId: '30000000-0000-4000-8000-000000000001', checkoutId: checkout.checkoutId,
    transactionId: checkout.transactionId, permitId: checkout.permit.permitId,
    originalOperationId: checkout.operationId, cartIdentitySha256: await cartDigest(checkout.cartIdentity),
    reason: retirementReason,
  };
};

const clientFor = (store: any, respond: (url: string, body: any) => any) => createFiscalWorkflowV2Client({
  store: () => store,
  readAuth: () => ({ base, headers, descriptor: scope, assertCurrent() { } }),
  readOfflineAuthority: async () => { throw Error('OFFLINE_FISCAL_BINDING_CHANGED'); },
  fetchImpl: async (url: string, init: any) => respond(String(url), init?.body ? JSON.parse(init.body) : null),
} as any);

test('an attempt with a possible effect is closed only with the ERP receipt and leaves the pointer empty', async () => {
  const f = fixture();
  try {
    const op = await f.store.refillOperation(key);
    await f.store.savePermits(key, op, [f.permit(1)]);
    const checkout = await f.store.reserveCheckout(key, 'cart', undefined, '40000000-0000-4000-8000-000000000001', { requirePermit: true, authorityHash: 'a'.repeat(64) });
    await f.store.markPaymentPossible(checkout.checkoutId, 'payment-one');
    assert.equal((await f.store.currentCheckout(key))!.phase, 'EFFECT_POSSIBLE');
    const proof = await proofFor(checkout);
    // The expired-prepared path can never accept a possible effect: that is the dead end.
    await assert.rejects(f.store.beginRetirement(key, proof), /RETIREMENT_RECONCILIATION_REQUIRED/);
    const closed = await f.store.closeUnbornRetirement!(key, proof, receiptFor(proof));
    assert.equal(closed.phase, 'CLOSED');
    assert.equal(closed.receipt!.state, 'HELD');
    assert.equal(await f.store.currentCheckout(key), null);
    assert.equal(f.sql.prepare("SELECT count(*) n FROM pos_fiscal_checkout_retirements_v1 WHERE phase='CLOSED'").get().n, 1);
    // A receipt for another identity is refused, never recorded.
    await assert.rejects(f.store.closeUnbornRetirement!(key, proof, { ...receiptFor(proof), permitId: f.permit(9).permitId }), /RECONCILIATION|INVALID/);
  } finally { f.sql.close(); }
});

test('a possible effect that already left a document is never released', async () => {
  const f = fixture();
  try {
    const op = await f.store.refillOperation(key);
    await f.store.savePermits(key, op, [f.permit(2)]);
    const checkout = await f.store.reserveCheckout(key, 'cart', undefined, '40000000-0000-4000-8000-000000000002', { requirePermit: true, authorityHash: 'a'.repeat(64) });
    await f.store.markPaymentPossible(checkout.checkoutId, 'payment-two');
    f.sql.prepare("INSERT INTO documents(collection_name,doc_id,data)VALUES('transactions',?,?)")
      .run(checkout.transactionId, JSON.stringify({ id: checkout.transactionId }));
    const proof = await proofFor(checkout);
    await assert.rejects(f.store.closeUnbornRetirement!(key, proof, receiptFor(proof)), /RETIREMENT_RECONCILIATION_REQUIRED/);
    assert.equal((await f.store.currentCheckout(key))!.phase, 'EFFECT_POSSIBLE');
    assert.equal(f.sql.prepare('SELECT count(*) n FROM pos_fiscal_checkout_retirements_v1').get().n, 0);
  } finally { f.sql.close(); }
});

test('the client asks the ERP before touching a possible effect and reports its refusal unchanged', async () => {
  const f = fixture();
  try {
    const op = await f.store.refillOperation(key);
    await f.store.savePermits(key, op, [f.permit(3)]);
    const checkout = await f.store.reserveCheckout(key, 'cart', undefined, '40000000-0000-4000-8000-000000000003', { requirePermit: true, authorityHash: 'a'.repeat(64) });
    await f.store.markPaymentPossible(checkout.checkoutId, 'payment-three');
    const calls: string[] = [];
    const refusing = clientFor(f.store, (url, body) => {
      calls.push(url);
      return { ok: false, json: async () => ({ code: 'FISCAL_WORKFLOW_DOCUMENT_EXISTS' }) };
    });
    const refused = await refusing.cancelUnreconcilableAttempt({ tags: ['40000000-0000-4000-8000-000000000003'], cartIdentity: 'another-cart' });
    assert.equal(refused.cancelled, false);
    assert.match(refused.note, /FISCAL_WORKFLOW_DOCUMENT_EXISTS/);
    assert.deepEqual(calls, [`${base}/fiscal/workflow/v2/retire-unborn`]);
    assert.equal((await f.store.currentCheckout(key))!.phase, 'EFFECT_POSSIBLE', 'a refusal leaves the attempt untouched');

    const accepting = clientFor(f.store, (url, body) => {
      calls.push(url);
      return { ok: true, json: async () => receiptFor(body) };
    });
    const retired = await accepting.cancelUnreconcilableAttempt({ tags: ['40000000-0000-4000-8000-000000000003'], cartIdentity: 'another-cart' });
    assert.equal(retired.cancelled, true);
    assert.equal(await f.store.currentCheckout(key), null);
    assert.equal(f.sql.prepare("SELECT count(*) n FROM pos_fiscal_checkout_retirements_v1 WHERE phase='CLOSED'").get().n, 1);
  } finally { f.sql.close(); }
});

test('a pending attempt that still matches this ticket is left alone', async () => {
  const f = fixture();
  try {
    const op = await f.store.refillOperation(key);
    await f.store.savePermits(key, op, [f.permit(4)]);
    const checkout = await f.store.reserveCheckout(key, 'cart', undefined, '40000000-0000-4000-8000-000000000004', { requirePermit: true, authorityHash: 'a'.repeat(64) });
    const client = clientFor(f.store, () => { throw Error('the ERP must not be called'); });
    const outcome = await client.cancelUnreconcilableAttempt({ tags: ['40000000-0000-4000-8000-000000000004'], cartIdentity: checkout.cartIdentity });
    assert.equal(outcome.cancelled, false);
    assert.match(outcome.note, /mismo ticket/);
    assert.equal((await f.store.currentCheckout(key))!.checkoutId, checkout.checkoutId);
  } finally { f.sql.close(); }
});
