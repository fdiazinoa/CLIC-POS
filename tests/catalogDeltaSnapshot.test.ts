import assert from 'node:assert/strict';
import test from 'node:test';
import type { TerminalConfigSnapshot } from '../types';
import { mergeCatalogDeltaIntoSnapshot } from '../utils/terminalConfigSnapshot';
import { compactStoredTerminalCatalog } from '../utils/compactTerminalCatalogSnapshot';
import { canDeleteCatalogProduct, keepProductAfterAuthoritativeFull, resolveRemoteCatalogDeletionIds } from '../services/sync/catalogReconciliation';
import type { Product } from '../types';

const snapshot = (items: Array<{ id: string; name: string }>): TerminalConfigSnapshot => ({
  terminal_id: 'master-1',
  masters: { items },
} as TerminalConfigSnapshot);

test('full, delta y recuperación conservan artículos no modificados', () => {
  const full = snapshot([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  const merged = mergeCatalogDeltaIntoSnapshot(full, snapshot([{ id: 'a', name: 'A nueva' }]), {
    items_upsert: [{ id: 'a', name: 'A nueva' }],
  });
  assert.deepEqual(merged.masters?.items, [
    { id: 'a', name: 'A nueva' }, { id: 'b', name: 'B' },
  ]);
  const afterDelete = mergeCatalogDeltaIntoSnapshot(merged, snapshot([]), {
    items_delete: [{ id: 'b' }],
  });
  assert.deepEqual(afterDelete.masters?.items, [{ id: 'a', name: 'A nueva' }]);
});

test('un delta sin catálogo completo previo falla antes de guardar el cursor', () => {
  assert.throws(() => mergeCatalogDeltaIntoSnapshot(
    { terminal_id: 'master-1' } as TerminalConfigSnapshot,
    snapshot([{ id: 'a', name: 'A' }]),
    { items_upsert: [{ id: 'a', name: 'A' }] },
  ), /catálogo completo/);
});

test('la configuración guarda solo identidad y hash de artículos para el siguiente delta', () => {
  const items = Array.from({ length: 2430 }, (_, index) => ({
    id: `item-${index}`,
    name: 'ARTÍCULO DE PRUEBA '.repeat(100),
    _catalog_hash: 'a'.repeat(40),
  }));
  const full = snapshot(items);
  const config = compactStoredTerminalCatalog({
    terminals: [{ id: 'master-1', config: { erpSnapshot: full } }],
    terminalSnapshots: { 'master-1': full },
  });
  assert.ok(JSON.stringify({ terminals: [{ config: { erpSnapshot: full } }], terminalSnapshots: { 'master-1': full } }).length > 4 * 1024 * 1024);
  assert.ok(JSON.stringify(config).length < 4 * 1024 * 1024);
  const cached = config.terminalSnapshots['master-1'];
  assert.deepEqual(cached.masters?.items?.[0], { id: 'item-0', _catalog_hash: 'a'.repeat(40) });
  const merged = mergeCatalogDeltaIntoSnapshot(cached, snapshot([]), {
    items_upsert: [{ id: 'item-0', name: 'Actualizado', _catalog_hash: 'b'.repeat(40) }],
  });
  assert.equal(merged.masters?.items?.length, items.length);
  assert.equal((merged.masters?.items?.[0] as any).name, 'Actualizado');
});

test('full autoritativo elimina ERP ausente y conserva local y cambios pendientes', () => {
  const erp = { id: 'erp-1', syncSource: 'ERP_SNAPSHOT' } as unknown as Product;
  const local = { id: 'local-1', syncSource: 'LOCAL' } as unknown as Product;
  const remapped = { id: 'local-sku', sourceItemId: 'erp-2', syncSource: 'ERP_SNAPSHOT' } as unknown as Product;
  const empty = new Set<string>();
  const cached = new Set(['erp-1', 'erp-2']);
  assert.equal(keepProductAfterAuthoritativeFull(erp, empty, cached, empty), false);
  assert.equal(keepProductAfterAuthoritativeFull(local, empty, cached, empty), true);
  assert.equal(keepProductAfterAuthoritativeFull(remapped, empty, cached, new Set(['erp-2'])), true);
  assert.equal(keepProductAfterAuthoritativeFull(remapped, new Set(['erp-2']), cached, empty), true);
});

test('delta delete respeta una edición pendiente incluso con ID local remapeado', () => {
  const remapped = { id: 'local-sku', sourceItemId: 'erp-2', syncSource: 'ERP_SNAPSHOT' } as unknown as Product;
  const coincidental = { id: 'local-2', sku: 'erp-2', syncSource: 'LOCAL' } as unknown as Product;
  assert.deepEqual([...resolveRemoteCatalogDeletionIds(['erp-2'], [remapped, coincidental])], ['local-sku']);
  assert.equal(canDeleteCatalogProduct(remapped, new Set(['erp-2'])), false);
  assert.equal(canDeleteCatalogProduct(remapped, new Set(['local-sku'])), false);
  assert.equal(canDeleteCatalogProduct(remapped, new Set()), true);
});
