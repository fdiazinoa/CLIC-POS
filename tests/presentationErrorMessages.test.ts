import test from 'node:test';
import assert from 'node:assert/strict';
import { describePresentationError } from '../utils/presentationErrorMessages';
import { isErpPresentationDenial, isTransientPresentationFailure } from '../services/inventoryPresentations/runtime';

test('a scope divergence tells the cashier to sync the terminal configuration', () => {
  const hint = describePresentationError('INVENTORY_PRESENTATION_SCOPE_CHANGED');
  assert.match(hint, /no coinciden con la configuración del ERP/);
  assert.doesNotMatch(hint, /INVENTORY_PRESENTATION_/);
});

test('a missing cache, an ERP denial and an expired session are distinguished', () => {
  assert.match(describePresentationError('INVENTORY_PRESENTATION_CACHE_REQUIRED'), /Reintentar/);
  assert.match(describePresentationError('INVENTORY_PRESENTATION_ERP_DENIED'), /deshabilitadas/);
  assert.match(describePresentationError('INVENTORY_PRESENTATION_AUTH_REQUIRED'), /Diagnóstico fiscal/);
});

test('unknown codes stay visible instead of being replaced by a generic message', () => {
  assert.equal(describePresentationError('INVENTORY_PRESENTATION_FUTURE_CODE'), 'INVENTORY_PRESENTATION_FUTURE_CODE');
  assert.match(describePresentationError('Error: INVENTORY_PRESENTATION_TARIFF_FORBIDDEN'), /tarifa/);
});

test('only an ERP answer disables the local presentations for good', () => {
  assert.equal(isErpPresentationDenial('INVENTORY_PRESENTATION_ERP_DENIED'), true);
  assert.equal(isErpPresentationDenial('INVENTORY_PRESENTATION_AUTH_REQUIRED'), true);
  assert.equal(isErpPresentationDenial('INVENTORY_PRESENTATION_HTTP_403'), true);
  assert.equal(isErpPresentationDenial('INVENTORY_PRESENTATION_SCOPE_CHANGED'), false);
  assert.equal(isErpPresentationDenial('INVENTORY_PRESENTATION_LOCAL_REQUIRED'), false);
  assert.equal(isTransientPresentationFailure('INVENTORY_PRESENTATION_HTTP_503'), true);
});
