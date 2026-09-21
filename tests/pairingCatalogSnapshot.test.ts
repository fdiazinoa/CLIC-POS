import assert from 'node:assert/strict';
import test from 'node:test';
import { pairingSnapshotItems } from '../services/setup/pairingCatalogSnapshot';

test('la revinculación sin cambios conserva los productos locales', () => {
  const compact = [{ id: 'sku-270', _catalog_hash: 'a'.repeat(40) }];
  assert.equal(pairingSnapshotItems({ unchanged: true, terminal_config: { masters: { items: compact } } }), undefined);
  assert.equal(pairingSnapshotItems({ unchanged: true, items: compact }), undefined);
});

test('la vinculación inicial acepta artículos completos del ERP', () => {
  const full = [{ id: 'sku-270', name: 'Peine', price: 150 }];
  assert.deepEqual(pairingSnapshotItems({ terminal_config: { masters: { items: full } } }), full);
  assert.deepEqual(pairingSnapshotItems({ items: full }), full);
});
