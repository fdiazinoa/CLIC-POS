import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const posSource = readFileSync(
  new URL('../components/POSInterface.tsx', import.meta.url),
  'utf8',
);

test('el catálogo móvil usa tarjetas y separación compactas', () => {
  assert.match(posSource, /min-h-\[194px\]/);
  assert.match(posSource, /h-\[6\.75rem\]/);
  assert.match(posSource, /minmax\(138px,1fr\)/);
  assert.match(posSource, /gap-2\.5 content-start/);
});

test('la navegación móvil conserva controles táctiles de al menos 42 px', () => {
  assert.match(posSource, /h-11 md:h-12/);
  assert.match(posSource, /h-\[42px\] md:h-\[48px\]/);
  assert.match(posSource, /isMobile \? 'p-3' : 'p-8'/);
});
