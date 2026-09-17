import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

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
    /setReturnToTableMapAfterPayment\(true\);\s*}\s*return txn;/,
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

test('closing a restaurant order releases its edit lock without waiting for another table', () => {
  const orderClosedHandler = appSource.slice(
    appSource.indexOf('onTableOrderClosed={(table'),
    appSource.indexOf('onOpenAgenda=', appSource.indexOf('onTableOrderClosed={(table')),
  );

  assert.match(
    orderClosedHandler,
    /releaseActiveTableEditLock\(\{ deferRemote: true \}\)/,
    'la facturación debe liberar el bloqueo de edición dentro del cierre de la mesa',
  );
  assert.ok(
    orderClosedHandler.indexOf('releaseActiveTableEditLock')
      < orderClosedHandler.indexOf("db.save('tables', reconciled)"),
    'la liberación local debe ocurrir antes de persistir el cierre',
  );
});
