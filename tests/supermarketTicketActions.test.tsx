import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createSupermarketLineInteraction } from '../utils/supermarketLineInteraction';
import { resetCompletedSaleDiscount, type CheckoutDiscount } from '../utils/checkoutDiscountLifecycle';

test('click and long-press open one line each without a duplicate synthetic click', () => {
  let timestamp = 1000;
  const opened: string[] = [];
  const interaction = createSupermarketLineInteraction((cartId) => opened.push(cartId), () => timestamp);
  interaction.click('line-a');
  assert.deepEqual(opened, ['line-a']);

  let prevented = 0;
  timestamp += 100;
  interaction.contextMenu('line-a', { preventDefault: () => { prevented += 1; } });
  interaction.click('line-a'); // Android's click following a long touch.
  assert.equal(prevented, 1);
  assert.deepEqual(opened, ['line-a', 'line-a']);

  interaction.click('line-b'); // A different line must remain responsive.
  assert.deepEqual(opened, ['line-a', 'line-a', 'line-b']);
  timestamp += 701;
  interaction.click('line-a');
  assert.deepEqual(opened, ['line-a', 'line-a', 'line-b', 'line-a']);
});

test('keyboard activation ignores events from nested controls', () => {
  const opened: string[] = [];
  const interaction = createSupermarketLineInteraction((cartId) => opened.push(cartId));
  let prevented = 0;
  interaction.keyDown('line-a', { key: 'Enter', isRowTarget: false, preventDefault: () => { prevented += 1; } });
  interaction.keyDown('line-a', { key: 'Enter', isRowTarget: true, preventDefault: () => { prevented += 1; } });
  interaction.keyDown('line-a', { key: ' ', isRowTarget: true, preventDefault: () => { prevented += 1; } });
  assert.deepEqual(opened, ['line-a', 'line-a']);
  assert.equal(prevented, 2);
});

test('supermarket ticket exposes the selected line for keyboard and touch editing', () => {
  const table = readFileSync(new URL('../components/ProductTableSupermarket.tsx', import.meta.url), 'utf8');
  assert.match(table, /tabIndex=\{0\}/);
  assert.match(table, /aria-label=\{`Editar \$\{item\.name\}, cantidad \$\{item\.quantity\}`\}/);
  assert.doesNotMatch(table, /opacity-0 group-hover:opacity-100/);
});

test('the supermarket row opens the existing permission-aware editor using the canonical cart line', () => {
  const pos = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const table = readFileSync(new URL('../components/ProductTableSupermarket.tsx', import.meta.url), 'utf8');
  assert.match(pos, /cart\.find\(item => item\.cartId === cartId\)/);
  assert.match(pos, /if \(selectedLine\) setEditingItem\(selectedLine\)/);
  assert.match(pos, /<CartItemOptionsModal[\s\S]*?canVoidItem=\{cartItemEditCapabilities\.canVoidItem/);
  assert.match(table, /lineInteraction\.contextMenu\(item\.cartId, event\)/);
  assert.match(table, /isRowTarget: event\.target === event\.currentTarget/);
  assert.doesNotMatch(table, /onRemoveItem/);
});

test('completed checkout clears discount on every cart-closing path but not a partial fraction', () => {
  const pos = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  let currentDiscount: CheckoutDiscount = { type: 'FIXED', value: 65 };
  resetCompletedSaleDiscount((discount) => { currentDiscount = discount; });
  assert.deepEqual(currentDiscount, { type: 'PERCENT', value: 0 });
  for (const reason of ['POS_CLEAR_05', 'POS_CLEAR_06', 'POS_CLEAR_07']) {
    const index = pos.indexOf(`reason: '${reason}'`);
    assert.ok(index > 0, `${reason} success path exists`);
    assert.match(pos.slice(index, index + 240), /onUpdateCart\(\[\]\);\s*resetCompletedSaleDiscount\(setGlobalDiscount\)/);
  }
  const partial = pos.indexOf('if (currentFractionPart && pendingFractionParts.length > 1)');
  const completed = pos.indexOf('if (currentFractionPart && pendingFractionParts.length === 1)');
  assert.ok(partial > 0 && completed > partial);
  assert.doesNotMatch(pos.slice(partial, completed), /setGlobalDiscount/);
});
