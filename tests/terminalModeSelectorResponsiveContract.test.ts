import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/TerminalModeSelector.tsx', import.meta.url), 'utf8');

test('el selector de modo permite desplazamiento vertical en pantallas móviles', () => {
  assert.match(source, /h-full min-h-0 overflow-y-auto/);
  assert.doesNotMatch(source, /p-6 overflow-hidden relative/);
  assert.match(source, /items-start justify-center/);
});

test('las cuatro opciones conservan una columna móvil y dos columnas desde tablet', () => {
  assert.match(source, /grid grid-cols-1[^"']*md:grid-cols-2/);
  assert.match(source, /onSelect\('SERVER_LOCAL'\)/);
  assert.match(source, /onSelect\('SERVER_ERP'\)/);
  assert.match(source, /onSelect\('CLIENT'\)/);
  assert.match(source, /onSelect\('ORDER_TAKER'\)/);
  assert.deepEqual([...source.matchAll(/onSelect\('([^']+)'\)/g)].map(match => match[1]).sort(),
    ['CLIENT', 'ORDER_TAKER', 'SERVER_ERP', 'SERVER_LOCAL']);
});
