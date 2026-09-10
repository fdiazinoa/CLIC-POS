import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { shouldBlockTableMapForDirectSale } from '../utils/restaurantNavigation';

test('una venta directa con artículos no puede abrir el mapa de mesas', () => {
  assert.equal(shouldBlockTableMapForDirectSale(1, false), true);
  assert.equal(shouldBlockTableMapForDirectSale(3, false), true);
});

test('el mapa sigue disponible sin venta directa o desde una mesa activa', () => {
  assert.equal(shouldBlockTableMapForDirectSale(0, false), false);
  assert.equal(shouldBlockTableMapForDirectSale(2, true), false);
});

test('todas las acciones Mesas pasan por el mismo bloqueo', () => {
  const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const backStart = source.indexOf('const handleBackToMap');
  const backEnd = source.indexOf('const handleRestoreTicket', backStart);
  const backSource = source.slice(backStart, backEnd);
  const tablesStart = source.indexOf("case 'TABLES':");
  const tablesEnd = source.indexOf("case 'loyalty_card':", tablesStart);
  const tablesSource = source.slice(tablesStart, tablesEnd);

  assert.match(backSource, /shouldBlockTableMapForDirectSale\(cart\.length, Boolean\(activeTable\)\)/);
  assert.match(backSource, /Debes cobrar o cancelar la venta directa antes de ir a Mesas\./);
  assert.match(tablesSource, /handleBackToMap\(\)/);
  assert.doesNotMatch(tablesSource, /onOpenTableMap\(\)/);
  assert.doesNotMatch(tablesSource, /handleSendAndExit\(\)/);
});
