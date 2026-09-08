import type { Transaction, ZReport } from '../../types';

type ReportWithMembers = Pick<ZReport, 'id'> & {
  recoveryMemberIds?: {
    transactions?: string[];
  };
};

const normalizeId = (value: unknown): string => String(value || '').trim();

export const collectClosedTransactionIds = (
  history: Array<Pick<Transaction, 'id' | 'zReportId'>> = [],
  reports: ReportWithMembers[] = [],
): Set<string> => {
  const closed = new Set<string>();

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
