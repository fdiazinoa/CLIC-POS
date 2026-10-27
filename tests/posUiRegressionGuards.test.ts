import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scopedWarehousesForStore, alternativeWarehouseForLines } from '../utils/warehouseScope';
import type { Warehouse } from '../types';

const source = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const pos = () => source('components/POSInterface.tsx');
const settings = () => source('components/Settings.tsx');

/**
 * These guard the UI decisions that a stale base or a bad merge already reverted once.
 * They are source contracts: they fail the suite before a build can ship the old layout.
 */

test('warehouse scope keeps only the terminal store and never drops legacy rows without storeId', () => {
  const rows = [
    { id: 'a', code: 'ALM_CENTRAL', storeId: 'store-1' },
    { id: 'b', code: '001', storeId: 'store-2' },
    { id: 'c', code: 'LEGACY' },
  ] as unknown as Warehouse[];
  assert.deepEqual(scopedWarehousesForStore(rows, 'store-1').map(row => row.id), ['a', 'c']);
  assert.deepEqual(scopedWarehousesForStore(rows, '').map(row => row.id), ['a', 'b', 'c']);
  // Unknown store: only the rows without a storeId survive; nothing is invented.
  assert.deepEqual(scopedWarehousesForStore(rows, 'store-9').map(row => row.id), ['c']);
});

test('the assign-client control lives in the ticket header, not as a full-width row', () => {
  const src = pos();
  assert.match(src, /title="Asignar cliente"/);
  assert.doesNotMatch(src, /w-full flex items-center justify-between px-3 py-2 bg-white border border-dashed/);
  assert.ok(src.indexOf('title="Asignar cliente"') < src.indexOf('TicketStatusControls className={`ml-auto'),
    'the client control must render before the header status controls');
  assert.match(src, /warehouses=\{operatingWarehouses\}/);
});

const desktopRow = () => {
  const src = pos();
  const start = src.indexOf('// DESKTOP CARD DESIGN');
  assert.ok(start > 0, 'desktop row markup not found');
  return src.slice(start, start + 12000);
};

test('ticket rows keep the unit price and drop the per-line tax legend', () => {
  const row = desktopRow();
  assert.match(row, /c\/u/);
  assert.doesNotMatch(row, /\{lineTaxSummary\}/);
});

test('KDS state is an icon marker, never a text chip', () => {
  const row = desktopRow();
  assert.match(row, /ChefHat size=\{12\}/);
  assert.doesNotMatch(row, /'KDS enviado'/);
});

