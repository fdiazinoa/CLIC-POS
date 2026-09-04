import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const desktopCardStart = posSource.indexOf('// DESKTOP CARD DESIGN (Restaurant/Retail)');
const desktopCardEnd = posSource.indexOf('{/* Modifiers List */}', desktopCardStart);
const desktopCard = posSource.slice(desktopCardStart, desktopCardEnd);

test('el ticket desktop prioriza cantidad por precio con tamaño y contraste legibles', () => {
  assert.ok(desktopCardStart >= 0 && desktopCardEnd > desktopCardStart);
  assert.match(
    desktopCard,
    /text-sm font-bold leading-snug text-slate-700[\s\S]*?\{item\.quantity\} × \{baseCurrency\.symbol\}/,
  );
  assert.match(
    desktopCard,
    /mt-0\.5 text-\[11px\] font-semibold leading-snug text-slate-500[\s\S]*?\{lineTaxSummary\}/,
  );
});

test('el ticket desktop no repite la cantidad como insignia de unidades', () => {
  assert.doesNotMatch(desktopCard, /\{item\.quantity\} ud/);
  assert.match(desktopCard, /\{isActiveCartItem && \(/);
});
