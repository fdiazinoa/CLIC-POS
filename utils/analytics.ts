import { Transaction, ZReportStats, Collection } from '../types';

export const calculateZReportStats = (transactions: Transaction[], collections: Collection[] = []): ZReportStats => {
    if ((!transactions || transactions.length === 0) && (!collections || collections.length === 0)) {
        return {
            averageTicket: 0,
            itemsPerSale: 0,
            peakHour: 'N/A',
            topProduct: null,
            returnsCount: 0,
            returnsTotal: 0,
            grossSales: 0,
            netSales: 0,
            discountsTotal: 0,
            advancementsTotal: 0,
            collectionsTotal: 0
        };
    }

    // Calcular el total recolectado en CXC (Collections)
    const collectionsTotal = collections.reduce((acc, c) => acc + (c.totalAmount || 0), 0);

    // Filter valid sales (completed) vs refunds
    // Requirement: totalDevoluciones should be specifically documentType === 'REFUND' or ncfType === 'B04'
    const refunds = transactions.filter(t =>
        t.documentType === 'REFUND' ||
        t.ncfType === 'B04'
    );

    // Sales: Everything that is not a refund document and not explicitly voided.
    // If a normal sale (B01) was marked 'REFUNDED', it still counts towards Gross Sales 
    // because the B04 document will subtract it in the Devoluciones section.
    const sales = transactions.filter(t =>
        t.documentType !== 'REFUND' &&
        t.ncfType !== 'B04' &&
        t.documentType !== 'VOID'
    );

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

    // 6. Gross & Net Sales (NO INCLUYE RECAUDO CxC - Esto se maneja aparte en el Z)
    const grossSales = totalSalesAmount;
    const netSales = grossSales - returnsTotal;

    // 7. Discounts
    const discountsTotal = sales.reduce((acc, t) => acc + (t.discountAmount || 0), 0);

    // 8. Advancements (Gift Cards / Wallet Deposits)
    const advancementsTotal = transactions.reduce((acc, t) => acc + (t.walletDepositAmount || 0), 0);



    return {
        averageTicket,
        itemsPerSale,
        peakHour,
        topProduct,
        returnsCount,
        returnsTotal,
        grossSales,
        netSales,
        discountsTotal,
        advancementsTotal,
        collectionsTotal
    };
};
