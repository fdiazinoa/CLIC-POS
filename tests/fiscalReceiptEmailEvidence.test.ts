import test from 'node:test';
import assert from 'node:assert/strict';
import { fiscalStatusSourceChecksum } from '../services/fiscal/FiscalStatusProof';
import { buildReceiptEmailPayload } from '../services/email/receiptEmailPayload';
import { prepareFiscalEmailPayload } from '../services/email/fiscalReceiptEmailDelivery';
import { sendReceiptEmailViaErp } from '../services/email/receiptEmailService';
import type { FiscalEmailJob } from '../services/email/FiscalReceiptEmailQueue';

async function fixture(type: string) {
  const binding = JSON.stringify(['tenant', 'terminal', 'device', 'https://erp.invalid', 'https://erp.invalid']);
  const tx: any = { id: 'synthetic-' + type, date: '2026-11-12', terminalId: 'terminal', ncf: type + '0000000001',
    ncfType: type, fiscalProvider: 'MSELLER', fiscalSyncStatus: 'PENDING', documentType: type === 'E34' ? 'REFUND' : 'SALE',
    customerSnapshot: { name: 'Customer', taxId: '101010101' }, total: 100, netAmount: 100, taxAmount: 0,
    items: [{ id: 'water', name: 'Water', quantity: 1, price: 100, v3SaleAuthority: { binding } }], payments: [{ method: 'CASH', amount: 100 }], v3Binding: binding };
  const scope: any = { basis: 'PERSISTED_SUBMISSION_INTENT', providerId: 'MSELLER', environment: 2, issuerRnc: '130090752',
    tenantId: 'tenant', companyId: 'company', terminalId: 'terminal', deviceId: 'device', storeId: 'store', binding,
    sourceChecksum: await fiscalStatusSourceChecksum(tx), capturedAt: '2026-11-12T14:00:00Z' };
  tx.fiscalSubmissionScope = scope;
  const consumer = type === 'E32', signedAt = '12-11-2026 10:00:00';
  const query = new URLSearchParams({ RncEmisor: '130090752', ENCF: tx.ncf, MontoTotal: '100.00', CodigoSeguridad: 'ABC123',
    ...consumer ? {} : { RncComprador: '101010101', FechaEmision: '12-11-2026', FechaFirma: signedAt } });
  const qrUrl = `https://${consumer ? 'fc' : 'ecf'}.dgii.gov.do/ecf/${consumer ? 'ConsultaTimbreFC' : 'ConsultaTimbre'}?${query}`;
  const proof: any = { schemaVersion: 1, source: 'ERP_SCOPED_PROVIDER_GET',
    scope: { tenantId: 'tenant', companyId: 'company', terminalId: 'terminal', deviceId: 'device', storeId: 'store' },
    document: { erpDocumentId: 'erp-id', sourceTransactionId: tx.id, ncf: tx.ncf, ncfType: type, sourceChecksum: scope.sourceChecksum, total: 100 },
    issuer: { rnc: '130090752', providerId: 'MSELLER', environment: 2, credentialCompanyId: 'company', credentialAccountRnc: '130090752' },
    environmentBasis: scope.basis, historicalEnvironment: null, lookup: { requestedNcf: tx.ncf }, decision: 'PENDING',
    observedAt: '2026-11-12T14:01:00Z', providerReceipt: { returnedNcf: tx.ncf, internalTrackId: 'track', status: 'Pending',
      success: true, pending: true, invoiceTotal: 100, printEvidence: { schemaVersion: 1, qrUrl, securityCode: 'ABC123', signedAt } } };
  const job: FiscalEmailJob = { id: 'email', scope: 'scope', state: 'WAITING_SIGNATURE', transaction: structuredClone(tx),
    payload: buildReceiptEmailPayload(tx, 'test@example.invalid', { receiptConfig: { showQr: false } } as any, 'RD$') };
  tx.fiscalPrintProof = proof;
  return { job, tx, proof, qrUrl };
}
for (const type of ['E31', 'E32', 'E34', 'E44', 'E45']) {
  test(`${type}: signed pending evidence is preserved byte-for-byte and required QR overrides hide setting only for email`, async () => {
    const f = await fixture(type), before = JSON.stringify(f.tx);
    const result = await prepareFiscalEmailPayload(f.job, f.tx);
    assert.ok(result); assert.equal((result.fiscalPrintEvidence as any).qrUrl, f.qrUrl);
    assert.equal(result.fiscalValidated, false); assert.equal(result.showQr, true);
    assert.equal((result.receiptDesign as any).showQr, true);
    assert.equal(f.job.payload.showQr, false); assert.equal(JSON.stringify(f.tx), before);
    let sent: any;
    const delivery = await sendReceiptEmailViaErp(result, {
      readCredentials: () => ({ syncToken: 'synthetic', tenantId: 'tenant', companyId: 'company', terminalId: 'terminal', deviceId: 'device' }),
      request: async request => { sent = request.body; return { ok: true, status: 200, headers: { 'Content-Type': 'application/json' },
        data: { success: true, id: 'synthetic-resend' }, text: '{}', networkEngine: 'fetch', fetchStage: 'response' }; },
    });
    assert.equal(delivery.success, true); assert.equal(sent.fiscalPrintEvidence.qrUrl, f.qrUrl);
    assert.equal(sent.fiscalValidated, false);

    f.tx.total = 101; assert.equal(await prepareFiscalEmailPayload(f.job, f.tx), undefined);
  });
}
test('missing retained original leaves mail pending', async () => {
  const f = await fixture('E34'); assert.equal(await prepareFiscalEmailPayload(f.job, null), undefined);
});

test('foreign security code or unsigned eCF never produces a ready mail payload', async () => {
  const f = await fixture('E34');
  f.tx.fiscalPrintProof.providerReceipt.printEvidence.securityCode = 'XXXXXX';
  assert.equal(await prepareFiscalEmailPayload(f.job, f.tx), undefined);
});
