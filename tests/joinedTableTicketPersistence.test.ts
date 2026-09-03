import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the actual three POS builders and App reconciliation, not a second
// implementation of the save logic. No server, device or business data writes.
const pos = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const marker = 'const reconcileTablesWithParkedTickets = useCallback(';
const start = app.indexOf(marker) + marker.length;
assert.ok(start >= marker.length);
const end = app.indexOf('}, []);', start) + 1;
const reconcile = Function(`${ts.transpile(`const reconcile = ${app.slice(start, end)};`)}; return reconcile;`)();

function save(builder: string, ticket: any, activeTable: any, items: any[]) {
  const begin = pos.indexOf(`const ${builder}: ParkedTicket = {`);
  assert.ok(begin >= 0, `missing ${builder}`);
  const finish = pos.indexOf('\n      };', begin) + 9;
  const context = {
    existing: ticket, existingParked: ticket, activeTable,
    orderId: ticket.id, parkedTicketId: ticket.id,
    cart: items, ticketItems: items, cartTotal: 150, ticketTotal: 150,
    discountAmount: 0, globalDiscount: { type: 'PERCENT', value: 0 },
    selectedCustomer: null, activeBarTabName: null, activeBarTabId: null,
    activeTableContext: { compactLabel: activeTable.name, roomLabel: 'QA' },
    readCartOrderNumber: () => undefined, buildParkedTicketName: () => ticket.name,
    normalizedAlias: undefined, cartOverride: undefined, tableName: activeTable.name,
    effectiveOrderServiceType: 'DINE_IN',
  };
  const code = ts.transpile(`${pos.slice(begin, finish)}; return ${builder};`);
  return Function(...Object.keys(context), code)(...Object.values(context));
}

for (const builder of ['syncedTicket', 'newParked', 'tableOrder']) {
  for (const ids of [['TABLE_01', 'TABLE_02'], ['TABLE_01', 'TABLE_02', 'TABLE_03']]) {
   for (const enteredId of ids) {
    test(`${builder}: editing ${enteredId} in group of ${ids.length} preserves the whole joined account through save/reload/retry`, () => {
      const ticket = {
        id: 'shared-order', name: 'Mesa 1', tableId: ids[0], primaryTableId: ids[0],
        joinedTableIds: ids, total: 100,
        items: [{ id: 'original', price: 100, quantity: 1 }],
      };
      const tables = ids.map((id, i) => ({
        id, name: `Mesa ${i + 1}`, status: 'OCCUPIED', currentOrderId: ticket.id,
        joinedSourceTableId: ids[0], joinedTableId: i ? ids[0] : ids[1],
      }));
      const items = [...ticket.items, { id: 'added', price: 50, quantity: 1 }];
      const active = tables.find(table => table.id === enteredId);
      let next = save(builder, ticket, active, items);
      for (let retry = 0; retry < 3; retry++) {
        // Persisted JSON/offline reload must carry the same shared membership.
        next = JSON.parse(JSON.stringify(next));
        assert.equal(next.tableId, ids[0]);
        assert.equal(next.primaryTableId, ids[0]);
        assert.deepEqual(next.joinedTableIds, ids);
        assert.deepEqual(next.items, items);
        let reconciled = reconcile(tables, [next]);
        reconciled = reconcile(reconciled, [next]);
        assert.deepEqual(reconciled.map((table: any) => table.status), ids.map(() => 'OCCUPIED'));
        assert.ok(reconciled.every((table: any) => table.currentOrderId === ticket.id));
        assert.deepEqual(reconciled.map((table: any) => table.currentOrderTotal), ids.map((_, index) => index ? 0 : 150));
        next = save(builder, next, active, items);
      }
      // Explicit closure still releases all members; no permanent occupancy.
      assert.ok(reconcile(tables, []).every((table: any) => table.status === 'FREE'));
    });
   }
  }

  test(`${builder}: ordinary tables do not become joined`, () => {
    const table = { id: 'TABLE_01', name: 'Mesa 1', status: 'OCCUPIED', currentOrderId: 'ordinary' };
    const ticket = { id: 'ordinary', name: 'Mesa 1', tableId: table.id };
    const next = save(builder, ticket, table, [{ id: 'single', price: 150, quantity: 1 }]);
    assert.equal(next.tableId, table.id);
    assert.equal(next.primaryTableId, undefined);
    assert.equal(next.joinedTableIds, undefined);
    assert.equal(reconcile([table], [next])[0].status, 'OCCUPIED');
    assert.equal(reconcile([table], [])[0].status, 'FREE');
  });
}
