import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const totalsStart = posSource.indexOf('{/* --- BLOQUE DE TOTALES --- */}');
const totalsEnd = posSource.indexOf('pos-ticket-checkout', totalsStart);
const totalsBlock = posSource.slice(totalsStart, totalsEnd);

test('subtotal e impuestos usan tamaño y contraste legibles', () => {
  assert.ok(totalsStart >= 0 && totalsEnd > totalsStart);
  assert.match(
    totalsBlock,
    /text-sm font-extrabold text-slate-700[\s\S]*?<span>SUBTOTAL<\/span>/,
  );
  assert.match(
    totalsBlock,
    /text-sm font-extrabold text-slate-700[\s\S]*?<span>IMPUESTOS<\/span>/,
  );
});

test('la tasa principal y el desglose tributario evitan texto diminuto y pálido', () => {
  assert.match(
    totalsBlock,
    /text-xs font-bold uppercase tracking-wide text-slate-600[\s\S]*?\{primaryTaxLabel\}/,
  );
  assert.match(
    totalsBlock,
    /text-xs font-semibold text-slate-600[\s\S]*?\{tax\.label\}/,
  );
  assert.match(
    totalsBlock,
    /font-bold tabular-nums text-slate-700[\s\S]*?formatCurrency\(tax\.amount, baseCurrency\.symbol\)/,
  );
  assert.doesNotMatch(totalsBlock, /text-\[10px\][^"\n]*text-slate-400[\s\S]*?\{(?:primaryTaxLabel|tax\.label)\}/);
});
