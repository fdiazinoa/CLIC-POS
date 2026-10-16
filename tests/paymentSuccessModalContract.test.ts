import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { RestaurantPersistenceQueue } from '../utils/restaurantPersistenceQueue';
import { updateTablesAfterAccountClose } from '../utils/tableCloseState';
import type { Table, ParkedTicket } from '../types';

const posSource = readFileSync(
  new URL('../components/POSInterface.tsx', import.meta.url),
  'utf8'
);
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('table checkout keeps the completed-sale modal mounted until the cashier closes it', () => {
  const paymentHandler = posSource.slice(
    posSource.indexOf('const handlePaymentConfirm'),
    posSource.indexOf('const handleSplitConfirm')
  );

  assert.match(
    paymentHandler,
    /setReturnToTableMapAfterPayment\(true\);\s*}\s*return activeV3Reservation \? settledFinalTxn : txn;/,
    'successful table checkout must defer navigation until after the success screen'
  );
  assert.doesNotMatch(
    paymentHandler,
    /if \(activeTable && onOpenTableMap\) \{\s*onOpenTableMap\(\);/,
    'successful table checkout must not unmount PaymentModal before it renders its result'
  );
});

test('closing the completed-sale modal performs the deferred table navigation', () => {
  const file = ts.createSourceFile('POSInterface.tsx', posSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers: ts.ArrowFunction[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'UnifiedPaymentModal') {
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'onClose'
          && attribute.initializer && ts.isJsxExpression(attribute.initializer)
          && attribute.initializer.expression && ts.isArrowFunction(attribute.initializer.expression)) {
          handlers.push(attribute.initializer.expression);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.equal(handlers.length, 1, 'identify the actual checkout modal, not another onClose');
  const body = ts.transpileModule(`const close = ${handlers[0].getText(file)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  for (const deferred of [false, true]) {
    for (const hasNavigation of [false, true]) {
      const calls: unknown[][] = [];
      const close = new Function('recordCheckoutDiagnostic', 'setShowPaymentModal',
        'returnToTableMapAfterPayment', 'onOpenTableMap', 'setReturnToTableMapAfterPayment', 'finishInteraction', 'paymentModalTraceRef', `${body}; return close;`)(
        (event: string) => calls.push(['diagnostic', event]),
        (value: boolean) => calls.push(['visible', value]), deferred,
        hasNavigation ? () => calls.push(['navigate']) : undefined,
        (value: boolean) => calls.push(['deferred', value]),
        () => {}, { current: null },
      );
      close();
      assert.deepEqual(calls, [ ['diagnostic', 'PAYMENT_CLOSE'], ['visible', false],
        ...(deferred && hasNavigation ? [['deferred', false], ['navigate']] : []) ]);
    }
  }
});

test('closing a restaurant order publishes and releases locally before deferred table persistence', async () => {
  const file = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers: ts.ArrowFunction[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === 'onTableOrderClosed'
      && node.initializer && ts.isJsxExpression(node.initializer)
      && node.initializer.expression && ts.isArrowFunction(node.initializer.expression)) {
      handlers.push(node.initializer.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.equal(handlers.length, 1, 'execute the actual production close callback');
  const body = ts.transpileModule(`const close = ${handlers[0].getText(file)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  for (const closedOrderId of ['closed-order', undefined]) {
    const trace: string[] = [], saved: Table[] = [], timers: (() => void)[] = [];
    const table = { id: 'table-1', status: 'OCCUPIED', currentOrderId: closedOrderId, currentOrderTotal: 100 } as Table;
    const joined = { id: 'table-2', status: 'OCCUPIED', currentOrderId: closedOrderId || 'other-order', currentOrderTotal: 0 } as Table;
    const unaffected = { id: 'table-3', status: 'OCCUPIED', currentOrderId: 'unrelated-order' } as Table;
    const ticket = { id: 'closed-order', tableId: 'table-1', joinedTableIds: ['table-2'], items: [] } as unknown as ParkedTicket;
    let tables = [table, joined, unaffected];
    const snapshot = { current: { tables, parkedTickets: [ticket] } };
    const acknowledged = { current: new Map([['table-1', [ticket]]]) };
    const closedIds = { current: new Set<string>() };
    const queue = new RestaurantPersistenceQueue();
    const releaseOptions: unknown[] = [];
    const bindings = {
      lastAcknowledgedTableTicketsRef: acknowledged,
      masterOperationalSnapshotRef: snapshot,
      closedRestaurantOrderIdsRef: closedIds,
      updateTablesAfterAccountClose,
      setTables: (update: (previous: Table[]) => Table[]) => {
        trace.push('publish'); tables = update(tables);
        assert.equal(tables[0].status, 'FREE');
        assert.deepEqual(snapshot.current.tables, tables, 'source snapshot is published before UI callback');
      },
      restaurantPersistenceQueueRef: { current: queue },
      db: { saveDocument: async (collection: string, affected: Table) => {
        assert.equal(collection, 'tables'); trace.push(`save:${affected.id}`); saved.push(affected);
      } },
      releaseActiveTableEditLock: (options: unknown) => {
        trace.push('releaseSync'); releaseOptions.push(options); return Promise.resolve();
      },
      window: { setTimeout: (callback: () => void, delay: number) => {
        assert.equal(delay, 0); timers.push(callback); return 1;
      } },
      console,
    };
    const close = new Function(...Object.keys(bindings), `${body}; return close;`)(...Object.values(bindings));
    close(table, closedOrderId, []);
    assert.deepEqual(trace, ['publish', 'releaseSync'], 'no storage/network work precedes the synchronous local release');
    assert.deepEqual(releaseOptions, [closedOrderId
      ? { deferRemote: true }
      : { deferRemote: true, waitForPersistence: false }]);
    assert.equal(timers.length, 1, 'remote cleanup is scheduled, never executed synchronously');
    assert.equal(closedIds.current.has('closed-order'), Boolean(closedOrderId));
    assert.equal(acknowledged.current.has('table-1'), !closedOrderId);
    await queue.run(async () => {});
    assert.deepEqual(trace, ['publish', 'releaseSync', 'save:table-1', ...(closedOrderId ? ['save:table-2'] : [])]);
    assert.deepEqual(saved, closedOrderId ? [tables[0], tables[1]] : [tables[0]]);
    assert.equal(tables[2], unaffected, 'unrelated table is neither changed nor persisted');
    assert.equal(tables[1].status, closedOrderId ? 'FREE' : 'OCCUPIED');
    assert.equal(tables[0].currentOrderId, undefined);
  }
});
