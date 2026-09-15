import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessConfig, CartItem, TerminalConfig } from '../types';
import {
  calculateTaxBreakdownFromItems,
  resolveEffectiveTaxIds,
} from '../utils/fiscalBreakdown';
import { calculateTransactionTaxSummary } from '../utils/taxSummary';

const tax = { id: 'itbis-18', code: '001', name: 'ITBIS', rate: 0.18, type: 'VAT' as const };
const config = { taxes: [tax], taxRate: 0.18 } as BusinessConfig;
const terminalConfig = {
  operational: { defaultTaxIds: [tax.id] },
} as TerminalConfig;

const item = (appliedTaxIds: string[] | undefined, patch: Record<string, unknown> = {}) => ({
  id: 'shirt-a',
  name: 'CAMISA A',
  price: 100,
  quantity: 1,
  cartId: 'line-1',
  images: [],
  attributes: [],
  variants: [],
  tariffs: [],
  appliedTaxIds,
  ...patch,
}) as CartItem;

test('una selección vacía explícita no hereda el impuesto de la terminal', () => {
  assert.deepEqual(resolveEffectiveTaxIds([], terminalConfig), []);
  assert.deepEqual(calculateTaxBreakdownFromItems([item([])], config, { terminalConfig }), []);
});

test('solo un artículo legacy sin campo de impuestos hereda el valor de la terminal', () => {
  assert.deepEqual(resolveEffectiveTaxIds(undefined, terminalConfig), [tax.id]);
  assert.deepEqual(
    calculateTaxBreakdownFromItems([item(undefined)], config, { terminalConfig }).map(line => line.id),
    [tax.id],
  );
});

test('un id desconocido no se convierte silenciosamente en el impuesto local', () => {
  const staleTaxId = 'foreign-company-tax';
  assert.deepEqual(
    calculateTaxBreakdownFromItems([item([staleTaxId], { taxable: true })], config, { terminalConfig }),
    [],
  );
});

test('taxable false prevalece incluso para un registro legacy sin appliedTaxIds', () => {
  assert.deepEqual(resolveEffectiveTaxIds(undefined, terminalConfig, false), []);
  assert.deepEqual(
    calculateTaxBreakdownFromItems([item(undefined, { taxable: false })], config, { terminalConfig }),
    [],
  );
});

test('la NC de una línea explícitamente sin impuesto conserva impuesto cero', () => {
  const summary = calculateTransactionTaxSummary([item([])], config.taxes, false, config.taxRate);
  assert.deepEqual(summary, {
    grossAmount: 100,
    netAmount: 100,
    taxAmount: 0,
    total: 100,
  });
});

test('la NC importada con tax_ids vacío también conserva impuesto cero', () => {
  const importedLine = item(undefined, { tax_ids: [] });
  const summary = calculateTransactionTaxSummary([importedLine], config.taxes, true, config.taxRate);

  assert.equal(summary.taxAmount, 0);
  assert.equal(summary.netAmount, 100);
  assert.equal(summary.total, 100);
});

test('una NC mixta calcula impuestos por renglón sin gravar el artículo exento', () => {
  const summary = calculateTransactionTaxSummary([
    item([], { cartId: 'exempt' }),
    item([tax.id], { cartId: 'taxed' }),
  ], config.taxes, false, config.taxRate);

  assert.equal(summary.netAmount, 200);
  assert.equal(summary.taxAmount, 18);
  assert.equal(summary.total, 218);
});
