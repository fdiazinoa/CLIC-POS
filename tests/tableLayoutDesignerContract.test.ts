import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const designerSource = readFileSync(
  new URL('../components/TableLayoutDesigner.tsx', import.meta.url),
  'utf8',
);

test('las adiciones rápidas del diseñador parten siempre del plano más reciente', () => {
  assert.match(designerSource, /onUpdateTables\(currentTables => \{/);
  assert.match(designerSource, /return \[\.\.\.currentTables, newTable\]/);
  assert.doesNotMatch(designerSource, /onUpdateTables\(\[\.\.\.tables, newTable\]\)/);
});

test('ediciones y eliminaciones tampoco sobrescriben actualizaciones concurrentes', () => {
  assert.match(designerSource, /onUpdateTables\(currentTables => \([\s\S]*?currentTables\.map/);
  assert.match(designerSource, /onUpdateTables\(currentTables => currentTables\.filter/);
});
