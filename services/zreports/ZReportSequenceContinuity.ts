import type { DocumentSeries, ZReport } from '../../types';

export type ZSequenceContinuityEvidence = {
  version: 1;
  seriesId: string;
  prefix: string;
  terminalId: string;
  configuredNextNumber: number;
  selectedNumber: number;
  localHighWatermark: number | null;
  localReportIds: string[];
  erpRevision: string | null;
  erpHighWatermark: number | null;
};

const normalized = (value: unknown): string => String(value ?? '').trim().toUpperCase();

const positiveInteger = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

const nonNegativeInteger = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};

const nonNegativeIntegerString = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  return /^(0|[1-9][0-9]*)$/.test(text) && Number.isSafeInteger(Number(text))
    ? text
    : null;
};

const reportNumberForSeries = (report: ZReport, series: DocumentSeries): number | null => {
  const reportSeriesId = normalized(report.seriesId);
  const expectedSeriesId = normalized(series.id);
  const explicit = positiveInteger(report.seriesNumber);
  if (explicit && reportSeriesId && reportSeriesId === expectedSeriesId) return explicit;

  // The printed code is also a uniqueness boundary. Count legacy reports and
  // reassigned series that reused the same visible prefix.
  const prefix = String(series.prefix || '');
  const code = String(report.sequenceNumber || '');
  if (!prefix || !code.startsWith(prefix)) return null;
  const suffix = code.slice(prefix.length);
  return /^[0-9]+$/.test(suffix) ? positiveInteger(suffix) : null;
};

const reportBelongsToTerminal = (report: ZReport, terminalIds: Set<string>): boolean => {
  const ids = [report.terminalId, report.source_terminal_id]
    .map(normalized)
    .filter(Boolean);
  return ids.some((id) => terminalIds.has(id));
};

const erpAuthority = (series: DocumentSeries & Record<string, unknown>) => {
  const revision = nonNegativeIntegerString(
    series.sequenceRevision ?? series.sequence_revision ?? series.revision,
  );
  const highWatermark = nonNegativeInteger(
    series.lastCommittedNumber ?? series.last_committed_number ?? series.highWatermark,
  );
  return { revision, highWatermark };
};

/**
 * Returns a collision-free local lower bound. It never claims that a number is
 * globally available: ERP remains responsible for durable uniqueness/CAS.
 */
export const resolveZSequenceContinuity = (input: {
  series: DocumentSeries;
  reports: ZReport[];
  terminalIds: string[];
}): ZSequenceContinuityEvidence => {
  const terminalIds = new Set(input.terminalIds.map(normalized).filter(Boolean));
  const configuredNextNumber = positiveInteger(input.series.nextNumber);
  if (!configuredNextNumber) throw new Error('Z_SEQUENCE_CONFIG_INVALID');

  const localReports = input.reports
    .filter((report) => reportBelongsToTerminal(report, terminalIds))
    .map((report) => ({ report, number: reportNumberForSeries(report, input.series) }))
    .filter((entry): entry is { report: ZReport; number: number } => entry.number !== null);
  const localHighWatermark = localReports.length
    ? Math.max(...localReports.map((entry) => entry.number))
    : null;
  const authority = erpAuthority(input.series as DocumentSeries & Record<string, unknown>);
  const selectedNumber = Math.max(
    configuredNextNumber,
    (localHighWatermark ?? 0) + 1,
    (authority.highWatermark ?? 0) + 1,
  );

  return {
    version: 1,
    seriesId: input.series.id,
    prefix: input.series.prefix || '',
    terminalId: input.terminalIds[0] || '',
    configuredNextNumber,
    selectedNumber,
    localHighWatermark,
    localReportIds: localReports.map(({ report }) => report.id).sort(),
    erpRevision: authority.revision,
    erpHighWatermark: authority.highWatermark,
  };
};

/**
 * The authenticated ERP terminal snapshot is the authority for nextNumber.
 * Richer high-water evidence remains an additional monotonic guard when the
 * server publishes it, but its absence must not block an ERP-managed series.
 */
export const requireErpZSequenceAuthority = (
  series: DocumentSeries & Record<string, unknown>,
  evidence: ZSequenceContinuityEvidence,
): void => {
  if (normalized(series.source) !== 'ERP_TERMINAL_CONFIG') return;

  if (
    evidence.erpHighWatermark !== null &&
    evidence.configuredNextNumber <= evidence.erpHighWatermark
  ) {
    throw new Error('Z_SEQUENCE_AUTHORITY_STALE');
  }
};
