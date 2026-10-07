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

test('las doce acciones conservan dos filas sin Guardar condicional', () => {
  assert.equal(restaurantActionGrid.match(/flex h-16 items-center/g)?.length, 12);
  assert.equal(restaurantActionGrid.match(/size=\{20\}/g)?.length, 12);
  assert.equal(restaurantActionGrid.match(/px-3 text-sm font-black/g)?.length, 12);
});


test('Guardar permanece condicionado en toolbar desktop y conserva el handler; compact/mobile no se retiran', () => {
  assert.doesNotMatch(restaurantActionGrid, /handleGridAction\('SAVE'\)/);
  const toolbarStart = posSource.indexOf('<TicketStatusControls className="ml-auto');
  const toolbar = posSource.slice(toolbarStart, posSource.indexOf('</TicketStatusControls>', toolbarStart));
  assert.match(toolbar, /canParkDirectSale &&/);
  assert.match(toolbar, /onClick=\{\(\) => handleGridAction\('SAVE'\)\}/);
  assert.match(toolbar, /aria-label="Guardar ticket"/);
  assert.match(toolbar, /title="Guardar ticket"/);
  assert.match(toolbar, /flex h-12 w-12 shrink-0/);
  assert.ok(posSource.slice(0, gridStart).includes("onClick={() => handleGridAction('SAVE')}"));
});


test('desktop toolbar wraps intact controls below branding rather than overflowing narrow sidebar', () => {
  assert.match(posSource, /data-testid="desktop-ticket-toolbar" className=\{`flex w-full flex-wrap items-center/);
});
