import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useIsMobile } from '../hooks/useIsMobile';
import { MobilePosNavigation } from '../components/MobilePosNavigation';

function TabletProbe() {
  return <span>{useIsMobile(900) ? 'mobile' : 'desktop'}</span>;
}

for (const width of [600, 768, 800, 899, 900, 1280]) {
  test(`tablet first render selects the correct layout at ${width}px`, () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { innerWidth: width } });
    try {
      assert.equal(renderToStaticMarkup(<TabletProbe />), `<span>${width < 900 ? 'mobile' : 'desktop'}</span>`);
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });
}

test('catalog offers named navigation to tables and actions without requiring a sale', () => {
  const html = renderToStaticMarkup(<MobilePosNavigation onOpenTables={() => {}} onOpenActions={() => {}} />);
  assert.match(html, /aria-label="Opciones del POS"/);
  assert.match(html, /data-testid="mobile-open-tables"/);
  assert.match(html, /data-testid="mobile-open-actions"/);
  assert.doesNotMatch(html, /disabled|md:hidden/);
});

test('terminals without table navigation keep actions without exposing tables', () => {
  const html = renderToStaticMarkup(<MobilePosNavigation onOpenActions={() => {}} />);
  assert.doesNotMatch(html, /mobile-open-tables/);
  assert.match(html, /mobile-open-actions/);
});
