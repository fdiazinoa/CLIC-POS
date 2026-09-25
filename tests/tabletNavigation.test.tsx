import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isMobileViewport, useIsMobile } from '../hooks/useIsMobile';
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

test('portrait order taker exposes kitchen and save-order actions without a cashier checkout', () => {
  const html = renderToStaticMarkup(<MobilePosNavigation
    onOpenTables={() => {}}
    onOpenActions={() => {}}
    onDispatchOrder={() => {}}
    onSaveOrder={() => {}}
    hasOrderItems
  />);
  assert.match(html, /aria-label="Toma de pedido"/);
  assert.match(html, /data-testid="mobile-dispatch-order"/);
  assert.match(html, /data-testid="mobile-save-order"/);
  assert.match(html, /Guardar pedido/);
  assert.doesNotMatch(html, /Cobrar|Cajero/);
});

test('empty portrait order keeps kitchen and save-order disabled', () => {
  const html = renderToStaticMarkup(<MobilePosNavigation
    onOpenActions={() => {}}
    onSaveOrder={() => {}}
    onDispatchOrder={() => {}}
  />);
  assert.match(html, /disabled="" data-testid="mobile-dispatch-order"/);
  assert.match(html, /disabled="" data-testid="mobile-save-order"/);
});

test('1080px order-taker portrait uses one-panel mobile layout; landscape stays desktop', () => {
  assert.equal(isMobileViewport(1080, 1920, 900, true), true);
  assert.equal(isMobileViewport(1920, 1080, 900, true), false);
  // M27X reports a 1080px physical width but about 785 CSS px in WebView.
  assert.equal(isMobileViewport(785, 1396, 768, true), true);
  assert.equal(isMobileViewport(1396, 785, 768, true), false);
  assert.equal(isMobileViewport(1080, 1920, 900, false), false);
  assert.equal(isMobileViewport(899, 1920, 900, false), true);
});
