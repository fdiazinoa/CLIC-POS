import type { BusinessConfig } from '../types';

const value = (input: unknown): string => String(input || '').trim();

export const resolveClientMasterTerminalId = (
  config: BusinessConfig,
  localTerminalIds: Array<string | null | undefined>,
  candidates: Array<string | null | undefined> = [],
): string | undefined => {
  const localIds = new Set(localTerminalIds.map(value).filter(Boolean));
  const primary = (config.terminals || []).find(terminal => terminal?.config?.isPrimaryNode === true);
  if (!primary) return undefined;
  const primaryIds = new Set([
    primary.config?.erpTerminalId,
    primary.id,
  ].map(value).filter(Boolean));
  const corroboratedCandidate = candidates.map(value).find(candidate => primaryIds.has(candidate));

  return [corroboratedCandidate, primary.config?.erpTerminalId, primary.id]
    .map(value)
    .find(candidate => candidate && primaryIds.has(candidate) && !localIds.has(candidate));
};
