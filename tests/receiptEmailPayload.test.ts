import assert from 'node:assert/strict';
import test from 'node:test';

import type { BusinessConfig, CartItem, Transaction, User } from '../types';
import { buildReceiptEmailPayload, resolveReceiptItemOptions } from '../services/email/receiptEmailPayload';

test('normaliza opciones de producto sin duplicados', () => {
  const item = {
    modifiers: ['Marinado Especial'],
    selected_modifiers: [{ name: 'Extra queso' }],
    restaurantConfig: { selected_modifiers: [{ label: 'Extra queso' }], note: 'Sin cebolla' },
    variantInfo: 'Grande',
  } as CartItem;

  assert.deepEqual(resolveReceiptItemOptions(item), [
    'Marinado Especial',
    'Extra queso',
    'Grande',
    'Sin cebolla',
  ]);
});

test('no repite talla y color cuando ya están descritos en la variante', () => {
  const item = {
    modifiers: ['Rojo', 'M', 'Marinado Especial'],
    variantInfo: 'Color: Rojo / Talla: M',
  } as CartItem;

  assert.deepEqual(resolveReceiptItemOptions(item), [
    'Marinado Especial',
    'Color: Rojo / Talla: M',
  ]);
});

test('construye el contrato detallado para el ticket visual del ERP', () => {
  const transaction = {
    id: 'tx-1',
    displayId: 'TCKS0022000005',
    date: '2026-08-20T13:57:57.047Z',
    items: [{
      id: 'p-1',
      cartId: 'cart-1',
      name: 'Pollo Fresco (Peso)',
      quantity: 2.45,
      price: 3.5,
      originalPrice: 4,
      taxAmount: 1.54,
      salespersonId: 'seller-1',
      modifiers: ['Marinado Especial'],
    } as CartItem],
    total: 10.12,
    payments: [{
      method: 'CARD',
      methodLabel: 'Tarjeta',
      amount: 10.12,
      appliedAmount: 10.12,
      currencyCode: 'DOP',
      gatewayAuthorizationCode: 'SECRET-AUTH',
      gatewayReference: 'SECRET-REFERENCE',
    }],
    userId: 'cashier-1',
    userName: 'Ana P.',
    terminalId: 'terminal-1',
    status: 'COMPLETED',
    ncf: 'E310000000001',
    ncfType: 'E31',
    fiscalMode: 'ECF',
    fiscalSyncStatus: 'SYNCED',
    fiscalReferenceId: 'ecf-reference-1',
    netAmount: 8.58,
    taxAmount: 1.54,
    discountAmount: 0.5,
    discountType: 'PERCENT',
    discountValue: 5,
  } as Transaction;
  const config = {
    companyInfo: { name: 'Mercasend', rnc: '131-12345-1' },
    currencies: [
      { code: 'DOP', name: 'Peso dominicano', symbol: 'RD$', rate: 1, isBase: true, isEnabled: true },
      { code: 'USD', name: 'Dólar', symbol: '$', rate: 60, isEnabled: true },
    ],
    receiptConfig: {
      showQr: true,
      showForeignCurrencyTotals: true,
      showOrderNumber: true,
      footerMessage: '¡Gracias por su compra!',
    },
  } as BusinessConfig;
  const users = [{ id: 'seller-1', name: 'Ana P.' }] as User[];

  const payload = buildReceiptEmailPayload(transaction, 'cliente@example.com', config, 'RD$', users);
  const line = payload.cart[0] as Record<string, unknown>;

  assert.equal(payload.fiscalDocumentLabel, 'e-CF Credito Fiscal');
  assert.equal(payload.fiscalValidated, true);
  assert.equal(payload.cashierName, 'Ana P.');
  assert.equal(payload.discountValue, 5);
  assert.equal(line.sellerName, 'Ana P.');
  assert.equal(line.itemTaxAmount, 1.54);
  assert.equal(line.itemDiscountAmount, 1.23);
  assert.deepEqual(line.options, ['Marinado Especial']);
  assert.equal(payload.showForeignCurrencyTotals, true);
  assert.equal(payload.showOrderNumber, true);
  assert.deepEqual(payload.receiptDesign, {
    showCustomerInfo: false,
    showSavings: false,
    showQr: true,
    showForeignCurrencyTotals: true,
    showSerialNumbers: false,
    showLotNumbers: false,
    showOrderNumber: true,
    footerMessage: '¡Gracias por su compra!',
  });
  assert.equal(JSON.stringify(payload.payments).includes('SECRET-AUTH'), false);
  assert.equal(JSON.stringify(payload.payments).includes('SECRET-REFERENCE'), false);
});

test('convierte la tasa promocional fraccionaria a porcentaje para el correo', () => {
  const transaction = {
    id: 'tx-promo',
    date: '2026-08-23T13:00:00.000Z',
    items: [{
      id: 'p-1',
      cartId: 'cart-promo',
      name: 'Camisa A',
      quantity: 2,
      price: 187.5,
      originalPrice: 375,
      discountAmount: 375,
      discountRate: 0.5,
      totalAmount: 375,
      adjustmentSource: 'PROMOTION',
    } as CartItem],
    total: 375,
    payments: [{ method: 'CASH', amount: 375 }],
    userId: 'cashier-1',
    userName: 'Ana P.',
    status: 'COMPLETED',
  } as Transaction;

  const payload = buildReceiptEmailPayload(transaction, 'cliente@example.com', undefined, 'RD$');
  const line = payload.cart[0] as Record<string, unknown>;

  assert.equal(line.itemDiscountRate, 50);
});
