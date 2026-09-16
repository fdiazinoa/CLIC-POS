/** Read-only display: never substitute a station default for the active identity. */
export const resolveTerminalLoginLabel = (terminal?: Record<string, any> | null): string => {
  const cfg = terminal?.config || {};
  const candidates = [terminal?.terminalCode, cfg.erpBinding?.terminalName, terminal?.label, terminal?.name, cfg.erpTerminalId, terminal?.id];
  return candidates.map(value => typeof value === 'string' ? value.trim() : '').find(Boolean) || 'Sin identificar';
};
