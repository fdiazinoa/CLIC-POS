import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtimeSources = [
  'services/restaurant/KioskProductionPreflight.ts',
  'services/restaurant/ProductionAreaSnapshot.ts',
  'services/articleFormats/inventoryJournal.ts',
  'services/fiscal/FiscalWorkflowRetirement.ts',
  'services/sync/ProductImageCacheService.ts',
  'services/sync/SyncManager.ts',
  'components/ClassificationManager.tsx',
];

test('catalog application does not require Object.hasOwn on older Android WebViews', () => {
  for (const sourcePath of runtimeSources) {
    const source = readFileSync(new URL(`../${sourcePath}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /Object\.hasOwn\s*\(/, sourcePath);
  }
});

test('production snapshot and printer validation preserve own-key semantics without Object.hasOwn', async () => {
  const { productionAreaRows, mergeProductionAreaSnapshot } = await import('../services/restaurant/ProductionAreaSnapshot');
  const { prepareKioskProduction } = await import('../services/restaurant/KioskProductionPreflight');
  const descriptor = Object.getOwnPropertyDescriptor(Object, 'hasOwn');
  Object.defineProperty(Object, 'hasOwn', { value: undefined, configurable: true, writable: true });
  try {
    const area = { id: 'KITCHEN', name: 'Kitchen', modo_salida: 'PRINTER', printer_id: 'printer' };
    assert.deepEqual(productionAreaRows({ resolved: { catalog: { production_areas: [area] } } }), [area]);
    assert.equal(productionAreaRows({ resolved: { catalog: Object.create({ production_areas: [area] }) } }), undefined);
    assert.throws(() => productionAreaRows({ resolved: { catalog: { production_areas: null } } }), /SNAPSHOT_INVALID/);
    const omitted = mergeProductionAreaSnapshot([{ id: area.id, name: area.name }], [area]);
    assert.equal(omitted[0].printer_id, 'printer');
    const inherited = mergeProductionAreaSnapshot([Object.assign(Object.create({ printer_id: null }), { id: area.id, name: area.name })], [area]);
    assert.equal(inherited[0].printer_id, 'printer');
    const cleared = mergeProductionAreaSnapshot([{ id: area.id, name: area.name, printer_id: null }], [area]);
    assert.equal(cleared[0].printer_id, null);
    const line = { id: 'item', name: 'Simple', production_area_id: area.id, product_type: 'SIMPLE' } as any;
    const config = { availablePrinters: [{ id: 'printer', productionAreaId: area.id }] } as any;
    assert.equal(prepareKioskProduction([line], omitted, config, 'T')[0].printerId, 'printer');
    assert.throws(() => prepareKioskProduction([line], cleared, config, 'T'), /impresora/);
  } finally {
    if (descriptor) Object.defineProperty(Object, 'hasOwn', descriptor);
  }
});
