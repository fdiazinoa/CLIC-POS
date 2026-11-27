/**
 * Effective ERP binding identity.
 *
 * The ERP lifecycle effect in `App.tsx` owns the startup sync (`STARTUP`), the
 * heartbeat, the conditional terminal-config safety check and the outbox
 * polling. React re-runs that effect whenever one of its dependencies changes
 * identity, and every re-run re-arms the 8 s `STARTUP` timer.
 *
 * `configUpdated` snapshots always replace `config.terminals` with a brand new
 * array (and brand new terminal objects), even when the values are identical.
 * Depending on `getCurrentTerminal` therefore recreated the lifecycle effect on
 * every ordinary configuration refresh: `STARTUP` → manifest → forced config
 * fetch → `configUpdated` → new `STARTUP` every ~10 s.
 *
 * This module derives a primitive key that only changes when the effective
 * binding changes: tenant, local terminal, ERP terminal, device binding and the
 * terminal binding mode. Ordinary config snapshots keep the same key, while a
 * real re-binding (or a terminal switch) produces a different one.
 */

export interface ErpBindingTerminalLike {
  id?: string | null;
  name?: string | null;
  config?: {
    stationNumber?: string | number | null;
    terminalName?: string | null;
    erpTerminalId?: string | null;
    currentDeviceId?: string | null;
    isPrimaryNode?: boolean | null;
    erpBinding?: {
      terminalId?: string | null;
      tenantId?: string | null;
      stationNumber?: string | number | null;
      deviceId?: string | null;
    } | null;
    erpSnapshot?: {
      tenant_id?: string | null;
    } | null;
  } | null;
}

export interface ResolveErpBindingIdentityInput {
  /** Terminal resolved for the current device (may be missing before config loads). */
  terminal?: ErpBindingTerminalLike | null;
  /** Device identity used by the POS runtime. */
  deviceId?: string | null;
  /** Tenant persisted in the config snapshot (`config.metadata.tenantId`). */
  configTenantId?: string | null;
  /** Tenant stored by the activation/license flow. */
  storedTenantId?: string | null;
  /** Local terminal identifier stored by activation/pairing. */
  storedActiveTerminalId?: string | null;
  /** ERP terminal identifier stored by activation/pairing. */
  storedErpTerminalId?: string | null;
}

export interface ErpBindingIdentity {
  /** True when a terminal object was resolved for the current device. */
  bound: boolean;
  tenantId: string;
  /** Local terminal record id from the config snapshot. */
  terminalId: string;
  localTerminalId: string;
  erpTerminalId: string;
  deviceId: string;
  bindingMode: 'MASTER' | 'SLAVE' | '';
  /** Primitive key; stable across ordinary config snapshots. */
  key: string;
}

const ERP_BINDING_IDENTITY_KEY_PREFIX = 'erp-binding:v1';

const normalizeIdentityPart = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';

const firstNonEmpty = (...values: unknown[]): string => {
  for (const value of values) {
    const normalized = normalizeIdentityPart(value);
    if (normalized) return normalized;
  }
  return '';
};

/**
 * Resolves the effective binding identity of the terminal currently bound to
 * this device. Values are normalized to primitives so that identity comparison
 * never depends on object/array references.
 */
export function resolveErpBindingIdentity(
  input: ResolveErpBindingIdentityInput,
): ErpBindingIdentity {
  const terminal = input.terminal ?? null;
  const terminalConfig = terminal?.config ?? null;
  const binding = terminalConfig?.erpBinding ?? null;

  const terminalId = normalizeIdentityPart(terminal?.id);
  const bound = Boolean(terminalId);

  const tenantId = firstNonEmpty(
    binding?.tenantId,
    terminalConfig?.erpSnapshot?.tenant_id,
    input.configTenantId,
    input.storedTenantId,
  );

  const localTerminalId = firstNonEmpty(
    terminalConfig?.stationNumber,
    binding?.stationNumber,
    terminalConfig?.terminalName,
    terminal?.name,
    terminal?.id,
    input.storedActiveTerminalId,
  );

  const erpTerminalId = firstNonEmpty(
    binding?.terminalId,
    terminalConfig?.erpTerminalId,
    input.storedErpTerminalId,
  );

  const deviceId = firstNonEmpty(
    terminalConfig?.currentDeviceId,
    binding?.deviceId,
    input.deviceId,
  );

  const bindingMode: ErpBindingIdentity['bindingMode'] = terminal
    ? (terminalConfig?.isPrimaryNode === false ? 'SLAVE' : 'MASTER')
    : '';

  const key = [
    ERP_BINDING_IDENTITY_KEY_PREFIX,
    bound ? 'bound' : 'unbound',
    tenantId,
    terminalId,
    localTerminalId,
    erpTerminalId,
    deviceId,
    bindingMode,
    // Stored fallbacks keep the key deterministic while the config snapshot is
    // still loading: it changes once the terminal binding is resolved.
    normalizeIdentityPart(input.storedActiveTerminalId),
    normalizeIdentityPart(input.storedErpTerminalId),
  ].join('|');

  return {
    bound,
    tenantId,
    terminalId,
    localTerminalId,
    erpTerminalId,
    deviceId,
    bindingMode,
    key,
  };
}
