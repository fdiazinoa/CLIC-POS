import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';
import { dbAdapter } from '../services/db';
import { db } from '../utils/db';
import { transactionService } from '../services/transactionService';
import { DEFAULT_TERMINAL_CONFIG } from '../constants';
import { applyTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';

const terminalId = 'fiscal-terminal';
const lot = { id: 'lot', type: 'B02', prefix: 'B02', startNumber: 100, endNumber: 110,
  currentGlobal: 99, expiryDate: '2099-12-31', isActive: true };
const allocation = { id: 'allocation', terminalId, fiscalRangeId: 'lot', ncfType: 'B02',
  reservedStart: 100, reservedEnd: 110, nextNumber: 100, status: 'ACTIVE' };
const config = () => ({ terminals: [{ id: terminalId, config: {
  ...structuredClone(DEFAULT_TERMINAL_CONFIG), erpTerminalId: terminalId,
  erpBinding: { companyId: 'company-a' }, fiscal: { enabled: true, mode: 'LEGACY_B', fiscalAllocations: [allocation], fiscalRanges: [lot] },
} }] } as any);
const apply = (documents: object, identity: object = {}) => applyTerminalConfigSnapshot(config(), {
  terminalId, incomingSnapshot: { terminal_id: terminalId, company_id: 'company-a', ...identity,
    fiscalMode: 'LEGACY_B', resolved: { documents } } as any,
});

test('snapshot cannot relabel a foreign terminal allocation or manufacture malformed authority', () => {
  for (const patch of [{ terminalId: 'foreign' }, { terminalId: '' }, { ncfType: 'UNKNOWN' }, { ncfType: '' }, { id: '' },
    { metadata: { companyId: 'company-b' } }, { company_id: 'company-b' }, { metadata: { sourceTerminalId: 'foreign' } }]) {
    const result = apply({ fiscal_allocations: [{ ...allocation, ...patch }], fiscal_ranges: [lot] });
    assert.deepEqual(result.config.terminals[0].config.fiscal.fiscalAllocations, []);
  }
});
test('all explicit assignment aliases revoke old assignments, including snake tenant alias', () => {
  for (const key of ['fiscal_allocations', 'fiscalAllocations', 'fiscal_allocations_by_tenant', 'fiscalAllocationsByTenant']) {
    assert.deepEqual(apply({ [key]: [] }).config.terminals[0].config.fiscal.fiscalAllocations, []);
  }
});
test('snapshot company mismatch cannot reuse previously downloaded fiscal assignments', () => {
  assert.throws(() => apply({ fiscal_allocations: [allocation] }, { company_id: 'company-b' }), /FISCAL_TERMINAL_COMPANY_MISMATCH/);
});
test('malformed or unidentified lots never become downloaded authorizations', () => {
  for (const patch of [{ id: '' }, { type: 'UNKNOWN' }, { startNumber: 'not-a-number100' }]) {
    assert.deepEqual(apply({ fiscal_ranges: [{ ...lot, ...patch }], fiscal_allocations: [] }).config.terminals[0].config.fiscal.fiscalRanges, []);
  }
});

test('payment authority check executes before every integrated provider intent without releasing the V3 fence', async () => {
  const source = readFileSync(new URL('../components/PaymentModal.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('   const authorizeIntegratedCardPayment =');
  const end = source.indexOf('   const buildPaymentEntry =', start);
  assert.ok(start > 0 && end > start);
  let intents = 0; let providerCalls = 0; let fenceReleases = 0; let checks = 0;
  const context = createContext({
    resolvePaymentMethodForEntry: () => ({}), resolveGatewayIntegrationForPayment: () => ({ provider: 'AZUL' }),
    roundToTwo: (n: number) => n, selectedCurrency: { rate: 1 }, baseCurrency: { code: 'DOP' },
    calculateGatewayTaxAmount: () => 0, createAzulOrderNumber: () => 'test',
    beforePaymentEffects: async () => () => { fenceReleases++; },
    validatePaymentAuthority: async () => { checks++; throw new Error('FISCAL_TERMINAL_AUTHORITY_REQUIRED'); },
    paymentIntentService: { create: async () => { intents++; } },
    azulGatewayService: { sale: async () => { providerCalls++; } },
  });
  new Script(ts.transpileModule(source.slice(start, end) + '\nglobalThis.authorize = authorizeIntegratedCardPayment;',
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText).runInContext(context);
  for (let index = 0; index < 2; index++) await assert.rejects(context.authorize({ id: `payment-${index}`, amount: 10 }), /FISCAL_TERMINAL_AUTHORITY_REQUIRED/);
  assert.equal(checks, 2); assert.equal(intents, 0); assert.equal(providerCalls, 0); assert.equal(fenceReleases, 0);
});

test('transaction boundary rejects unauthorized prepared fiscal document before sequence or transaction writes', async () => {
  const get = dbAdapter.getCollection; const save = dbAdapter.saveCollection; const document = dbAdapter.saveDocument;
  let writes = 0;
  try {
    (dbAdapter as any).getCollection = async (name: string) => name === 'fiscalRanges' ? [lot] : [];
    (dbAdapter as any).saveCollection = async () => { writes++; };
    (dbAdapter as any).saveDocument = async () => { writes++; };
    await assert.rejects(transactionService.createTransaction({ documentType: 'TICKET', seriesId: 'TICKET',
      terminalId, ncfType: 'B02', ncf: 'B0200000100' }), /FISCAL_TERMINAL_AUTHORITY_REQUIRED/);
    assert.equal(writes, 0);
    await db.assertFiscalTransactionAuthority({ documentType: 'TICKET' }, { fiscal: { mode: 'NONE' } } as any);
    await assert.rejects(db.assertFiscalTransactionAuthority({ documentType: 'TICKET', terminalId },
      { fiscal: { mode: 'LEGACY_B' } } as any), /FISCAL_TERMINAL_AUTHORITY_REQUIRED/);
  } finally { dbAdapter.getCollection = get; dbAdapter.saveCollection = save; dbAdapter.saveDocument = document; }
});

test('production checkout guard blocks sales and refunds before non-V3 payment effects and preserves explicit NONE/order taker', async () => {
  const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('   const assertCheckoutFiscalAuthority =');
  const end = source.indexOf('   const startCheckoutInteraction =', start);
  assert.ok(start > 0 && end > start);
  const get = dbAdapter.getCollection; const save = dbAdapter.saveCollection;
  let writes = 0; let fences = 0;
  try {
    (dbAdapter as any).getCollection = async (name: string) => name === 'fiscalRanges' ? [lot] : [];
    (dbAdapter as any).saveCollection = async () => { writes++; };
    const context = createContext({ db, isOrderTakerMode: false, isFiscalModeDisabled: false,
      activeTerminalConfig: { erpTerminalId: terminalId, fiscal: { mode: 'LEGACY_B', enabled: true } },
      processedCart: [{ quantity: 1 }], requiredSaleFiscalType: 'B02', terminalId,
      fiscalCompliance: { mode: 'LEGACY_B' },
      isTerminalFiscalReceiptRequired: (terminal: any) => terminal?.fiscal?.mode !== 'NONE',
      resolveCreditNoteFiscalCode: () => 'B04', v3Operational: null, cart: [],
      setLargeMasterSyncV3CriticalOperation: () => { fences++; },
    });
    new Script(ts.transpileModule(source.slice(start, end) + '\nglobalThis.before = beforeV3PaymentEffects;',
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText).runInContext(context);
    for (const quantities of [[1], [-1], [1, -1]]) {
      context.processedCart = quantities.map(quantity => ({ quantity }));
      await assert.rejects(context.before(), /lote fiscal/);
    }
    assert.equal(writes, 0); assert.equal(fences, 0);
    context.isFiscalModeDisabled = true;
    context.activeTerminalConfig.fiscal.mode = 'NONE';
    assert.equal(typeof await context.before(), 'function');
    context.isFiscalModeDisabled = false; context.isOrderTakerMode = true;
    assert.equal(typeof await context.before(), 'function');
  } finally { dbAdapter.getCollection = get; dbAdapter.saveCollection = save; }
});
