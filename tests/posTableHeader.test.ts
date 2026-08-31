import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolvePosTableHeaderLabel } from '../utils/posTableHeader';

const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');

test('compacta salón y mesa numérica sin modificar sus nombres persistidos', () => {
  assert.equal(
    resolvePosTableHeaderLabel({ roomName: 'Salón Principal', tableName: 'Mesa 2' }),
    'Principal · M02',
  );
  assert.equal(
    resolvePosTableHeaderLabel({ roomName: 'Salón 3', tableName: 'Mesa 12' }),
    'S03 · M12',
  );
});

test('limita nombres libres extensos para que el control de comensales siga visible', () => {
  assert.equal(
    resolvePosTableHeaderLabel({ roomName: 'Terraza completamente exterior', tableName: 'Mesa Presidencial' }),
    'Terraza complet… · Presidenc…',
  );
});

test('el encabezado POS usa el rótulo compacto solo para presentación', () => {
  assert.match(source, /const activeTableHeaderLabel = useMemo/);
  assert.match(source, /activeBarTabName \|\| activeTableHeaderLabel/);
  assert.match(source, /max-w-\[220px\] truncate text-base/);
});