test('checkout actions are icon-only with a green Cobrar', () => {
  const src = pos();
  assert.match(src, /aria-label=\{rightSidebarTab === 'ACTIONS' \? 'Ver ticket' : 'Opciones'\}/);
  assert.doesNotMatch(src, /<span className="truncate">\{rightSidebarTab === 'ACTIONS'/);
  assert.match(src, /bg-emerald-600 text-white hover:bg-emerald-500/);
  assert.match(src, /aria-hidden="true">\$<\/span>/);
});

test('the fiscal badge is a short chip inside the ticket header', () => {
  assert.match(pos(), /<FiscalStatusBadge compact short visible=/);
});

test('settings rows are grouped cards that open a modal grid', () => {
  const src = settings();
  assert.match(src, /setOpenSettingsGroup\(/);
  assert.match(src, /grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3/);
  for (const group of ['Inventario y Catálogo', 'Finanzas y Legal', 'Configuración Local', 'Equipo y Marketing', 'Sistema y Auditoría']) {
    assert.ok(src.includes(`label="${group}"`), `missing settings group ${group}`);
  }
});

test('a retained fiscal attempt that can never reconcile is released instead of blocking the box', () => {
  const src = pos();
  // The checkout flow must offer an escape hatch before failing the reconciliation guard.
  assert.match(src, /fiscalWorkflowV2Client\.cancelUnreconcilableAttempt\(/);
  assert.match(src, /FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED:\$\{outcome\.note\}/);
  assert.match(src, /const reusableTag=!fiscalAttemptReleased/);
  const client = source('services/fiscal/FiscalWorkflowV2Client.ts');
  assert.match(client, /async cancelUnreconcilableAttempt\(/);
  assert.match(client, /async pendingCheckoutInfo\(/);
  assert.match(client, /async diagnostics\(/);
  // A paid online attempt still keeps the ERP as the only authority on the document.
  assert.match(client, /async retireUnbornAttempt\(/);
  assert.match(client, /current\.phase==='EFFECT_POSSIBLE'\)return \{cancelled:false,note:`\$\{retired\.note\} El intento ya tiene un pago/);
  // Local-first: an offline permit (even with a possible payment) and a prepared online permit are
  // released here; only a paid online attempt keeps the ERP as the authority.
  assert.match(client, /current\.phase==='EFFECT_POSSIBLE'&&current\.permit\?\.leaseId&&native\.abandonPreparedWithoutEffects/);
  assert.match(client, /current\.phase==='PREPARED'&&native\.abandonPreparedWithoutEffects&&current\.permit\?\.permitId/);
  assert.match(source('services/db/FiscalWorkflowRetirementStore.ts'), /export async function closeUnbornRetirement\(/);
  // The escape hatch exists only for an ERP that cannot reconcile, with an audited supervisor.
  assert.match(source('components/FiscalDiagnostics.tsx'), /Liberar con autorización/);
  assert.match(source('components/FiscalDiagnostics.tsx'), /inputType: 'password'/);
  assert.match(source('services/db/FiscalWorkflowV2Store.ts'), /async releaseAttemptWithoutErp\(/);
  assert.match(source('services/db/FiscalWorkflowV2Store.ts'), /pos_fiscal_attempt_releases_v1/);
  const store = source('services/db/FiscalWorkflowV2Store.ts');
  assert.match(store, /async abandonPreparedWithoutEffects\(/);
  assert.match(store, /assertRetirementHasNoEffects\(sql/);
  // Boot reconciliation can no longer bail out when the terminal lost its local authority.
  const service = source('services/sync/TerminalReauthorizationService.ts');
  assert.doesNotMatch(service, /if \(!store \|\| !local\) return note;/);
  assert.match(service, /cancelUnreconcilableAttempt\(\{\}\)/);
});

test('fiscal diagnostics stay reachable from Settings', () => {
  const src = settings();
  assert.match(src, /'FISCAL_DIAGNOSTICS'/);
  assert.match(src, /label="Diagnóstico fiscal"/);
  assert.match(src, /<FiscalDiagnostics onClose=/);
  assert.match(source('components/FiscalDiagnostics.tsx'), /Cerrar intento pendiente/);
});

test('a restaurant account restores with its agreed prices and only adopts today authority', () => {
  const src = pos();
  assert.match(src, /v3Operational\.reanchor\(cart\)/);
  assert.doesNotMatch(src, /setSuccessToast\('Ticket actualizado al inventario de hoy/);
  assert.match(source('components/LargeMasterSyncV3OperationalPOS.tsx'), /planV3CartReanchor\(/);
  const planner = source('services/sync/LargeMasterSyncV3CartReanchor.ts');
  assert.match(planner, /output\.push\(\{ \.\.\.line, v3SaleAuthority: next \}\)/);
  assert.match(planner, /taxIncluded !== next\.taxIncluded/);
  // The raw code must never reach the cashier again.
  assert.match(source('utils/v3ErrorMessages.ts'), /SYNC_V3_CART_MIXED_VERSION/);
  assert.doesNotMatch(src, /setErrorToast\(`V3: /);
});

test('presentations have their own read-only diagnostics sweep', () => {
  assert.match(settings(), /label="Diagnóstico de presentaciones"/);
  assert.match(settings(), /'PRESENTATION_DIAGNOSTICS'/);
  const panel = source('components/PresentationDiagnostics.tsx');
  assert.match(panel, /runPresentationDiagnostics\(/);
  assert.match(panel, /no descarga presentaciones ni emite documentos/);
  const sweep = source('services/inventoryPresentations/diagnostics.ts');
  assert.match(sweep, /comparePresentationScope/);
  for (const stage of ['auth', 'scope', 'negotiate', 'context', 'cache', 'cart']) assert.match(sweep, new RegExp(`id: '${stage}'`));
});

test('the presentations panel can adopt the ERP default warehouse for the box', () => {
  const panel = source('components/PresentationDiagnostics.tsx');
  assert.match(panel, /Usar el almacén del ERP/);
  assert.match(panel, /defaultSalesWarehouseId: match\.id/);
  assert.match(panel, /onUpdateConfig\?\.\(nextConfig\)/);
  assert.match(settings(), /onUpdateConfig=\{props\.onUpdateConfig\}/);
});

test('a table saved on another warehouse re-anchors and its presentations adopt today master', () => {
  const src = pos();
  assert.match(src, /stamp\.warehouseId !== liveWarehouse/);
  assert.match(src, /reconcilePresentationLine\(/);
  assert.match(src, /el precio de la presentación cambió/);
  const reconcile = source('services/inventoryPresentations/reconcile.ts');
  assert.match(reconcile, /status: 'reconciled'/);
  assert.match(reconcile, /PRICE_CHANGED/);
  assert.match(source('utils/presentationErrorMessages.ts'), /INVENTORY_PRESENTATION_SOURCE_REQUIRED_NOT_YET_SUPPORTED/);
});

test('an account restored after a master refresh is still settleable offline', () => {
  const source_ = source('services/fiscal/OfflineTableFiscalCheckout.ts');
  assert.match(source_, /export const tableAccountLineFingerprint/);
  assert.match(source_, /tableAccountLineFingerprint\(originals\[0\]\)!==tableAccountLineFingerprint\(line\)/);
  assert.doesNotMatch(source_, /v3RetainedLineFingerprint\(originals\[0\]\)/);
  assert.match(source_, /OFFLINE_FISCAL_TABLE_SOURCE_CHANGED/);
});

test('a transient failure never locks the cashier out of the next attempt', () => {
  const src = pos();
  // A timed-out commit is reconciled against the durable record before failing.
  assert.match(src, /TIMEOUT_CREATE_TRANSACTION/);
  assert.match(src, /La venta no se registró a tiempo\. Se liberó el intento anterior/);
  assert.match(src, /const restate = async \(\) => \{/);
  // An already approved gateway intent is reused instead of charging the card twice.
  const modal = source('components/PaymentModal.tsx');
  assert.match(modal, /intent\?\.status === 'AUTHORIZED'\) \{/);
  assert.match(modal, /gatewayReference: reference/);
  assert.doesNotMatch(modal, /&& intent\?\.status === 'AUTHORIZED'\) throw new Error\('PAYMENT_INTENT_RECONCILIATION_REQUIRED'\)/);
});

test('a native attempt bound to another cart is released instead of blocking the payment', () => {
  const src = pos();
  assert.match(src, /pendingAttempt\.cartIdentity !== currentFiscalCheckoutCartIdentity/);
  assert.match(src, /FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED:\$\{released\?\.note/);
  // The re-anchor also looks at the native store, not only the in-memory reference.
  assert.match(src, /const pending = await fiscalWorkflowV2Client\.pendingCheckoutInfo\(\)/);
});

test('a stale descriptive copy of an article never blocks the sale', () => {
  const source_ = source('services/sync/LargeMasterSyncV3LineSource.ts');
  assert.match(source_, /SYNC_V3_ARTICLE_SOURCE_CHANGED:identity/);
  assert.match(source_, /SYNC_V3_ARTICLE_SOURCE_CHANGED:tariff/);
  assert.doesNotMatch(source_, /JSON\.stringify\(line\.appliedTaxIds\) !== JSON\.stringify\(product\.appliedTaxIds\)/);
  assert.match(source('utils/v3ErrorMessages.ts'), /SYNC_V3_ARTICLE_SOURCE_CHANGED/);
});

test('a warehouse conflict names where the ticket articles actually live', () => {
  const lines = [{ id: 'a', name: 'Pechuga', activeInWarehouses: ['ALM_CENTRAL'] }];
  const warehouses = [{ id: 'ALM_CENTRAL', name: 'Almacén Central' }, { id: 'A01', name: 'Almacén A01' }];
  const alternative = alternativeWarehouseForLines(lines, warehouses, 'A01');
  assert.deepEqual(alternative, { warehouseId: 'ALM_CENTRAL', name: 'Almacén Central', lineName: 'Pechuga' });
  assert.equal(alternativeWarehouseForLines([{ id: 'b', activeInWarehouses: ['A01'] }], warehouses, 'A01'), null);
  assert.equal(alternativeWarehouseForLines(lines, warehouses, ''), null);
  assert.match(pos(), /alternativeWarehouseForLines\(processedCart as any, warehouses, defaultSalesWarehouseId\)/);
});

test('the box follows the ERP sale warehouse instead of waiting for a manual step', () => {
  const src = pos();
  assert.match(src, /readErpSalesWarehouse\(\)/);
  assert.match(src, /pickAuthorizedWarehouse\(rows, erp\)/);
  assert.doesNotMatch(src, /setSuccessToast\(`Almacén de venta actualizado desde el ERP/);
  assert.doesNotMatch(src, /if \(!v3Operational \|\| cart\.length > 0\) return;/);
});

test('a manual payment keeps its identity when the checkout is retried', () => {
  const modal = source('components/PaymentModal.tsx');
  assert.match(modal, /paymentIdNamespace\?: string/);
  assert.match(modal, /id: \(paymentOperationId \|\| paymentIdNamespace\) \? `\$\{paymentOperationId \|\| paymentIdNamespace\}:payment:\$\{payments\.length\}`/);
  const src = pos();
  assert.match(src, /paymentAttemptRef=useRef<\{cartKey:string;id:string\}\|null>/);
  assert.match(src, /paymentIdNamespace=\{\(\(\):string=>\{const cartKey=currentFiscalCheckoutCartIdentity\(\)/);
  // The retained-operation semantics stay tied to the reservation claim only.
  assert.match(src, /paymentOperationId=\{activeV3Reservation\?\.claimId\}/);
});

test('the checkout resolves blockers before the cashier pays', () => {
  const src = pos();
  assert.match(src, /stableCheckoutAttemptId\(cartKey,\(\)=>createUuid\(\)\)/);
  assert.match(src, /if \(!showPaymentModal \|\| !v3Operational\) return;/);
  assert.match(src, /setShowPaymentModal\(false\);\s*\n\s*setErrorToast\(released\.note\)/);
});

test('automatic reconciliation is silent for the cashier', () => {
  const src = pos();
  assert.doesNotMatch(src, /setSuccessToast\(`Almacén de venta actualizado desde el ERP/);
  assert.doesNotMatch(src, /setSuccessToast\('Ticket actualizado al inventario de hoy/);
  assert.match(src, /console\.info\('\[checkout\] almacén de venta alineado con el ERP/);
  // Only exceptions and money changes may speak.
  assert.match(src, /setErrorToast\(released\.note\)/);
});

test('every preparation step releases a stale attempt through one helper', () => {
  const src = pos();
  assert.match(src, /const releaseStaleFiscalAttempt = async \(options: \{ identity\?: string \} = \{\}\)/);
  // The modal preflight and the re-anchor both delegate to it.
  const releaseCalls = src.match(/await releaseStaleFiscalAttempt\(/g) || [];
  assert.ok(releaseCalls.length >= 2, 'both preparation steps must use the shared helper');
  assert.doesNotMatch(src, /const outcome = await fiscalWorkflowV2Client\.cancelUnreconcilableAttempt\(\{\}\)\.catch/);
});

test('the account only speaks when the preparation could not finish', () => {
  const src = pos();
  assert.match(src, /Revisar antes de cobrar/);
  assert.match(src, /const \[accountHold, setAccountHold\] = useState<\{ note: string \} \| null>\(null\)/);
  assert.match(src, /setAccountHold\(\{ note: released\.note \}\)/);
  // A resolved account clears the warning and keeps the ticket silent.
  assert.match(src, /setAccountHold\(null\);/);
  assert.doesNotMatch(src, /Lista para cobrar/);
});
