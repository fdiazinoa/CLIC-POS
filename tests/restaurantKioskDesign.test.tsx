import { readFileSync } from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const bundle = buildSync({
  stdin: {
    contents: `export {default as KioskWelcome} from './components/kiosk/KioskWelcome'; export {default as RestaurantKioskMenu, RestaurantCatalogImage} from './components/kiosk/RestaurantKioskMenu'; export {default as KioskProductBrowser} from './components/kiosk/KioskProductBrowser'; export {KioskSecurityProvider} from './components/kiosk/KioskContext';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'tsx',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  loader: { '.css': 'empty' },
  write: false,
  logLevel: 'silent',
});
const loaded = { exports: {} as Record<string, React.FC<any>> };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
  createRequire(import.meta.url),
  loaded,
  loaded.exports,
);
const {
  KioskWelcome,
  KioskProductBrowser,
  KioskSecurityProvider,
  RestaurantKioskMenu,
  RestaurantCatalogImage,
} = loaded.exports;

function elements(node: React.ReactNode): React.ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const value = node as React.ReactElement<any>;
  return [value, ...elements(value.props.children)];
}

test('restaurant welcome has its own food-order composition and explicit service callbacks without retail video', () => {
  const calls: string[] = [];
  const tree = KioskWelcome({
    restaurantMode: true,
    storeName: 'Fixture restaurante',
    onStartShopping: () => calls.push('implicit'),
    onSelectServiceType: (value) => calls.push(value),
    onAdminAccess: () => calls.push('admin'),
  });
  const html = renderToStaticMarkup(tree);
  assert.doesNotMatch(html, /<video|mixkit/);
  assert.match(html, /Fixture restaurante/);
  const buttons = elements(tree).filter((value) => value.type === 'button');
  for (const text of ['Comer aquí', 'Para llevar'])
    buttons
      .find((value) => renderToStaticMarkup(value).includes(text))!
      .props.onClick();
  assert.deepEqual(calls, ['DINE_IN', 'TAKEOUT']);
  assert.equal(
    typeof (tree as React.ReactElement<any>).props.onClick,
    'undefined',
  );
});

test('retail welcome retains its tap-to-start and existing presentation', () => {
  let starts = 0;
  const tree = KioskWelcome({ onStartShopping: () => starts++ });
  assert.match(renderToStaticMarkup(tree), /<video|mixkit/);
  (tree as React.ReactElement<any>).props.onClick();
  assert.equal(starts, 1);
});

const products = Array.from({ length: 61 }, (_, index) => ({
  id: `real-${index}`,
  name: `Plato ${index}`,
  category: 'Platos',
  price: 100,
  tariffs: [{ tariffId: 'tariff', price: 100 }],
  activeInWarehouses: ['warehouse'],
  stock: 20,
  stockBalances: { warehouse: 20 },
  images: [],
  attributes: [],
  variants: [],
  appliedTaxIds: [],
  production_area_id: 'kitchen',
}));
const props = {
  products,
  warehouses: [{ id: 'warehouse', name: 'Principal' }],
  cart: [],
  onAddToCart: () => {},
  onRemoveFromCart: () => {},
  onCheckout: () => {},
  onCancel: () => {},
  terminalId: 'terminal',
  config: {
    companyInfo: { name: 'Fixture restaurante' },
    terminals: [
      {
        id: 'terminal',
        config: {
          pricing: { defaultTariffId: 'tariff' },
          inventoryScope: { defaultSalesWarehouseId: 'warehouse' },
        },
      },
    ],
    tariffs: [{ id: 'tariff', name: 'Normal' }],
    features: {},
  },
};
function browser(restaurantMode: boolean) {
  return renderToStaticMarkup(
    <KioskSecurityProvider>
      <KioskProductBrowser
        {...(props as any)}
        restaurantMode={restaurantMode}
        serviceType="TAKEOUT"
      />
    </KioskSecurityProvider>,
  );
}

test('restaurant menu exposes category navigation, truthful order subtotal and bounded catalog pagination', () => {
  const html = browser(true);
  assert.match(html, /aria-label="Categorías del menú"/);
  assert.match(html, /Subtotal del pedido/);
  assert.match(html, /Siguiente página/);
  assert.match(html, /Revisar pedido/);
  assert.doesNotMatch(html, /PAGAR AHORA/);
});

test('retail browser keeps existing cart checkout rather than restaurant navigation', () => {
  const html = browser(false);
  assert.match(html, /Tu Carrito/);
  assert.match(html, /PAGAR AHORA/);
  assert.doesNotMatch(html, /Categorías del menú|Revisar pedido/);
});

function menuTree(overrides: Record<string, unknown> = {}) {
  const events: string[] = [];
  let tree: React.ReactNode;
  const menuProps = {
    storeName: 'Fixture restaurante',
    serviceType: 'TAKEOUT',
    products,
    catalogProducts: products,
    categories: ['Todos', 'Platos'],
    selectedCategory: 'Todos',
    searchQuery: '',
    cart: [],
    subtotal: 0,
    itemCount: 0,
    checkoutError: '',
    feedback: null,
    formatMoney: (value: number) => `$${value.toFixed(2)}`,
    displayCategory: (value: string) => value,
    getPrice: () => 100,
    getAvailability: () => ({ canSell: true, reason: '' }),
    onSearch: (value: string) => events.push(`search:${value}`),
    onCategory: (value: string) => events.push(`category:${value}`),
    onProduct: (value: { id: string }) => events.push(`product:${value.id}`),
    onIncrease: (value: { cartId: string }) =>
      events.push(`increase:${value.cartId}`),
    onDecrease: (value: { cartId: string }) =>
      events.push(`decrease:${value.cartId}`),
    onRemove: (value: string) => events.push(`remove:${value}`),
    onCheckout: () => events.push('checkout'),
    onCancel: () => events.push('cancel'),
    ...overrides,
  };
  function Probe() {
    tree = RestaurantKioskMenu(menuProps);
    return tree;
  }
  const html = renderToStaticMarkup(<Probe />);
  return { tree: tree!, html, events };
}

test('actual restaurant category/search/product callbacks remain distinct from checkout and cancellation', () => {
  const { tree, events } = menuTree();
  const nodes = elements(tree);
  const category = nodes.find(
    (value) =>
      value.type === 'nav' &&
      value.props['aria-label'] === 'Categorías del menú',
  )!;
  elements(category)
    .filter((value) => value.type === 'button')[1]
    .props.onClick();
  nodes
    .find((value) => value.type === 'input')!
    .props.onChange({ target: { value: 'Plato 3' } });
  const card = nodes.find(
    (value) =>
      value.type === 'button' &&
      value.props.className === 'restaurant-product-card',
  )!;
  card.props.onClick();
  assert.deepEqual(events, [
    'category:Platos',
    'search:Plato 3',
    'product:real-0',
  ]);
  assert.equal(
    nodes.filter(
      (value) =>
        value.type === 'button' &&
        value.props.className === 'restaurant-product-card',
    ).length,
    30,
  );
});

test('real order controls preserve configured line cartId and note without reassigning another configuration', () => {
  const cart = [
    {
      ...products[0],
      cartId: 'configured-A',
      quantity: 2,
      modifiers: ['Queso extra'],
      note: 'Sin cebolla',
    },
    {
      ...products[0],
      cartId: 'configured-B',
      quantity: 1,
      modifiers: ['Sin queso'],
      note: 'Aparte',
    },
  ];
  const before = JSON.stringify(cart);
  const menu = menuTree({ cart, subtotal: 300, itemCount: 3 });
  const order = elements(menu.tree).find(
    (value) =>
      typeof value.type === 'function' && value.type.name === 'RestaurantOrder',
  )!;
  let tree: React.ReactNode;
  function Probe() {
    tree = (order.type as React.FC<any>)(order.props);
    return tree;
  }
  const html = renderToStaticMarkup(<Probe />),
    nodes = elements(tree!);
  assert.match(html, /Queso extra|Sin cebolla/);
  nodes
    .find(
      (value) =>
        value.type === 'button' &&
        value.props['aria-label'] === 'Agregar una unidad de Plato 0',
    )!
    .props.onClick();
  nodes
    .find(
      (value) =>
        value.type === 'button' &&
        value.props['aria-label'] === 'Quitar una unidad de Plato 0',
    )!
    .props.onClick();
  nodes
    .find(
      (value) =>
        value.type === 'button' &&
        value.props['aria-label'] === 'Eliminar Plato 0',
    )!
    .props.onClick();
  assert.deepEqual(menu.events, [
    'increase:configured-A',
    'decrease:configured-A',
    'remove:configured-A',
  ]);
  assert.equal(JSON.stringify(cart), before);
  nodes
    .find(
      (value) =>
        value.type === 'button' &&
        value.props.className === 'restaurant-primary',
    )!
    .props.onClick();
  assert.equal(menu.events.filter((value) => value === 'checkout').length, 1);
});

test('empty order is disabled and review dismissal never invokes order cancellation or checkout', () => {
  const { tree, events } = menuTree();
  const nodes = elements(tree);
  const bar = nodes.find(
    (value) =>
      value.type === 'footer' &&
      value.props.className === 'restaurant-order-bar',
  )!;
  assert.equal(
    elements(bar).find((value) => value.type === 'button')!.props.disabled,
    true,
  );
  const dialog = nodes.find((value) => value.type === 'dialog')!;
  let prevented = false;
  dialog.props.onCancel({
    preventDefault: () => {
      prevented = true;
    },
  });
  dialog.props.onClose();
  assert.equal(prevented, true);
  assert.deepEqual(events, []);
  nodes
    .find(
      (value) =>
        value.type === 'button' && value.props.className === 'restaurant-home',
    )!
    .props.onClick();
  assert.deepEqual(events, ['cancel']);
});

test('unavailable real products stay disabled, with their reason visible and no invented price or food image', () => {
  const { tree, html } = menuTree({
    getAvailability: () => ({ canSell: false, reason: 'Sin existencias' }),
  });
  const card = elements(tree).find(
    (value) =>
      value.type === 'button' &&
      value.props.className === 'restaurant-product-card',
  )!;
  assert.equal(card.props.disabled, true);
  assert.match(html, /Sin existencias/);
  assert.match(html, /\$100\.00/);
  assert.doesNotMatch(html, /mixkit|unsplash|<img/);
});

test('actual dialog close effect returns focus to search when the original review button becomes disabled or detached', () => {
  const source = ts.createSourceFile(
    'RestaurantKioskMenu.tsx',
    readFileSync(
      new URL('../components/kiosk/RestaurantKioskMenu.tsx', import.meta.url),
      'utf8',
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let effect: ts.ArrowFunction | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === 'useEffect' &&
      ts.isArrowFunction(node.arguments[0])
    )
      effect = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(effect);
  const compiled = ts.transpileModule(
    'const closeEffect = ' + effect.getText(source),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  for (const state of ['enabled', 'disabled', 'detached'] as const) {
    const calls: string[] = [];
    const opener = {
      isConnected: state !== 'detached',
      matches: (selector: string) => {
        assert.equal(selector, ':disabled');
        return state === 'disabled';
      },
      focus: () => calls.push('opener'),
    };
    const close = new Function(
      'dialogRef',
      'reviewOpen',
      'returnFocusRef',
      'searchRef',
      compiled + '; return closeEffect;',
    )(
      { current: { open: true, close: () => calls.push('close') } },
      false,
      { current: opener },
      { current: { focus: () => calls.push('search') } },
    );
    close();
    assert.deepEqual(calls, [
      'close',
      state === 'enabled' ? 'opener' : 'search',
    ]);
  }
});
