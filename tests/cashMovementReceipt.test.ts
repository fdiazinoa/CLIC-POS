import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildEscPosCashMovementReceiptPayload } from '../services/printer/EscPosFormatter';
import { appendNumericCharacter } from '../utils/numericInput';
import type { BusinessConfig, CashMovement } from '../types';

const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../components/TerminalSettings.tsx', import.meta.url), 'utf8');
const defaultsSource = readFileSync(new URL('../constants.ts', import.meta.url), 'utf8');

const config = {
  companyInfo: { name: 'CLIC QA', rnc: '101010101' },
  currencySymbol: 'RD$',
  currencies: [{ code: 'DOP', symbol: 'RD$', isBase: true }],
  terminals: [{ id: 'T1', config: { terminalName: 'Caja 1' } }],
} as unknown as BusinessConfig;

const movement = {
  id: 'CM-1001',
  type: 'IN',
  amount: 1250.5,
  reason: 'Fondo inicial',
  timestamp: '2026-09-04T08:30:00-04:00',
  userId: 'u1',
  userName: 'Ana',
  terminalId: 'T1',
  currencyCode: 'DOP',
} as CashMovement;

test('Entrada/Salida usa teclado interno y no abre el teclado Android al entrar', () => {
  const start = posSource.indexOf('{cashMovementModalType && (');
  const end = posSource.indexOf('{showServiceTypeDialog', start);
  const modal = posSource.slice(start, end);

  assert.match(modal, /<NumericKeypad/);
  assert.match(modal, /inputMode="none"/);
  assert.match(modal, /data-disable-native-soft-keyboard="true"/);
  assert.match(modal, /maxDecimalPlaces=\{2\}/);
  assert.doesNotMatch(modal, /autoFocus/);
  assert.doesNotMatch(modal, /type="number"/);
});

test('el teclado monetario limita la cantidad a dos decimales', () => {
  const options = { allowDecimal: true, maxDecimalPlaces: 2 };
  assert.equal(appendNumericCharacter('12.34', '5', options), '12.34');
  assert.equal(appendNumericCharacter('12.3', '4', options), '12.34');
});

test('el comprobante térmico contiene los datos auditables del movimiento', () => {
  const payload = buildEscPosCashMovementReceiptPayload(movement, config);
  assert.ok(payload);
  const receipt = Buffer.from(payload, 'base64').toString('latin1');

  assert.match(receipt, /COMPROBANTE DE ENTRADA/);
  assert.match(receipt, /CM-1001/);
  assert.match(receipt, /Caja 1/);
  assert.match(receipt, /Ana/);
  assert.match(receipt, /Fondo inicial/);
  assert.match(receipt, /RD\$1250\.50/);
});

test('la opción de sesión controla la impresión posterior a la persistencia', () => {
  assert.match(settingsSource, /Imprimir comprobante de entrada\/salida/);
  assert.match(settingsSource, /autoPrintCashMovementReceipt/);
  assert.match(defaultsSource, /autoPrintCashMovementReceipt: false/);

  const start = posSource.indexOf('const confirmCashMovement = async');
  const end = posSource.indexOf('const renderQuickActionsPanel', start);
  const flow = posSource.slice(start, end);
  const saveIndex = flow.indexOf('await onRegisterCashMovement');
  const closeIndex = flow.indexOf('closeCashMovementModal()');
  const printIndex = flow.indexOf('printCashMovementReceipt');

  assert.ok(saveIndex >= 0);
  assert.ok(closeIndex > saveIndex);
  assert.ok(printIndex > closeIndex);
  assert.match(flow, /movement && activeTerminalConfig\?\.workflow\?\.session\?\.autoPrintCashMovementReceipt/);
  assert.match(flow, /void printCashMovementReceipt/);
});
