import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  inventoryScannerPreferenceKey,
  normalizeInventoryScannerQuantity,
  resolveInventoryScannerQuantityMode,
} from '../utils/inventoryScanner';

const inventoryCountSource = readFileSync(
  new URL('../components/inventory/InventoryCount.tsx', import.meta.url),
  'utf8',
);

test('el inventario móvil usa una unidad por defecto y guarda el modo por terminal', () => {
  assert.equal(resolveInventoryScannerQuantityMode(null), 'UNIT');
  assert.equal(resolveInventoryScannerQuantityMode('PROMPT'), 'PROMPT');
  assert.equal(resolveInventoryScannerQuantityMode('invalid'), 'UNIT');
  assert.equal(
    inventoryScannerPreferenceKey('PDA-01'),
    'clic_inventory_scanner_quantity_mode:PDA-01',
  );
});

test('la cantidad del lector se limita a enteros positivos', () => {
  assert.equal(normalizeInventoryScannerQuantity(undefined), 1);
  assert.equal(normalizeInventoryScannerQuantity(0), 1);
  assert.equal(normalizeInventoryScannerQuantity('3.7'), 4);
  assert.equal(normalizeInventoryScannerQuantity(20_000), 9_999);
});

test('InventoryCount autoagrega coincidencias exactas y expone el modo sin Settings', () => {
  assert.match(inventoryCountSource, /findExactInventoryProduct\(products, query\)/);
  assert.match(inventoryCountSource, /window\.setTimeout\(\(\) =>/);
  assert.match(inventoryCountSource, /void handleResolvedProduct\(exactProduct, query\)/);
  assert.match(inventoryCountSource, /Lector: \+1 automático/);
  assert.match(inventoryCountSource, /Lector: pedir cantidad/);
  assert.match(inventoryCountSource, /Producto no encontrado/);
  assert.match(inventoryCountSource, /scanInputRef\.current\?\.select\(\)/);
  assert.match(inventoryCountSource, /ref=\{scanInputRef\}/);
});
