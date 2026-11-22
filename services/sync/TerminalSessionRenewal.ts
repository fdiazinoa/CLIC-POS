import { resolveSyncTarget } from './SyncProfile';
import { validatedLargeMasterSyncV3ErpSyncBase } from './LargeMasterSyncV3BoundTransport';
import { resolveLocalDeviceId } from '../../utils/deviceRevocation';
import { isCanonicalErpTerminalId } from './terminalIdentity';
import { captureStaleTerminalAuthorization, captureTerminalSessionSnapshot, saveTerminalSessionCAS, readTerminalCredentialsSync, type TerminalCredentials } from './TerminalCredentialStore';

export type SessionRenewalResult = {
  renewed: boolean;
  reason: string;
  expiresAt: string | null;
};

type RenewalTarget = { kind?: string; baseUrl?: string; terminalId?: string } | null;

export type SessionRenewalPorts = {
  credentials?: () => TerminalCredentials;
  target?: () => RenewalTarget;
  capture?: typeof captureTerminalSessionSnapshot;
  save?: typeof saveTerminalSessionCAS;
  fetchImpl?: typeof fetch;
};

let inFlight: { fiscalRecovery: boolean; promise: Promise<SessionRenewalResult> } | null = null;

const literal = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.trim() === value && !/[\r\n\t]/.test(value);

/**
 * Renews the terminal session against the ERP using only the paired device token.
 * The ERP rotates the session token on every register, so a box can end up holding a
 * stale (or missing) session while its pairing is still valid. This handshake adopts the
 * current session without re-pairing: the device token, and therefore the fiscal binding
 * and the offline reserve, stay untouched. An answer without a date is an open-ended session.
 */
