import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildProductEditorSyncMarker } from '../utils/productEditorSync';

test('detects tax, operation and stock changes without depending on a timestamp', () => {
  const base = {
    id: 'wd0001',
    appliedTaxIds: ['itbis-18'],
    operationalFlags: { trackInventory: true, promptPrice: false },
    stockBalances: { main: 3 },
  };

  assert.notEqual(
    buildProductEditorSyncMarker(base as any),
    buildProductEditorSyncMarker({ ...base, appliedTaxIds: [] } as any)
  );
  assert.notEqual(
    buildProductEditorSyncMarker(base as any),
    buildProductEditorSyncMarker({
      ...base,
      operationalFlags: { ...base.operationalFlags, promptPrice: true },
    } as any)
  );
  assert.notEqual(
    buildProductEditorSyncMarker(base as any),
    buildProductEditorSyncMarker({ ...base, stockBalances: { main: 4 } } as any)
  );
});

test('keeps the product editor mounted while a catalog snapshot changes', () => {
  const source = readFileSync(new URL('../components/CatalogManager.tsx', import.meta.url), 'utf8');

  assert.match(
    source,
    /<ProductForm key=\{editingProduct === 'NEW' \? 'NEW' : editingProduct\.id\}/
  );
  assert.doesNotMatch(source, /<ProductForm key=\{[^\n]*buildProductEditorSyncMarker/);
});
