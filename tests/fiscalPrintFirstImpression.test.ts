import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_FISCAL_PRINT_WAIT_MS,
  MAX_FISCAL_PRINT_WAIT_MS,
  resolveFiscalPrintBudget,
  resolveFiscalPrintReadiness,
} from '../services/fiscal/FiscalPrintEvidence';
import { fiscalStatusSourceChecksum } from '../services/fiscal/FiscalStatusProof';

/** Signed ERP workflow state for a sale that only gets its signature after the first polls. */
async function workflowFixture() {
  const binding = JSON.stringify(['tenant', 'terminal', 'device', 'https://erp.invalid', 'https://erp.invalid']);
  const tx: any = {
    id: 'original', date: '2026-10-16T03:30:00Z', terminalId: 'terminal', ncf: 'E310000001021', electronicNcf: 'E310000001021',
    ncfType: 'E31', customerSnapshot: { name: 'Comprador', taxId: '101010101' }, currency: 'DOP', fiscalEnvironment: 0,
    fiscalProvider: 'MSELLER', fiscalSyncStatus: 'PENDING', v3Binding: binding,
    v3InventoryBaseline: JSON.stringify([binding, 'S', 1, 1, 'C']),
    items: [{ id: 'P', cartId: 'P', name: 'Water', quantity: 1, price: 352, netAmount: 352, taxAmount: 0, totalAmount: 352, v3SaleAuthority: { binding } }],
    payments: [{ method: 'CASH', amount: 352 }], total: 352, netAmount: 352, taxAmount: 0,
    fiscalIssuance: { issuerRnc: '130090752', tenantId: 'tenant', companyId: 'company', terminalId: 'terminal' },
  };
  const envelope = { transaction: JSON.parse(JSON.stringify(tx)) };
  const scope = { tenantId: 'tenant', companyId: 'company', storeId: 'store', terminalId: 'terminal', deviceId: 'device' };
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const { sha256Utf8 } = await import('../services/sync/LargeMasterSyncV3Client');
  const state: any = {
    schemaVersion: 2, source: 'ERP_POS_FISCAL_WORKFLOW_V2', mode: 'WORKFLOW', transactionId: tx.id, workflowId: 'permit', permitId: 'permit',
    scope, issuerRnc: '130090752', environment: 0, ncf: tx.ncf, ncfType: 'E31', currency: 'DOP', exchangeRate: 1, total: 352,
    saleEventId: 'event', originalSourceEnvelope: envelope,
    originalDigestV2: await sha256Utf8(JSON.stringify(canonical({ schemaVersion: 2, source: 'POS_ORIGINAL_ENVELOPE_V2', scope, saleEventId: 'event', payload: envelope }))),
    checksumV1: await fiscalStatusSourceChecksum(tx), observationVersion: 3, draftRevision: 1,
    decision: 'ACCEPTED_CONDITIONAL', state: 'ACCEPTED_CONDITIONAL', buyer: { name: 'Comprador fiscal efectivo', taxId: '101010101' },
    canCorrect: false, observedAt: '2026-10-18T03:31:00Z', history: [],
    signature: {
      schemaVersion: 1,
      qrUrl: 'https://ecf.dgii.gov.do/testecf/ConsultaTimbre?RncEmisor=130090752&RncComprador=101010101&ENCF=E310000001021&FechaEmision=15-10-2026&MontoTotal=352.00&FechaFirma=15-10-2026%2023%3A30%3A53&CodigoSeguridad=NVrTbH',
      securityCode: 'NVrTbH', signedAt: '15-10-2026 23:30:53',
    },
  };
  return { tx, state };
}

test('la primera impresión espera la firma tardía y la devuelve firmada', async () => {
  const { fiscalWorkflowV2Client } = await import('../services/fiscal/FiscalWorkflowV2Client');
  const f = await workflowFixture();
  const before = JSON.stringify(f.tx);
  const oldCached = fiscalWorkflowV2Client.cached, oldConsult = fiscalWorkflowV2Client.consult, oldEnabled = fiscalWorkflowV2Client.enabled;
  let ready = false;
  const startedAt = Date.now();
  const signatureArrivesAfterMs = 200;
  fiscalWorkflowV2Client.enabled = () => true;
  fiscalWorkflowV2Client.cached = async () => ready ? f.state : null;
  fiscalWorkflowV2Client.consult = async () => {
    if (Date.now() - startedAt >= signatureArrivesAfterMs) ready = true;
    return ready ? f.state : { ...f.state, signature: undefined, decision: 'PENDING', state: 'PENDING' };
  };
  try {
    const display = await resolveFiscalPrintReadiness(f.tx, { timeoutMs: 10000 });
    assert.ok(display, 'la primera impresión (10 s) debe capturar la firma que llega después de los 8 s');
    assert.match(display.qrUrl, /ConsultaTimbre/);
    assert.equal(display.certifiedNcf, 'E310000001021');
    assert.equal(JSON.stringify(f.tx), before, 'la venta retenida nunca se reescribe por imprimir');
  } finally {
    fiscalWorkflowV2Client.cached = oldCached; fiscalWorkflowV2Client.consult = oldConsult; fiscalWorkflowV2Client.enabled = oldEnabled;
  }
});

