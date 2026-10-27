import { readLargeMasterSyncV3BoundIdentity, validatedLargeMasterSyncV3ErpSyncBase } from './LargeMasterSyncV3BoundTransport';
import { captureTerminalSessionSnapshot, saveTerminalSessionCAS, readTerminalCredentialsSync } from './TerminalCredentialStore';

export type SessionRenewalResult = {
  renewed: boolean;
  reason: string;
  expiresAt: string | null;
};

let inFlight: Promise<SessionRenewalResult> | null = null;

type RenewalPorts = {
  identity?: typeof readLargeMasterSyncV3BoundIdentity;
  credentials?: () => ReturnType<typeof readTerminalCredentialsSync>;
  capture?: typeof captureTerminalSessionSnapshot;
  save?: typeof saveTerminalSessionCAS;
  fetchImpl?: typeof fetch;
};

const literal = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.trim() === value && !/[\r\n\t]/.test(value);

/**
 * Renews the terminal session against the ERP with the paired device token.
 * It never re-pairs the device: the device token and every binding derived from it stay
 * untouched, so the offline fiscal reserve survives. The ERP decides the session lifetime;
 * an answer without a date is stored as an open-ended session.
 */
const renew = async (ports: RenewalPorts = {}): Promise<SessionRenewalResult> => {
  const readIdentity = ports.identity || readLargeMasterSyncV3BoundIdentity;
  const fetchImpl = ports.fetchImpl || fetch;
  const save = ports.save || saveTerminalSessionCAS;
  const capture = ports.capture || captureTerminalSessionSnapshot;
  const credentials = (ports.credentials || readTerminalCredentialsSync)();
  if (!literal(credentials.deviceToken)) return { renewed: false, reason: 'SIN_TOKEN_DE_DISPOSITIVO', expiresAt: null };
  let identity;
  try { identity = readIdentity(); } catch { return { renewed: false, reason: 'IDENTIDAD_DE_TERMINAL_NO_DISPONIBLE', expiresAt: null }; }
  let base: string;
  try { base = validatedLargeMasterSyncV3ErpSyncBase(identity.erpSyncBaseUrl); } catch { return { renewed: false, reason: 'ERP_SIN_CONFIGURAR', expiresAt: null }; }
  const snapshot = capture();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(`${base}/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Device-Id': identity.deviceId,
        'X-Device-Token': credentials.deviceToken,
        'X-Terminal-Id': identity.terminalId,
      },
      body: JSON.stringify({ terminalId: identity.terminalId, deviceId: identity.deviceId }),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    let data: any = null;
    try { data = await response.json(); } catch { data = null; }
    if (response.status !== 200) return { renewed: false, reason: String(data?.code || data?.error || `HTTP_${response.status}`), expiresAt: null };
    if (!data || data.status !== 'AUTHORIZED' || data.success !== true) return { renewed: false, reason: String(data?.code || 'RESPUESTA_DE_SESION_INVALIDA'), expiresAt: null };
    const token = typeof data.token === 'string' ? data.token : typeof data.syncToken === 'string' ? data.syncToken : '';
    if (!literal(token)) return { renewed: false, reason: 'SESION_SIN_TOKEN', expiresAt: null };
    const declared = typeof data.tokenExpiresAt === 'string' ? data.tokenExpiresAt : null;
    if (declared !== null && (!Number.isFinite(Date.parse(declared)) || Date.parse(declared) <= Date.now())) return { renewed: false, reason: 'SESION_CON_FECHA_INVALIDA', expiresAt: null };
    await save(snapshot, {
      token,
      expiresAt: declared,
      observation: {
        source: 'LOCAL_OBSERVATION_OF_ERP_SYNC_AUTH',
        origin: new URL(base).origin,
        route: '/api/sync/auth',
        tenantId: identity.tenantId,
        terminalId: identity.terminalId,
        deviceId: identity.deviceId,
        observedAt: new Date().toISOString(),
      },
    }, () => undefined);
    return { renewed: true, reason: 'OK', expiresAt: declared };
  } catch (error) {
    return { renewed: false, reason: error instanceof Error ? (error.name === 'AbortError' ? 'TIEMPO_DE_ESPERA_AGOTADO' : error.message) : String(error), expiresAt: null };
  } finally { clearTimeout(timer); }
};

/** Single-flight: two recoveries never race for the same terminal session. */
export const renewTerminalSession = (ports: RenewalPorts = {}): Promise<SessionRenewalResult> => {
  if (inFlight) return inFlight;
  inFlight = renew(ports).finally(() => { inFlight = null; });
  return inFlight;
};
