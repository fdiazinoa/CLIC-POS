import { Transaction, Product, InventoryLedgerEntry, Customer, PurchaseOrder, Reception, AttendanceLog, Supplier } from '../types';

/**
 * Reconstructs inventory as of a specific date by backtracking through ledger entries.
 */
export const getInventorySnapshotAtDate = (
    products: Product[],
    ledger: InventoryLedgerEntry[],
    targetDate: string
) => {
    const targetTime = new Date(targetDate).getTime();
    const snapshot: any[] = [];

    products.forEach(product => {
        // Current total stock from product metadata (sum of all warehouses)
        const balances = product.stockBalances || {};
        let currentStock = Object.values(balances).reduce((acc: number, qty: number) => acc + (qty || 0), 0);

        // Sort ledger entries for this product descending (newest first)
        const movements = (ledger || [])
            .filter(l => l.productId === product.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        let adjustedStock = currentStock;

        // Traverse backwards starting from current stock
        for (const move of movements) {
            const moveTime = new Date(move.createdAt).getTime();
            if (moveTime > targetTime) {
                // This move happened AFTER our target date, so we reverse it
                adjustedStock -= (move.qtyIn || 0);
                adjustedStock += (move.qtyOut || 0);
            } else {
                break;
            }
        }

        snapshot.push({
            id: product.id,
            name: product.name,
            code: product.barcode || '',
            quantity: adjustedStock,
            avgCost: product.cost || 0,
            value: adjustedStock * (product.cost || 0)
        });
    });

    return snapshot;
};

/**
 * Calculates Customer RFM (Recency, Frequency, Monetary)
 */
export const calculateRFMData = (customers: Customer[], transactions: Transaction[]) => {
    const now = new Date().getTime();

    return customers.map(customer => {
        const customerTxs = transactions.filter(tx => tx.customerId === customer.id && tx.status !== 'REFUNDED');

        if (customerTxs.length === 0) return null;

        const sortedTxs = [...customerTxs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const lastVisitTime = new Date(sortedTxs[0].date).getTime();
        const daysSinceLastVisit = Math.floor((now - lastVisitTime) / (1000 * 60 * 60 * 24));

        const monetary = customerTxs.reduce((acc, tx) => acc + tx.total, 0);
        const frequency = customerTxs.length;

        return {
            id: customer.id,
            name: customer.name,
            recency: daysSinceLastVisit,
            frequency,
            monetary,
            lastVisit: sortedTxs[0].date
        };
    }).filter(Boolean);
};

/**
 * Lead Time Performance (Promised vs Actual)
 */
export const getLeadTimePerformance = (purchaseOrders: PurchaseOrder[], receptions: Reception[], suppliers: Supplier[]) => {
    return purchaseOrders.map(po => {
        const relatedReceptions = receptions.filter(r => r.purchaseOrderId === po.id);
        if (relatedReceptions.length === 0) return null;

        const firstReception = relatedReceptions[0];
        const promised = new Date(po.expectedDate || po.date).getTime();
        const actual = new Date(firstReception.date).getTime();
        const diffDays = Math.floor((actual - promised) / (1000 * 60 * 60 * 24));

        const supplier = (suppliers || []).find(s => s.id === po.supplierId);

        return {
            id: po.id,
            supplierName: supplier?.name || po.supplierName || 'Proveedor Desconocido',
            promisedDate: po.expectedDate || po.date,
            actualDate: firstReception.date,
            delayDays: diffDays,
            status: po.status
        };
    }).filter(Boolean);
};

/**
 * ABC Ranking (80/20 Rule)
 * Classifies products based on their contribution to total revenue.
 */
export const getABCRanking = (products: Product[], transactions: Transaction[]) => {
    const productSales: Record<string, { name: string; total: number; qty: number }> = {};

    transactions.forEach(tx => {
        if (tx.status === 'REFUNDED') return;
        tx.items.forEach(item => {
            if (!productSales[item.id]) {
                productSales[item.id] = { name: item.name, total: 0, qty: 0 };
            }
            productSales[item.id].total += (item.price * item.quantity);
            productSales[item.id].qty += item.quantity;
        });
    });

    const sorted = Object.entries(productSales)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => b.total - a.total);

    const totalRevenue = sorted.reduce((acc, p) => acc + p.total, 0);
    let cumulativeRevenue = 0;

    return sorted.map(p => {
        cumulativeRevenue += p.total;
        const percentage = totalRevenue > 0 ? (cumulativeRevenue / totalRevenue) * 100 : 0;
        let classification: 'A' | 'B' | 'C' = 'C';
        if (percentage <= 80) classification = 'A';
        else if (percentage <= 95) classification = 'B';

        return {
            ...p,
            share: totalRevenue > 0 ? (p.total / totalRevenue) * 100 : 0,
            cumShare: percentage,
            classification
        };
    });
};

/**
 * Sales by Hour (Heatmap Data)
 */
export const getSalesByHour = (transactions: Transaction[]) => {
    const hours = Array.from({ length: 24 }, (_, i) => ({
        hour: `${i.toString().padStart(2, '0')}:00`,
        total: 0,
        count: 0
    }));

    transactions.forEach(tx => {
        if (tx.status === 'REFUNDED') return;
        const date = new Date(tx.date);
        const hour = date.getHours();
        hours[hour].total += tx.total;
        hours[hour].count += 1;
    });

    return hours;
};

/**
 * HR Availability / Hours Worked
 */
export const getHRPerformance = (attendance: AttendanceLog[]) => {
    const userPerformance: Record<string, { name: string; hours: number; lastClock: string | null }> = {};

    const sorted = [...(attendance || [])].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const tempClocks: Record<string, string> = {};

    sorted.forEach(log => {
        if (!userPerformance[log.userId]) {
            userPerformance[log.userId] = { name: log.userName, hours: 0, lastClock: null };
        }

        if (log.type === 'CLOCK_IN') {
            tempClocks[log.userId] = log.timestamp;
        } else if (log.type === 'CLOCK_OUT' && tempClocks[log.userId]) {
            const start = new Date(tempClocks[log.userId]).getTime();
            const end = new Date(log.timestamp).getTime();
            const diffHours = (end - start) / (1000 * 60 * 60);
            userPerformance[log.userId].hours += diffHours;
            delete tempClocks[log.userId];
        }
        userPerformance[log.userId].lastClock = log.timestamp;
    });

    return Object.entries(userPerformance).map(([id, data]) => ({ id, ...data }));
};

/**
 * Tab 1: Supplier Intelligence Aggregation
 */
export const getSuppliersIntelligence = (purchaseOrders: PurchaseOrder[], suppliers: Supplier[]) => {
    const summary: Record<string, {
        name: string;
        taxId: string;
        orderCount: number;
        totalSpent: number;
        leadTimes: number[];
    }> = {};

    purchaseOrders.forEach(po => {
        const supplier = (suppliers || []).find(s => s.id === po.supplierId);
        const sId = po.supplierId || 'unknown';

        if (!summary[sId]) {
            summary[sId] = {
                name: supplier?.name || po.supplierName || 'Desconocido',
                taxId: supplier?.taxId || 'N/A',
                orderCount: 0,
                totalSpent: 0,
                leadTimes: []
            };
        }

        summary[sId].orderCount += 1;
        summary[sId].totalSpent += (po.totalCost || 0);

        // Calculate lead time if it was completed
        if (po.status === 'COMPLETED' && po.expectedDate) {
            const expected = new Date(po.expectedDate).getTime();
            const actual = new Date(po.date).getTime(); // Should ideally use reception date, but using PO date as fallback
            const diff = Math.max(0, Math.floor((actual - expected) / (1000 * 60 * 60 * 24)));
            summary[sId].leadTimes.push(diff);
        }
    });

    return Object.entries(summary).map(([id, data]) => ({
        id,
        ...data,
        avgLeadTime: data.leadTimes.length > 0
            ? Math.round(data.leadTimes.reduce((a, b) => a + b, 0) / data.leadTimes.length)
            : 0
    }));
};

/**
 * Tab 3: Item Price Intelligence (Variance Analysis)
 */
export const getItemPriceIntelligence = (purchaseOrders: PurchaseOrder[], suppliers: Supplier[] = []) => {
    const itemHistory: Record<string, { name: string; prices: { date: string; cost: number; supplier: string }[] }> = {};

    // Collect all unique items and their price history
    purchaseOrders.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).forEach(po => {
        const supplier = suppliers.find(s => s.id === po.supplierId);
        const resolvedName = supplier?.name || po.supplierName || 'Desconocido';

        (po.items || []).forEach(item => {
            if (!itemHistory[item.productId]) {
                itemHistory[item.productId] = { name: item.productName, prices: [] };
            }
            itemHistory[item.productId].prices.push({
                date: po.date,
                cost: item.cost,
                supplier: resolvedName
            });
        });
    });

    return Object.entries(itemHistory).map(([id, data]) => {
        const history = data.prices;
        if (history.length === 0) return null;

        const latest = history[history.length - 1];
        const previous = history.length > 1 ? history[history.length - 2] : null;
        const variation = previous ? ((latest.cost - previous.cost) / previous.cost) * 100 : 0;

        return {
            id,
            name: data.name,
            lastSupplier: latest.supplier,
            lastDate: latest.date,
            prevPrice: previous ? previous.cost : 0,
            lastPrice: latest.cost,
            variationPercent: variation,
            isAlert: variation >= 5
        };
    }).filter(Boolean);
};

