import { Transaction, ZReportStats } from '../types';

export const calculateZReportStats = (transactions: Transaction[]): ZReportStats => {
    if (!transactions || transactions.length === 0) {
        return {
            averageTicket: 0,
            itemsPerSale: 0,
            peakHour: 'N/A',
            topProduct: null,
            returnsCount: 0,
            returnsTotal: 0,
            discountsTotal: 0
        };
    }

    // Filter valid sales (completed) vs refunds
    const sales = transactions.filter(t => t.status === 'COMPLETED');
    const refunds = transactions.filter(t => t.status === 'REFUNDED' || t.status === 'PARTIAL_REFUND');

    // 1. Average Ticket
    const totalSalesAmount = sales.reduce((acc, t) => acc + t.total, 0);
    const averageTicket = sales.length > 0 ? totalSalesAmount / sales.length : 0;

    // 2. Items per Sale
    const totalItemsSold = sales.reduce((acc, t) => acc + t.items.reduce((iAcc, item) => iAcc + item.quantity, 0), 0);
    const itemsPerSale = sales.length > 0 ? totalItemsSold / sales.length : 0;

    // 3. Peak Hour
    const hourCounts: Record<number, number> = {};
    sales.forEach(t => {
        const hour = new Date(t.date).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });

    let maxHour = -1;
    let maxCount = 0;
    Object.entries(hourCounts).forEach(([hour, count]) => {
        if (count > maxCount) {
            maxCount = count;
            maxHour = parseInt(hour);
        }
    });

    const peakHour = maxHour >= 0
        ? `${maxHour.toString().padStart(2, '0')}:00 - ${(maxHour + 1).toString().padStart(2, '0')}:00`
        : 'N/A';

    // 4. Top Product
    const productSales: Record<string, { name: string; quantity: number; total: number }> = {};

    sales.forEach(t => {
        t.items.forEach(item => {
            if (!productSales[item.id]) {
                productSales[item.id] = { name: item.name, quantity: 0, total: 0 };
            }
            productSales[item.id].quantity += item.quantity;
            productSales[item.id].total += item.price * item.quantity;
        });
    });

    let topProduct = null;
    let maxQty = 0;

    Object.values(productSales).forEach(p => {
        if (p.quantity > maxQty) {
            maxQty = p.quantity;
            topProduct = p;
        }
    });

    // 5. Returns
    const returnsCount = refunds.length;
    const returnsTotal = refunds.reduce((acc, t) => acc + Math.abs(t.total), 0);

    // 6. Discounts
    const discountsTotal = sales.reduce((acc, t) => acc + (t.discountAmount || 0), 0);

    return {
        averageTicket,
        itemsPerSale,
        peakHour,
        topProduct,
        returnsCount,
        returnsTotal,
        discountsTotal
    };
};
