import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const posSource = readFileSync(
  new URL('../components/POSInterface.tsx', import.meta.url),
  'utf8',
);

const gridStart = posSource.indexOf('className="pos-full-action-grid');
const gridEnd = posSource.indexOf('{/* RIGHT SIDEBAR', gridStart);
const restaurantActionGrid = posSource.slice(gridStart, gridEnd);

test('la botonera completa elimina encabezados visuales y conserva grupos accesibles', () => {
  assert.match(restaurantActionGrid, /role="group" aria-label="Venta"/);
  assert.match(restaurantActionGrid, /role="group" aria-label="Comanda"/);
  assert.match(restaurantActionGrid, /role="group" aria-label="Caja"/);
  assert.doesNotMatch(restaurantActionGrid, />\s*Venta\s*<\/div>/);
  assert.doesNotMatch(restaurantActionGrid, />\s*Comanda\s*<\/div>/);
  assert.doesNotMatch(restaurantActionGrid, />\s*Caja\s*<\/div>/);
});

test('las doce acciones usan botones, texto e iconos ampliados', () => {
  assert.equal(restaurantActionGrid.match(/flex h-16 items-center/g)?.length, 12);
  assert.equal(restaurantActionGrid.match(/size=\{20\}/g)?.length, 12);
  assert.equal(restaurantActionGrid.match(/px-3 text-sm font-black/g)?.length, 12);
});
