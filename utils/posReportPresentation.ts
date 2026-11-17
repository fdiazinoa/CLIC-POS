export const POS_REPORT_COLUMNS = 32;

// Match the printer's ASCII encoding before measuring physical columns. Keep
// alignment spaces and line feeds, but never allow embedded ESC/POS commands.
export const reportPrintableText = (text: string): string => String(text || '')
  .replace(/\r\n?/g, '\n').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\x20-\x7e\n]/g, '');

const wrapLine = (line: string, width: number): string[] => {
  const rows: string[] = [];
  let remaining = line;
  while (remaining.length > width) {
    const space = remaining.lastIndexOf(' ', width);
    const split = space > 0 ? space : width;
    rows.push(remaining.slice(0, split));
    remaining = remaining.slice(split).trimStart();
  }
  rows.push(remaining);
  return rows;
};

/** Idempotent: an already prepared preview retains every alignment space. */
export const preparePosReportText = (text: string, width = POS_REPORT_COLUMNS): string => {
  if (!Number.isInteger(width) || width < 1) throw new Error('Ancho de informe no válido.');
  return reportPrintableText(text).split('\n').flatMap(line => {
    const pair = line.trim().match(/^(?:(.*\S)\s+)?([^:\s]+) (-?(?:\d+\.\d+|\d+(?:\.\d+)?e[+-]?\d+))$/);
    if (!pair) return wrapLine(line, width);
    const label = (pair[1] || '').trim();
    const amount = `${pair[2]} ${pair[3]}`;
    if (amount.length > width) throw new Error('El importe no cabe en el formato de 32 columnas. No se envió a imprimir.');
    if (!label) return [amount.padStart(width)];
    if (label.length + amount.length + 1 <= width) return [label + ' '.repeat(width - label.length - amount.length) + amount];
    return [...wrapLine(label, width), amount.padStart(width)];
  }).join('\n');
};

export const compactReportDateTime = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export const reportHeading = (text: string): string => preparePosReportText(text).split('\n')
  .map(line => line.padStart(Math.floor((POS_REPORT_COLUMNS + line.length) / 2))).join('\n');
