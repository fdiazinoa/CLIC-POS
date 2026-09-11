import type { Customer } from '../../types';

const customerId = (customer: Customer): string => String(customer?.id || '').trim();

/**
 * Select only customers that genuinely arrived from a Client terminal.
 *
 * The native Master server can already contain the complete customer snapshot
 * while React is still hydrating.  Comparing only against the in-memory array
 * during that window makes every existing customer look new and creates an
 * outbound mutation loop.  The persisted snapshot closes that startup gap.
 */
export function selectCustomersCreatedByClients(
  incoming: Customer[],
  inMemory: Customer[],
  persisted: Customer[],
): Customer[] {
  const knownIds = new Set(
    [...inMemory, ...persisted]
      .map(customerId)
      .filter(Boolean),
  );
  const created: Customer[] = [];

  for (const customer of incoming) {
    const id = customerId(customer);
    if (!id || knownIds.has(id)) continue;
    knownIds.add(id);
    created.push(customer);
  }

  return created;
}
