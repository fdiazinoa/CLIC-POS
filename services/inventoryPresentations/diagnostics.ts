import type { BusinessConfig, CartItem } from '../../types';
import { capturePresentationAuth, validatePresentationContext, PRESENTATIONS_ROOT, type PresentationAuth, type PresentationAuthority, type PresentationContext } from './client';
import { presentationAuthority } from './authority';
import { InventoryPresentationStore, type PresentationSQL } from './store';
import { inventoryPresentationRevision, canonicalPresentationJson } from './contract';

export type PresentationCheckStatus = 'OK' | 'FAIL' | 'WARN';
export type PresentationCheck = { id: string; label: string; status: PresentationCheckStatus; detail: string };

const list = (values: readonly string[] | undefined) => (values && values.length ? [...values].sort().join(', ') : '—');

/** Field-by-field comparison between the terminal sale scope and the ERP presentation context. */
export const comparePresentationScope = (
  local: PresentationAuthority,
  remote: Partial<PresentationContext> & Record<string, any>,
): PresentationCheck[] => {
  const rows: PresentationCheck[] = [];
  const push = (id: string, label: string, localValue: string, remoteValue: string) => {
    const same = localValue === remoteValue;
    rows.push({ id, label, status: same ? 'OK' : 'FAIL', detail: same ? localValue : `caja: ${localValue} · ERP: ${remoteValue}` });
  };
  push('origin', 'Origen del ERP', local.origin, String(remote.origin ?? local.origin));
  const remoteScope = (remote.scope || {}) as Record<string, string>;
  for (const key of ['tenantId', 'companyId', 'storeId', 'terminalId', 'deviceId'] as const) {
    push(`scope-${key}`, `Ámbito ${key}`, local.scope[key], String(remoteScope[key] ?? '—'));
  }
  push('warehouse', 'Almacén de venta', local.scope.warehouseId, String(remoteScope.warehouseId ?? '—'));
  push('local', 'Local de inventario', local.scope.localId, String(remoteScope.localId ?? '—'));
  push('tariffs', 'Tarifas permitidas', list(local.tariffIds), list((remote.tariffIds || []) as string[]));
  push('categories', 'Categorías permitidas', list(local.categories), list(((remote.categories || []) as string[]).map(value => String(value).toLowerCase())));
  return rows;
};

export type PresentationDiagnosticsPorts = {
  config: BusinessConfig;
  terminalId: string;
  cartLines?: CartItem[];
  sql?: PresentationSQL;
  authority?: () => PresentationAuthority;
  auth?: () => PresentationAuth;
  fetchImpl?: typeof fetch;
  store?: InventoryPresentationStore;
};

/**
 * Ordered sweep of every stage the presentations feature depends on. It is read-only except
 * for the negotiate/masters probes, and reports the exact local and ERP values so a divergence
 * is visible instead of a single protocol code.
 */
