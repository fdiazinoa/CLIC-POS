import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../components/ProductForm.tsx', import.meta.url), 'utf8');

test('aclara Categoría POS como categoría de venta sin cambiar su contrato de datos', () => {
  assert.match(source, />Categoría de venta POS<\/label>/);
  assert.match(source, /-- Seleccione Categoría de venta POS --/);

  const fieldStart = source.indexOf('>Categoría de venta POS</label>');
  const fieldEnd = source.indexOf('</select>', fieldStart);
  const fieldBlock = source.slice(fieldStart, fieldEnd);

  assert.match(fieldBlock, /value=\{formData\.category\}/);
  assert.match(fieldBlock, /category: e\.target\.value/);
  assert.match(fieldBlock, /value=\{c\.name\}/);
  assert.doesNotMatch(fieldBlock, /formData\.type/);
});
