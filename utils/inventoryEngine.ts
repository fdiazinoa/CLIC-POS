
import { Product, Season, Supplier, InventoryLedgerEntry, Warehouse, StockTransfer } from '../types';
import { db } from './db';

export interface InventoryCalculation {
    vmd: number;
    multiplier: number;
    leadTime: number;
    safetyStock: number;
    suggestedMin: number;
    suggestedMax: number;
    hasInsufficientData?: boolean;
    breakdown: {
        baseVmd: number;
        transferDemandVmd?: number;
        seasonName: string;
        seasonMultiplier: number;
        leadTimeDays: number;
        safetyStockQty: number;
    }
}

/**
 * Calculates suggested MIN/MAX stock levels based on sales history, 
 * seasonality multipliers, and supplier lead times for a SPECIFIC warehouse.
 */
export async function calculateOptimalInventoryLevels(
    product: Product,
    warehouseId: string,
    allSeasons: Season[],
    allSuppliers: Supplier[],
    daysLookback: number = 30
): Promise<InventoryCalculation> {
    const ledger = await db.get('inventoryLedger') as InventoryLedgerEntry[] || [];
    const warehouses = await db.get('warehouses') as Warehouse[] || [];
    const targetWarehouse = warehouses.find(w => w.id === warehouseId);

    const now = new Date();
    const startDate = new Date();
    startDate.setDate(now.getDate() - daysLookback);

    // 1. Calculate Local Sales VMD
    const salesEntries = ledger.filter(entry =>
        entry.productId === product.id &&
        entry.warehouseId === warehouseId &&
        entry.concept === 'VENTA' &&
        new Date(entry.createdAt) >= startDate
    );

    const totalSales = salesEntries.reduce((sum, entry) => sum + (entry.qtyOut || 0), 0);
    let totalDemand = totalSales;
    let transferDemandVmd = 0;

    // 2. CD Logic: Add Outbound Transfers if it's a Main Warehouse (DC)
    if (targetWarehouse?.isMain) {
        const transfers = await db.get('transfers') as StockTransfer[] || [];
        const outboundTransfers = transfers.filter(t =>
            t.sourceWarehouseId === warehouseId &&
            new Date(t.createdAt) >= startDate &&
            t.items.some(item => item.productId === product.id)
        );

        const totalTransferred = outboundTransfers.reduce((sum, t) => {
            const item = t.items.find(i => i.productId === product.id);
            return sum + (item?.quantity || 0);
        }, 0);

        totalDemand += totalTransferred;
        transferDemandVmd = totalTransferred / daysLookback;
    }

    const baseVmd = totalDemand / daysLookback;

    // 3. Fallback: Insufficient Data
    const hasInsufficientData = totalDemand === 0;

    // 4. Identify Applicable Season Multiplier
    let multiplier = 1.0;
    let activeSeasonName = 'Normal';

    const relevantSeasons = allSeasons.filter(s => {
        if (!s.isActive) return false;
        const start = new Date(s.startDate);
        const end = new Date(s.endDate);
        const isWithinDate = now >= start && now <= end;

        const isProductIncluded = s.productIds?.includes(product.id);
        const isCategoryIncluded = s.affectedCategories?.includes(product.category);

        return isWithinDate && (isProductIncluded || isCategoryIncluded);
    });

    if (relevantSeasons.length > 0) {
        const bestSeason = relevantSeasons.reduce((prev, curr) =>
            (curr.multiplier || 1) > (prev.multiplier || 1) ? curr : prev
        );
        multiplier = bestSeason.multiplier || 1.0;
        activeSeasonName = bestSeason.name;
    }

    // 5. Get Lead Time (In a real system, this could be wh-specific as requested)
    // For now using supplier lead time.
    const primarySupplier = allSuppliers.find(s => s.id === product.primarySupplierId);
    let leadTimeDays = primarySupplier?.leadTimeDays || 7;

    // Logistic Insight: Locations further away from CD could have extra lead time
    // if (!targetWarehouse?.isMain) leadTimeDays += 1; // Example logic

    // 6. Calculate Inventory Metrics
    const adjustedVmd = baseVmd * multiplier;
    const leadTimeConsumption = adjustedVmd * leadTimeDays;
    const safetyStockQty = leadTimeConsumption * 0.20;

    const suggestedMin = Math.ceil(leadTimeConsumption + safetyStockQty);
    const suggestedMax = Math.ceil(suggestedMin * 2);

    return {
        vmd: parseFloat(adjustedVmd.toFixed(2)),
        multiplier,
        leadTime: leadTimeDays,
        safetyStock: parseFloat(safetyStockQty.toFixed(2)),
        suggestedMin: suggestedMin || 1,
        suggestedMax: suggestedMax || 2,
        hasInsufficientData,
        breakdown: {
            baseVmd: parseFloat((totalSales / daysLookback).toFixed(2)),
            transferDemandVmd: parseFloat(transferDemandVmd.toFixed(2)),
            seasonName: activeSeasonName,
            seasonMultiplier: multiplier,
            leadTimeDays,
            safetyStockQty: parseFloat(safetyStockQty.toFixed(2))
        }
    };
}
