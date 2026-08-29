import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

import { calculateTaxBreakdownFromItems, freezeAuthoritativeLineFiscalAmounts } from '../utils/fiscalBreakdown';
import { resolveClassificationActive } from '../utils/posCatalogPresentation';

const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('cliente exento no genera impuesto ni importes fiscales en las líneas', () => {
  const config = {
    taxRate: 0.18,
    taxes: [{ id: 'itbis', name: 'ITBIS', rate: 0.18, type: 'VAT' }],
  } as any;
  const items = [{ price: 100, quantity: 1, appliedTaxIds: ['itbis'] }];

  assert.deepEqual(calculateTaxBreakdownFromItems(items, config, { taxExempt: true }), []);
  const frozen = freezeAuthoritativeLineFiscalAmounts(items, config, {
    taxExempt: true,
    transactionNetAmount: 100,
    transactionTaxAmount: 0,
    transactionTotal: 100,
  });
  assert.equal(frozen[0].taxAmount, 0);
  assert.equal(frozen[0].taxRate, 0);
  assert.equal(frozen[0].totalAmount, 100);
});

test('familia oculta se interpreta como inactiva para la pantalla de ventas', () => {
  assert.equal(resolveClassificationActive({ isActive: false }), false);
  const pos = read('components/POSInterface.tsx');
  assert.match(pos, /categoryIsVisible && entry\.isSellable/);
  assert.match(pos, /config\.families/);
});

test('los contratos de navegación y edición rápida quedan conectados', () => {
  const app = read('App.tsx');
  const settings = read('components/Settings.tsx');
  const wallet = read('components/WalletIntegrations.tsx');
  const pos = read('components/POSInterface.tsx');
  const catalog = read('components/CatalogManager.tsx');

  assert.match(app, /if \(Capacitor\.isNativePlatform\(\)\)[\s\S]*clearActiveUserSession\(\)[\s\S]*setCurrentView\('LOGIN'\)/);
  assert.match(settings, /<WalletIntegrations[\s\S]*onClose=\{\(\) => setCurrentView\('HOME'\)\}/);
  assert.match(wallet, /aria-label="Volver a ajustes"/);
  assert.match(pos, /case 'TRACKING':[\s\S]*setShowParkedList\(false\)[\s\S]*onOpenInventoryTracking\(\)/);
  assert.match(pos, /setGlobalDiscount\([\s\S]*returnToTicketView\(\)/);
  assert.match(catalog, /aria-label=\{`Modificar precio de \$\{product\.name\}`\}/);
  assert.match(catalog, /defaultTariffId/);
});

test('monedas e impuestos exponen las rutas operacionales bajo api sync', () => {
  const server = read('server/index.ts');
  const adapter = read('services/sync/ApiSyncAdapter.ts');
  assert.match(server, /server\.use\('\/api\/sync\/currencies', currencyRoutes\)/);
  assert.match(server, /server\.use\('\/api\/sync\/taxes', taxRoutes\)/);
  assert.match(adapter, /postOperationalPayload\('\/currencies\/upsert'/);
  assert.match(adapter, /postOperationalPayload\('\/taxes\/upsert'/);
});

test('la identidad del tenant no sustituye los datos reales de empresa', () => {
  const app = read('App.tsx');
  assert.match(app, /Tenant identity selects the data boundary; it is not company master data/);
  assert.doesNotMatch(app, /identityText\.includes\('mercasend'\)/);
});
