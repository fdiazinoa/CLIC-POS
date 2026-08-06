import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveKdsTicketHeightClass } from '../components/kds/KitchenDisplay';

const kdsSource = readFileSync(new URL('../components/kds/KitchenDisplay.tsx', import.meta.url), 'utf8');

test('el KDS reduce tipografía y espacios para mostrar más líneas por tarjeta', () => {
  assert.match(kdsSource, /min-h-\[250px\]/);
  assert.match(kdsSource, /flex-1 overflow-y-auto p-3 space-y-2/);
  assert.match(kdsSource, /text-base font-bold leading-tight/);
  assert.match(kdsSource, /w-full py-2\.5 rounded-xl font-black text-sm/);
});

test('el KDS aprovecha toda la altura cuando las órdenes caben en una sola fila', () => {
  assert.match(resolveKdsTicketHeightClass(1), /h-\[calc\(100vh-9\.5rem\)\]/);
  assert.match(resolveKdsTicketHeightClass(2), /sm:h-\[calc\(100vh-9\.5rem\)\]/);
  assert.match(resolveKdsTicketHeightClass(3), /lg:h-\[calc\(100vh-9\.5rem\)\]/);
  assert.match(resolveKdsTicketHeightClass(4), /2xl:h-\[calc\(100vh-9\.5rem\)\]/);
  assert.doesNotMatch(resolveKdsTicketHeightClass(5), /lg:h-\[calc\(100vh-9\.5rem\)\]/);
});

test('las minutas extensas ofrecen contador, toque y pulsación larga para ampliar', () => {
  assert.match(kdsSource, /\+\{hiddenItemCount\} artículos · VER TODOS/);
  assert.match(kdsSource, /KDS_LONG_PRESS_MS = 550/);
  assert.match(kdsSource, /Toca para ver la orden completa/);
  assert.match(kdsSource, /<ExpandedTicketOverlay/);
  assert.match(kdsSource, /MARCAR ORDEN \/ LISTA/);
});
