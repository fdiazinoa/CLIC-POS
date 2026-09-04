import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

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
  assert.match(
    posSource,
    /onClose=\{\(\) => \{\s*setShowPaymentModal\(false\);\s*if \(returnToTableMapAfterPayment && onOpenTableMap\) \{\s*setReturnToTableMapAfterPayment\(false\);\s*onOpenTableMap\(\);/,
    'the explicit modal close action must return restaurant sales to the table map'
  );
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
