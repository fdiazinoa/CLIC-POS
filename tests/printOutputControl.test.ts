import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { nativePrintBridge } from '../services/printer/NativePrintBridge';
import { PrintOutputError, runPrintTask } from '../services/printer/PrintFeedback';

test('un resultado nativo fallido no puede aceptarse como impresión', async () => {
  const previousWindow = (globalThis as any).window;
  (globalThis as any).window = {
    ClicPOSNativePrinter: {
      platform: 'android',
      printEscPos: async () => ({ status: 'error', success: false, errorCode: 'PRINTER_NOT_FOUND' }),
    },
  };
  try {
    await assert.rejects(
      nativePrintBridge.printEscPos({ dataBase64: 'AQ==' }, true),
      (error: unknown) => error instanceof PrintOutputError && /No se encontró una impresora/.test(error.message),
    );
  } finally {
    (globalThis as any).window = previousWindow;
  }
});

test('un trabajo pendiente bloquea envíos duplicados', async () => {
  let complete!: (value: boolean) => void;
  let submissions = 0;
  const task = () => {
    submissions += 1;
    return new Promise<boolean>(resolve => { complete = resolve; });
  };
  const first = runPrintTask('ticket:sale-1', 'Ticket', task, 1000);
  const duplicate = runPrintTask('ticket:sale-1', 'Ticket', task, 1000);
  assert.equal(first, duplicate);
  assert.equal(submissions, 0);
  await Promise.resolve();
  assert.equal(submissions, 1);
  complete(true);
  assert.equal(await first, true);
});

test('la pantalla de venta conserva el comprobante y ofrece reintento', () => {
  const source = readFileSync(new URL('../components/PaymentModal.tsx', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('if (!config || !completedTransaction || printTicketPending.current)'), source.indexOf('<Printer size={18}', source.indexOf('if (!config || !completedTransaction || printTicketPending.current)')));
  assert.doesNotMatch(handler, /onClose\(\)/);
  assert.match(handler, /vuelve a pulsar Ticket para reintentar sin repetir el cobro/);
  assert.match(handler, /printTicketPending\.current/);
});

test('todas las salidas transaccionales usan el control compartido', () => {
  const receipt = readFileSync(new URL('../utils/printer.ts', import.meta.url), 'utf8');
  for (const output of ['printTicket', 'printGatewayVoucher', 'printReservation', 'printPrecuenta', 'printComanda']) {
    assert.match(receipt, new RegExp(`const ${output} = .*runPrintTask`, 's'));
  }
  const close = readFileSync(new URL('../services/printer/ThermalPrinterService.ts', import.meta.url), 'utf8');
  const labels = readFileSync(new URL('../utils/labelPrinter.ts', import.meta.url), 'utf8');
  assert.match(close, /printZReport: .*runPrintTask/s);
  assert.match(labels, /export const printLabelsFromTemplate = async[\s\S]*runPrintTask/);
  assert.match(labels, /method: 'queued'[\s\S]*result\.printed remains false/);
});
