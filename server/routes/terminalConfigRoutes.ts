import express from 'express';
import { getSetting, saveSetting } from '../db.js';
import { applyTerminalConfigSnapshot, extractTerminalConfigSnapshot } from '../../utils/terminalConfigSnapshot.js';
import { TerminalConfigSnapshot } from '../../types.js';

const router = express.Router();

const REQUEST_TIMEOUT_MS = 12000;

const asObject = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const stripTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

const stripApiSuffix = (value: string): string => {
  return value
    .replace(/\/api\/sync\/?$/i, '')
    .replace(/\/api\/?$/i, '');
};

const normalizeBaseUrl = (value?: string | null): string | null => {
  const raw = asString(value);
  if (!raw) return null;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    return stripTrailingSlashes(stripApiSuffix(url.toString()));
  } catch {
    return null;
  }
};

const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const resolveStoredErpContext = (): Record<string, any> => asObject(getSetting('erp_setup_context'));

const resolveTenantId = (req: express.Request): string | null => {
  const queryTenantId = asString(req.query.tenant_id);
  const headerTenantId = asString(req.headers['x-tenant-id']);
  const storedTenantId =
    asString(resolveStoredErpContext().tenantId) ||
    asString(getSetting('active_tenant_id')) ||
    asString(getSetting('tenant_id'));

  return queryTenantId || headerTenantId || storedTenantId || null;
};

const resolveErpBaseUrl = (req: express.Request): string | null => {
  const queryBase = normalizeBaseUrl(asString(req.query.erp_base_url));
  const storedContextBase = normalizeBaseUrl(asString(resolveStoredErpContext().erpBaseUrl));
  const syncMetadata = asObject(getSetting('syncMetadata'));
  const storedMetadataBase =
    normalizeBaseUrl(asString(syncMetadata.erpBaseUrl)) ||
    normalizeBaseUrl(asString(syncMetadata.syncApiUrl)) ||
    normalizeBaseUrl(asString(syncMetadata.masterSyncUrl));

  return queryBase || storedContextBase || storedMetadataBase || null;
};

const buildErpHeaders = (req: express.Request, tenantId: string | null): HeadersInit => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  const authorization = asString(req.headers.authorization);
  const cookie = asString(req.headers.cookie);

  if (authorization) headers.Authorization = authorization;
  if (cookie) headers.Cookie = cookie;
  if (tenantId) headers['X-Tenant-Id'] = tenantId;

  return headers;
};

const fetchErpJson = async (req: express.Request, baseUrl: string, path: string, tenantId: string) => {
  const url = `${stripTrailingSlashes(baseUrl)}${path}`;
  const response = await withTimeout(
    fetch(url, {
      method: 'GET',
      headers: buildErpHeaders(req, tenantId),
    }),
    `ERP request ${path}`
  );

  const text = await response.text();
  let payload: any = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const message =
      asString(asObject(payload).message) ||
      asString(asObject(payload).error) ||
      `${response.status} ${response.statusText}`.trim();
    throw new Error(`ERP ${path}: ${message}`);
  }

  return payload;
};

const getSnapshotCache = (): Record<string, TerminalConfigSnapshot> => {
  return asObject(getSetting('terminal_snapshot_cache')) as Record<string, TerminalConfigSnapshot>;
};

const getCachedTerminalSnapshot = (terminalId: string): TerminalConfigSnapshot | null => {
  const cache = getSnapshotCache();
  const snapshot = asObject(cache[terminalId]);
  return Object.keys(snapshot).length > 0 ? (snapshot as TerminalConfigSnapshot) : null;
};

const saveCachedTerminalSnapshot = (terminalId: string, snapshot: TerminalConfigSnapshot | null | undefined) => {
  if (!snapshot) return;
  const resolved = asObject(snapshot.resolved);
  if (Object.keys(resolved).length === 0) return;
  const cache = getSnapshotCache();
  cache[terminalId] = snapshot;
  saveSetting('terminal_snapshot_cache', cache);
};

router.get('/:terminalId/config', async (req, res) => {
  const config = getSetting('config');
  const terminalId = asString(req.params.terminalId);
  const tenantId = resolveTenantId(req);
  const erpBaseUrl = resolveErpBaseUrl(req);
  const posDeviceId = asString(req.query.pos_device_id);

  if (!terminalId) {
    return res.status(400).json({ status: 'error', message: 'terminalId es obligatorio.' });
  }

  if (!tenantId || !erpBaseUrl) {
    return res.status(400).json({
      status: 'error',
      message: 'tenant_id y erp_base_url son obligatorios para refrescar la terminal.',
    });
  }

  try {
    const snapshotPayload = await fetchErpJson(
      req,
      erpBaseUrl,
      `/api/sync/terminals/${encodeURIComponent(terminalId)}/config?tenant_id=${encodeURIComponent(tenantId)}`,
      tenantId
    );
    const snapshot = extractTerminalConfigSnapshot(snapshotPayload);
    if (!snapshot) {
      throw new Error('El ERP no devolvió terminal_config para el refresco.');
    }

    const cachedSnapshot = getCachedTerminalSnapshot(terminalId);
    const applied = applyTerminalConfigSnapshot(config, {
      terminalId,
      posDeviceId,
      incomingSnapshot: snapshot,
      cachedSnapshot,
    });

    if (applied.snapshot && !applied.hasResolutionError && Object.keys(asObject(applied.snapshot.resolved)).length > 0) {
      saveCachedTerminalSnapshot(applied.terminalId, applied.snapshot);
    }

    saveSetting('config', applied.config);

    return res.json({
      success: true,
      source: applied.snapshotSource,
      tenant_id: asString(snapshot.tenant_id) || tenantId,
      terminal_id: applied.terminalId,
      terminal_config: snapshot,
      config: applied.config,
      snapshot_meta: {
        used_resolved: applied.usedResolved,
        used_fallback_config: applied.usedFallbackConfig,
        used_cached_snapshot: applied.usedCachedSnapshot,
        resolution_error: snapshot.resolution_error ?? null,
        full_pull_on_pairing: applied.fullPullOnPairing ?? false,
      },
    });
  } catch (error: any) {
    console.error('❌ Terminal config refresh error:', error?.message || error);

    const cachedSnapshot = getCachedTerminalSnapshot(terminalId);
    if (cachedSnapshot) {
      const applied = applyTerminalConfigSnapshot(config, {
        terminalId,
        posDeviceId,
        incomingSnapshot: cachedSnapshot,
        cachedSnapshot,
      });

      saveSetting('config', applied.config);

      return res.json({
        success: true,
        source: 'CACHED_SNAPSHOT',
        tenant_id: asString(cachedSnapshot.tenant_id) || tenantId,
        terminal_id: applied.terminalId,
        terminal_config: cachedSnapshot,
        config: applied.config,
        snapshot_meta: {
          used_resolved: applied.usedResolved,
          used_fallback_config: applied.usedFallbackConfig,
          used_cached_snapshot: true,
          resolution_error: null,
          full_pull_on_pairing: applied.fullPullOnPairing ?? false,
        },
      });
    }

    return res.status(500).json({
      status: 'error',
      message: error?.message || 'No se pudo refrescar la configuración de la terminal.',
    });
  }
});

export default router;
