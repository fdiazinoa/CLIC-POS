import { ScaleLabelConfig } from '../types';

export interface ScannedItem {
    plu: string;
    value: number;
    type: 'WEIGHT' | 'PRICE';
}

export interface ScaleBarcodeParseResult {
    success: boolean;
    item?: ScannedItem;
    normalizedBarcode: string;
    message: string;
}

export function normalizeScaleBarcodeInput(barcode: string): string {
    return String(barcode || '').replace(/\D/g, '');
}

export function parseScaleBarcodeDetailed(barcode: string, config: ScaleLabelConfig): ScaleBarcodeParseResult {
    const normalizedBarcode = normalizeScaleBarcodeInput(barcode);

    if (!config.isEnabled) {
        return {
            success: false,
            normalizedBarcode,
            message: 'Activa el lector de etiquetas antes de probar.'
        };
    }

    if (!normalizedBarcode) {
        return {
            success: false,
            normalizedBarcode,
            message: 'Escanea o escribe un código EAN-13 para probar.'
        };
    }

    if (normalizedBarcode.length !== config.structure.totalLength) {
        return {
            success: false,
            normalizedBarcode,
            message: `Longitud inválida: ${normalizedBarcode.length} dígitos. Esperado: ${config.structure.totalLength}.`
        };
    }

    const prefix = normalizedBarcode.substring(0, config.structure.prefixLength);
    if (!config.prefixes.includes(prefix)) {
        return {
            success: false,
            normalizedBarcode,
            message: `Prefijo ${prefix || 'vacío'} no permitido. Permitidos: ${config.prefixes.join(', ') || 'ninguno'}.`
        };
    }

    const pluEnd = config.structure.pluStart + config.structure.pluLength;
    const valueEnd = config.structure.valueStart + config.structure.valueLength;
    if (pluEnd > normalizedBarcode.length || valueEnd > normalizedBarcode.length) {
        return {
            success: false,
            normalizedBarcode,
            message: 'La estructura configurada excede la longitud del código.'
        };
    }

    const plu = normalizedBarcode.substring(config.structure.pluStart, pluEnd);
    const rawValue = normalizedBarcode.substring(config.structure.valueStart, valueEnd);
    const numericValue = parseInt(rawValue, 10);

    if (Number.isNaN(numericValue)) {
        return {
            success: false,
            normalizedBarcode,
            message: `El valor ${rawValue || 'vacío'} no es numérico.`
        };
    }

    const item = {
        plu,
        value: numericValue / Math.pow(10, config.decimals),
        type: config.valueType
    } as ScannedItem;

    return {
        success: true,
        item,
        normalizedBarcode,
        message: `PLU ${item.plu} leído correctamente.`
    };
}

export function parseScaleBarcode(barcode: string, config: ScaleLabelConfig): ScannedItem | null {
    return parseScaleBarcodeDetailed(barcode, config).item || null;
}
