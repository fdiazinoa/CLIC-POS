import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scopedWarehousesForStore } from '../utils/warehouseScope';
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
  // An attempt with a possible effect is only discardable by the ERP; the local release
  // stays restricted to a PREPARED attempt without payments.
  assert.match(client, /async retireUnbornAttempt\(/);
  assert.match(client, /if\(current\.phase==='EFFECT_POSSIBLE'\|\|/);
  assert.match(client, /current\.phase==='PREPARED'&&native\.abandonPreparedWithoutEffects/);
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
