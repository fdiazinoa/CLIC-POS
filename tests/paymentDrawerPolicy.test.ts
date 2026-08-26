import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEscPosCashDrawerPayload, buildEscPosTicketPayload, shouldOpenDrawerForTransaction } from '../services/printer/EscPosFormatter';
import type { BusinessConfig, Transaction } from '../types';
import { getInitialConfig } from '../constants';

const buildConfig = (): BusinessConfig => {
  const config = getInitialConfig('Supermercado' as any);
  config.paymentMethods = [
    { id: 'cash', name: 'Efectivo', type: 'CASH', opensDrawer: true },
    { id: 'card', name: 'Tarjeta', type: 'CARD', opensDrawer: false },
  ] as BusinessConfig['paymentMethods'];
  config.terminals = [{
    id: 't1',
    config: {
      currentDeviceId: 'DEV-1',
      erpTerminalId: 'erp-terminal-1',
      hardware: { cashDrawerTrigger: 'PRINTER' },
    },
  }] as BusinessConfig['terminals'];
  return config;
};

const buildTransaction = (payments: Array<Record<string, unknown>>, terminalId = 't1'): Transaction => ({
  id: 'tx-drawer-policy',
  terminalId,
  userId: 'user-1',
  userName: 'Cajero',
  status: 'COMPLETED',
  date: '2026-08-26T12:00:00.000Z',
  items: [{
    id: 'item-1',
    cartId: 'cart-1',
    name: 'Producto',
    quantity: 1,
    price: 100,
    category: 'General',
    images: [],
    attributes: [],
    variants: [],
    tariffs: [],
    appliedTaxIds: [],
  }],
  subtotal: 100,
  tax: 0,
  total: 100,
  payments,
} as Transaction);

test('abre el cajón cuando el medio de pago marcado participa en la venta', () => {
  const config = buildConfig();
  const transaction = buildTransaction([{ methodId: 'cash', method: 'CASH', amount: 100 }]);

  assert.equal(shouldOpenDrawerForTransaction(transaction, config), true);
});

test('no abre el cajón para una tarjeta sin el check', () => {
  const config = buildConfig();
  const transaction = buildTransaction([{ methodId: 'card', method: 'CARD', amount: 100 }]);

  assert.equal(shouldOpenDrawerForTransaction(transaction, config), false);
});

test('un pago mixto abre el cajón si al menos uno de sus medios está marcado', () => {
  const config = buildConfig();
  const transaction = buildTransaction([
    { methodId: 'card', method: 'CARD', amount: 50 },
    { methodId: 'cash', method: 'CASH', amount: 50 },
  ]);

  assert.equal(shouldOpenDrawerForTransaction(transaction, config), true);
});

test('reconoce la terminal por su identificador ERP', () => {
  const config = buildConfig();
  const transaction = buildTransaction([{ method: 'CASH', amount: 100 }], 'erp-terminal-1');

  assert.equal(shouldOpenDrawerForTransaction(transaction, config), true);
});

test('no envía apertura a la impresora cuando la terminal usa disparo directo', () => {
  const config = buildConfig();
  config.terminals[0].config.hardware.cashDrawerTrigger = 'DIRECT';
  const transaction = buildTransaction([{ method: 'CASH', amount: 100 }]);

  assert.equal(shouldOpenDrawerForTransaction(transaction, config), false);
});

test('el pulso del cajón se envía como una orden independiente del ticket', () => {
  const drawerBytes = Buffer.from(buildEscPosCashDrawerPayload(), 'base64');
  const ticketPayload = buildEscPosTicketPayload(
    buildTransaction([{ methodId: 'cash', method: 'CASH', amount: 100 }]),
    buildConfig(),
    [],
  );
  assert.ok(ticketPayload);
  const ticketBytes = Buffer.from(ticketPayload, 'base64');
  const drawerPulse = Buffer.from([0x1b, 0x70, 0x00, 25, 250]);

  assert.equal(drawerBytes.includes(drawerPulse), true);
  assert.equal(ticketBytes.includes(drawerPulse), false);
});
