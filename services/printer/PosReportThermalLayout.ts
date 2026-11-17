import type { PosReportDocument, ReportBlock, ReportCell } from './PosReportDocument';
import { reportDate, reportTime } from './PosReportDocument';

export interface QueryThermalProfile {
  id: string;
  paperWidthMm: 80 | 88;
  printableWidthMm: number;
  columns: 42 | 48;
  font: 'A';
}
// TM-T88 standard mode is 42 columns. 48 requires a verified 48-column mode.
// Do not change persistent printer memory switches or any shared receipt profile.
export const QUERY_THERMAL_80MM: Readonly<QueryThermalProfile> = Object.freeze({
  id: 'query-80mm-font-a-42', paperWidthMm: 80, printableWidthMm: 72, columns: 42, font: 'A',
});
export const QUERY_THERMAL_80MM_48: Readonly<QueryThermalProfile> = Object.freeze({
  ...QUERY_THERMAL_80MM, id: 'query-80mm-font-a-48-verified', columns: 48,
});
export interface QueryReportLine { text: string; bold: boolean; centered: boolean }

// CP858 preserves Spanish accents, ñ, ü, currency signs and single-cell alignment.
const CP858_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\xad±‗¾¶§÷¸°¨·¹³²■\xa0';
const clean = (text: string): string => Array.from(text.normalize('NFC'), char => {
  const code = char.codePointAt(0)!;
  return code < 32 || (code >= 127 && code <= 159) ? ' ' : char;
}).join('')
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—\u00ad]/g, '-').replace(/…/g, '...').replace(/\u00a0/g, ' ');
export const encodeQueryReportText = (text: string): Uint8Array => {
  const result: number[] = [];
  for (const char of clean(text)) {
    const code = char.codePointAt(0)!;
    if (code >= 32 && code <= 126) result.push(code);
    else {
      const index = CP858_HIGH.indexOf(char);
      if (index < 0) throw new Error(`Carácter no compatible con CP858: ${char}`);
      result.push(index + 128);
    }
  }
  return Uint8Array.from(result);
};
const length = (text: string): number => Array.from(text).length;
const fit = (text: string, width: number, right = false): string => {
  const pad = Math.max(0, width - length(text));
  return right ? ' '.repeat(pad) + text : text + ' '.repeat(pad);
};
const wrapConcept = (value: string, width: number): string[] => {
  const text = clean(value);
  if (!text) return [''];
  const result: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (length(current) + (current ? 1 : 0) + length(word) <= width) current += (current ? ' ' : '') + word;
    else {
      if (current) result.push(current);
      const chars = Array.from(word);
      while (chars.length > width) result.push(chars.splice(0, width).join(''));
      current = chars.join('');
    }
  }
  if (current) result.push(current);
  return result;
};

