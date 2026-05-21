import { LabelElement, LabelTemplate } from '../../types';

export interface ZplLabelRecord {
  productId: string;
  productName: string;
  sku?: string;
  price?: number;
  copies: number;
}

const DEFAULT_DPI = 203;

const toAscii = (value: string): string => (
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
);

const toBase64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const mmToDots = (value: number, dpi = DEFAULT_DPI): number => (
  Math.max(0, Math.round((Number(value) || 0) * dpi / 25.4))
);

const zplText = (value: string): string => (
  toAscii(value)
    .replace(/\^/g, ' ')
    .replace(/~/g, ' ')
    .replace(/\\/g, '/')
);

const elementValue = (
  element: LabelElement,
  record: ZplLabelRecord,
  currencySymbol: string
): string => {
  switch (element.dataSource) {
    case 'PRODUCT_NAME':
      return record.productName || element.content || '';
    case 'PRODUCT_PRICE':
      return typeof record.price === 'number' ? `${currencySymbol}${record.price.toFixed(2)}` : element.content || '';
    case 'PRODUCT_SKU':
      return record.sku || record.productId || element.content || '';
    case 'CUSTOM_TEXT':
    default:
      return element.content || '';
  }
};

const renderTextElement = (
  element: LabelElement,
  record: ZplLabelRecord,
  currencySymbol: string
): string => {
  const x = mmToDots(element.x);
  const y = mmToDots(element.y);
  const width = Math.max(40, mmToDots(element.width));
  const fontSize = Math.max(18, Math.round((element.fontSize || 10) * 2.4));
  const value = zplText(elementValue(element, record, currencySymbol));
  const font = element.isBold ? 'A0N' : 'A0N';

  return `^FO${x},${y}^${font},${fontSize},${fontSize}^FB${width},1,0,L,0^FD${value}^FS`;
};

const renderBarcodeElement = (
  element: LabelElement,
  record: ZplLabelRecord,
  currencySymbol: string
): string => {
  const x = mmToDots(element.x);
  const y = mmToDots(element.y);
  const width = Math.max(80, mmToDots(element.width));
  const height = Math.max(28, mmToDots(element.height));
  const value = zplText(elementValue(element, record, currencySymbol));
  if (!value) return '';

  const moduleWidth = Math.max(1, Math.min(3, Math.floor(width / Math.max(60, value.length * 12))));
  return `^FO${x},${y}^BY${moduleWidth},2,${height}^BCN,${height},Y,N,N^FD${value}^FS`;
};

const renderQrElement = (
  element: LabelElement,
  record: ZplLabelRecord,
  currencySymbol: string
): string => {
  const x = mmToDots(element.x);
  const y = mmToDots(element.y);
  const height = Math.max(32, mmToDots(element.height));
  const value = zplText(elementValue(element, record, currencySymbol));
  if (!value) return '';

  const magnification = Math.max(3, Math.min(8, Math.floor(height / 24)));
  return `^FO${x},${y}^BQN,2,${magnification}^FDLA,${value}^FS`;
};

const renderElement = (
  element: LabelElement,
  record: ZplLabelRecord,
  currencySymbol: string
): string => {
  if (element.type === 'BARCODE') {
    return renderBarcodeElement(element, record, currencySymbol);
  }
  if (element.type === 'QR') {
    return renderQrElement(element, record, currencySymbol);
  }
  return renderTextElement(element, record, currencySymbol);
};

export const buildZplLabelPayload = (
  template: LabelTemplate,
  records: ZplLabelRecord[],
  currencySymbol: string
): string | null => {
  const prepared = records
    .filter(record => Number.isFinite(record.copies) && record.copies > 0)
    .flatMap(record => Array.from({ length: Math.floor(record.copies) }, () => ({ ...record, copies: 1 })));

  if (!prepared.length) return null;

  const widthDots = Math.max(1, mmToDots(template.widthMm));
  const heightDots = Math.max(1, mmToDots(template.heightMm));

  const zpl = prepared
    .map(record => [
      '^XA',
      '^CI28',
      `^PW${widthDots}`,
      `^LL${heightDots}`,
      '^LH0,0',
      '^PON',
      template.elements.map(element => renderElement(element, record, currencySymbol)).filter(Boolean).join('\n'),
      '^XZ'
    ].join('\n'))
    .join('\n');

  return toBase64(zpl);
};
