import type { BusinessConfig } from '../../types';
import { resolveServingTerminalFromConfig } from '../../utils/masterServerEligibility';

export const CLIENT_BINDING_RECOVERY_KEY = 'clic_client_binding_recovery_v1';

export interface ClientBindingRecoveryState {
  version: 1;
  status: 'BIND_ACKED_RESTORE_PENDING';
  authorityUrl: string;
  authorityFingerprint: string;
  masterTerminalId: string;
  terminalId: string;
  deviceId: string;
  tenantId: string;
  companyId: string;
  storeId: string;
  ackAt: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const normalized = (value: unknown): string => String(value || '').trim();
const lower = (value: unknown): string => normalized(value).toLowerCase();

const terminalIdentity = (terminal: Record<string, any> | null): string => {
  const config = terminal?.config || {};
  const binding = config.erpBinding || {};
  return normalized(binding.terminalId || binding.terminal_id || config.erpTerminalId || terminal?.erpTerminalId || terminal?.id);
};

const scope = (remote: Record<string, any>, field: 'tenant' | 'company' | 'store'): string => {
  const serving = resolveServingTerminalFromConfig(remote) as Record<string, any> | null;
  const sources = [serving?.config?.erpBinding, serving, remote.masterSetupContext, remote, remote.metadata?.syncProfile];
  for (const source of sources) {
    const value = normalized(source?.[`${field}Id`] || source?.[`${field}_id`]);
    if (value) return value;
  }
  return '';
};

export const resolveClientBindingExpectedScope = (input: {
  terminal: Record<string, any>;
  authority: Record<string, any>;
  tenantId?: string;
}): { tenantId: string; companyId: string; storeId: string; erpManaged: boolean } => {
  const terminal = input.terminal || {};
  const config = terminal.config || {};
  const binding = config.erpBinding || {};
  const context = input.authority?.masterSetupContext || {};
  const erpManaged = context.erpEnabled === true || context.erp_enabled === true;
  const resolved = {
    tenantId: normalized(terminal.tenantId || terminal.tenant_id || binding.tenantId || binding.tenant_id || input.tenantId || scope(input.authority, 'tenant')),
    companyId: normalized(terminal.companyId || terminal.company_id || binding.companyId || binding.company_id || scope(input.authority, 'company')),
    storeId: normalized(terminal.storeId || terminal.store_id || binding.storeId || binding.store_id || scope(input.authority, 'store')),
    erpManaged,
  };
  if (erpManaged && (!resolved.tenantId || !resolved.companyId || !resolved.storeId)) {
    throw new Error('MASTER_SCOPE_REQUIRED: la autoridad ERP no publicó tenant/company/store completos.');
  }
  return resolved;
};

export const resolveMasterAuthorityIdentity = (remote: Record<string, any>): string =>
  terminalIdentity(resolveServingTerminalFromConfig(remote) as Record<string, any> | null);

export const createMasterAuthorityFingerprint = (remote: Record<string, any>): string => {
  const runtimeId = lower(remote.runtimeTerminalId || remote.runtime_terminal_id || remote.runtime?.terminalId || remote.runtime?.terminal_id);
  return [runtimeId, lower(resolveMasterAuthorityIdentity(remote)), lower(scope(remote, 'tenant')), lower(scope(remote, 'company')), lower(scope(remote, 'store'))].join('|');
};

export const validateClientBindingAck = (input: {
  response: Record<string, any>;
  terminalId: string;
  deviceId: string;
  masterTerminalId: string;
  tenantId?: string;
  companyId?: string;
  storeId?: string;
}): BusinessConfig => {
  const { response } = input;
  if (response.success !== true) {
    throw new Error('BIND_ACK_SUCCESS_REQUIRED: la Maestra no confirmó el vínculo.');
  }
  if (normalized(response.terminal_id) !== normalized(input.terminalId)) {
    throw new Error('BIND_ACK_TERMINAL_MISMATCH: terminal_id no coincide con la terminal seleccionada.');
  }
  if (lower(response.master_terminal_id) !== lower(input.masterTerminalId)) {
    throw new Error('BIND_ACK_MASTER_MISMATCH: master_terminal_id no coincide con la autoridad validada.');
  }
  if (normalized(response.current_device_id || response.currentDeviceId) !== normalized(input.deviceId)) {
    throw new Error('BIND_ACK_DEVICE_MISMATCH: la Maestra confirmó otro dispositivo.');
  }
  const config = response.config as BusinessConfig | undefined;
  const terminal = config?.terminals?.find((entry: any) => normalized(entry.id) === normalized(input.terminalId));
  if (!terminal) throw new Error('BIND_ACK_TERMINAL_MISSING: la configuración confirmada no contiene la terminal cliente.');
  if (normalized(terminal.config?.currentDeviceId) !== normalized(input.deviceId)) {
    throw new Error('BIND_ACK_DEVICE_MISMATCH: currentDeviceId no coincide con este equipo.');
  }
  if (terminal.config?.isPrimaryNode !== false || terminal.config?.governedByMaster !== true) {
    throw new Error('BIND_ACK_ROLE_INVALID: la terminal confirmada no es cliente gobernada.');
  }
  const acknowledgedMasterId = normalized(terminal.config?.masterTerminalId || terminal.config?.master_terminal_id);
  if (!acknowledgedMasterId || lower(acknowledgedMasterId) !== lower(input.masterTerminalId)) {
    throw new Error('BIND_ACK_MASTER_MISMATCH: masterTerminalId no coincide con la autoridad validada.');
  }
  const binding = terminal.config?.erpBinding || {};
  for (const [field, expected] of [
    ['tenant', input.tenantId],
    ['company', input.companyId],
    ['store', input.storeId],
  ] as const) {
    const normalizedExpected = normalized(expected);
    if (!normalizedExpected) continue;
    const topLevel = normalized(response[`${field}_id`]);
    const embedded = normalized(binding[`${field}Id`] || binding[`${field}_id`] || (terminal as any)[`${field}Id`] || (terminal as any)[`${field}_id`]);
    if (topLevel !== normalizedExpected || embedded !== normalizedExpected) {
      throw new Error(`BIND_ACK_SCOPE_MISMATCH: ${field} no coincide con la selección local.`);
    }
  }
  return config;
};

export const readClientBindingRecovery = (storage: StorageLike = localStorage): ClientBindingRecoveryState | null => {
  try {
    const parsed = JSON.parse(storage.getItem(CLIENT_BINDING_RECOVERY_KEY) || 'null');
    return parsed?.version === 1 && parsed?.status === 'BIND_ACKED_RESTORE_PENDING' ? parsed : null;
  } catch {
    return null;
  }
};

export const persistClientBindingRecovery = (state: Omit<ClientBindingRecoveryState, 'version' | 'status' | 'ackAt'> & { ackAt?: string }, storage: StorageLike = localStorage): ClientBindingRecoveryState => {
  const next: ClientBindingRecoveryState = {
    version: 1,
    status: 'BIND_ACKED_RESTORE_PENDING',
    ...state,
    ackAt: state.ackAt || new Date().toISOString(),
  };
  storage.setItem(CLIENT_BINDING_RECOVERY_KEY, JSON.stringify(next));
  return next;
};

export const clearClientBindingRecovery = (storage: StorageLike = localStorage): void => {
  storage.removeItem(CLIENT_BINDING_RECOVERY_KEY);
};
