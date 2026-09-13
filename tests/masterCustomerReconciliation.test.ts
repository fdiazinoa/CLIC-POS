import assert from 'node:assert/strict';
import test from 'node:test';
import type { Customer } from '../types';
import { selectCustomersCreatedByClients } from '../services/sync/masterCustomerReconciliation';

const customer = (id: string): Customer => ({ id, name: `Cliente ${id}` } as Customer);

test('does not requeue the persisted customer snapshot while React hydrates', () => {
  const persisted = [customer('a'), customer('b')];

  assert.deepEqual(
    selectCustomersCreatedByClients([...persisted], [], persisted),
    [],
  );
});

test('queues only genuinely new Client customers', () => {
  const existing = customer('existing');
  const createdByClient = customer('new');

  assert.deepEqual(
    selectCustomersCreatedByClients(
      [existing, createdByClient],
      [existing],
      [existing],
    ).map(entry => entry.id),
    ['new'],
  );
});

test('deduplicates repeated customer ids from the native snapshot', () => {
  assert.deepEqual(
    selectCustomersCreatedByClients(
      [customer('new'), customer('new')],
      [],
      [],
    ).map(entry => entry.id),
    ['new'],
  );
});
