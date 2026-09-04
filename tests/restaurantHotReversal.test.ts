import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canReverseRestaurantDraftWithoutApproval,
  hasKitchenDispatchEvidence,
  markRestaurantLinesCommitted,
  requiresRestaurantReductionApproval,
} from '../utils/restaurantHotReversal';

const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('permite corregir una línea de restaurante mientras sigue en borrador', () => {
  assert.equal(canReverseRestaurantDraftWithoutApproval(true, { dispatched: false }), true);
  assert.equal(canReverseRestaurantDraftWithoutApproval(true, { kdsStatus: '' }), true);
});

test('mantiene autorización fuera del modo restaurante', () => {
  assert.equal(canReverseRestaurantDraftWithoutApproval(false, { dispatched: false }), false);
});

test('protege líneas enviadas, pendientes, devueltas o subtotalizadas', () => {
  assert.equal(canReverseRestaurantDraftWithoutApproval(true, { dispatched: true }), false);
  assert.equal(canReverseRestaurantDraftWithoutApproval(true, { kdsStatus: 'PENDIENTE' }), false);
  assert.equal(canReverseRestaurantDraftWithoutApproval(true, { kdsOrderId: 'KDS-1' }), false);
  assert.equal(canReverseRestaurantDraftWithoutApproval(true, { subtotalizedAt: '2026-09-04T12:00:00Z' }), false);
  assert.equal(canReverseRestaurantDraftWithoutApproval(true, { restaurantCommittedAt: '2026-09-04T13:00:00Z' }), false);
  assert.equal(hasKitchenDispatchEvidence({ kdsStatus: 'DEVUELTO' }), true);
});

test('al reabrir una mesa, rebajar cantidad requiere autorización', () => {
  const [committed] = markRestaurantLinesCommitted([{ quantity: 2 }], '2026-09-04T13:00:00Z');
  assert.equal(committed.restaurantCommittedAt, '2026-09-04T13:00:00Z');
  assert.equal(requiresRestaurantReductionApproval(true, committed, 1), true);
  assert.equal(requiresRestaurantReductionApproval(true, committed, 3), false);
  assert.equal(requiresRestaurantReductionApproval(false, committed, 1), false);
  assert.equal(requiresRestaurantReductionApproval(true, { quantity: 2 }, 1), false);
});

test('el borrado unitario y limpiar borradores usan la misma regla', () => {
  assert.match(posSource, /activeTable && \(isRestaurantMode \|\| activeTerminalConfig\?\.operational\?\.usa_mesas\)/);
  assert.match(posSource, /canReverseRestaurantDraftWithoutApproval\(isRestaurantOrderContext, originalItem\)/);
  assert.match(posSource, /requiresRestaurantReductionApproval\(isRestaurantOrderContext, originalItem/);
  assert.match(appSource, /nextCart = markRestaurantLinesCommitted\(parked\.items, parked\.timestamp\)/);
  assert.match(posSource, /!isSubtotalizedMutation && !isHotRestaurantReversal/);
  assert.match(posSource, /if \(!allFreshItemsAreHotRestaurantDrafts\) \{[\s\S]*permission: 'POS_VOID_ITEM'/);
  assert.match(posSource, /handleReturnDispatchedCartItem/);
});
