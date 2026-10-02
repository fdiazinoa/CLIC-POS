import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const start = source.indexOf('const handleSplitConfirm = ');
const end = source.indexOf('\n   };', start) + '\n   };'.length;
assert.ok(start >= 0 && end > start);
const compiled = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

test('split desde una secundaria conserva membresía y metadata en todas las cuentas', () => {
  const original = {
    id: 'shared-order',
    name: 'Mesa primaria',
    tableId: 'primary',
    primaryTableId: 'primary',
    joinedTableIds: ['primary', 'secondary'],
    barTabId: 'bar-shared',
    barTabName: 'Grupo terraza',
    items: [{ id: 'a', price: 100, quantity: 1 }, { id: 'b', price: 50, quantity: 1 }],
    total: 150,
    timestamp: '2026-10-02T12:00:00.000Z',
  };
  const unrelated = { id: 'other', tableId: 'other-table', items: [], total: 0 };
  const parkedTicketsRef = { current: [original, unrelated] };
  let persisted: any[] = [];
  const context = {
    onUpdateCart: () => undefined,
    activeTable: { id: 'secondary', name: 'Mesa secundaria', currentOrderId: original.id },
    selectedCustomer: null,
    parkedTicketsRef,
    activeTableContext: { compactLabel: 'Terraza · Mesa secundaria', roomLabel: 'Terraza' },
    activeBarTabId: null,
    activeBarTabName: null,
    readCartOrderNumber: () => undefined,
    effectiveOrderServiceType: 'DINE_IN',
    onUpdateParkedTicketsRef: { current: (tickets: any[]) => { persisted = tickets; } },
    onTableOrderSaved: undefined,
    setShowSplitModal: () => undefined,
    setSuccessToast: () => undefined,
  };
  const handler = Function(
    ...Object.keys(context),
    `${compiled}; return handleSplitConfirm;`,
  )(...Object.values(context));

  handler(
    [{ id: 'a', price: 100, quantity: 1 }],
    [{ id: 'b', price: 50, quantity: 1 }],
    [[{ id: 'c', price: 25, quantity: 1 }]],
    3,
  );

  assert.equal(persisted.length, 4);
  assert.equal(persisted[0], unrelated);
  const splitAccounts = persisted.slice(1);
  for (const account of splitAccounts) {
    assert.equal(account.tableId, 'primary');
    assert.equal(account.primaryTableId, 'primary');
    assert.deepEqual(account.joinedTableIds, ['primary', 'secondary']);
    assert.equal(account.barTabId, 'bar-shared');
    assert.equal(account.barTabName, 'Grupo terraza');
  }
  assert.equal(parkedTicketsRef.current, persisted);
});
