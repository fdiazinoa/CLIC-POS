import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  normalizePrintCopies,
  resolveConfiguredPrintCopies,
  resolveTransactionPrintKind,
} from '../utils/printCopies';

test('normaliza cantidades de copias a un rango seguro', () => {
  assert.equal(normalizePrintCopies(undefined), 1);
  assert.equal(normalizePrintCopies(0), 1);
  assert.equal(normalizePrintCopies(2.9), 2);
  assert.equal(normalizePrintCopies(99), 10);
});

test('resuelve copias por tipo de documento con compatibilidad para configuraciones antiguas', () => {
  const config = {
    receiptConfig: {
      documentCopies: {
        invoice: 2,
        creditNote: 3,
        kitchenOrder: 4,
        xReport: 5,
        zReport: 6,
        other: 7,
      },
    },
  } as any;

  assert.equal(resolveConfiguredPrintCopies(config, 'invoice'), 2);
  assert.equal(resolveConfiguredPrintCopies(config, 'creditNote'), 3);
  assert.equal(resolveConfiguredPrintCopies(config, 'kitchenOrder'), 4);
  assert.equal(resolveConfiguredPrintCopies(config, 'xReport'), 5);
  assert.equal(resolveConfiguredPrintCopies(config, 'zReport'), 6);
  assert.equal(resolveConfiguredPrintCopies(config, 'other'), 7);
  assert.equal(resolveConfiguredPrintCopies({ receiptConfig: {} } as any, 'invoice'), 1);
});

test('clasifica devoluciones y B04 como nota de crédito', () => {
  assert.equal(resolveTransactionPrintKind({ ncfType: 'B04', documentType: 'TICKET' } as any), 'creditNote');
  assert.equal(resolveTransactionPrintKind({ documentType: 'REFUND' } as any), 'creditNote');
  assert.equal(resolveTransactionPrintKind({ ncfType: 'B02', documentType: 'TICKET' } as any), 'invoice');
});

test('los flujos físicos propagan la cantidad configurada al router de impresión', () => {
  const printerSource = readFileSync(new URL('../utils/printer.ts', import.meta.url), 'utf8');
  const zReportSource = readFileSync(
    new URL('../services/printer/ThermalPrinterService.ts', import.meta.url),
    'utf8',
  );
  const nativeBridgeSource = readFileSync(
    new URL('../native-stubs/android/ClicPOSNativePrinterBridge.kt', import.meta.url),
    'utf8',
  );

  assert.match(printerSource, /resolveTransactionPrintKind\(transaction\)/);
  assert.match(printerSource, /resolveConfiguredPrintCopies\(config, 'kitchenOrder'\)/);
  assert.match(printerSource, /resolveConfiguredPrintCopies\(config, 'other'\)/);
  assert.match(zReportSource, /isXReport \? 'xReport' : 'zReport'/);
  assert.ok((printerSource.match(/copies,/g) || []).length >= 8);
  assert.ok((zReportSource.match(/copies,/g) || []).length >= 2);
  assert.match(nativeBridgeSource, /payload\.optInt\("copies", 1\)\.coerceIn\(1, 10\)/);
  assert.match(nativeBridgeSource, /repeat\(copies\.coerceIn\(1, 10\)\)/);
});
