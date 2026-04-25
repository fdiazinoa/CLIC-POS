import { BusinessConfig } from '../types';

export interface TerminalSnapshotSeller {
  id: string;
  name: string;
  code?: string;
  email?: string;
  roleName?: string;
}

const asObject = (value: unknown): Record<string, any> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
);

const asArray = <T = any>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);
const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const sellerIdentity = (seller: Record<string, any>): string => {
  return [
    asString(seller.id),
    asString(seller.code),
    asString(seller.email).toLowerCase(),
    asString(seller.name).toLowerCase(),
  ].find(Boolean) || '';
};

const getTerminalSnapshotCandidates = (config: BusinessConfig, terminalId?: string | null): Record<string, any>[] => {
  const terminal = (config.terminals || []).find((entry) => entry.id === terminalId) || (config.terminals || [])[0];
  const snapshots = [
    asObject(terminal?.config?.erpSnapshot),
    asObject(terminalId ? config.terminalSnapshots?.[terminalId] : null),
  ];

  return snapshots.filter((snapshot) => Object.keys(snapshot).length > 0);
};

export const getTerminalSnapshotSellers = (
  config: BusinessConfig,
  terminalId?: string | null
): TerminalSnapshotSeller[] => {
  const sellers = getTerminalSnapshotCandidates(config, terminalId)
    .flatMap((snapshot) => asArray<Record<string, any>>(asObject(snapshot.masters).sellers));

  const seen = new Set<string>();
  const normalized: TerminalSnapshotSeller[] = [];

  sellers.forEach((seller) => {
    const identity = sellerIdentity(seller);
    const id = asString(seller.id || seller.code || seller.email || seller.name);
    const name = asString(seller.name || seller.code || seller.email);

    if (!identity || !id || !name || seen.has(identity)) {
      return;
    }

    seen.add(identity);
    normalized.push({
      id,
      name,
      code: asString(seller.code) || undefined,
      email: asString(seller.email) || undefined,
      roleName: asString(seller.role_name || seller.roleName) || undefined,
    });
  });

  return normalized;
};

export const resolveTerminalSellerName = (
  salespersonId: string | undefined | null,
  config: BusinessConfig,
  terminalId?: string | null,
  fallbackUsers?: Array<{ id: string; name?: string | null }>
): string | null => {
  const id = asString(salespersonId);
  if (!id) return null;

  const userMatch = (fallbackUsers || []).find((user) => asString(user?.id) === id);
  if (userMatch?.name) {
    return userMatch.name.trim();
  }

  const sellerMatch = getTerminalSnapshotSellers(config, terminalId).find((seller) => seller.id === id);
  return sellerMatch?.name || null;
};
