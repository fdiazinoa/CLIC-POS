import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const bundle = buildSync({ stdin: { contents: `export {default as Browser} from './components/kiosk/KioskProductBrowser'; export {KioskSecurityProvider as Security} from './components/kiosk/KioskContext';`,
  resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' }, write: false, logLevel: 'silent' });
const loaded = { exports: {} as Record<string, React.FC<any>> };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { Browser, Security } = loaded.exports;
const stamp = { syncId: 'S', syncVersion: 1, tariffId: 'T', warehouseId: 'W', binding: 'bound',
  inventoryVersion: 1, inventoryCursor: 'C', taxIncluded: true };
const product = { id: 'P', name: 'Agua', type: 'PRODUCT', isInventoriable: true, price: 100,
  category: 'Bebidas', tariffs: [{ tariffId: 'T', price: 100 }], activeInWarehouses: ['W'],
  stock: 0, stockBalances: { W: 0 }, operationalFlags: { trackInventory: true, allowNegativeStock: true },
  images: ['https://images.example.test/food.jpg'], attributes: [], variants: [], appliedTaxIds: [], v3SaleAuthority: stamp };

function elements(node: React.ReactNode): React.ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const value = node as React.ReactElement<any>;
  return [value, ...elements(value.props.children)];
}

function renderBrowser(item: any, cart: any[] = [], terminalAllowsNegative?: boolean) {
  const accepted: any[] = [];
  let browser: React.ReactElement<any>;
  function Probe() {
    browser = Browser({ products: [item], cart, warehouses: [{ id: 'W', name: 'Principal' }],
      onAddToCart: (value: any) => accepted.push({ ...value, quantity: 1 }),
      onRemoveFromCart() {}, onCheckout() {}, onCancel() {}, restaurantMode: true, terminalId: 'terminal',
      config: { companyInfo: { name: 'Fixture' }, features: { stockTracking: true }, tariffs: [{ id: 'T' }],
        terminals: [{ id: 'terminal', config: { pricing: { defaultTariffId: 'T' },
          workflow: { inventory: { allowNegativeStock: terminalAllowsNegative } },
          inventoryScope: { defaultSalesWarehouseId: 'W' } } }] } }) as React.ReactElement<any>;
    return browser;
  }
  const html = renderToStaticMarkup(<Security><Probe /></Security>);
  const menuElement = elements(browser!).find(row => typeof row.type === 'function'
    && row.props.onProduct && row.props.getAvailability)!;
  let menu: React.ReactNode;
  function MenuProbe() { menu = (menuElement.type as React.FC<any>)(menuElement.props); return menu; }
  renderToStaticMarkup(<MenuProbe />);
  const card = elements(menu!).find(row => row.type === 'button' && row.props.className === 'restaurant-product-card');
  const tap = () => {
    // Feedback timers are unrelated to the synchronous acceptance callback.
    const previous = globalThis.setTimeout;
    globalThis.setTimeout = (() => 0) as any;
    try { card?.props.onClick(); } finally { globalThis.setTimeout = previous; }
  };
  return { html, card, accepted, tap };
}

test('V3 restaurant card keeps image URL and one + tap invokes add once with authority intact', () => {
  for (const patch of [{}, { type: 'SERVICE', operationalFlags: { trackInventory: true } },
    { isInventoriable: false, operationalFlags: { trackInventory: true } },
    { operationalFlags: { trackInventory: false } }]) {
    const f = renderBrowser({ ...product, ...patch });
    assert.ok(f.card);
    assert.equal(f.card.props.disabled, false);
    assert.match(f.html, /src="https:\/\/images.example.test\/food.jpg"/);
    f.tap();
    assert.equal(f.accepted.length, 1);
    assert.equal(f.accepted[0].quantity, 1);
    assert.equal(f.accepted[0].price, 100);
    assert.deepEqual(f.accepted[0].v3SaleAuthority, stamp);
  }
});

test('V3 strict stock uses cumulative cart quantity and still denies stock/tariff/warehouse errors', () => {
  const strict = { ...product, stock: 2, stockBalances: { W: 2 },
    operationalFlags: { trackInventory: true, allowNegativeStock: false } };
  const allowed = renderBrowser(strict, [{ ...strict, cartId: 'first', quantity: 1 }]);
  assert.equal(allowed.card?.props.disabled, false); allowed.tap(); assert.equal(allowed.accepted.length, 1);
  const full = renderBrowser(strict, [{ ...strict, cartId: 'first', quantity: 1 }, { ...strict, cartId: 'second', quantity: 1 }]);
  assert.equal(full.card?.props.disabled, true); full.tap(); assert.deepEqual(full.accepted, []);
  for (const patch of [{ stock: 0, stockBalances: { W: 0 } }, { tariffs: [] }, { activeInWarehouses: ['OTHER'] }]) {
    const blocked = renderBrowser({ ...strict, ...patch });
    assert.ok(!blocked.card || blocked.card.props.disabled); blocked.tap(); assert.deepEqual(blocked.accepted, []);
  }
});

test('unstamped legacy cards retain product AND terminal negative-stock permission', () => {
  const legacy = { ...product, v3SaleAuthority: undefined };
  for (const terminal of [undefined, false]) {
    const f = renderBrowser(legacy, [], terminal); assert.equal(f.card?.props.disabled, true);
    f.tap(); assert.deepEqual(f.accepted, []);
  }
  const allowed = renderBrowser(legacy, [], true); assert.equal(allowed.card?.props.disabled, false);
  allowed.tap(); assert.equal(allowed.accepted.length, 1);
});
