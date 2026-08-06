import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const kdsSource = readFileSync(new URL('../components/kds/KitchenDisplay.tsx', import.meta.url), 'utf8');

test('el KDS reduce tipografía y espacios para mostrar más líneas por tarjeta', () => {
  assert.match(kdsSource, /min-h-\[250px\]/);
  assert.match(kdsSource, /flex-1 overflow-y-auto p-3 space-y-2/);
  assert.match(kdsSource, /text-base font-bold leading-tight/);
  assert.match(kdsSource, /w-full py-2\.5 rounded-xl font-black text-sm/);
});
