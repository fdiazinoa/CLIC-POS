import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const tableMap = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

test('the retained POS stays mounted but is not painted behind the table map', () => {
  const hostStart = app.indexOf('const PersistentPOSHost');
  const hostSource = app.slice(hostStart, app.indexOf('const TableMapLifecycleBoundary', hostStart));
  assert.match(hostSource, /data-pos-persistent-host="true"/);
  assert.match(hostSource, /className="h-full"/);
  assert.match(hostSource, /if \(visible\) host\.removeAttribute\('aria-hidden'\)/);
  assert.match(hostSource, /host\.setAttribute\('aria-hidden', 'true'\)/);
  assert.doesNotMatch(hostSource, /\binvisible\b|opacity-0|opacity-100|setAttribute\('inert'/);

  const shellStart = app.indexOf('data-pos-table-shell="true"');
  const shellSource = app.slice(shellStart, app.indexOf(': renderView();', shellStart));
  assert.match(shellSource, /\{renderView\('POS'\)\}/);
  assert.match(shellSource, /<TableMapLifecycleBoundary visible=\{currentView === 'TABLE_MAP'\}/);
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
