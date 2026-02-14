export interface EscPosLabelRecord {
  productId: string;
  productName: string;
  sku?: string;
  price?: number;
  copies: number;
}

const ESC = 0x1b;
const GS = 0x1d;

const MAX_LINE = 32;

const toAscii = (value: string): string => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
};

const padRight = (value: string, length: number): string => {
  if (value.length >= length) return value.slice(0, length);
  return `${value}${' '.repeat(length - value.length)}`;
};

const splitLines = (text: string, width = MAX_LINE): string[] => {
  const clean = toAscii(text);
  if (!clean) return [''];

  const words = clean.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  words.forEach(word => {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= width) {
      line = next;
      return;
    }

    if (line) {
      lines.push(line);
      line = '';
    }

    if (word.length > width) {
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      return;
    }

    line = word;
  });

  if (line) lines.push(line);
  return lines;
};

const text = (value: string): Uint8Array => new TextEncoder().encode(`${value}\n`);
const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

const concat = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  chunks.forEach(chunk => {
    out.set(chunk, offset);
    offset += chunk.length;
  });

  return out;
};

const toBase64 = (input: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < input.length; i += chunkSize) {
    const chunk = input.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

export const buildEscPosLabelPayload = (
  records: EscPosLabelRecord[],
  currencySymbol: string,
  header = 'IMPRESION DE ETIQUETAS'
): string | null => {
  const prepared = records
    .filter(record => Number.isFinite(record.copies) && record.copies > 0)
    .flatMap(record => Array.from({ length: Math.floor(record.copies) }, () => ({ ...record, copies: 1 })));

  if (!prepared.length) return null;

  const chunks: Uint8Array[] = [];

  // Init + center + bold
  chunks.push(bytes(ESC, 0x40));
  chunks.push(bytes(ESC, 0x61, 0x01));
  chunks.push(bytes(ESC, 0x45, 0x01));
  chunks.push(text(toAscii(header)));
  chunks.push(bytes(ESC, 0x45, 0x00));
  chunks.push(text('-'.repeat(MAX_LINE)));

  prepared.forEach(record => {
    chunks.push(bytes(ESC, 0x61, 0x01));
    splitLines(record.productName || record.productId, MAX_LINE).forEach(line => {
      chunks.push(text(line));
    });

    chunks.push(bytes(ESC, 0x61, 0x00));
    const sku = toAscii(record.sku || record.productId || 'SIN-SKU');
    chunks.push(text(padRight(`SKU: ${sku}`, MAX_LINE)));

    if (typeof record.price === 'number') {
      const amount = `${currencySymbol}${record.price.toFixed(2)}`;
      chunks.push(text(padRight(`PRECIO: ${toAscii(amount)}`, MAX_LINE)));
    }

    // Texto base para lectura humana en caso de no soporte de barcode commands.
    chunks.push(bytes(ESC, 0x61, 0x01));
    chunks.push(text(`*${sku}*`));
    chunks.push(bytes(ESC, 0x61, 0x00));
    chunks.push(text('-'.repeat(MAX_LINE)));
  });

  chunks.push(text(''));
  chunks.push(text(''));
  // Full cut
  chunks.push(bytes(GS, 0x56, 0x00));

  return toBase64(concat(chunks));
};
