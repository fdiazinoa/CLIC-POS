import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyAuthoritativeProductTaxes,
  normalizeErpTaxDefinition,
  reconcileOpenCartFiscalData,
} from '../utils/erpFiscalCatalogSync';
import { calculateTransactionTaxSummary } from '../utils/taxSummary';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const taxId = '7e70f4fd-240d-4665-99c9-603f3615ee0e';

test('tax_id singular del ERP reemplaza asociaciones fiscales locales antiguas', () => {
  const product = applyAuthoritativeProductTaxes({
    id: 'shirt-a',
    sku: 'REF-0001',
    name: 'CAMISA A',
    taxable: true,
    tax_id: taxId,
    tax_ids: undefined,
    appliedTaxIds: ['legacy-tax'],
  });
  assert.equal(product.taxable, true);
  assert.deepEqual(product.tax_ids, [taxId]);
  assert.deepEqual(product.appliedTaxIds, [taxId]);
});

test('taxable false limpia todas las asociaciones aunque llegue un id', () => {
  const product = applyAuthoritativeProductTaxes<Record<string, unknown>>({ taxable: false, tax_id: taxId });
  assert.equal(product.taxable, false);
  assert.deepEqual(product.tax_ids, []);
  assert.deepEqual(product.appliedTaxIds, []);
});

test('rate 0.18 se interpreta como 18 por ciento y calcula RD$67.50 sobre RD$375', () => {
  const tax = normalizeErpTaxDefinition({ id: taxId, code: '001', name: 'ITBIS', rate: 0.18 });
  assert.equal(tax.rate, 0.18);
  const result = calculateTransactionTaxSummary([
    { id: 'shirt-a', name: 'CAMISA A', sku: 'REF-0001', price: 375, quantity: 1, taxable: true, appliedTaxIds: [taxId] } as any,
  ], [tax], false);
  assert.equal(result.netAmount, 375);
  assert.equal(result.taxAmount, 67.5);
  assert.equal(result.total, 442.5);
});

test('una tasa ERP expresada como 18 se normaliza a fracción decimal', () => {
  assert.equal(normalizeErpTaxDefinition({ id: taxId, rate: 18 }).rate, 0.18);
});

test('las líneas abiertas se recrean fiscalmente sin tocar su identidad operativa', () => {
  const line = { id: 'shirt-a', cartId: 'cart-1', sku: 'REF-0001', price: 375, quantity: 1, taxable: false, appliedTaxIds: [] } as any;
  const result = reconcileOpenCartFiscalData([line], [
    { id: 'shirt-a', sku: 'REF-0001', name: 'CAMISA A', taxable: true, appliedTaxIds: [taxId] } as any,
  ]);
  assert.notEqual(result.cart[0], line);
  assert.equal(result.cart[0].cartId, 'cart-1');
  assert.equal(result.cart[0].taxable, true);
  assert.deepEqual(result.cart[0].appliedTaxIds, [taxId]);
  assert.deepEqual(result.updatedSkus, ['REF-0001']);
});

test('el FULL omite caché y envía el UUID canónico como terminal_id', () => {
  const source = fs.readFileSync(path.join(root, 'services/sync/ApiSyncAdapter.ts'), 'utf8');
  assert.match(source, /collections\/\$\{collection\}\/full/);
  assert.match(source, /url\.searchParams\.set\('terminal_id', terminalId\)/);
  assert.match(source, /requireCanonicalErpTerminalId\(target\.terminalId\)/);
  assert.match(source, /cache: 'no-store'/);
  assert.match(source, /'Cache-Control': 'no-cache, no-store, max-age=0'/);
});

test('impuestos se descargan antes que productos y ambos se publican atómicamente', () => {
  const source = fs.readFileSync(path.join(root, 'services/sync/SyncManager.ts'), 'utf8');
  const taxesPull = source.indexOf("pullFullSnapshot('taxes')");
  const productsPull = source.indexOf("pullFullSnapshot('products')");
  const atomicCommit = source.indexOf('dbAdapter.saveDocumentsAtomically', productsPull);
  assert.ok(taxesPull > 0 && productsPull > taxesPull && atomicCommit > productsPull);
  assert.match(source, /\['taxes', 'products', 'config'\]/);
  assert.match(source, /\[SYNC_FISCAL_PRODUCT_APPLIED\]/);
});

test('CONFIG_PUSH_V2 acopla fiscal y catálogo y confirma después del commit local', () => {
  const source = fs.readFileSync(path.join(root, 'utils/erpSyncLifecycle.ts'), 'utf8');
  assert.match(source, /Array\.from\(new Set\(\[\.\.\.staleScopesBase, 'fiscal', 'catalog'\]\)\)/);
  const atomicApply = source.indexOf('applyConfigPushV2DomainsAtomically(staleScopes, domains)');
  const acknowledge = source.indexOf("ackErpOutboxEvent(eventId, 'APPLIED')", atomicApply);
  assert.ok(atomicApply > 0 && acknowledge > atomicApply);
});
