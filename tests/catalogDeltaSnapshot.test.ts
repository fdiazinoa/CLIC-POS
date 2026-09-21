import assert from 'node:assert/strict';
import test from 'node:test';
import type { TerminalConfigSnapshot } from '../types';
import { mergeCatalogDeltaIntoSnapshot } from '../utils/terminalConfigSnapshot';
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
