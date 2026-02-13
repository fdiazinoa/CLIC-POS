
export type UnitType = 'MASS' | 'VOLUME' | 'UNIT';

export interface UnitDefinition {
    code: string;
    name: string;
    type: UnitType;
    baseFactor: number; // Factor relative to the base unit (g for MASS, ml for VOLUME, 1 for UNIT)
}

// Base units: Gram (g) for Mass, Milliliter (ml) for Volume, Unit (un) for Count
export const UNITS: Record<string, UnitDefinition> = {
    // Mass (Base: Gram)
    'gr': { code: 'gr', name: 'Gramo (g)', type: 'MASS', baseFactor: 1 },
    'kg': { code: 'kg', name: 'Kilogramo (kg)', type: 'MASS', baseFactor: 1000 },
    'lb': { code: 'lb', name: 'Libra (lb)', type: 'MASS', baseFactor: 453.592 },
    'oz': { code: 'oz', name: 'Onza (oz)', type: 'MASS', baseFactor: 28.3495 },

    // Volume (Base: Milliliter)
    'ml': { code: 'ml', name: 'Mililitro (ml)', type: 'VOLUME', baseFactor: 1 },
    'l': { code: 'l', name: 'Litro (L)', type: 'VOLUME', baseFactor: 1000 },
    'gal': { code: 'gal', name: 'Galón (gal)', type: 'VOLUME', baseFactor: 3785.41 },
    'oz_fl': { code: 'oz_fl', name: 'Onza Fl. (fl oz)', type: 'VOLUME', baseFactor: 29.5735 },

    // Unit
    'un': { code: 'un', name: 'Unidad (un)', type: 'UNIT', baseFactor: 1 },
};

export const getConversionFactor = (fromUnit: string, toUnit: string): number => {
    const from = UNITS[fromUnit];
    const to = UNITS[toUnit];

    // If units are invalid or incompatible, return 1 (no conversion possible safe fallback)
    if (!from || !to || from.type !== to.type) {
        console.warn(`Incompatible or invalid units: ${fromUnit} -> ${toUnit}`);
        return 1;
    }

    // Convert "From" to Base, then Base to "To"
    // Example: Lb -> Kg
    // 1 Lb * 453.59 (g/lb) / 1000 (g/kg) = 0.45359 Kg
    return from.baseFactor / to.baseFactor;
};

export const calculateCost = (quantity: number, unitCode: string, ingredientCost: number, ingredientUnitCode: string = 'un'): number => {
    // If ingredient unit is not defined, assume 'un' or same as usage if intuitive, but let's be strict or default to 1:1 if unknown.
    // However, usually ingredient.cost is "Price per Purchasing Unit".
    // So if Ingredient is $100 / Lb.
    // And we use 100 Gr.
    // We need to convert 100 Gr to Lb.
    // 100 Gr * (1 Lb / 453.59 Gr) = 0.22 Lb.
    // Cost = 0.22 Lb * $100/Lb = $22.

    const usageUnit = UNITS[unitCode];
    const purchaseUnit = UNITS[ingredientUnitCode] || UNITS['un'];

    if (!usageUnit || !purchaseUnit || usageUnit.type !== purchaseUnit.type) {
        // Fallback: just multiply qty * cost (assumes 1:1 match if incompatible)
        return quantity * ingredientCost;
    }

    // Convert Usage Quantity to Purchasing Unit
    // Qty (Base) = Qty * UsageFactor
    // Qty (Purchase) = Qty (Base) / PurchaseFactor
    const qtyInPurchaseUnit = (quantity * usageUnit.baseFactor) / purchaseUnit.baseFactor;

    return qtyInPurchaseUnit * ingredientCost;
};
