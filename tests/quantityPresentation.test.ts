import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatQuantity, normalizeQuantityPresentation, terminalQuantityPresentation } from '../utils/quantityPresentation';
import { createWeightPresentation, displayWeightQuantity, weightLineLabel } from '../utils/scaleWeight';
import { mergeTerminalPosOptions } from '../utils/terminalPosOptions';
import { applyTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';
import { getInitialConfig, DEFAULT_TERMINAL_CONFIG } from '../constants';
import SupermarketTicketSummary from '../components/SupermarketTicketSummary';
import PurchaseOrderList from '../components/PurchaseOrderList';
import SettingsOperational from '../components/SettingsOperational';
import { buildEscPosTicketPayload } from '../services/printer/EscPosFormatter';
import { buildReceiptEmailPayload } from '../services/email/receiptEmailPayload';

test('bounded cached text formatting preserves small nonzero signs and invalid values', () => {
  assert.equal(formatQuantity(0.5715263862000001), '0.572');
  assert.equal(formatQuantity(1), '1');
  assert.equal(formatQuantity(1.23456789, 0), '1');
  assert.equal(formatQuantity(1.23456789, 6), '1.234568');
  assert.equal(formatQuantity(-1.23456789), '-1.235');
  assert.equal(formatQuantity(-0), '0');
  assert.equal(formatQuantity(0.00001), '< 0.001');
  assert.equal(formatQuantity(-0.00001), '> -0.001');
  assert.equal(formatQuantity(0.1, 0), '< 1');
  assert.equal(formatQuantity(-0.1, 0), '> -1');
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(formatQuantity(value), '—');
  for (const value of ['6', -1, 7, NaN, 1.2]) assert.equal(formatQuantity(1.2345, value), '1.235');
  assert.equal(formatQuantity(123456789.125), '123,456,789.125');
  assert.deepEqual(normalizeQuantityPresentation({ salesDecimals: 0, purchaseDecimals: 6 }), { salesDecimals: 0, purchaseDecimals: 6 });
});
const base = () => ({ ...getInitialConfig('Supermercado' as any), terminals: [
  { id: 'T', config: { ...structuredClone(DEFAULT_TERMINAL_CONFIG), operational: {
    ...DEFAULT_TERMINAL_CONFIG.operational, quantityPresentation: { salesDecimals: 3, purchaseDecimals: 6 } } } },
  { id: 'OTHER', config: { ...structuredClone(DEFAULT_TERMINAL_CONFIG), operational: {
    ...DEFAULT_TERMINAL_CONFIG.operational, quantityPresentation: { salesDecimals: 0, purchaseDecimals: 0 } } } },
] } as any);

test('terminal config roundtrip and ERP omission preserve local precision without cross-terminal inheritance', () => {
  const config = base();
  const restored = JSON.parse(JSON.stringify(config));
  assert.deepEqual(terminalQuantityPresentation(restored, 'T'), { salesDecimals: 3, purchaseDecimals: 6 });
  assert.deepEqual(terminalQuantityPresentation(restored, 'missing'), { salesDecimals: 3, purchaseDecimals: 3 });
  const applied = applyTerminalConfigSnapshot(restored, { terminalId: 'T', incomingSnapshot: { terminal_id: 'T', resolved: { operational: { expandTicket: true } } } as any });
  assert.equal(applied.config.terminals.find((t: any) => t.id === 'T').config.operational.quantityPresentation.purchaseDecimals, 6);
  assert.equal(applied.config.terminals.find((t: any) => t.id === 'OTHER').config.operational.quantityPresentation.salesDecimals, 0);
  const local = config.terminals[0].config;
  const patch = mergeTerminalPosOptions(local, { operational: { quantityPresentation: { salesDecimals: 2, purchaseDecimals: '0' } } });
  assert.deepEqual(patch.operational.quantityPresentation, { salesDecimals: 2, purchaseDecimals: 6 });
});

test('actual footer/settings/purchase list renders chosen precision and respects readonly', () => {
  const summary = renderToStaticMarkup(React.createElement(SupermarketTicketSummary, { symbol: '$', subtotal: 1, discount: 0, tax: 0, total: 1, units: .5715263862000001, points: 0, quantityDecimals: 3 }));
  assert.match(summary, />0\.572</); assert.doesNotMatch(summary, /571526386/);
  const config = base();
  const settings = renderToStaticMarkup(React.createElement(SettingsOperational, { config: config.terminals[0].config, onUpdate() {}, isReadOnly: true }));
  assert.match(settings, /Decimales de cantidad en ventas/); assert.match(settings, /Sólo visualización/);
  assert.match(settings, /aria-label="Decimales de cantidad en compras"[^>]*disabled/);
  const orders = [{ id: 'PO', date: '2026-10-09', status: 'ORDERED', supplierId: 'S', items: [{ quantityOrdered: 1.23456789, quantityReceived: .12345678 }], totalCost: 42 }] as any;
  const before = JSON.stringify(orders);
  const html = renderToStaticMarkup(React.createElement(PurchaseOrderList, { purchaseOrders: orders, suppliers: [], config, terminalId: 'T', onNewOrder() {}, onViewDetail() {}, onSendEmail() {}, onDeleteOrder() {} }));
  assert.match(html, /1\.234568/); assert.match(html, /0\.123457/);
  assert.equal(JSON.stringify(orders), before);
});

test('receipt and email quantity labels change while canonical sale, refund, price, tax and DTO remain exact', () => {
  const config = base(); config.companyInfo = { name: 'CLIC', rnc: '', address: '', phone: '' }; config.currencySymbol='$'; config.receiptConfig={};
  const line = { id:'BAL',cartId:'L',name:'BAL',quantity:.5715263862000001*.45359237,price:1.23456789,originalPrice:2,taxAmount:.04,measurementUnit:'kg',weightPresentation:createWeightPresentation('S','lb','kg') } as any;
  const tx = { id:'X',date:'2026-10-09',terminalId:'T',items:[line],total:line.quantity*line.price,payments:[],userName:'Fixture' } as any;
  const before=JSON.stringify(tx); const totals=tx.items.map((i:any)=>i.quantity*i.price);
  const render = () => Buffer.from(buildEscPosTicketPayload(tx,config)!, 'base64').toString('latin1');
  const a=render(); assert.match(a,/0\.572 lb x/);
  config.terminals[0].config.operational.quantityPresentation.salesDecimals=6;
  const b=render(); assert.match(b,/0\.571526 lb x/);
  assert.equal(weightLineLabel(line,'$',line.price,0).split(' x ')[1],weightLineLabel(line,'$',line.price,6).split(' x ')[1]);
  const dto=buildReceiptEmailPayload(tx,'fixture@example.invalid',config,'$') as any;
  const item=dto.items?.[0]||dto.cart?.[0]; assert.equal(item.quantity,line.quantity); assert.equal(item.price,line.price); assert.equal(item.unitPrice,line.price);
  assert.equal(JSON.stringify(tx),before); assert.deepEqual(tx.items.map((i:any)=>i.quantity*i.price),totals);
  assert.equal(displayWeightQuantity(line),line.quantity/.45359237);
});
