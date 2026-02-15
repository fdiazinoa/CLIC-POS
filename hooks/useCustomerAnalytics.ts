import { useMemo } from 'react';
import { Customer, Transaction } from '../types';

export interface CustomerAnalyticsFilters {
  warehouseId: string; // "ALL" for all warehouses
  startMs: number | null;
  endMs: number | null;
  searchTerm: string;
}

export interface CustomerLastItem {
  name: string;
  quantity: number;
  amount: number;
  date: string;
}

export interface CustomerAnalyticsRow {
  id: string;
  name: string;
  taxId: string;
  phone: string;
  recency: number;
  frequency: number;
  monetary: number;
  lastVisit: string;
  lastItems: CustomerLastItem[];
}

export interface CustomerAnalyticsSummary {
  ticketAverage: number;
  topCustomerName: string;
  newCustomers: number;
  totalSales: number;
  totalAmount: number;
}

interface UseCustomerAnalyticsParams {
  customers: Customer[];
  transactions: Transaction[];
  filters: CustomerAnalyticsFilters;
  terminalWarehouseMap?: Record<string, string>;
  fallbackWarehouseId?: string;
  now?: Date;
}

interface CustomerAccumulator {
  id: string;
  name: string;
  taxId: string;
  phone: string;
  lastVisitMs: number;
  firstVisitMs: number;
  frequency: number;
  monetary: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const normalize = (value: string): string => value.trim().toLowerCase();

const resolveTicketAmount = (tx: Transaction): number => {
  const net = Number(tx.netAmount);
  const tax = Number(tx.taxAmount);
  if (Number.isFinite(net) && Number.isFinite(tax)) {
    return net + tax;
  }
  const total = Number(tx.total || 0);
  return Number.isFinite(total) ? total : 0;
};

const isWithinRange = (
  time: number,
  startMs: number | null,
  endMs: number | null
): boolean => {
  if (!Number.isFinite(time)) return false;
  if (startMs !== null && time < startMs) return false;
  if (endMs !== null && time > endMs) return false;
  return true;
};

export const useCustomerAnalytics = ({
  customers,
  transactions,
  filters,
  terminalWarehouseMap = {},
  fallbackWarehouseId,
  now = new Date()
}: UseCustomerAnalyticsParams): { rows: CustomerAnalyticsRow[]; summary: CustomerAnalyticsSummary; isLoading: boolean } => {
  return useMemo(() => {
    const customerById = new Map<string, Customer>();
    (customers || []).forEach(customer => {
      customerById.set(customer.id, customer);
    });

    const terminalWarehouseById = new Map<string, string>();
    Object.entries(terminalWarehouseMap).forEach(([terminalId, warehouseId]) => {
      terminalWarehouseById.set(normalize(terminalId), warehouseId);
    });
    const inferredFallbackWarehouseId =
      fallbackWarehouseId ||
      (terminalWarehouseById.size === 1 ? Array.from(terminalWarehouseById.values())[0] : undefined);

    const customerStats = new Map<string, CustomerAccumulator>();
    const customerTransactions = new Map<string, Array<{ time: number; date: string; items: Transaction['items'] }>>();
    const periodSpentByCustomer = new Map<string, number>();

    let periodTotalAmount = 0;
    let periodTicketCount = 0;

    const resolveTxWarehouseId = (tx: Transaction): string | undefined => {
      const raw = tx as unknown as {
        warehouseId?: string;
        salesWarehouseId?: string;
        warehouse?: { id?: string };
        meta?: { warehouseId?: string };
      };
      const explicitWarehouseId =
        raw.warehouseId ||
        raw.salesWarehouseId ||
        raw.warehouse?.id ||
        raw.meta?.warehouseId;
      if (explicitWarehouseId) return explicitWarehouseId;

      if (tx.terminalId) {
        const mappedWarehouse = terminalWarehouseById.get(normalize(tx.terminalId));
        if (mappedWarehouse) return mappedWarehouse;
      }

      return inferredFallbackWarehouseId;
    };

    const resolveCustomerIdentity = (
      tx: Transaction
    ): { customerId: string; name: string; taxId: string; phone: string } | null => {
      const raw = tx as unknown as {
        customer?: { id?: string; name?: string; taxId?: string; phone?: string };
      };
      const snapshot: { name?: string; taxId?: string; phone?: string } = tx.customerSnapshot || {};
      const directCustomerId = tx.customerId || raw.customer?.id;
      const directName = tx.customerName || snapshot.name || raw.customer?.name;
      const fallbackCustomerId = directName
        ? `name:${normalize(directName)}`
        : snapshot.taxId
          ? `tax:${normalize(snapshot.taxId)}`
          : '';
      const customerId = directCustomerId || fallbackCustomerId;
      if (!customerId) return null;

      const master = directCustomerId ? customerById.get(directCustomerId) : undefined;
      return {
        customerId,
        name: master?.name || directName || 'Cliente',
        taxId: master?.taxId || snapshot.taxId || raw.customer?.taxId || '',
        phone: master?.phone || snapshot.phone || raw.customer?.phone || ''
      };
    };

    for (const tx of (transactions || [])) {
      if (tx.status === 'REFUNDED') continue;

      const txDate = tx.date || '';
      const time = new Date(txDate).getTime();
      if (!Number.isFinite(time)) continue;

      const txWarehouseId = resolveTxWarehouseId(tx);
      if (filters.warehouseId !== 'ALL' && txWarehouseId !== filters.warehouseId) continue;

      const customerIdentity = resolveCustomerIdentity(tx);
      if (!customerIdentity) continue;
      const customerId = customerIdentity.customerId;

      const current = customerStats.get(customerId) || {
        id: customerId,
        name: customerIdentity.name,
        taxId: customerIdentity.taxId,
        phone: customerIdentity.phone,
        lastVisitMs: time,
        firstVisitMs: time,
        frequency: 0,
        monetary: 0
      };

      current.lastVisitMs = Math.max(current.lastVisitMs, time);
      current.firstVisitMs = Math.min(current.firstVisitMs, time);
      if (!current.taxId && customerIdentity.taxId) current.taxId = customerIdentity.taxId;
      if (!current.phone && customerIdentity.phone) current.phone = customerIdentity.phone;
      if (!current.name && customerIdentity.name) current.name = customerIdentity.name;
      customerStats.set(customerId, current);

      const txList = customerTransactions.get(customerId) || [];
      txList.push({ time, date: txDate, items: tx.items || [] });
      customerTransactions.set(customerId, txList);

      if (isWithinRange(time, filters.startMs, filters.endMs)) {
        const amount = resolveTicketAmount(tx);
        current.frequency += 1;
        current.monetary += amount;
        periodTicketCount += 1;
        periodTotalAmount += amount;
        periodSpentByCustomer.set(customerId, (periodSpentByCustomer.get(customerId) || 0) + amount);
      }
    }

    const nowStartMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const latestItemsByCustomer = new Map<string, CustomerLastItem[]>();
    customerTransactions.forEach((txList, customerId) => {
      const ordered = [...txList].sort((a, b) => b.time - a.time);
      const items: CustomerLastItem[] = [];

      for (const tx of ordered) {
        for (const item of (tx.items || [])) {
          if (items.length >= 5) break;
          const qty = Number(item.quantity || 0);
          const price = Number(item.price || 0);
          items.push({
            name: item.name || item.id || 'Artículo',
            quantity: qty,
            amount: qty * price,
            date: tx.date
          });
        }
        if (items.length >= 5) break;
      }

      latestItemsByCustomer.set(customerId, items);
    });

    let topCustomerName = '-';
    let topSpent = -1;
    periodSpentByCustomer.forEach((amount, customerId) => {
      if (amount <= topSpent) return;
      topSpent = amount;
      topCustomerName = customerStats.get(customerId)?.name || '-';
    });

    let newCustomers = 0;
    customerStats.forEach(stat => {
      if (isWithinRange(stat.firstVisitMs, filters.startMs, filters.endMs)) {
        newCustomers += 1;
      }
    });

    const search = normalize(filters.searchTerm || '');
    const rows = Array.from(customerStats.values())
      .map<CustomerAnalyticsRow>((stat) => {
        const recency = Math.max(0, Math.floor((nowStartMs - stat.lastVisitMs) / DAY_MS));
        return {
          id: stat.id,
          name: stat.name,
          taxId: stat.taxId,
          phone: stat.phone,
          recency,
          frequency: stat.frequency,
          monetary: stat.monetary,
          lastVisit: new Date(stat.lastVisitMs).toISOString(),
          lastItems: latestItemsByCustomer.get(stat.id) || []
        };
      })
      .filter(row => {
        if (!search) return true;
        const haystack = `${row.name} ${row.taxId} ${row.phone}`.toLowerCase();
        return haystack.includes(search);
      });

    return {
      rows,
      summary: {
        ticketAverage: periodTicketCount > 0 ? periodTotalAmount / periodTicketCount : 0,
        topCustomerName,
        newCustomers,
        totalSales: periodTicketCount,
        totalAmount: periodTotalAmount
      },
      isLoading: false
    };
  }, [
    customers,
    transactions,
    filters.warehouseId,
    filters.startMs,
    filters.endMs,
    filters.searchTerm,
    terminalWarehouseMap,
    fallbackWarehouseId,
    now
  ]);
};
