import assert from 'node:assert/strict';
import test from 'node:test';
import type { Customer } from '../types';
import {
  collapseEmptyPosCustomerShadows,
  isEmptyPosCustomerShadow,
} from '../services/customers/customerPresentation';

const customer = (overrides: Partial<Customer> & { code?: string }): Customer => ({
  id: overrides.id || crypto.randomUUID(),
  name: 'Caridad Olivo',
  ...overrides,
} as Customer);

test('hides an empty POS shadow when an authoritative same-name customer exists', () => {
  const canonical = customer({ id: 'canonical', code: 'CLI-040000', taxId: '1308558965', loyaltyPoints: 262 });
  const shadow = customer({ id: 'shadow', code: 'POS-C59BDABF5593' });

  assert.equal(isEmptyPosCustomerShadow(shadow), true);
  assert.deepEqual(collapseEmptyPosCustomerShadows([shadow, canonical]), [canonical]);
});

test('keeps the same-name row carrying distinguishing contact information', () => {
  const identified = customer({ id: 'identified', code: 'POS-C59BDABF5593', phone: '8095550101' });
  const shadow = customer({ id: 'shadow', code: 'POS-568F3F40DCEF' });

  assert.deepEqual(collapseEmptyPosCustomerShadows([identified, shadow]), [identified]);
});

test('does not collapse ambiguous all-empty same-name POS records', () => {
  const first = customer({ id: 'first', code: 'POS-C59BDABF5593' });
  const second = customer({ id: 'second', code: 'POS-568F3F40DCEF' });

  assert.deepEqual(collapseEmptyPosCustomerShadows([first, second]), [first, second]);
});
