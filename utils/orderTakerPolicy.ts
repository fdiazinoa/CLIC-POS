export const ORDER_TAKER_TERMINAL_TYPE = 'ORDER_TAKER' as const;
export const STANDARD_POS_TERMINAL_TYPE = 'STANDARD_POS' as const;

export type PosTerminalType =
  | typeof ORDER_TAKER_TERMINAL_TYPE
  | typeof STANDARD_POS_TERMINAL_TYPE;

const asObject = (value: unknown): Record<string, any> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
);

const normalizeType = (value: unknown): string => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

export const resolveTerminalType = (...candidates: unknown[]): PosTerminalType => {
  for (const candidate of candidates) {
    const value = asObject(candidate);
    const normalized = normalizeType(
      Object.keys(value).length > 0
        ? value.terminalType
          ?? value.terminal_type
          ?? value.deviceRole
          ?? value.device_role
          ?? value.role
          ?? value.type
        : candidate
    );

    if ([
      'ORDER_TAKER',
      'ORDERTAKER',
      'ORDER_TAKING',
      'TOMA_PEDIDOS',
      'TOMA_DE_PEDIDOS',
      'WAITER_STATION',
      'MOBILE_ORDER',
    ].includes(normalized)) {
      return ORDER_TAKER_TERMINAL_TYPE;
    }

    if ([
      'STANDARD_POS',
      'STANDARDPOS',
      'POS',
      'POS_TERMINAL',
      'TERMINAL_POS',
      'CAJA',
    ].includes(normalized)) {
      return STANDARD_POS_TERMINAL_TYPE;
    }
  }

  return STANDARD_POS_TERMINAL_TYPE;
};

export const resolveTerminalTypeFromContract = (terminal: unknown): PosTerminalType => {
  const source = asObject(terminal);
  const config = asObject(source.config);
  const metadata = asObject(source.metadata ?? config.metadata);
  const terminalConfig = asObject(source.terminal_config ?? source.terminalConfig);
  const resolved = asObject(terminalConfig.resolved);
  const resolvedTerminal = asObject(resolved.terminal);
  const identity = asObject(resolved.identity);

  return resolveTerminalType(
    source,
    config,
    metadata,
    resolvedTerminal,
    identity,
    resolved
  );
};

export const isOrderTakerTerminal = (terminal: unknown): boolean => (
  resolveTerminalTypeFromContract(terminal) === ORDER_TAKER_TERMINAL_TYPE
);

export const isTerminalAllowedForBinding = (
  terminal: unknown,
  expectedType?: PosTerminalType | null,
  masterTerminalIds: Iterable<string> = []
): boolean => {
  if (!expectedType) return true;
  const actualType = resolveTerminalTypeFromContract(terminal);
  const typeAllowed = expectedType === ORDER_TAKER_TERMINAL_TYPE
    ? actualType === ORDER_TAKER_TERMINAL_TYPE
    : actualType !== ORDER_TAKER_TERMINAL_TYPE;
  if (!typeAllowed || expectedType !== ORDER_TAKER_TERMINAL_TYPE) return typeAllowed;

  const expectedMasters = new Set(Array.from(masterTerminalIds, (value) => String(value || '').trim()).filter(Boolean));
  const assignedMaster = resolveOrderTakerContract(terminal).masterTerminalId;
  return expectedMasters.size === 0 || !assignedMaster || expectedMasters.has(assignedMaster);
};

export const resolveOrderTakerContract = (terminal: unknown) => {
  const source = asObject(terminal);
  const config = asObject(source.config);
  const metadata = asObject(source.metadata ?? config.metadata);
  const masterTerminalId = String(
    source.masterTerminalId
    ?? source.master_terminal_id
    ?? config.masterTerminalId
    ?? config.master_terminal_id
    ?? metadata.masterTerminalId
    ?? metadata.master_terminal_id
    ?? ''
  ).trim();
  const capabilities = source.capabilities ?? config.capabilities ?? metadata.capabilities;
  const restrictions = source.restrictions ?? config.restrictions ?? metadata.restrictions;

  return {
    terminalType: resolveTerminalTypeFromContract(terminal),
    masterTerminalId: masterTerminalId || undefined,
    capabilities: Array.isArray(capabilities) ? capabilities.map(String) : [],
    restrictions: Array.isArray(restrictions) ? restrictions.map(String) : [],
  };
};
