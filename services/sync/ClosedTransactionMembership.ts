import type { Transaction, ZReport } from '../../types';

type ReportWithMembers = Pick<ZReport, 'id'> & {
  recoveryMemberIds?: {
    transactions?: string[];
  };
};

const normalizeId = (value: unknown): string => String(value || '').trim();
const closingTransactionIds = new Set<string>();

export const reserveClosingTransactionIds = (ids: string[]): void => {
  ids.forEach((value) => {
    const id = normalizeId(value);
    if (id) closingTransactionIds.add(id);
  });
};

export const releaseClosingTransactionIds = (ids: string[]): void => {
  ids.forEach((value) => closingTransactionIds.delete(normalizeId(value)));
};

export const isTransactionReservedForClose = (id: string): boolean =>
  closingTransactionIds.has(normalizeId(id));

export const collectClosedTransactionIds = (
  history: Array<Pick<Transaction, 'id' | 'zReportId'>> = [],
  reports: ReportWithMembers[] = [],
): Set<string> => {
  const closed = new Set<string>();

  closingTransactionIds.forEach((id) => closed.add(id));

  history.forEach((transaction) => {
    const id = normalizeId(transaction?.id);
    if (id && normalizeId(transaction?.zReportId)) closed.add(id);
  });

  reports.forEach((report) => {
    (report?.recoveryMemberIds?.transactions || []).forEach((memberId) => {
      const id = normalizeId(memberId);
      if (id) closed.add(id);
    });
  });

  return closed;
};

export const partitionTransactionsByClosedMembership = (
  transactions: Transaction[] = [],
  closedIds: Set<string>,
): { open: Transaction[]; closed: Transaction[] } => {
  const open: Transaction[] = [];
  const closed: Transaction[] = [];
  const seen = new Set<string>();

  transactions.forEach((transaction) => {
    const id = normalizeId(transaction?.id);
    if (!id || seen.has(id)) return;
    seen.add(id);

    if (closedIds.has(id) || normalizeId(transaction?.zReportId)) {
      closed.push(transaction);
      return;
    }
    open.push(transaction);
  });

  return { open, closed };
};

type PersistInboundDependencies = {
  loadHistory: () => Promise<Transaction[]>;
  loadReports: () => Promise<ZReport[]>;
  saveActive: (transaction: Transaction) => Promise<void>;
  deleteActive: (transactionId: string) => Promise<void>;
};

type ReconcilePreviewDependencies = {
  loadHistory: () => Promise<Transaction[]>;
  loadReports: () => Promise<ZReport[]>;
  deleteActive: (transactionId: string) => Promise<void>;
};

type ReconcilePreviewScope = {
  terminalIds?: string[];
};

export type ReconcilePreviewResult = {
  transactions: Transaction[];
  removedClosed: Transaction[];
  closedIds: Set<string>;
  lastClosedDocumentId?: string;
};

type DocumentSequence = {
  prefix: string;
  number: number;
  reference: string;
};

const parseDocumentSequence = (value: unknown): DocumentSequence | null => {
  const reference = normalizeId(value);
  const match = reference.match(/^(.*?)(\d+)$/);
  if (!match) return null;
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number)) return null;
  return { prefix: match[1].toUpperCase(), number, reference };
};

const reportLastTicketId = (report: ZReport): string => {
  const raw = report as ZReport & Record<string, any>;
  return normalizeId(
    raw.sync_audit?.last_ticket_id
    || raw.syncAudit?.last_ticket_id
    || raw.syncAudit?.lastTicketId,
  );
};

const transactionDisplayId = (transaction: Transaction): string =>
  normalizeId(transaction.displayId || transaction.source_display_id || transaction.id);

const belongsToTerminal = (record: Record<string, any>, terminalIds: Set<string>): boolean => {
  if (terminalIds.size === 0) return true;
  return [record.terminalId, record.source_terminal_id]
    .map(value => normalizeId(value).toLowerCase())
    .some(value => value && terminalIds.has(value));
};

