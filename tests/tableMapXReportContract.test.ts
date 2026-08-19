import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tableMapSource = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('el mapa de mesas expone Cierre X solo con permiso y abre el flujo financiero real', () => {
  assert.match(tableMapSource, /currentRolePermissions\.includes\('POS_CLOSE_X'\)/);
  assert.match(tableMapSource, /onClick=\{onOpenXReport\}/);
  assert.match(appSource, /onOpenXReport=\{\(\) => handleViewChange\('FINANCE', \{/);
  assert.match(appSource, /initialCashMovementType: 'X_REPORT'/);
  assert.match(appSource, /returnView: 'TABLE_MAP'/);
});
