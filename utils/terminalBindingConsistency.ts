const asObject = (value: unknown): Record<string, any> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
);

const asString = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const readFirstString = (...values: unknown[]): string => {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) return normalized;
  }
  return '';
};

export const isGovernedClientTerminal = (
  configValue: unknown,
  terminalValue: unknown = {},
): boolean => {
  const config = asObject(configValue);
  const terminal = asObject(terminalValue);
  const terminalType = readFirstString(
    terminal.terminalType,
    terminal.terminal_type,
    config.terminalType,
    config.terminal_type,
    asObject(config.deviceRole).role,
  ).toUpperCase();
  const masterTerminalId = readFirstString(
    terminal.masterTerminalId,
    terminal.master_terminal_id,
    config.masterTerminalId,
    config.master_terminal_id,
  );

  return Boolean(masterTerminalId || terminalType === 'ORDER_TAKER');
};

type ClientTerminalBinding = {
  currentDeviceId?: string;
  isPrimaryNode: false;
  governedByMaster: true;
  syncConfig: Record<string, any> & {
    mode: 'SLAVE';
    isEnabled: true;
  };
  erpBinding?: Record<string, any> & {
    terminalId?: string;
    deviceId?: string;
  };
};

export const enforceClientTerminalBinding = <T extends Record<string, any>>(
  configValue: T,
  deviceIdInput?: string | null,
): T & ClientTerminalBinding => {
  const config = asObject(configValue);
  const currentDeviceId = readFirstString(deviceIdInput, config.currentDeviceId);
  const erpBinding = asObject(config.erpBinding);
  const erpTerminalId = readFirstString(
    erpBinding.terminalId,
    erpBinding.terminal_id,
    config.erpTerminalId,
    config.erp_terminal_id,
  );
  const shouldKeepErpBinding = Object.keys(erpBinding).length > 0 || Boolean(erpTerminalId);

  return {
    ...config,
    ...(currentDeviceId ? { currentDeviceId } : {}),
    isPrimaryNode: false,
    governedByMaster: true,
    syncConfig: {
      ...asObject(config.syncConfig),
      mode: 'SLAVE',
      isEnabled: true,
    },
    ...(shouldKeepErpBinding ? {
      erpBinding: {
        ...erpBinding,
        ...(erpTerminalId ? { terminalId: erpTerminalId } : {}),
        ...(currentDeviceId ? { deviceId: currentDeviceId } : {}),
      },
    } : {}),
  } as unknown as T & ClientTerminalBinding;
};
