import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  resolveGlobalDiscountLabel,
  resolveGlobalDiscountPercentage,
} from '../utils/globalDiscountPresentation';
import {
  buildEscPosSubtotalPayload,
  buildEscPosTicketPayload,
} from '../services/printer/EscPosFormatter';

const htmlPrinterSource = readFileSync(new URL('../utils/printer.ts', import.meta.url), 'utf8');
const escPosPrinterSource = readFileSync(
  new URL('../services/printer/EscPosFormatter.ts', import.meta.url),
  'utf8',
);
const printerConfig = {
  companyInfo: { name: 'CLIC POS', rnc: '', phone: '', address: '' },
  currencySymbol: 'RD$',
  receiptConfig: {},
  taxes: [],
  terminals: [],
} as any;

test('el descuento de la precuenta muestra el porcentaje aplicado', () => {
  assert.equal(resolveGlobalDiscountPercentage({
    discountAmount: 158,
    subtotalBeforeDiscount: 790,
  }), 20);
  assert.equal(resolveGlobalDiscountLabel({
    discountAmount: 158,
    subtotalBeforeDiscount: 790,
  }), 'DESCUENTO (20%)');
});

test('el porcentaje configurado se conserva y los descuentos fijos se calculan', () => {
  assert.equal(resolveGlobalDiscountLabel({
    discountAmount: 100,
    subtotalBeforeDiscount: 790,
    discountType: 'PERCENT',
    discountValue: 12.5,
  }), 'DESCUENTO (12.5%)');
  assert.equal(resolveGlobalDiscountLabel({
    discountAmount: 79,
    subtotalBeforeDiscount: 790,
    discountType: 'FIXED',
    discountValue: 79,
  }), 'DESCUENTO (10%)');
});

test('las impresiones HTML y ESC/POS usan la etiqueta y una devolución fuerza nota de crédito', () => {
  assert.match(htmlPrinterSource, /const discountLabel = resolveGlobalDiscountLabel/);
  assert.match(htmlPrinterSource, /<span>\$\{discountLabel\}<\/span>/);
  assert.match(htmlPrinterSource, /transaction\.documentType === 'REFUND'/);
  assert.match(htmlPrinterSource, /\? 'NOTA DE CRÉDITO'/);

  assert.match(escPosPrinterSource, /buildEscPosSubtotalPayload/);
  assert.match(escPosPrinterSource, /discountType: params\.discountType/);
  assert.match(escPosPrinterSource, /transaction\.documentType === 'REFUND'/);
  assert.match(escPosPrinterSource, /\? 'NOTA DE CREDITO'/);

  const subtotalPayload = buildEscPosSubtotalPayload(printerConfig, {
    items: [{ id: 'p1', cartId: 'c1', name: 'Producto', quantity: 1, price: 790 } as any],
    subtotal: 790,
    discountTotal: 158,
    discountType: 'PERCENT',
    discountValue: 20,
    taxTotal: 113.76,
    finalTotal: 745.76,
  });
  assert.match(Buffer.from(subtotalPayload || '', 'base64').toString('latin1'), /DESCUENTO \(20%\)/);

  const refundPayload = buildEscPosTicketPayload({
    id: 'refund-1',
    documentType: 'REFUND',
    ncfType: 'B02',
    date: new Date().toISOString(),
    items: [{ id: 'p1', cartId: 'c1', name: 'Producto', quantity: -1, price: 100 } as any],
    total: -100,
    payments: [],
    userId: 'u1',
    userName: 'Cajero',
    terminalId: 't1',
    status: 'REFUNDED',
  } as any, printerConfig);
  const decodedRefund = Buffer.from(refundPayload || '', 'base64').toString('latin1');
  assert.match(decodedRefund, /NOTA DE CREDITO/);
  assert.doesNotMatch(decodedRefund, /FACTURA DE CONSUMO/);
});
