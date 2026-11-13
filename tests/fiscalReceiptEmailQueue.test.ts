import test from 'node:test';
import assert from 'node:assert/strict';
import { FiscalReceiptEmailQueue, type FiscalEmailJob } from '../services/email/FiscalReceiptEmailQueue';
import { sendReceiptEmailViaErp, withReceiptDeliveryRequestId } from '../services/email/receiptEmailService';

function fixture() {
  const rows = new Map<string, FiscalEmailJob>();
  let scope = 'tenant/company/terminal/device', now = 1, signed = false, counter = 0;
  const deliveries: any[] = [];
  let response = { success: true, id: 'resend-id' };
  const ports = {
    scope: () => scope, now: () => now, id: () => `request-${++counter}`,
    list: async () => structuredClone([...rows.values()]),
    save: async (job: FiscalEmailJob) => { rows.set(job.id, structuredClone(job)); },
    prepare: async (job: FiscalEmailJob) => signed ? { ...job.payload,
      fiscalPrintEvidence: { qrUrl: 'https://signed.invalid', securityCode: 'ABC123' }, fiscalValidated: false, showQr: true } : undefined,
    send: async (payload: any) => { deliveries.push(structuredClone(payload)); return response; },
  };
  return { rows, ports, deliveries, queue: new FiscalReceiptEmailQueue(ports),
    sign: () => { signed = true; }, advance: (ms = 60_001) => { now += ms; },
    switchScope: () => { scope = 'different-company'; }, fail: () => { response = { success: false, id: '' }; } };
}
const transaction = { id: 'transaction', ncfType: 'E34', ncf: 'E340000000001', documentType: 'REFUND', total: 100 } as any;
const payload = { email: 'client@example.invalid', cart: [{ name: 'Water' }], ncfType: 'E34', ncf: transaction.ncf };

test('NC waits durably without sending; restart and signature sends while DGII is pending', async () => {
  const f = fixture();
  const result = await f.queue.enqueue(transaction, payload);
  assert.equal(result.status, 'pending_signature');
  assert.equal(f.rows.size, 1);
  await f.queue.runAutomatic(); assert.equal(f.deliveries.length, 0);
  const restarted = new FiscalReceiptEmailQueue(f.ports);
  f.sign(); f.advance(); await restarted.runAutomatic();
  assert.equal(f.deliveries.length, 1);
  assert.equal(f.deliveries[0].fiscalValidated, false);
  assert.equal(f.deliveries[0].deliveryRequestId, 'request-1');
  assert.equal(f.rows.get('request-1')?.state, 'SENT');
  await restarted.runAutomatic(); assert.equal(f.deliveries.length, 1);
});

test('double click and overlapping rounds retain one durable request and one delivery', async () => {
  const f = fixture();
  await Promise.all([f.queue.enqueue(transaction, payload), f.queue.enqueue(transaction, payload)]);
  assert.equal(f.rows.size, 1);
  f.sign(); await Promise.all([f.queue.runAutomatic(), f.queue.runAutomatic()]);
  assert.equal(f.deliveries.length, 1);
});

test('response loss/reconnection keeps exact body and ID; unknown delivery beyond 24h is held', async () => {
  const f = fixture(); f.sign(); f.fail();
  await f.queue.enqueue(transaction, payload); await f.queue.runAutomatic();
  f.advance(); const restarted = new FiscalReceiptEmailQueue(f.ports); await restarted.runAutomatic();
  assert.deepEqual(f.deliveries[0], f.deliveries[1]);
  f.advance(24 * 60 * 60 * 1000); await restarted.runAutomatic();
  assert.equal(f.deliveries.length, 2);
  assert.equal(f.rows.get('request-1')?.state, 'REVIEW');
  assert.equal((await restarted.enqueue(transaction, payload)).success, false);
});

test('company/terminal change never sends the other scope pending mail', async () => {
  const f = fixture(); await f.queue.enqueue(transaction, payload); f.sign(); f.switchScope();
  await f.queue.runAutomatic(); assert.equal(f.deliveries.length, 0);
});

test('storage failure cannot acknowledge a queued request or send its email', async () => {
  const f = fixture(); f.ports.save = async () => { throw Error('disk full'); };
  const queue = new FiscalReceiptEmailQueue(f.ports);
  await assert.rejects(queue.enqueue(transaction, payload), /disk full/);
  await queue.runAutomatic(); assert.equal(f.deliveries.length, 0);
});

