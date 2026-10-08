import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { isWeightedProduct } from '../utils/weightedProduct';

// Execute the actual callbacks with isolated dependencies; no mounted React/device is claimed.
const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
async function callback(name: string, dependencies: Record<string, unknown>) {
  const start = source.indexOf(`const ${name} = useCallback(`);
  const end = source.indexOf(']);', source.indexOf('}, [', start)) + 3;
  const js = await transform(source.slice(start, end), { loader: 'ts', target: 'es2022' });
  const scope = { useCallback: (fn: unknown) => fn, ...dependencies };
  return new Function(...Object.keys(scope), `${js.code}; return ${name};`)(...Object.values(scope));
}

test('actual click opens admitted untracked scale; existing tracked stock callback retains fractional demand checks', async () => {
  let stock = 0.5;
  const cartQuantityByProduct: Record<string, number> = {};
  const errors: string[] = [];
  const product = { id: 'BAL', type: 'PRODUCT', name: 'BAL-001', measurementUnit: 'Kilogramo', purchaseUnit: 'kg',
    conversionFactor: 1, operationalFlags: { isWeighted: true, integersOnly: false, trackInventory: false },
    v3SaleAuthority: { syncId: 'S', syncVersion: 85 }, variants: [], attributes: [] };
  const canAdd = await callback('canAddItemToCart', {
    setErrorToast: (error: string) => errors.push(error), setTimeout: () => 0,
    productHasActiveTariff: () => true, resolveProductActiveWarehouseIds: () => ['W'],
    productMatchesTerminalWarehouse: () => true, warehouses: [{ id: 'W' }], config: { features: {} },
    resolveInventoryConsumptionMode: () => 'SELF', activeTerminalConfig: {},
    getScopedProductStock: () => stock, committedByProduct: {}, cartQuantityByProduct,
    cartInventoryDemandByProduct: {}, getTerminalWarehouseName: () => 'W', productById: new Map(), products: [],
  });
  let modal: unknown;
  let added = 0;
  const click = await callback('handleProductClick', {
    suppressProductInputUntilMs: 0, isMobile: false, defaultSalesWarehouseId: 'W',
    isWeightedProduct, productHasRestaurantConfiguration: () => false, isReturnMode: false,
    ensureSalesWithOpenZPermission: () => true, canAddItemToCart: canAdd, v3Operational: {},
    setProductForScale: (value: unknown) => { modal = value; }, addToCart: () => { ++added; },
  });
  click(product);
  assert.strictEqual(modal, product);
  assert.equal(added, 0);
  stock = 0;
  assert.equal(canAdd(product, 0.25), true);
  const legacyTracked = { ...product, v3SaleAuthority: undefined, operationalFlags: { ...product.operationalFlags, trackInventory: true } };
  stock = 0.5;
  assert.equal(canAdd(legacyTracked, 0.25), true);
  stock = 0.2;
  assert.equal(canAdd(legacyTracked, 0.25), false);
  stock = 0.5; cartQuantityByProduct.BAL = 0.375;
  assert.equal(canAdd(legacyTracked, 0.25), false);
  assert.equal(canAdd(legacyTracked, 0.125), true);
  assert.equal(errors.length, 2);
});