/**
 * Removes closed copies from the active projection before the cashier reviews
 * a Z. Historical rows and Z manifests remain the immutable membership proof.
 */
export const reconcileTransactionsForZPreview = async (
  active: Transaction[],
  dependencies: ReconcilePreviewDependencies,
  scope: ReconcilePreviewScope = {},
): Promise<ReconcilePreviewResult> => {
  const [history, reports] = await Promise.all([
    dependencies.loadHistory(),
    dependencies.loadReports(),
  ]);
  const closedIds = collectClosedTransactionIds(history, reports);
  const terminalIds = new Set((scope.terminalIds || []).map(value => normalizeId(value).toLowerCase()).filter(Boolean));
  const closedDocumentSequences = [
    ...history
      .filter(transaction => normalizeId(transaction.zReportId) && belongsToTerminal(transaction, terminalIds))
      .map(transactionDisplayId),
    ...reports
      .filter(report => belongsToTerminal(report as ZReport & Record<string, any>, terminalIds))
      .map(reportLastTicketId),
  ]
    .map(parseDocumentSequence)
    .filter((value): value is DocumentSequence => Boolean(value));
  const lastByPrefix = new Map<string, DocumentSequence>();
  closedDocumentSequences.forEach(sequence => {
    const previous = lastByPrefix.get(sequence.prefix);
    if (!previous || sequence.number > previous.number) lastByPrefix.set(sequence.prefix, sequence);
  });

  const closedByDocumentCut = new Set<string>();
  active.forEach(transaction => {
    if (!belongsToTerminal(transaction, terminalIds)) return;
    const sequence = parseDocumentSequence(transactionDisplayId(transaction));
    const lastClosed = sequence ? lastByPrefix.get(sequence.prefix) : undefined;
    if (lastClosed && sequence!.number <= lastClosed.number) {
      closedByDocumentCut.add(transaction.id);
    }
  });
  const effectiveClosedIds = new Set([...closedIds, ...closedByDocumentCut]);
  const partition = partitionTransactionsByClosedMembership(active, effectiveClosedIds);

  for (const transaction of partition.closed) {
    await dependencies.deleteActive(transaction.id);
  }

  return {
    transactions: partition.open,
    removedClosed: partition.closed,
    closedIds: effectiveClosedIds,
    lastClosedDocumentId: [...lastByPrefix.values()]
      .sort((left, right) => right.number - left.number)[0]?.reference,
  };
};

export type PersistInboundResult = {
  accepted: Transaction[];
  skippedClosed: Transaction[];
  closedIds: Set<string>;
};

/**
 * Persists transactions received from another POS without reopening documents
 * that already belong to a local Z. Membership is checked again after writes
 * so a close that completes concurrently wins over the inbound copy.
 */
export const persistInboundTransactionsIfOpen = async (
  incoming: Transaction[],
  dependencies: PersistInboundDependencies,
): Promise<PersistInboundResult> => {
  const [historyBefore, reportsBefore] = await Promise.all([
    dependencies.loadHistory(),
    dependencies.loadReports(),
  ]);
  const closedBefore = collectClosedTransactionIds(historyBefore, reportsBefore);
  const initial = partitionTransactionsByClosedMembership(incoming, closedBefore);

  for (const transaction of initial.open) {
    await dependencies.saveActive(transaction);
  }

  const [historyAfter, reportsAfter] = await Promise.all([
    dependencies.loadHistory(),
    dependencies.loadReports(),
  ]);
  const closedAfter = collectClosedTransactionIds(historyAfter, reportsAfter);
  const final = partitionTransactionsByClosedMembership(initial.open, closedAfter);

  for (const transaction of final.closed) {
    await dependencies.deleteActive(transaction.id);
  }

  return {
    accepted: final.open,
    skippedClosed: [...initial.closed, ...final.closed],
    closedIds: closedAfter,
  };
};
