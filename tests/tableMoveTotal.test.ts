import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { CartItem, ParkedTicket } from '../types';
import { getWholeTableMoveTotal } from '../utils/tableMoveTotal';
import { buildTableAccountDisplayEntries } from '../utils/tableAccountPresentation';

const account = (total: number): ParkedTicket => ({
  id: 'account-to-move',
  tableId: 'mesa-3',
  name: 'Mesa 3',
  total,
  items: [{ id: 'camisa-a', cartId: 'line-camisa-a', price: 375, quantity: 2 } as CartItem],
} as ParkedTicket);

test('whole move retains the 50% promotion and the amount shown in the account modal', () => {
  const source = account(375);
  const before = structuredClone(source);
  const moved = { ...source, tableId: 'mesa-4', total: getWholeTableMoveTotal(source) };

  assert.equal(moved.total, 375); // Raw unit prices would incorrectly produce 750.
  assert.equal(buildTableAccountDisplayEntries([moved])[0].amount, 375);
  assert.equal(moved.id, source.id);
  assert.equal(moved.items[0].cartId, 'line-camisa-a');
  assert.equal(moved.items[0].quantity, 2);
  assert.deepEqual(source, before);
});

test('whole move retains tax-exclusive and discounted-tax totals without repricing lines', () => {
  for (const total of [885, 442.5, 0]) {
    const source = account(total);
    assert.equal(getWholeTableMoveTotal(source), total);
    assert.equal(source.items[0].price, 375);
    assert.equal(source.items[0].quantity, 2);
  }
});

test('whole move uses legacy raw prices only when the persisted total is not a finite number', () => {
  for (const total of [undefined, null, NaN, Infinity, -Infinity, '375']) {
    assert.equal(getWholeTableMoveTotal(account(total as number)), 750);
  }
});

test('TableMap uses the preserved total only after the partial-move branch has returned', () => {
  const source = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
  const partial = source.indexOf("if (mode === 'MOVE' && requestedItems)");
  const whole = source.indexOf("const nextTotal = mode === 'MOVE'\n            ? getWholeTableMoveTotal(sourceTicket)");
  assert.ok(partial >= 0 && whole > partial);
  assert.match(source.slice(whole), /total: nextTotal,/);
  assert.match(source.slice(whole), /currentOrderTotal: mode === 'MERGE' \? undefined : nextTotal,/);
});
