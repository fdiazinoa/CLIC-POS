import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Exercise the actual non-designed Master merge expression, not a duplicate helper.
const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const branch = source.match(/if \(!localFloorPlan\) return (\{[^;]+\});/);
assert.ok(branch, 'non-designed Master merge branch must remain identifiable');
const merge = new Function('localTable', 'remoteTable', `return (${branch[1]});`);

test('Master sin diseño borra lock ausente y conserva cuenta/propiedades locales', () => {
  const local = { id: 'table-4', name: 'Mesa 4', editingLock: { ownerId: 'client-old' }, currentOrderId: 'old' };
  const remote = { id: 'table-4', currentOrderId: 'order-tax', currentOrderTotal: 1327.5 };
  const result = merge(local, remote);
  assert.equal(result.editingLock, undefined);
  assert.equal(result.name, 'Mesa 4');
  assert.equal(result.currentOrderId, 'order-tax');
  assert.equal(result.currentOrderTotal, 1327.5);
  assert.equal(local.editingLock.ownerId, 'client-old');
});

test('Master sin diseño conserva lock vigente autoritativo sin cambiar dueño', () => {
  const lock = { ownerId: 'client-live', acquiredAt: 100, expiresAt: 999999 };
  assert.deepEqual(merge({ id: 'table-4', editingLock: { ownerId: 'old' } }, { id: 'table-4', editingLock: lock }).editingLock, lock);
});
