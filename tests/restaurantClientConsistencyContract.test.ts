import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../types.ts', import.meta.url), 'utf8');
const serverSource = readFileSync(
  new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url),
  'utf8',
);
const htmlPrinterSource = readFileSync(new URL('../utils/printer.ts', import.meta.url), 'utf8');
const escPosPrinterSource = readFileSync(
  new URL('../services/printer/EscPosFormatter.ts', import.meta.url),
  'utf8',
);

test('el ticket de mesa comparte y restaura descuento, cliente y comensales', () => {
  assert.match(typesSource, /discountType\?: 'PERCENT' \| 'FIXED'/);
  assert.match(typesSource, /discountValue\?: number/);
  assert.match(typesSource, /guests\?: number/);
  assert.match(posSource, /discountAmount,\s*discountType: globalDiscount\.type,\s*discountValue: globalDiscount\.value,\s*guests:/);
  assert.match(posSource, /restoredParkedPricingRef/);
  assert.match(posSource, /parked\.discountValue \?\? parked\.discountAmount \?\? 0/);
  assert.match(posSource, /customerId: selectedCustomer\?\.id/);
  assert.match(appSource, /guests: Number\(linkedTicket\.guests \|\| 0\) > 0/);
});

test('la Master permite persistir comensales y clientes creados por una terminal cliente', () => {
  assert.match(serverSource, /method == "PUT" && path\.startsWith\("\/api\/tables\/"\)/);
  assert.match(serverSource, /private fun handleTableUpdate/);
  assert.match(serverSource, /ticket\.put\("guests", payload\.optInt\("guests", 0\)\)/);
  assert.match(serverSource, /method == "PUT" && path == "\/api\/customers"/);
  assert.match(serverSource, /private fun handleCustomerUpsert/);
  assert.match(serverSource, /catalogVersions\["customers"\]/);
  assert.match(serverSource, /\.put\("customers", getSyncCollection\("customers"\)\)/);
  assert.match(serverSource, /hasInitializedCatalogs && acknowledgedRevision < restaurantRevision\.get\(\)/);
  assert.match(appSource, /fetch\(resolveOperationalApiUrl\('\/api\/customers'\)/);
  assert.match(appSource, /syncManager\.broadcastChange\('customers', customer, 'CREATE'\)/);
});

test('asignar un cliente persiste el ticket sin perder el lock ni la selección al volver al POS', () => {
  assert.match(appSource, /currentView !== 'POS' && currentView !== 'CUSTOMERS'/);
  assert.match(appSource, /reason: 'customer_assigned'/);
  assert.match(appSource, /customerId: c\.id,[\s\S]*customerName: c\.name/);
  assert.match(appSource, /!activeTableEditLockRef\.current/);
  assert.match(posSource, /else if \(!selectedCustomer\) \{\s*onSelectCustomer\(null\)/);
});

test('la salida conserva las credenciales del lock, evita esperas y no duplica comandas KDS', () => {
  const releaseStart = appSource.indexOf('const releaseActiveTableEditLock');
  const releaseEnd = appSource.indexOf('const acquireTableEditLock', releaseStart);
  const releaseSource = appSource.slice(releaseStart, releaseEnd);
  assert.ok(
    releaseSource.indexOf("await invokeTableEditLock('release'")
      < releaseSource.indexOf('activeTableEditLockRef.current = null'),
  );
  assert.match(releaseSource, /attempt <= 2/);

  const saveStart = appSource.indexOf('const handleUpdateParkedTickets');
  const saveEnd = appSource.indexOf('const handleParkedOrderSplitFromMap', saveStart);
  const saveSource = appSource.slice(saveStart, saveEnd);
  assert.doesNotMatch(saveSource, /await fetchTables\(\)/);

  const parkStart = posSource.indexOf('const handleParkCurrentTicket');
  const parkEnd = posSource.indexOf('const saveActiveTableOrderForMap', parkStart);
  const parkSource = posSource.slice(parkStart, parkEnd);
  assert.doesNotMatch(parkSource, /api\/ordenes/);

  const backStart = posSource.indexOf('const handleBackToMap');
  const backEnd = posSource.indexOf('const handleRestoreTicket', backStart);
  const backSource = posSource.slice(backStart, backEnd);
  assert.match(backSource, /cart\.some\(item => !item\.dispatched\)/);
  assert.match(backSource, /await handleDispatchCommand\('table_exit'\)/);
  assert.match(backSource, /dispatchOutcome === 'DISPATCHED' \|\| dispatchOutcome === 'CANCELLED'/);
});

test('el diseñador vuelve al mapa cuando se abrió desde Salas', () => {
  assert.match(appSource, /tableDesignerReturnViewRef\.current = 'TABLE_MAP'/);
  assert.match(appSource, /if \(returnView === 'TABLE_MAP'\) \{\s*setCurrentView\('TABLE_MAP'\)/);
});

test('la factura muestra el descuento junto al artículo y separa el descuento general', () => {
  assert.match(htmlPrinterSource, /Descuento artículo \(\$\{lineDiscount\.discountPercentageLabel\}\)/);
  assert.match(htmlPrinterSource, /Precio final:/);
  assert.match(htmlPrinterSource, /const discountTotal = Math\.max\(0, Number\(transaction\.discountAmount \|\| 0\)\)/);
  assert.match(escPosPrinterSource, /Descuento articulo \(\$\{discount\.discountPercentageLabel\}\)/);
  assert.match(escPosPrinterSource, /'  Precio final'/);
  assert.match(escPosPrinterSource, /DESCUENTO GENERAL/);
  assert.match(escPosPrinterSource, /globalDiscountTotal/);
});
