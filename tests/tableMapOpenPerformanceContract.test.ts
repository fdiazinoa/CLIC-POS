import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const tableMapSource = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const instrumentationSource = readFileSync(new URL('../diagnostics/viteInstrumentation.ts', import.meta.url), 'utf8');

test('restaurant viewport fitting uses the last observed size without a synchronous geometry read', () => {
  const fitStart = tableMapSource.indexOf('const fitRestaurantViewport');
  const fitEnd = tableMapSource.indexOf('useLayoutEffect(() => {', fitStart);
  const fitSource = tableMapSource.slice(fitStart, fitEnd);

  assert.ok(fitStart >= 0 && fitEnd > fitStart);
  assert.match(fitSource, /const \{ width, height \} = viewportSizeRef\.current/);
  assert.doesNotMatch(fitSource, /getBoundingClientRect/);
  assert.match(tableMapSource, /new ResizeObserver\(\(\[entry\]\) =>/);
  assert.match(tableMapSource, /viewportSizeRef\.current = nextSize/);
});

test('first mount does not schedule a redundant unconditional viewport fit', () => {
  const fitStart = tableMapSource.indexOf('const fitRestaurantViewport');
  const fitEffectsEnd = tableMapSource.indexOf('const obstacleTables', fitStart);
  const fitEffectsSource = tableMapSource.slice(fitStart, fitEffectsEnd);

  assert.doesNotMatch(
    fitEffectsSource,
    /requestAnimationFrame\(\(\) => fitRestaurantViewport\(\)\)/,
  );
  assert.match(fitEffectsSource, /if \(!sizeChanged\)/);
  assert.match(fitEffectsSource, /if \(!hasObservedViewportRef\.current\)/);
});

test('the retained table map is removed from hit testing when inactive and interactive when visible', () => {
  const boundaryStart = appSource.indexOf('const TableMapLifecycleBoundary');
  const boundaryEnd = appSource.indexOf('const AppContent', boundaryStart);
  const boundarySource = appSource.slice(boundaryStart, boundaryEnd);

  assert.match(boundarySource, /visible \? 'opacity-100' : 'hidden'/);
  assert.match(boundarySource, /setAttribute\('inert', ''\)/);
  assert.match(boundarySource, /removeAttribute\('inert'\)/);
  assert.match(boundarySource, /host\.contains\(activeElement\)/);
  assert.match(boundarySource, /activeElement\.blur\(\)/);
  assert.match(boundarySource, /aria-hidden=\{!visible\}/);
  assert.match(boundarySource, /willChange: 'opacity'/);
  // pointer-events:none is inherited but a descendant with pointer-events:auto
  // can opt back into hit testing. display:none on the host cannot be overridden.
  assert.doesNotMatch(boundarySource, /opacity-0 pointer-events-none/);
});

test('temporary table map profiling hooks are absent from production sources', () => {
  const productionSources = [appSource, tableMapSource, posSource, instrumentationSource].join('\n');

  assert.doesNotMatch(productionSources, /TABLE_MAP_DIAGNOSTICS/);
  assert.doesNotMatch(productionSources, /tableMapOpen/);
  assert.doesNotMatch(productionSources, /recordTableMapReactCommit/);
  assert.doesNotMatch(productionSources, /measureTableMapWork/);
  assert.doesNotMatch(productionSources, /TableMapSubtree/);
});
