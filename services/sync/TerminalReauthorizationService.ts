import { readTerminalCredentialsSync } from './TerminalCredentialStore';
import { registerErpSyncTerminal } from '../../utils/erpSyncLifecycle';
import { resolveLocalDeviceId } from '../../utils/deviceRevocation';

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
  let note = '';
  try {
    const { dbAdapter } = await import('../db');
    const { readOfflineFiscalLocalAuthority } = await import('../fiscal/OfflineFiscalLeaseContext');
    const { fiscalWorkflowScopeKey } = await import('../fiscal/FiscalWorkflowV2Types');
    await dbAdapter.connect();
    const store = dbAdapter.fiscalWorkflowStore;
    const local = await readOfflineFiscalLocalAuthority().catch(() => null);
    if (!store || !local) return note;
    const scopeKey = fiscalWorkflowScopeKey(local.scope);
    const current = await store.currentCheckout(scopeKey).catch(() => null);
    if (current && current.offlineBindingHash !== local.bindingHash) {
      if (current.phase === 'PREPARED' && store.abandonOfflinePrepared) {
        await store.abandonOfflinePrepared(current).catch(() => undefined);
        note = ' Se descartó un cobro fiscal preparado de la vinculación anterior.';
      } else if (current.phase === 'EFFECT_POSSIBLE') {
        note = ' Hay un cobro con efecto posible de la vinculación anterior: revísalo antes de cobrar.';
      }
      await store.revokeOfflineLeases?.('*').catch(() => undefined);
    }
  } catch { /* best effort */ }
  return note;
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
    message: `Terminal reautorizada. ${fiscal}${staleNote}`,
    authStatus: updated.authStatus || null,
    expiresAt: updated.syncTokenExpiresAt || null,
  };
};