export const layoutQueryReport = (document: PosReportDocument, profile: QueryThermalProfile = QUERY_THERMAL_80MM): QueryReportLine[] => {
  const width = profile.columns;
  if (![42, 48].includes(width)) throw new Error('Ancho térmico de consulta no compatible');
  const output: QueryReportLine[] = [];
  const add = (value: string, bold = false, centered = false, atomic = false) => {
    const text = clean(value);
    // Validate characters before any transport receives a partial document.
    encodeQueryReportText(text);
    if (atomic && length(text) > width) throw new Error('Un valor indivisible supera el ancho imprimible');
    for (const line of atomic ? [text] : wrapConcept(text, width)) {
      const leading = centered ? Math.floor((width - length(line)) / 2) : 0;
      output.push({ text: centered ? fit(' '.repeat(leading) + line, width) : line, bold, centered });
    }
  };
  const rule = () => add('-'.repeat(width));
  const pair = (label: string, raw: string, bold = false) => {
    const value = clean(raw);
    if (length(value) > width) throw new Error('Un importe, fecha o código supera el ancho imprimible');
    const available = width - length(value) - 1;
    if (available < 8) {
      add(label, bold);
      add(fit(value, width, true), bold, false, true);
    } else {
      const rows = wrapConcept(label, available);
      rows.forEach((line, index) => add(fit(line, available) + ' ' + (index === rows.length - 1 ? value : ' '.repeat(length(value))), bold, false, true));
    }
  };
  const table = (block: Extract<ReportBlock, { type: 'table' }>) => {
    const columns = block.columns;
    // Numeric/atomic columns expand to the largest original value. The concept
    // receives the remainder; there are no magic spaces or tab stops.
    const widths = columns.map((column, index) => column.atomic ? Math.max(length(clean(column.title)), ...block.rows.map(row => length(clean(row[index]?.text || '')))) : 0);
    const textIndices = columns.map((column, i) => column.atomic ? -1 : i).filter(i => i >= 0);
    const remaining = width - widths.reduce((sum, item) => sum + item, 0) - (columns.length - 1);
    const minimums = textIndices.map(index => Math.max(8, ...block.rows.map(row => row[index]?.atomic ? length(clean(row[index].text)) : 0)));
    const required = minimums.reduce((sum, item) => sum + item, 0);
    if (!textIndices.length || remaining < required) {
      // Wide amounts get their own right-aligned line; never wrap or truncate them.
      for (const row of block.rows) row.forEach((item, i) => {
        if (columns[i].atomic || item.atomic) pair(columns[i].title, item.text, i === row.length - 1);
        else add(item.text);
      });
      return;
    }
    const extra = remaining - required;
    textIndices.forEach((index, i) => { widths[index] = minimums[i] + Math.floor(extra / textIndices.length) + (i === 0 ? extra % textIndices.length : 0); });
    const emit = (cells: ReportCell[], heading = false) => {
      const rows = cells.map((item, i) => {
        const text = clean(item.text);
        if (item.atomic || columns[i].atomic) {
          if (length(text) > widths[i]) throw new Error('Valor indivisible fuera de columna');
          return [text];
        }
        return wrapConcept(text, widths[i]);
      });
      const height = Math.max(...rows.map(row => row.length));
      for (let line = 0; line < height; line++) {
        const text = columns.map((column, i) => fit(rows[i][line] || '', widths[i], column.align === 'right')).join(' ');
        add(text, heading || columns.some((column, i) => column.emphasize && Boolean(rows[i][line])), false, true);
      }
    };
    emit(columns.map(column => ({ text: column.title, atomic: column.atomic })), true);
    rule();
    block.rows.forEach(row => emit(row));
  };
  add(document.business, true, true);
  add(document.title, true, true);
  // Each date remains a single token. The pair fits even in 42-column mode.
  add(`${reportDate(document.start + 'T00:00:00')} - ${reportDate(document.end + 'T00:00:00')}`, false, true, true);
  add(`Caja: ${document.terminal}`, false, true);
  add(`Emisión: ${reportDate(document.issuedAt)} ${reportTime(document.issuedAt)}`, false, true, true);
  add('CONSULTA - NO REALIZA CIERRE DE CAJA', true, true);
  rule();
  for (const block of document.blocks) {
    if (block.type === 'table') table(block);
    else if (block.type === 'pair') {
      if (block.bold) rule();
      pair(block.label, block.value, block.bold);
    } else {
      if (block.bold && output[output.length - 1]?.text !== '-'.repeat(width)) rule();
      add(block.text, block.bold, block.centered, block.atomic);
    }
  }
  rule();
  return output;
};
export const queryReportPlainText = (document: PosReportDocument, profile: QueryThermalProfile = QUERY_THERMAL_80MM): string =>
  layoutQueryReport(document, profile).map(line => line.text).join('\n');

export const buildQueryReportEscPos = (document: PosReportDocument, profile: QueryThermalProfile = QUERY_THERMAL_80MM): string => {
  const lines = layoutQueryReport(document, profile);
  const bytes: number[] = [0x1b, 0x40, 0x1b, 0x21, 0, 0x1b, 0x4d, 0, 0x1d, 0x21, 0,
    0x1b, 0x20, 0, 0x1b, 0x52, 0, 0x1b, 0x32, 0x1c, 0x2e, 0x1b, 0x74, 19, 0x1d, 0x4c, 0, 0];
  // Font A, normal scale, no additional character spacing, CP858. Keep the
  // printer's native print area: forcing GS W without model/DPI data is unsafe.
  for (const line of lines) {
    bytes.push(0x1b, 0x61, line.centered ? 1 : 0, 0x1b, 0x45, line.bold ? 1 : 0);
    bytes.push(...encodeQueryReportText(line.centered ? line.text.trim() : line.text), 0x0a);
  }
  // Feed/cut only; no drawer pulse, no persistent memory switch changes.
  bytes.push(0x1b, 0x45, 0, 0x1b, 0x61, 0, 0x0a, 0x0a, 0x1d, 0x56, 66, 0, 0x1b, 0x40);
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
};
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export const buildQueryReportHtml = (document: PosReportDocument, profile: QueryThermalProfile = QUERY_THERMAL_80MM): string => {
  const lines = layoutQueryReport(document, profile);
  const fontMm = profile.printableWidthMm / profile.columns / 0.6;
  const heightMm = Math.ceil(lines.length * fontMm * 1.25 + 6);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(document.title)}</title><style>@page{size:${profile.paperWidthMm}mm ${heightMm}mm;margin:0}html,body{margin:0;padding:0;width:${profile.paperWidthMm}mm}body{color:#000;background:#fff}pre{box-sizing:content-box;width:${profile.printableWidthMm}mm;margin:3mm auto;font-family:"Courier New","Liberation Mono",monospace;font-size:${fontMm}mm;line-height:1.25;font-variant-numeric:tabular-nums;letter-spacing:0;white-space:pre;overflow-wrap:normal;word-break:normal}strong{font-family:inherit;font-size:inherit;font-weight:bold}</style></head><body><pre>${lines.map(line => line.bold ? `<strong>${escapeHtml(line.text)}</strong>` : escapeHtml(line.text)).join('\n')}</pre></body></html>`;
};
