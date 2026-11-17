import { preparePosReportText } from '../../utils/posReportPresentation';

/** Dedicated report output: never changes shared payment vouchers or Z receipts. */
export const buildEscPosPosReportPayload = (text: string): string => {
  const lines = preparePosReportText(text).split('\n');
  // Reset, font A, normal width/height, left alignment, emphasis off.
  const bytes: number[] = [0x1b, 0x40, 0x1b, 0x21, 0, 0x1b, 0x4d, 0, 0x1d, 0x21, 0, 0x1b, 0x61, 0, 0x1b, 0x45, 0];
  let header = lines.includes('='.repeat(32));
  let continuedTotal = false;
  for (const line of lines) {
    const total = /^(VENTA NETA|TOTAL NETO|TOTAL DESCUENTOS|BALANCE MOVIMIENTOS):/.test(line);
    const emphasis = header || total || continuedTotal || /^\s*\[ .+ \]$/.test(line);
    bytes.push(0x1b, 0x45, emphasis ? 1 : 0, ...new TextEncoder().encode(line), 0x0a);
    continuedTotal = total && !/\S+ -?\d/.test(line);
    if (line === '='.repeat(32)) header = false;
  }
  bytes.push(0x1b, 0x45, 0, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
