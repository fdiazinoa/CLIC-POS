import { readTerminalCredentialsSync } from './TerminalCredentialStore';
import { registerErpSyncTerminal } from '../../utils/erpSyncLifecycle';
import { resolveLocalDeviceId } from '../../utils/deviceRevocation';
import { renewTerminalSession } from './TerminalSessionRenewal';

export type TerminalReauthorizationResult = {
  ok: boolean;
  message: string;
  authStatus?: string | null;
  expiresAt?: string | null;
};

const EXPIRY_SKEW_MS = 10 * 60_000;

/**
 * A prepared checkout (or lease) created under a previous terminal binding can never
 * reconcile. This retires it and revokes the stale leases so a fresh authority can be
 * issued. Safe to run on every boot: it is a no-op when the binding is unchanged.
 */
export const reconcileStaleFiscalCheckout = async (): Promise<string> => {
  try {
    const { dbAdapter } = await import('../db');
    await dbAdapter.connect();
    if (!dbAdapter.fiscalWorkflowStore) return '';
    const { readOfflineFiscalLocalAuthority } = await import('../fiscal/OfflineFiscalLeaseContext');
    const { fiscalWorkflowV2Client } = await import('../fiscal/FiscalWorkflowV2Client');
    const info = await fiscalWorkflowV2Client.pendingCheckoutInfo();
    if (!info) return '';
    const local = await readOfflineFiscalLocalAuthority().catch(() => null);
    // A checkout that still matches the local authority is handled by the checkout flow itself,
    // where the current cart proves whether it can be resumed.
    if (local && info.offlineBindingHash === local.bindingHash) return '';
    const outcome = await fiscalWorkflowV2Client.cancelUnreconcilableAttempt({});
    return outcome.cancelled ? ` ${outcome.note}` : '';
  } catch { return ''; }
};

/** True when the stored pairing can no longer authorize ERP/fiscal calls. */
export const needsTerminalReauthorization = (): { required: boolean; reason: string } => {
  const credentials = readTerminalCredentialsSync();
  const status = String(credentials.authStatus || '').toUpperCase();
  if (!credentials.deviceToken) return { required: true, reason: 'Sin token de dispositivo' };
  if (!credentials.syncToken) return { required: true, reason: 'Sin token de sincronización' };
  if (['NEEDS_REAUTH', 'AUTH_ERROR', 'DEVICE_NOT_AUTHORIZED', 'BOUND_AUTH_MISMATCH'].includes(status)) {
    return { required: true, reason: credentials.lastAuthError || status };
  }
  const expiry = Date.parse(String(credentials.syncTokenExpiresAt || ''));
  if (Number.isFinite(expiry) && expiry <= Date.now() + EXPIRY_SKEW_MS) {
    return { required: true, reason: 'Token de sincronización vencido o por vencer' };
  }
  return { required: false, reason: '' };
};

/**
 * Re-registers this terminal against the ERP and prepares the fiscal offline authority.
 * It is the only path that stores fresh device/sync tokens on the device, so every
 * recovery (manual button or automatic on boot) funnels through here.
 */
export const reauthorizeTerminal = async (): Promise<TerminalReauthorizationResult> => {
  const credentials = readTerminalCredentialsSync();
  const deviceId = String(credentials.deviceId || resolveLocalDeviceId() || '').trim();
  const terminalId = String(credentials.erpTerminalId || credentials.terminalId || '').trim();
  if (!deviceId || !terminalId) {
    return { ok: false, message: 'La terminal no tiene identidad local para reautorizar (deviceId/terminalId).' };
  }
  try {
    const payload = await registerErpSyncTerminal({
      deviceId,
      terminalId,
      localTerminalId: credentials.terminalCode || credentials.stationNumber || terminalId,
      terminalName: credentials.terminalName || null,
      companyId: credentials.companyId || null,
      storeId: credentials.storeId || null,
      isPrimary: true,
    });
    if (!payload) return { ok: false, message: 'El ERP no devolvió la vinculación de la terminal.' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `No se pudo reautorizar la terminal: ${detail}` };
  }

  const staleNote = await reconcileStaleFiscalCheckout();
  // The register rotates the ERP-side session token, so the device must adopt the current one;
  // renewing here (never re-pairing) keeps the binding and the offline reserve intact.
  const session = await renewTerminalSession();
  const sessionNote = session.renewed
    ? (session.expiresAt ? `Sesión renovada hasta ${new Date(session.expiresAt).toLocaleString('es-DO')}.` : 'Sesión renovada sin vencimiento.')
    : `Sesión sin renovar: ${session.reason}.`;

  let fiscal = 'No se pudo preparar la reserva fiscal.';
  try {
    const { fiscalWorkflowV2Client } = await import('../fiscal/FiscalWorkflowV2Client');
    await fiscalWorkflowV2Client.discover().catch(() => undefined);
    await fiscalWorkflowV2Client.prepareOfflineAuthority();
    const readiness = await fiscalWorkflowV2Client.offlineReadiness();
    fiscal = readiness.reason === 'READY_V1' || readiness.reason === 'READY_ALLOCATION'
      ? 'Reserva fiscal local preparada.'
      : `Reserva fiscal: ${readiness.code || readiness.reason}.`;
  } catch (error) {
    fiscal = `Reserva fiscal pendiente: ${error instanceof Error ? error.message : String(error)}.`;
  }

  const updated = readTerminalCredentialsSync();
  return {
    ok: true,
    message: `Terminal reautorizada. ${sessionNote} ${fiscal}${staleNote}`,
    authStatus: updated.authStatus || null,
    expiresAt: updated.syncTokenExpiresAt || null,
  };
};
