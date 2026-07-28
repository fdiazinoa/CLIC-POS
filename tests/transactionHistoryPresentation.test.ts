import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHistoryDiscountTotal, resolveHistoryTerminalName } from '../utils/transactionHistoryPresentation';

test('resolves a friendly terminal name from ERP and local aliases', () => {
  const terminals = [{
    id: 'T1',
    name: 'Caja local',
    config: {
      terminalName: 'Caja 003',
      stationNumber: 'POS-003',
      erpBinding: { terminalId: '9ffc6771-7845-4976-afd3-20cebc3cc6e8' }
    }
  }] as any;

  assert.equal(
    resolveHistoryTerminalName(
      { terminalId: '9ffc6771-7845-4976-afd3-20cebc3cc6e8' },
      terminals
    ),
    'Caja 003'
  );
  assert.equal(
    resolveHistoryTerminalName(
      { terminalId: 'old-terminal', terminalName: 'Caja Terraza' },
      []
    ),
    'Caja Terraza'
  );
});

test('uses persisted discount amount and supports legacy line discounts', () => {
  assert.equal(resolveHistoryDiscountTotal({ discountAmount: 25, items: [] }), 25);
  assert.equal(resolveHistoryDiscountTotal({
    items: [{ price: 80, originalPrice: 100, quantity: 2 }]
  } as any), 40);
});
