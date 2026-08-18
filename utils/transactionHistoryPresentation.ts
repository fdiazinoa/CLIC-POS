import { BusinessConfig, CartItem, Transaction } from '../types';

type HistoryTerminal = BusinessConfig['terminals'][number] & {
  name?: string;
};

const normalize = (value: unknown): string => String(value || '').trim();
const normalizeKey = (value: unknown): string => normalize(value).toLowerCase();

const terminalAliases = (terminal: HistoryTerminal): string[] => [
  terminal.id,
  terminal.name,
  terminal.config?.terminalName,
  terminal.config?.stationNumber,
  terminal.config?.erpTerminalId,
  terminal.config?.erpBinding?.terminalId,
  terminal.config?.erpBinding?.terminalName,
  (terminal.config as any)?.terminalId,
  (terminal.config as any)?.localTerminalId,
].map(normalize).filter(Boolean);

export const resolveHistoryTerminalName = (
  transaction: Pick<Transaction, 'terminalId' | 'terminalName'>,
  terminals: HistoryTerminal[] = []
): string => resolveTerminalDisplayName(transaction.terminalId, terminals, transaction.terminalName);

export const resolveTerminalDisplayName = (
  terminalId: unknown,
  terminals: HistoryTerminal[] = [],
  persistedTerminalName?: unknown,
): string => {
  const persistedName = normalize(persistedTerminalName);
  if (persistedName) return persistedName;
  const requested = normalizeKey(terminalId);
  const match = terminals.find(terminal =>
    terminalAliases(terminal).some(alias => normalizeKey(alias) === requested)
  );
  if (!match) return normalize(terminalId) || 'N/D';

  return [
    match.config?.terminalName,
    match.config?.erpBinding?.terminalName,
    match.name,
    match.config?.stationNumber,
  ].map(normalize).find(Boolean) || normalize(terminalId) || 'N/D';
};

const resolveLineDiscount = (item: CartItem): number => {
  const quantity = Math.abs(Number(item.quantity || 0));
  const originalPrice = Number((item as any).originalPrice);
  const price = Number(item.price || 0);
  if (!Number.isFinite(originalPrice) || originalPrice <= price) return 0;
  return (originalPrice - price) * quantity;
};

export const resolveHistoryDiscountTotal = (
  transaction: Pick<Transaction, 'discountAmount' | 'items'>
): number => {
  const persisted = Number(transaction.discountAmount || 0);
  if (Number.isFinite(persisted) && persisted > 0) return persisted;
  return (transaction.items || []).reduce((total, item) => total + resolveLineDiscount(item), 0);
};