export const runPresentationDiagnostics = async (ports: PresentationDiagnosticsPorts): Promise<PresentationCheck[]> => {
  const rows: PresentationCheck[] = [];
  let auth: PresentationAuth | null = null;
  try {
    auth = (ports.auth || capturePresentationAuth)();
    rows.push({ id: 'auth', label: 'Autorización de la caja', status: 'OK', detail: `terminal ${auth.scope.terminalId.slice(0, 8)} · dispositivo ${auth.scope.deviceId}` });
  } catch (error) {
    rows.push({ id: 'auth', label: 'Autorización de la caja', status: 'FAIL', detail: String((error as Error)?.message || error) });
    return rows;
  }

  let authority: PresentationAuthority;
  try {
    authority = (ports.authority || (() => presentationAuthority(ports.config, ports.terminalId)))();
    rows.push({ id: 'scope', label: 'Ámbito de venta de la caja', status: 'OK', detail: `almacén ${authority.scope.warehouseId.slice(0, 8)} · local ${authority.scope.localId.slice(0, 8)} · tarifas ${list(authority.tariffIds)} · categorías ${list(authority.categories)}` });
  } catch (error) {
    rows.push({ id: 'scope', label: 'Ámbito de venta de la caja', status: 'FAIL', detail: String((error as Error)?.message || error) });
    return rows;
  }

  let context: PresentationContext | null = null;
  const fetchImpl = ports.fetchImpl || fetch;
  try {
    const response = await fetchImpl(`${authority.origin}${PRESENTATIONS_ROOT}/negotiate`, {
      method: 'POST',
      headers: { ...auth.headers, 'X-Clic-Inventory-Presentations': '1', Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    const header = response.headers.get('X-Clic-Inventory-Presentations');
    if (response.status !== 200) {
      rows.push({ id: 'negotiate', label: 'Negociación con el ERP', status: 'FAIL', detail: `HTTP ${response.status}` });
      return rows;
    }
    rows.push({ id: 'negotiate', label: 'Negociación con el ERP', status: header === '1' ? 'OK' : 'FAIL', detail: header === '1' ? 'HTTP 200 con contrato de presentaciones' : 'Falta la cabecera X-Clic-Inventory-Presentations' });
    const body = await response.json();
    const remote = { ...body, origin: new URL(String(response.url || authority.origin)).origin };
    const comparison = comparePresentationScope(authority, remote);
    rows.push(...comparison);
    const mismatched = comparison.filter(row => row.status === 'FAIL');
    if (mismatched.length) {
      rows.push({ id: 'context', label: 'Contexto del ERP', status: 'FAIL', detail: `no coincide en ${mismatched.map(row => row.label.toLowerCase()).join(', ')}` });
      return rows;
    }
    context = await validatePresentationContext(body, authority);
    rows.push({ id: 'context', label: 'Contexto del ERP', status: 'OK', detail: `revisión ${context.contextRevision.slice(0, 12)}…` });
  } catch (error) {
    rows.push({ id: 'negotiate', label: 'Negociación con el ERP', status: 'FAIL', detail: String((error as Error)?.message || error) });
    return rows;
  }

  let store = ports.store;
  if (!store) {
    try {
      const sql = ports.sql;
      if (!sql) throw Error('INVENTORY_PRESENTATION_NATIVE_REQUIRED');
      store = new InventoryPresentationStore(sql);
      await store.migrate();
    } catch (error) {
      rows.push({ id: 'cache', label: 'Caché local', status: 'FAIL', detail: String((error as Error)?.message || error) });
      return rows;
    }
  }

  try {
    const bindingKey = await inventoryPresentationRevision({ origin: authority.origin, scope: authority.scope });
    const cached = await store.active(bindingKey);
    rows.push({ id: 'cache', label: 'Caché local', status: cached ? 'OK' : 'FAIL', detail: cached ? `sesión ${cached.sessionId.slice(0, 8)} · contexto ${cached.contextKey.slice(0, 8)}` : 'sin presentaciones descargadas para este ámbito' });
    if (context && cached && canonicalPresentationJson(cached.context) !== canonicalPresentationJson(context)) {
      rows.push({ id: 'cache-context', label: 'Caché contra el ERP', status: 'FAIL', detail: 'la caché es de otra revisión del contexto' });
    }
    const lines = (ports.cartLines || []).filter(line => line.inventoryPresentation !== undefined);
    if (!lines.length) {
      rows.push({ id: 'cart', label: 'Carrito', status: 'OK', detail: 'sin artículos con presentaciones' });
    } else if (!cached) {
      rows.push({ id: 'cart', label: 'Carrito', status: 'FAIL', detail: `${lines.length} artículo(s) con presentaciones sin caché` });
    } else {
      const revisions = Array.from(new Set(lines.map(line => line.inventoryPresentation!.masterRevision)));
      const retained = await store.retainedMany(cached.contextKey, revisions);
      const missing = revisions.filter(revision => !retained[revision]);
      const warehouseMismatch = lines.filter(line => line.v3SaleAuthority?.warehouseId !== cached!.context.scope.warehouseId);
      rows.push({
        id: 'cart',
        label: 'Carrito',
        status: missing.length || warehouseMismatch.length ? 'FAIL' : 'OK',
        detail: missing.length
          ? `${missing.length} presentación(es) no descargadas en esta caja`
          : warehouseMismatch.length
            ? `${warehouseMismatch.length} línea(s) con otro almacén que la caché`
            : `${lines.length} artículo(s) con presentaciones listos`,
      });
    }
  } catch (error) {
    rows.push({ id: 'cache', label: 'Caché local', status: 'FAIL', detail: String((error as Error)?.message || error) });
  }
  return rows;
};
