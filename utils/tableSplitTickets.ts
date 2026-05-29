import { ParkedTicket } from '../types';

const SPLIT_ACCOUNT_LABEL_RE = /Cuenta\s+(\d+)\s*\/\s*(\d+)/i;

export type SplitAccountMeta = { index: number; total: number };

export function getSplitAccountMeta(ticket: ParkedTicket): SplitAccountMeta | null {
  const haystack = `${ticket.alias || ''} ${ticket.name || ''}`;
  const match = haystack.match(SPLIT_ACCOUNT_LABEL_RE);
  if (!match) return null;
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(index) || !Number.isFinite(total) || index < 1 || total < 2) return null;
  return { index, total };
}

function isSplitSiblingTicket(ticket: ParkedTicket): boolean {
  return Boolean(getSplitAccountMeta(ticket)) || String(ticket.id || '').startsWith('split-');
}

/** Parked tickets that belong to the same mesa split (cuenta dividida). */
export function collectTableSplitTickets(
  tableId: string | number | undefined,
  parkedTickets: ParkedTicket[],
  primaryOrderId?: string
): ParkedTicket[] {
  if (tableId === undefined || tableId === null) return [];
  const tableKey = String(tableId);
  const related = (parkedTickets || []).filter(ticket => String(ticket.tableId ?? '') === tableKey);
  if (related.length === 0) return [];

  const splitSiblings = related.filter(isSplitSiblingTicket);
  if (related.length < 2 && splitSiblings.length === 0) return [];

  const uniqueById = new Map<string, ParkedTicket>();
  related.forEach(ticket => uniqueById.set(String(ticket.id), ticket));
  const unique = Array.from(uniqueById.values());

  return unique.sort((left, right) => {
    const leftMeta = getSplitAccountMeta(left);
    const rightMeta = getSplitAccountMeta(right);
    const leftIsPrimary = primaryOrderId ? String(left.id) === String(primaryOrderId) : false;
    const rightIsPrimary = primaryOrderId ? String(right.id) === String(primaryOrderId) : false;
    const leftRank = leftMeta?.index ?? (leftIsPrimary ? 1 : 100);
    const rightRank = rightMeta?.index ?? (rightIsPrimary ? 1 : 100);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return String(left.timestamp || '').localeCompare(String(right.timestamp || ''));
  });
}

export function formatSplitAccountPosition(position: number, total: number): string {
  return `${position}/${total}`;
}

export function buildSplitAccountLabel(baseName: string, index: number, splitCount: number): string {
  return `${baseName} - Cuenta ${index}/${splitCount}`;
}