test('waiting on signature/network does not delay enqueueing the next sale mail', async () => {
  const f = fixture(); f.sign();
  let release!: () => void;
  f.ports.send = async p => { await new Promise<void>(resolve => { release = resolve; }); return { success: true, id: 'id' }; };
  await f.queue.enqueue(transaction, payload);
  const round = f.queue.runAutomatic();
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  const next = await f.queue.enqueue({ ...transaction, id: 'next-sale' }, payload);
  assert.equal(next.status, 'pending_signature');
  release(); await round;
});

test('delivery request ID survives explicit network retries', () => {
  const original = withReceiptDeliveryRequestId(payload);
  assert.equal(withReceiptDeliveryRequestId(original).deliveryRequestId, original.deliveryRequestId);
});

for (const type of ['E31', 'E32', 'E34', 'E44', 'E45']) {
  test(`${type}: low-level sender refuses unsigned or hidden fiscal QR before making a request`, async () => {
    let calls = 0;
    const deps = { request: async () => { calls++; throw Error('must not call'); } };
    for (const extra of [{}, { fiscalPrintEvidence: { qrUrl: 'url', securityCode: 'ABC123', signedAt: 'date', certifiedNcf: type + '0000000001' }, showQr: false }]) {
      const result = await sendReceiptEmailViaErp({ ...payload, ncfType: type, ncf: type + '0000000001', ...extra }, deps);
      assert.equal(result.success, false); assert.equal(result.status, 'pending_signature');
    }
    assert.equal(calls, 0);
  });
}

test('authorization refresh cannot send the same email under another company', async () => {
  let company = 'original', calls = 0;
  const result = await sendReceiptEmailViaErp({ email: payload.email, cart: payload.cart }, {
    readCredentials: () => ({ syncToken: 'token', companyId: company, erpTenantId: 'tenant', terminalId: 'terminal', deviceId: 'device' }),
    refreshAuthorization: async () => { company = 'other'; },
    request: async () => { calls++; return { ok: false, status: 401, headers: {}, data: {}, text: '{}', networkEngine: 'fetch', fetchStage: 'response' }; },
  });
  assert.equal(calls, 1); assert.equal(result.success, false); assert.match(result.message!, /vinculación/);
});

test('native SQLite adapter durably recovers the email intent after adapter remount, without financial writes', async () => {
  const { nativeFixture } = await import('./articleFormatsNativeFixture');
  const f = await nativeFixture();
  try {
    const collection = 'fiscalReceiptEmailRequests';
    const baseline = f.db.prepare("SELECT collection_name,doc_id,data FROM documents WHERE collection_name<>? ORDER BY collection_name,doc_id").all(collection);
    const memory = fixture();
    const ports = { ...memory.ports,
      list: () => f.adapter.getCollection<FiscalEmailJob>(collection),
      save: (job: FiscalEmailJob) => f.adapter.saveDocument(collection, job) };
    await new FiscalReceiptEmailQueue(ports).enqueue(transaction, payload);
    assert.equal((await ports.list()).length, 1);
    const remount = await nativeFixture(f.db, false);
    const recovered = new FiscalReceiptEmailQueue({ ...ports,
      list: () => remount.adapter.getCollection<FiscalEmailJob>(collection),
      save: job => remount.adapter.saveDocument(collection, job) });
    memory.sign(); await recovered.runAutomatic();
    assert.equal(memory.deliveries.length, 1);
    assert.equal((await ports.list())[0].state, 'SENT');
    assert.deepEqual(f.db.prepare("SELECT collection_name,doc_id,data FROM documents WHERE collection_name<>? ORDER BY collection_name,doc_id").all(collection), baseline);
  } finally { f.db.close(); }
});

test('five documents lacking signature cannot starve a later signed document', async () => {
  const f = fixture();
  for (let i = 0; i < 6; i++) await f.queue.enqueue({ ...transaction, id: `tx-${i}` }, payload);
  const normalPrepare = f.ports.prepare;
  f.sign(); f.ports.prepare = async job => job.transaction.id === 'tx-5' ? normalPrepare(job) : undefined;
  const queue = new FiscalReceiptEmailQueue(f.ports);
  await queue.runAutomatic(); assert.equal(f.deliveries.length, 0);
  f.advance(); await queue.runAutomatic();
  assert.equal(f.deliveries.length, 1); assert.equal(f.deliveries[0].deliveryRequestId, 'request-6');
});

test('legacy type cannot bypass the signature requirement when the actual NCF is electronic', async () => {
  const result = await sendReceiptEmailViaErp({ ...payload, ncfType: 'B04' });
  assert.equal(result.success, false); assert.equal(result.status, 'pending_signature');
});
