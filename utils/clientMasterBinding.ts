import type { BusinessConfig } from '../types';

const value = (input: unknown): string => String(input || '').trim();

export const resolveClientMasterTerminalId = (
  config: BusinessConfig,
  localTerminalIds: Array<string | null | undefined>,
  candidates: Array<string | null | undefined> = [],
): string | undefined => {
  const localIds = new Set(localTerminalIds.map(value).filter(Boolean));
  const primary = (config.terminals || []).find(terminal => terminal?.config?.isPrimaryNode === true);
  const ordered = [
    ...candidates,
    primary?.config?.erpTerminalId,
    primary?.id,
  ].map(value).filter(Boolean);

  return ordered.find(candidate => !localIds.has(candidate));
};
