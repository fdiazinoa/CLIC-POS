import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readComponent = (name: string) => readFileSync(new URL(`../components/${name}`, import.meta.url), 'utf8');

test('Cierre Z usa teclado numérico interno en Android para todos los importes', () => {
  const source = readComponent('ZReportDashboard.tsx');

  assert.match(source, /Capacitor\.getPlatform\(\) === 'android'/);
  assert.match(source, /AndroidNumericKeypadDialog/);
  // Cash and denominations are fixed inputs; one dynamic input covers every
  // configured non-cash payment method selected for declaration.
  assert.ok((source.match(/data-disable-native-soft-keyboard/g) || []).length >= 3);
  assert.ok((source.match(/readOnly=\{isAndroid\}/g) || []).length >= 3);
  assert.match(source, /kind: 'DENOMINATION'/);
  assert.match(source, /kind: 'CASH'/);
  assert.match(source, /kind: 'PAYMENT_METHOD'/);
  assert.match(source, /paymentMethodsToDeclare\.map/);
});

test('acciones de precio usan teclado interno y toleran artículos ERP sin price', () => {
  for (const component of ['ProductQuickActions.tsx', 'ProductActionModal.tsx']) {
    const source = readComponent(component);
    assert.match(source, /Capacitor\.getPlatform\(\) === 'android'/, component);
    assert.match(source, /data-disable-native-soft-keyboard/, component);
    assert.match(source, /readOnly=\{isAndroid\}/, component);
    assert.match(source, /<NumericKeypad/, component);
    assert.match(source, /Number\.isFinite\(Number\(product/, component);
  }
});

test('el teclado de precio no se interpreta como clic fuera del menú de acciones', () => {
  const source = readComponent('ProductQuickActions.tsx');

  assert.match(source, /if \(activeModal !== 'NONE'\) return;/);
  assert.match(source, /\[activeModal, onClose\]/);
});

test('precio y descuento del artículo comparten el teclado interno sin abrir LatinIME', () => {
  const source = readComponent('CartItemOptionsModal.tsx');

  assert.match(source, /activeNumericField/);
  assert.match(source, /'PRICE' \| 'DISCOUNT'/);
  assert.match(source, /inputMode=\{isAndroid \? 'none' : 'decimal'\}/);
  assert.ok((source.match(/data-disable-native-soft-keyboard/g) || []).length >= 2);
  assert.ok((source.match(/readOnly=\{isAndroid\}/g) || []).length >= 2);
  assert.match(source, /replacePriceOnNextKey \? '' : priceInputValue/);
  assert.match(source, /Digitando: \{activeNumericField === 'PRICE' \? 'Precio unitario' : 'Descuento'\}/);
});
