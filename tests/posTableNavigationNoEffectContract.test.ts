import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const pos = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const map = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
const motionPolicy = readFileSync(new URL('../utils/tableMotionPolicy.ts', import.meta.url), 'utf8');

test('Venta and Mesas keep the same retained visibility mechanism without host animations', () => {
  const posHost = app.slice(app.indexOf('const PersistentPOSHost'), app.indexOf('const TableMapLifecycleBoundary'));
  const mapHost = app.slice(app.indexOf('const TableMapLifecycleBoundary'), app.indexOf('const AppContent'));
  assert.match(posHost, /visible \? 'visible' : 'invisible pointer-events-none select-none'/);
  assert.match(mapHost, /visible \? 'visible' : 'invisible pointer-events-none'/);
  for (const host of [posHost, mapHost]) {
    assert.match(host, /aria-hidden=\{!visible\}/);
    assert.match(host, /contain: 'layout style'/);
    assert.doesNotMatch(host, /transition-|animate-|opacity-0|willChange|translateZ/);
  }
});

test('descendants known to animate inherited visibility no longer use transition-all', () => {
  const catalog = pos.match(/className=\{`flex-1 min-h-0 flex flex-col min-w-0 bg-gray-50[^`]*`\}/)?.[0];
  const ticket = pos.match(/className=\{`pos-ticket-sidebar[^`]*`\}/)?.[0];
  const glassButton = map.slice(map.indexOf('const GlassButton:'));
  assert.ok(catalog);
  assert.ok(ticket);
  assert.doesNotMatch(catalog, /transition-/);
  assert.doesNotMatch(ticket, /transition-/);
  assert.doesNotMatch(glassButton.slice(0, 600), /transition-/);
  assert.match(motionPolicy, /isNativePlatform && platform === 'android'/);
});
