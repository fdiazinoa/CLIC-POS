import { readTerminalCredentialsSync } from './TerminalCredentialStore';
import { registerErpSyncTerminal } from '../../utils/erpSyncLifecycle';
import { resolveLocalDeviceId } from '../../utils/deviceRevocation';
import { renewFiscalTerminalSession, renewTerminalSession } from './TerminalSessionRenewal';

export type TerminalReauthorizationResult = {
  ok: boolean;
  message: string;
  authStatus?: string | null;
  expiresAt?: string | null;
  /** Reauthorization was deliberately skipped because offline sales are still pending push. */
  deferred?: boolean;
  pendingPushEvents?: number;
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
    const store = dbAdapter.fiscalWorkflowStore;
    const info = await fiscalWorkflowV2Client.pendingCheckoutInfo();
    if (!info) return '';
    const local = await readOfflineFiscalLocalAuthority().catch(() => null);
    // A checkout that still matches the local authority is handled by the checkout flow itself,
    // where the current cart proves whether it can be resumed. Legacy hashes (older builds mixed the
    // rotating device token) are compatible when the local reserve proves the same fiscal identity.
    if (local) {
      const compatible = info.offlineBindingHash === local.bindingHash
        || Boolean(info.offlineBindingHash && store?.offlineBindingCompatible
          && await store.offlineBindingCompatible(info.offlineBindingHash, local).catch(() => false));
      if (compatible) return '';
    }
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
 * Prepares the fiscal offline authority. The fiscal diagnostic uses the existing
 * device token only and leaves attempt reconciliation to its separate workflow.
 */
export const reauthorizeTerminal = async (
  options: { reconcileFiscalSession?: boolean } = {},
): Promise<TerminalReauthorizationResult> => {
  const credentials = readTerminalCredentialsSync();
  const deviceId = String(credentials.deviceId || resolveLocalDeviceId() || '').trim();
  const terminalId = String(credentials.erpTerminalId || credentials.terminalId || '').trim();
  if (!deviceId || !terminalId) {
    return { ok: false, message: 'La terminal no tiene identidad local para reautorizar (deviceId/terminalId).' };
  }
  if (!options.reconcileFiscalSession) {
    // Registers change the ERP terminal projection, which revokes the offline lease backing any sale that
    // has not reached the ERP yet. Prioritize the pending offline outbox: renew only the session, drain it,
    // and if it cannot be drained do NOT rotate authority. That keeps confirmed sales pushable and turns an
    // eventual deadlock into an explicit, retryable message instead of an infinite retry loop.
    try {
      const { countPendingOfflineFiscalPush, drainPendingOfflineFiscalPush } = await import('./OfflineFiscalPushDrain');
      let pendingPush = await countPendingOfflineFiscalPush();
      if (pendingPush > 0) {
        await renewTerminalSession().catch(() => undefined);
        const drain = await drainPendingOfflineFiscalPush();
        pendingPush = drain.pending;
        if (!drain.drained) {
          return {
            ok: false,
            deferred: true,
            pendingPushEvents: pendingPush,
            message: `No se reautorizó: ${pendingPush} evento(s) de ventas offline siguen pendientes de empujar al ERP. Se prioriza el outbox y NO se rota la autoridad fiscal para no revocar la reserva que respalda esas ventas; reintenta en cuanto el outbox drene.`,
          };
        }
      }
    } catch { /* The guard is best effort; never block reauthorization on an unsupported adapter. */ }
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
  }

  const staleNote = options.reconcileFiscalSession ? '' : await reconcileStaleFiscalCheckout();
  const session = options.reconcileFiscalSession ? await renewFiscalTerminalSession() : await renewTerminalSession();
  if (options.reconcileFiscalSession && !session.renewed) {
    return { ok: false, message: `No se renovó la autorización fiscal: ${session.reason}.` };
  }
  const sessionNote = session.reason === 'AUTHORIZATION_RECOVERED'
    ? 'Autorización local reconciliada con el ERP.'
    : session.renewed
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
    const reason = error instanceof Error && 'bindingReason' in error ? ` (${error.bindingReason})` : '';
    fiscal = `Reserva fiscal pendiente: ${error instanceof Error ? error.message : String(error)}${reason}.`;
  }

  const updated = readTerminalCredentialsSync();
  return {
    ok: true,
    message: `${options.reconcileFiscalSession ? '' : 'Terminal reautorizada. '}${sessionNote} ${fiscal}${staleNote}`,
    authStatus: updated.authStatus || null,
    expiresAt: updated.syncTokenExpiresAt || null,
  };
};
