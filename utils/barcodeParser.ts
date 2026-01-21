import { ScaleLabelConfig } from '../types';

export interface ScannedItem {
    plu: string;
    value: number;
    type: 'WEIGHT' | 'PRICE';
}

export function parseScaleBarcode(barcode: string, config: ScaleLabelConfig): ScannedItem | null {
    if (!config.isEnabled) return null;

    // 1. Validar Longitud
    if (barcode.length !== config.structure.totalLength) return null;

    // 2. Validar Prefijo
    const prefix = barcode.substring(0, config.structure.prefixLength);
    if (!config.prefixes.includes(prefix)) return null;

    // 3. Extraer PLU
    const plu = barcode.substring(
        config.structure.pluStart,
        config.structure.pluStart + config.structure.pluLength
    );

    // 4. Extraer Valor (Peso o Precio)
    const rawValue = barcode.substring(
        config.structure.valueStart,
        config.structure.valueStart + config.structure.valueLength
    );

    const numericValue = parseInt(rawValue, 10);
    if (isNaN(numericValue)) return null;

    // 5. Aplicar Divisor
    const finalValue = numericValue / Math.pow(10, config.decimals);

    return {
        plu: plu,
        value: finalValue,
        type: config.valueType
    };
}
