export interface ZebraWeightResponse {
  weight?: string;
  weight_mode?: string;
  status?: string;
}

const statusMessages: Record<string, string> = {
  '0': 'Báscula deshabilitada',
  '1': 'Báscula no preparada',
  '2': 'Peso por encima del límite',
  '3': 'Peso por debajo de cero',
  '4': 'Peso inestable: espera y vuelve a leer',
};

/** Zebra reports Metric in kg and English in lb. The POS prices per kg. */
export function zebraWeightKg(reading: ZebraWeightResponse): number {
  if (reading.status !== '5' && reading.status !== '6') {
    throw new Error(statusMessages[reading.status ?? ''] ?? 'Estado de báscula desconocido');
  }
  const raw = reading.weight?.trim() ?? '';
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error('Peso inválido');
  const weight = Number(raw);
  if (!Number.isFinite(weight)) throw new Error('Peso inválido');
  if ((reading.status === '5' && weight !== 0) || (reading.status === '6' && weight <= 0)) {
    throw new Error('Peso incompatible con el estado de la báscula');
  }
  if (reading.weight_mode === 'Metric') return weight;
  if (reading.weight_mode === 'English') return weight * 0.45359237;
  throw new Error('Unidad de peso desconocida');
}
