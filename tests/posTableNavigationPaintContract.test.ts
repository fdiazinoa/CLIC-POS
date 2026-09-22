import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const tableMap = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

test('the retained POS stays mounted, transparent and inert behind the table map', () => {
  assert.match(app, /data-pos-persistent-host="true"/);
  assert.match(app, /visible \? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none select-none'/);
  assert.match(app, /if \(visible\) host\.removeAttribute\('inert'\);\s*else host\.setAttribute\('inert', ''\);/);
  assert.doesNotMatch(app, /visible \? 'visible' : 'invisible pointer-events-none select-none'/);
});

test('the retained table map is transparent and inert when inactive', () => {
  assert.match(app, /data-table-map-persistent-host="true"/);
  assert.match(app, /visible \? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'/);
  assert.match(app, /if \(visible\) host\.removeAttribute\('inert'\);\s*else \{\s*host\.setAttribute\('inert', ''\);/);
  assert.doesNotMatch(app, /visible \? 'visible' : 'invisible pointer-events-none'/);
});

test('Android table map disables expensive backdrop filters without changing web styling', () => {
  assert.match(tableMap, /data-table-map-lightweight=\{Capacitor\.getPlatform\(\) === 'android' \? 'true' : undefined\}/);
  assert.match(styles, /\[data-table-map-lightweight="true"\] \[class\*="backdrop-blur"\]/);
  assert.match(styles, /-webkit-backdrop-filter: none;/);
  assert.match(styles, /backdrop-filter: none;/);
  assert.match(app, /Capacitor\.getPlatform\(\) === 'android' \? '' : 'backdrop-blur-xl'/);
});

test('Android table cards avoid entry animation and per-card compositing layers', () => {
  assert.match(tableMap, /const lightweightMap = Capacitor\.getPlatform\(\) === 'android'/);
  assert.match(tableMap, /variants=\{reduceMotion \? undefined : TABLE_ENTRY_VARIANTS\}/);
  assert.match(tableMap, /initial=\{reduceMotion \? false : 'hidden'\}/);
  assert.match(tableMap, /willChange: lightweightMap \? undefined : 'transform, opacity'/);
  assert.match(styles, /\[data-table-map-lightweight="true"\] \[data-table-node="true"\] \{\s*box-shadow: none;\s*transition: none;/);
  assert.match(tableMap, /!lightweightMap && !usesWhiteBackground/);
});
