import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeTaxIdentifiers,
  canonicalizeTaxMutationValues,
  normalizeTaxIdentifiersForSelection,
} from '../utils/taxIdentity';

const currentTax = {
  id: '7e70f4fd-240d-4665-99c9-603f3615ee0e',
  code: '001',
};

test('item tax identifiers are canonicalized against the current company catalog', () => {
  assert.deepEqual(
    canonicalizeTaxIdentifiers([
      'd8f830e8-cf99-48db-8a46-f6508f8e146a',
      currentTax.code,
      currentTax.id,
    ], [currentTax]),
    [currentTax.id],
  );
});

test('selecting a current tax does not preserve a stale foreign-company tax id', () => {
  const staleSelection = ['d8f830e8-cf99-48db-8a46-f6508f8e146a'];
  const current = canonicalizeTaxIdentifiers(staleSelection, [currentTax]);
  const next = [...normalizeTaxIdentifiersForSelection(current, currentTax), currentTax.id];

  assert.deepEqual(next, [currentTax.id]);
});

test('tax identifiers are preserved when the tax catalog is not loaded yet', () => {
  assert.deepEqual(canonicalizeTaxIdentifiers([' tax-18 ', 'tax-18'], []), ['tax-18']);
});

test('a pending tax mutation drops inherited foreign ids before retrying', () => {
  assert.deepEqual(
    canonicalizeTaxMutationValues(
      ['d8f830e8-cf99-48db-8a46-f6508f8e146a'],
      [currentTax.id, 'd8f830e8-cf99-48db-8a46-f6508f8e146a'],
      [currentTax],
    ),
    { before: [], after: [currentTax.id], repaired: true },
  );
});

test('a pending mutation with only unknown taxes is not converted into a removal', () => {
  const unknown = ['d8f830e8-cf99-48db-8a46-f6508f8e146a'];
  assert.deepEqual(
    canonicalizeTaxMutationValues([], unknown, [currentTax]),
    { before: [], after: unknown, repaired: false },
  );
});