test('un timeout corto cae a la impresión genérica sin retener ni mutar la venta', async () => {
  const { fiscalWorkflowV2Client } = await import('../services/fiscal/FiscalWorkflowV2Client');
  const f = await workflowFixture();
  const before = JSON.stringify(f.tx);
  const oldCached = fiscalWorkflowV2Client.cached, oldConsult = fiscalWorkflowV2Client.consult, oldEnabled = fiscalWorkflowV2Client.enabled;
  fiscalWorkflowV2Client.enabled = () => true;
  fiscalWorkflowV2Client.cached = async () => null;
  fiscalWorkflowV2Client.consult = async () => ({ ...f.state, signature: undefined, decision: 'PENDING', state: 'PENDING' });
  try {
    const start = Date.now();
    assert.equal(await resolveFiscalPrintReadiness(f.tx, { timeoutMs: 150 }), undefined);
    assert.ok(Date.now() - start < 1500);
    assert.equal(JSON.stringify(f.tx), before);
  } finally {
    fiscalWorkflowV2Client.cached = oldCached; fiscalWorkflowV2Client.consult = oldConsult; fiscalWorkflowV2Client.enabled = oldEnabled;
  }
});

test('el presupuesto de espera mantiene default 8 s, amplía hasta 60 s y nunca es negativo', () => {
  assert.equal(DEFAULT_FISCAL_PRINT_WAIT_MS, 8000);
  assert.equal(MAX_FISCAL_PRINT_WAIT_MS, 60000);
  assert.equal(resolveFiscalPrintBudget(), 8000, 'reimpresión sin opciones conserva 8 s');
  assert.equal(resolveFiscalPrintBudget(undefined), 8000);
  assert.equal(resolveFiscalPrintBudget(30000), 30000, 'el tope admite presupuestos ampliados');
  assert.equal(resolveFiscalPrintBudget(10000), 10000, 'primera impresión espera hasta 10 s');
  assert.equal(resolveFiscalPrintBudget(15000), 15000);
  assert.equal(resolveFiscalPrintBudget(90000), 60000, 'tope duro configurable');
  assert.equal(resolveFiscalPrintBudget(0), 0);
  assert.equal(resolveFiscalPrintBudget(-5), 0);
  assert.equal(resolveFiscalPrintBudget(Number.NaN), 8000);
});

test('printer y PaymentModal cablean 10 s sólo en la primera impresión; el historial conserva 8 s', () => {
  const printer = readFileSync(new URL('../utils/printer.ts', import.meta.url), 'utf8');
  assert.match(printer, /fiscalWaitMs\?: number/);
  assert.match(printer, /const fiscalWaitMs=options\.fiscalWaitMs\?\?DEFAULT_FISCAL_PRINT_WAIT_MS/);
  assert.match(printer, /resolveFiscalPrintReadiness\(transaction,\{timeoutMs:fiscalWaitMs\}\)/);
  assert.match(printer, /if\(!fiscalPrint\)options\.onFiscalPending\?\.\(\);/, 'la versión genérica avisa una sola vez');

  const payment = readFileSync(new URL('../components/PaymentModal.tsx', import.meta.url), 'utf8');
  assert.match(payment, /fiscalWaitMs: 10000/);
  assert.match(payment, /'Generando comprobante fiscal firmado…'/);
  assert.match(payment, /se imprimió una versión genérica una sola vez/);
  assert.match(payment, /printTicketPending\.current/);
  assert.match(payment, /if \(accepted && !canStartNewSale\) onClose\(\);/);

  const history = readFileSync(new URL('../components/TicketHistory.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(history, /fiscalWaitMs/, 'las reimpresiones desde historial mantienen el default corto');
});