/**
 * Tab 4: Discrepancy Audit (Ordered vs Received)
 */
export const getDiscrepancyReport = (purchaseOrders: PurchaseOrder[], receptions: Reception[], suppliers: Supplier[] = []) => {
    const discrepancies: any[] = [];

    // Create a map of receptions for fast lookup
    const receptionMap: Record<string, Reception[]> = {};
    receptions.forEach(r => {
        if (!receptionMap[r.purchaseOrderId]) receptionMap[r.purchaseOrderId] = [];
        receptionMap[r.purchaseOrderId].push(r);
    });

    purchaseOrders.forEach(po => {
        const poReceptions = receptionMap[po.id] || [];
        const supplier = suppliers.find(s => s.id === po.supplierId);
        const resolvedSupplierName = supplier?.name || po.supplierName || 'Desconocido';

        (po.items || []).forEach(item => {
            // Reconstruct history
            // Sum all receipts for this specific product in this PO
            const totalRecibidoReal = poReceptions.reduce((acc, r) => {
                const rItem = r.items.find(ri => ri.productId === item.productId && ri.variantSku === item.variantSku);
                return acc + (rItem?.quantityReceived || 0);
            }, 0);

            // If the PO is PARTIAL, the quantityOrdered is just the remainder.
            // If it's COMPLETED or ORDERED, it's the full amount intended.
            const originalIntent = (po.status === 'PARTIAL')
                ? (item.quantityOrdered + totalRecibidoReal)
                : item.quantityOrdered;

            // There is a discrepancy if what we ultimately got (totalRecibidoReal) 
            // doesn't match what we originally intended.
            // ALSO check the current PO state for COMPLETED orders that were forced-closed with missing items.
            const totalRecibidoFinal = (po.status === 'COMPLETED') ? item.quantityReceived : totalRecibidoReal;

            if (totalRecibidoFinal < originalIntent) {
                discrepancies.push({
                    poId: po.id,
                    productName: item.productName,
                    ordered: originalIntent,
                    received: totalRecibidoFinal,
                    missing: originalIntent - totalRecibidoFinal,
                    supplier: resolvedSupplierName,
                    date: po.date
                });
            }
        });
    });

    return discrepancies;
};
