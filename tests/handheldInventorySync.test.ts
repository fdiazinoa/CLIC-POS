import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const inventoryHomeSource = readFileSync(new URL('../components/inventory/InventoryHome.tsx', import.meta.url), 'utf8');

test('el menú del PDA ejecuta sincronización directa de OC y traspasos', () => {
  assert.match(inventoryHomeSource, /label: 'Sincronizar ahora'/);
  assert.match(inventoryHomeSource, /onSyncNow\(\)/);
  assert.match(inventoryHomeSource, /Sincronización completa: \$\{result\.purchaseOrders\} OC y \$\{result\.transfers\} traspasos disponibles/);
});

test('la sincronización del PDA solicita y rehidrata colecciones operativas', () => {
  assert.match(appSource, /masterScopes: \['suppliers', 'purchase_orders', 'transfers'\]/);
  assert.match(appSource, /db\.get\('suppliers'\)/);
  assert.match(appSource, /db\.get\('purchaseOrders'\)/);
  assert.match(appSource, /db\.get\('transfers'\)/);
  assert.match(appSource, /setPurchaseOrders\(/);
  assert.match(appSource, /setTransfers\(/);
});

test('la recepción conserva el nombre denormalizado del proveedor de la OC', () => {
  const receptionSource = readFileSync(new URL('../components/inventory/MobileReception.tsx', import.meta.url), 'utf8');
  assert.match(receptionSource, /order\.supplierName\?\.trim\(\)/);
});
