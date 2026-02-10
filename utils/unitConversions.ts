
export type UnitType = 'MASS' | 'VOLUME' | 'UNIT' | 'UNKNOWN';

interface ConversionRule {
    from: string;
    to: string;
    factor: number;
}

// Standard Conversions to Base Units (e.g. everything to grams or ml)
// This allows us to convert A -> B by doing A -> Base -> B
// Base for MASS: gr
// Base for VOLUME: ml

const MASS_TO_GRAMS: Record<string, number> = {
    'kg': 1000,
    'gr': 1,
    'mg': 0.001,
    'lb': 453.592,
    'oz': 28.3495,
    'ton': 1000000,
    'saco_50kg': 50000, // Common preset, though might be vague
    'quintal': 45359.2 // 100 lb
};

const VOLUME_TO_ML: Record<string, number> = {
    'lt': 1000,
    'ml': 1,
    'gal': 3785.41,
    'oz_fl': 29.5735,
    'pt': 473.176, // Pint
    'qt': 946.353  // Quart
};

export function getUnitType(code: string): UnitType {
    const c = code.toLowerCase();
    if (c in MASS_TO_GRAMS) return 'MASS';
    if (c in VOLUME_TO_ML) return 'VOLUME';
    if (['un', 'unidad', 'box', 'caja', 'saco', 'paq'].includes(c)) return 'UNIT';
    return 'UNKNOWN';
}

export function getSuggestedFactor(fromUnit: string, toUnit: string): number | null {
    const from = fromUnit.toLowerCase();
    const to = toUnit.toLowerCase();

    const type = getUnitType(from);
    const targetType = getUnitType(to);

    if (type !== targetType || type === 'UNKNOWN' || type === 'UNIT') {
        return null; // Cannot convert mismatched types or abstract units generically
    }

    if (type === 'MASS') {
        const fromVal = MASS_TO_GRAMS[from];
        const toVal = MASS_TO_GRAMS[to];
        // Factor = How many TOs in one FROM?
        // e.g. 1 kg (1000g) -> lb (453g). 1000 / 453.59 = 2.204
        return fromVal / toVal;
    }

    if (type === 'VOLUME') {
        const fromVal = VOLUME_TO_ML[from];
        const toVal = VOLUME_TO_ML[to];
        return fromVal / toVal;
    }

    return null;
}
