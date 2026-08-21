import assert from 'node:assert/strict';
import test from 'node:test';
import { appendNumericCharacter, removeLastNumericCharacter } from '../utils/numericInput';

test('el teclado numérico construye enteros y decimales sin ceros iniciales', () => {
  assert.equal(appendNumericCharacter('', '0'), '0');
  assert.equal(appendNumericCharacter('0', '5'), '5');
  assert.equal(appendNumericCharacter('', '.'), '0.');
  assert.equal(appendNumericCharacter('12.', '5'), '12.5');
  assert.equal(appendNumericCharacter('12.5', '.'), '12.5');
});

test('el teclado numérico respeta el máximo configurado y permite borrar', () => {
  assert.equal(appendNumericCharacter('10', '1', { maxValue: 100 }), '10');
  assert.equal(appendNumericCharacter('9', '9', { maxValue: 100 }), '99');
  assert.equal(removeLastNumericCharacter('12.5'), '12.');
  assert.equal(removeLastNumericCharacter(''), '');
});
