import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readSource = (relativePath: string): string =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('el éxito del cobro se publica antes de abrir cajón, imprimir o enviar correo', () => {
  const source = readSource('components/PaymentModal.tsx');
  const successIndex = source.indexOf('setIsSuccessScreen(true);');
  const deferredDeliveryIndex = source.indexOf('window.setTimeout(() => {', successIndex);
  const drawerIndex = source.indexOf('await openCashDrawerForTransaction', successIndex);
  const emailIndex = source.indexOf('await sendReceiptEmailRequest', successIndex);
  const printIndex = source.indexOf('await printIntegratedPaymentArtifacts', successIndex);

  assert.ok(successIndex > 0);
  assert.ok(deferredDeliveryIndex > successIndex);
  assert.ok(drawerIndex > deferredDeliveryIndex);
  assert.ok(emailIndex > deferredDeliveryIndex);
  assert.ok(printIndex > deferredDeliveryIndex);
});

test('el temporizador lento termina cuando SQLite confirma la venta', () => {
  const source = readSource('components/PaymentModal.tsx');
  const confirmationIndex = source.indexOf('const txn = await onConfirm');
  const clearIndex = source.indexOf('window.clearTimeout(slowProcessTimer);', confirmationIndex);
  const drawerIndex = source.indexOf('await openCashDrawerForTransaction', confirmationIndex);

  assert.ok(clearIndex > confirmationIndex);
  assert.ok(drawerIndex > clearIndex);
});

test('la propagación de secuencias queda ordenada pero no bloquea el cobro', () => {
  const source = readSource('services/transactionService.ts');
  const generator = source.slice(
    source.indexOf('async generateTransactionId'),
    source.indexOf('async createTransaction'),
  );

  assert.match(source, /let sequenceBroadcastQueue: Promise<void> = Promise\.resolve\(\)/);
  assert.match(generator, /enqueueSequenceBroadcast\(seriesId, seriesConfig\)/);
  assert.doesNotMatch(generator, /await syncManager\.broadcastChange/);
});

test('el cierre no incrementa dos veces la secuencia y difiere el recálculo del kardex', () => {
  const source = readSource('App.tsx');
  const completion = source.slice(
    source.indexOf('const handleTransactionComplete = async'),
    source.indexOf('const handleRegisterMovement'),
  );
  const deferredRefresh = completion.indexOf('window.setTimeout(() => {');
  const recalculate = completion.indexOf('await db.recalculateProductStock');

  assert.doesNotMatch(completion, /nextNumber\+\+/);
  assert.doesNotMatch(completion, /pushCatalog\('internalSequences'\)/);
  assert.ok(deferredRefresh > 0);
  assert.ok(recalculate > deferredRefresh);
  assert.match(completion, /db\.get\('products'\)/);
});
