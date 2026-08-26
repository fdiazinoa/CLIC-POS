import assert from 'node:assert/strict';
import test from 'node:test';

import type { Product } from '../types';
import { filterInventoryProducts, findExactInventoryProduct } from '../utils/inventoryProductSearch';

const products = [
  { id: 'p-1', name: 'Café Molido', barcode: '7460001', sku: 'CAF-001', category: 'Bebidas', variants: [], images: [], attributes: [], tariffs: [], appliedTaxIds: [] },
  { id: 'p-2', name: 'Café en Grano', barcode: '7460002', sku: 'CAF-002', category: 'Bebidas', variants: [], images: [], attributes: [], tariffs: [], appliedTaxIds: [] },
  { id: 'p-3', name: 'Azúcar Crema', barcode: '7460003', sku: 'AZU-001', category: 'Abarrotes', variants: [], images: [], attributes: [], tariffs: [], appliedTaxIds: [] },
] as unknown as Product[];

test('filtra inventario por nombre ignorando acentos y mayúsculas', () => {
  assert.deepEqual(filterInventoryProducts(products, 'cafe').map(product => product.id), ['p-2', 'p-1']);
});

test('filtra inventario por SKU y código de barras', () => {
  assert.equal(filterInventoryProducts(products, 'AZU-001')[0]?.id, 'p-3');
  assert.equal(findExactInventoryProduct(products, '7460002')?.id, 'p-2');
});

test('reconoce aliases ERP, códigos múltiples y variantes', () => {
  const aliasedProducts = [{
    id: 'local-1',
    name: 'Producto con aliases',
    category: 'Prueba',
    source_item_id: 'erp-100',
    barcodes: [{ value: '718037884653' }],
    variants: [{ sku: 'VAR-100', barcode: ['7469999'] }],
    images: [],
    attributes: [],
    tariffs: [],
    appliedTaxIds: [],
  }] as unknown as Product[];

  assert.equal(findExactInventoryProduct(aliasedProducts, 'erp-100')?.id, 'local-1');
  assert.equal(findExactInventoryProduct(aliasedProducts, '718037884653')?.id, 'local-1');
  assert.equal(findExactInventoryProduct(aliasedProducts, '7469999')?.id, 'local-1');
});

test('considera equivalentes UPC-A y EAN-13 con cero inicial', () => {
  const eanProducts = [{
    id: 'p-ean',
    name: 'Producto EAN',
    barcode: '0718037884653',
    category: 'Prueba',
    variants: [],
    images: [],
    attributes: [],
    tariffs: [],
    appliedTaxIds: [],
  }] as unknown as Product[];

  assert.equal(findExactInventoryProduct(eanProducts, '718037884653')?.id, 'p-ean');
});

test('no selecciona silenciosamente una búsqueda ambigua', () => {
  assert.equal(findExactInventoryProduct(products, 'cafe'), undefined);
  assert.equal(filterInventoryProducts(products, 'cafe').length, 2);
});
