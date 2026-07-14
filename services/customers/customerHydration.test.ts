import assert from 'node:assert/strict';
import test from 'node:test';
import type { Customer } from '../../types';
import { hydrateCustomerState } from './customerHydration';

const buildCustomers = (count: number): Customer[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `customer-${index + 1}`,
    name: `Cliente ${index + 1}`,
    phone: `809555${String(index).padStart(4, '0')}`,
  } as Customer));

for (const count of [0, 1, 20, 1000]) {
  test(`hydrates ${count} SQLite customers into shared UI state`, async () => {
    const sqliteCustomers = buildCustomers(count);
    let sharedState: Customer[] = [];
    let repositoryReads = 0;

    const hydrated = await hydrateCustomerState<Customer>(
      async () => {
        repositoryReads += 1;
        return sqliteCustomers;
      },
      (customers) => {
        sharedState = customers;
      },
    );

    assert.equal(repositoryReads, 1);
    assert.equal(hydrated.length, count);
    assert.equal(sharedState.length, count);
    assert.deepEqual(sharedState, sqliteCustomers);
  });
}

test('normalizes an unavailable customer collection to an empty UI state', async () => {
  let sharedState = buildCustomers(1);

  const hydrated = await hydrateCustomerState<Customer>(
    async () => null,
    (customers) => {
      sharedState = customers;
    },
  );

  assert.deepEqual(hydrated, []);
  assert.deepEqual(sharedState, []);
});
