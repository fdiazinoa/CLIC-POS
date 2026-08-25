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

test('el ticket ESC/POS imprime descuento antes de impuestos y el cupón después de pagos', () => {
  const payload = buildEscPosTicketPayload({
    id: 'sale-coupon-1',
    displayId: 'TCK-COUPON-1',
    date: new Date().toISOString(),
    items: [{ id: 'p1', cartId: 'c1', name: 'Producto', quantity: 1, price: 1_000 } as any],
    total: 1_062,
    payments: [{ id: 'payment-1', method: 'CASH', methodLabel: 'EFECTIVO', amount: 1_062 }],
    userId: 'u1',
    userName: 'Cajero',
    terminalId: 't1',
    status: 'COMPLETED',
    discountAmount: 100,
    discountType: 'FIXED',
    discountValue: 100,
    taxBreakdown: [{ id: 'itbis-18', name: 'ITBIS', rate: 0.18, amount: 162 }],
    couponCode: 'PROMO-2026',
    coupons: [{ id: 'coupon-1', code: 'PROMO-2026' }],
  } as any, printerConfig);
  const decoded = Buffer.from(payload || '', 'base64').toString('latin1');
  const subtotalIndex = decoded.indexOf('SUBTOTAL');
  const discountIndex = decoded.indexOf('DESCUENTO TOTAL');
  const taxIndex = decoded.indexOf('ITBIS 18%');
  const paymentsIndex = decoded.indexOf('PAGOS');
  const couponIndex = decoded.indexOf('DESCUENTO POR CUPON: PROMO-2026');

  assert.ok(subtotalIndex >= 0);
  assert.ok(discountIndex > subtotalIndex);
  assert.ok(taxIndex > discountIndex);
  assert.ok(paymentsIndex > taxIndex);
  assert.ok(couponIndex > paymentsIndex);
  assert.equal(decoded.match(/DESCUENTO POR CUPON: PROMO-2026/g)?.length, 1);
});
