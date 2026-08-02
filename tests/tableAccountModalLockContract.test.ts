import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const mapSource = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');

test('cerrar el selector de cuentas libera el lock adquirido antes de abrir la mesa', () => {
  assert.match(mapSource, /onTableOpenCancelled\?: \(table: Table\)/);
  assert.match(mapSource, /closeTablePreview\(selectedAccountTable, \(\) => setSelectedAccountTable\(null\)\)/);
  assert.match(mapSource, /closeTablePreview\(selectedBarTable, \(\) => setSelectedBarTable\(null\)\)/);
  assert.match(mapSource, /closeTablePreview\(selectedTable, \(\) => setSelectedTable\(null\)\)/);
  assert.match(appSource, /onTableOpenCancelled=\{async \(\) => \{[\s\S]*await releaseActiveTableEditLock\(\)/);
});

test('cerrar un aviso de mesa unida también libera el lock de preapertura', () => {
  assert.match(mapSource, /const closeTableNotice = useCallback/);
  assert.match(mapSource, /onClick=\{closeTableNotice\}/);
  assert.match(mapSource, /Promise\.resolve\(onTableOpenCancelled\?\.\(tableToRelease\)\)/);
});