const renew = async (ports: SessionRenewalPorts, fiscalRecovery: boolean): Promise<SessionRenewalResult> => {
  const readCredentials = ports.credentials || readTerminalCredentialsSync;
  const readTarget = ports.target || (() => resolveSyncTarget() as RenewalTarget);
  const save = ports.save || saveTerminalSessionCAS;
  const capture = ports.capture || captureTerminalSessionSnapshot;
  const fetchImpl = ports.fetchImpl || fetch;

  const credentials = readCredentials();
  if (!literal(credentials.deviceToken)) return { renewed: false, reason: 'SIN_TOKEN_DE_DISPOSITIVO', expiresAt: null };
  const target = readTarget();
  if (target && target.kind !== undefined && target.kind !== 'ERP_ACTIVE') return { renewed: false, reason: 'ERP_NO_ACTIVO', expiresAt: null };
  const deviceId = credentials.deviceId || null;
  const terminalId = credentials.erpTerminalId || credentials.terminalId || target?.terminalId || null;
  const tenantId = credentials.erpTenantId || credentials.tenantId || null;
  if (!literal(deviceId) || !literal(terminalId)) return { renewed: false, reason: 'IDENTIDAD_DE_TERMINAL_NO_DISPONIBLE', expiresAt: null };
  let base: string;
  try { base = validatedLargeMasterSyncV3ErpSyncBase(String(target?.baseUrl || '')); } catch { return { renewed: false, reason: 'ERP_SIN_CONFIGURAR', expiresAt: null }; }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const snapshot = capture();
    const recoveryGuard = fiscalRecovery ? captureStaleTerminalAuthorization(snapshot) : null;
    const assertCurrent = () => {
      recoveryGuard?.();
      if (!recoveryGuard) return;
      const currentTarget = readTarget();
      if (currentTarget?.kind !== 'ERP_ACTIVE' || currentTarget.terminalId !== terminalId
        || validatedLargeMasterSyncV3ErpSyncBase(String(currentTarget.baseUrl || '')) !== base
        || resolveLocalDeviceId() !== deviceId) throw Error('SYNC_AUTH_SESSION_CHANGED');
    };
    if (recoveryGuard) {
      const bound = snapshot.credentials;
      if (!isCanonicalErpTerminalId(terminalId) || target?.terminalId !== terminalId || !literal(tenantId)
        || bound.identityMigrationRequired || (bound.erpTerminalId || bound.terminalId) !== terminalId
        || (bound.erpTenantId || bound.tenantId) !== tenantId || bound.deviceId !== deviceId
        || bound.deviceToken !== credentials.deviceToken || resolveLocalDeviceId() !== deviceId
        || new URL(base).protocol !== 'https:') throw Error('SYNC_AUTH_RECOVERY_SCOPE_REQUIRED');
      assertCurrent();
    }
    const response = await fetchImpl(`${base}/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Device-Id': deviceId,
        'X-Device-Token': credentials.deviceToken,
        'X-Terminal-Id': terminalId,
      },
      body: JSON.stringify({ terminalId, deviceId }),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    let data: any = null;
    try { data = await response.json(); } catch { data = null; }
    if (response.status !== 200) return { renewed: false, reason: String(data?.code || data?.error || `HTTP_${response.status}`), expiresAt: null };
    if (!data || data.status !== 'AUTHORIZED' || data.success !== true) return { renewed: false, reason: String(data?.code || 'RESPUESTA_DE_SESION_INVALIDA'), expiresAt: null };
    if (recoveryGuard) {
      const matches = (names: string[], expected: string | null) => {
        const values = names.filter(name => Object.hasOwn(data, name)).map(name => data[name]);
        return values.length > 0 && values.every(value => value === expected);
      };
      if (response.redirected || !matches(['terminalId', 'terminal_id', 'erpTerminalId', 'erp_terminal_id'], terminalId)
        || !matches(['deviceId', 'device_id'], deviceId) || !matches(['tenantId', 'tenant_id'], tenantId))
        throw Error('SYNC_AUTH_RECOVERY_SCOPE_MISMATCH');
      if (Object.hasOwn(data, 'bindingEvidence')) throw Error('SYNC_AUTH_BINDING_PROJECTION_REQUIRED');
    }
    const token = typeof data.token === 'string' ? data.token : typeof data.syncToken === 'string' ? data.syncToken : '';
    if (!literal(token)) return { renewed: false, reason: 'SESION_SIN_TOKEN', expiresAt: null };
    const declared = typeof data.tokenExpiresAt === 'string' ? data.tokenExpiresAt : null;
    if (declared !== null && (!Number.isFinite(Date.parse(declared)) || Date.parse(declared) <= Date.now())) return { renewed: false, reason: 'SESION_CON_FECHA_INVALIDA', expiresAt: null };
    await save(snapshot, {
      token,
      expiresAt: declared,
      ...(recoveryGuard ? { recoverStaleAuthorization: true as const } : {}),
      observation: {
        source: 'LOCAL_OBSERVATION_OF_ERP_SYNC_AUTH',
        origin: new URL(base).origin,
        route: '/api/sync/auth',
        tenantId: tenantId || '',
        terminalId,
        deviceId,
        observedAt: new Date().toISOString(),
      },
    }, assertCurrent);
    return { renewed: true, reason: recoveryGuard ? 'AUTHORIZATION_RECOVERED' : 'OK', expiresAt: declared };
  } catch (error) {
    return { renewed: false, reason: error instanceof Error ? (error.name === 'AbortError' ? 'TIEMPO_DE_ESPERA_AGOTADO' : error.message) : String(error), expiresAt: null };
  } finally { clearTimeout(timer); }
};

/** Explicit recovery waits for a session-only request already in progress. */
const renewSingleFlight = (ports: SessionRenewalPorts, fiscalRecovery: boolean): Promise<SessionRenewalResult> => {
  if (inFlight) {
    if (!fiscalRecovery || inFlight.fiscalRecovery) return inFlight.promise;
    return inFlight.promise.then(() => renewSingleFlight(ports, true));
  }
  const promise = renew(ports, fiscalRecovery).finally(() => { inFlight = null; });
  inFlight = { fiscalRecovery, promise };
  return promise;
};

export const renewTerminalSession = (ports: SessionRenewalPorts = {}) => renewSingleFlight(ports, false);
export const renewFiscalTerminalSession = (ports: SessionRenewalPorts = {}) => renewSingleFlight(ports, true);
