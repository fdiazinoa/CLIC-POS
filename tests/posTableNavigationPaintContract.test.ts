import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const tableMap = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

test('the retained POS stays mounted but is not painted behind the table map', () => {
  assert.match(app, /data-pos-persistent-host="true"/);
  assert.match(app, /visible \? 'visible' : 'invisible pointer-events-none select-none'/);
  assert.doesNotMatch(app, /visible \? 'opacity-100' : 'opacity-0 pointer-events-none select-none'/);
});

test('Android table map disables expensive backdrop filters without changing web styling', () => {
  assert.match(tableMap, /data-table-map-lightweight=\{Capacitor\.getPlatform\(\) === 'android' \? 'true' : undefined\}/);
  assert.match(styles, /\[data-table-map-lightweight="true"\] \[class\*="backdrop-blur"\]/);
  assert.match(styles, /-webkit-backdrop-filter: none;/);
  assert.match(styles, /backdrop-filter: none;/);
  assert.match(app, /Capacitor\.getPlatform\(\) === 'android' \? '' : 'backdrop-blur-xl'/);
});
