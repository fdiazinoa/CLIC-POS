import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');

test('persistent POS fiscal and customer alerts do not run infinite pulse animations', () => {
  const persistentAlertMarkers = [
    'DEUDA VENCIDA / CRÉDITO BLOQUEADO',
    'Reserva fiscal baja',
    'Status Fiscal:',
  ];

  for (const marker of persistentAlertMarkers) {
    const markerIndex = source.indexOf(marker);
    assert.notEqual(markerIndex, -1, `missing persistent alert marker: ${marker}`);

    const surroundingMarkup = source.slice(Math.max(0, markerIndex - 900), markerIndex + 300);
    assert.doesNotMatch(
      surroundingMarkup,
      /animate-(?:pulse|spin|ping|bounce)/,
      `${marker} must remain visually static while the POS is idle`,
    );
  }
});

test('the persistent fiscal status warning remains visible without animation', () => {
  assert.match(source, /Status Fiscal:/);
  assert.match(source, /bg-red-50 text-red-600 border-red-100/);
});
