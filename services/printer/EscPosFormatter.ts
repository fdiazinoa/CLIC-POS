import { BusinessConfig, Reservation, Transaction, ZReport } from '../../types';
import { findTaxByIdentifier } from '../../utils/taxIdentity';
import { buildPaymentSettlementSummary } from '../../utils/paymentSettlement';
import { resolveTerminalSellerName } from '../../utils/terminalSnapshotSellers';

export interface EscPosLabelRecord {
  productId: string;
  productName: string;
  sku?: string;
  price?: number;
  copies: number;
}

const ESC = 0x1b;
const GS = 0x1d;
const RECEIPT_LINE_WIDTH = 42;
const LABEL_LINE_WIDTH = 32;

const toAscii = (value: string): string => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
};

const text = (value = ''): Uint8Array => new TextEncoder().encode(`${value}\n`);
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

const splitLines = (textValue: string, width: number): string[] => {
  const clean = toAscii(textValue);
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

const sanitizeRawText = (value = ''): string => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\n]/g, '');
};

const splitRawLines = (textValue: string, width: number): string[] => {
  const normalized = sanitizeRawText(textValue).replace(/\r/g, '');
  const sourceLines = normalized.split('\n');
  const wrappedLines: string[] = [];

  sourceLines.forEach((line) => {
    if (line.length === 0) {
      wrappedLines.push('');
      return;
    }

    for (let index = 0; index < line.length; index += width) {
      wrappedLines.push(line.slice(index, index + width));
    }
  });

  return wrappedLines;
};

const padRight = (value: string, length: number): string => {
  if (value.length >= length) return value.slice(0, length);
  return `${value}${' '.repeat(length - value.length)}`;
};

const linePair = (left: string, right: string, width: number): string[] => {
  const cleanLeft = toAscii(left);
  const cleanRight = toAscii(right);
  if (!cleanRight) {
    return splitLines(cleanLeft, width);
  }

  if (cleanLeft.length + cleanRight.length + 1 <= width) {
    return [`${cleanLeft}${' '.repeat(width - cleanLeft.length - cleanRight.length)}${cleanRight}`];
  }

  const availableLeft = Math.max(8, width - cleanRight.length - 1);
  const leftLines = splitLines(cleanLeft, availableLeft);
  const lines = leftLines.slice(0, -1);
  const lastLeft = leftLines[leftLines.length - 1] || '';

  if (lastLeft.length + cleanRight.length + 1 <= width) {
    lines.push(`${lastLeft}${' '.repeat(width - lastLeft.length - cleanRight.length)}${cleanRight}`);
    return lines;
  }

  lines.push(lastLeft);
  lines.push(`${' '.repeat(Math.max(0, width - cleanRight.length))}${cleanRight}`);
  return lines;
};

const divider = (width: number): Uint8Array => text('-'.repeat(width));
const align = (mode: 0 | 1 | 2): Uint8Array => bytes(ESC, 0x61, mode);
const bold = (enabled: boolean): Uint8Array => bytes(ESC, 0x45, enabled ? 0x01 : 0x00);
const size = (value: number): Uint8Array => bytes(GS, 0x21, value);
const initPrinter = (): Uint8Array => bytes(ESC, 0x40);
const openDrawer = (): Uint8Array => bytes(ESC, 0x70, 0x00, 25, 250);
const fullCut = (): Uint8Array => bytes(GS, 0x56, 66, 0);
const encodeQrModel = (): Uint8Array => bytes(GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
const encodeQrSize = (sizeValue = 6): Uint8Array => bytes(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, Math.max(3, Math.min(8, sizeValue)));
const encodeQrErrorCorrection = (): Uint8Array => bytes(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31);

const pushTextLines = (chunks: Uint8Array[], lines: string[]) => {
  lines.forEach(line => chunks.push(text(line)));
};

const pushPair = (chunks: Uint8Array[], left: string, right: string, width: number) => {
  pushTextLines(chunks, linePair(left, right, width));
};

const pushQrCode = (chunks: Uint8Array[], payload: string) => {
  const normalizedPayload = toAscii(payload);
  if (!normalizedPayload) return;

  const encodedPayload = new TextEncoder().encode(normalizedPayload);
  const storeLength = encodedPayload.length + 3;
  const pL = storeLength % 256;
  const pH = Math.floor(storeLength / 256);

  chunks.push(align(1));
  chunks.push(encodeQrModel());
  chunks.push(encodeQrSize());
  chunks.push(encodeQrErrorCorrection());
  chunks.push(bytes(GS, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30));
  chunks.push(encodedPayload);
  chunks.push(bytes(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30));
  chunks.push(align(0));
};

const formatMoney = (currencySymbol: string, value: number): string => {
  return `${toAscii(currencySymbol || '$')}${Number(value || 0).toFixed(2)}`;
};

const resolveCurrencySymbol = (config: BusinessConfig | undefined, currencyCode: string | undefined): string => {
  if (!currencyCode) return config?.currencySymbol || '$';
  return config?.currencies?.find(currency => currency.code === currencyCode)?.symbol || currencyCode;
};

const shouldOpenDrawerForTransaction = (transaction: Transaction, config: BusinessConfig): boolean => {
  const terminal = (config.terminals || []).find(candidate => candidate.id === transaction.terminalId);
  if (terminal?.config?.hardware?.cashDrawerTrigger !== 'PRINTER') {
    return false;
  }

  const paymentMethods = config.paymentMethods || [];
  return (transaction.payments || []).some((payment: any) => {
    const method = paymentMethods.find(methodDef =>
      (payment?.methodId && methodDef.id === payment.methodId) ||
      (payment?.method && methodDef.type === payment.method)
    );
    return method?.opensDrawer === true;
  });
};

const getItemTaxRate = (item: Transaction['items'][number], config: BusinessConfig): number => {
  if (item.appliedTaxIds && item.appliedTaxIds.length > 0) {
    return item.appliedTaxIds.reduce((sum, id) => {
      const tax = findTaxByIdentifier(config.taxes || [], id);
      return sum + (tax?.rate || 0);
    }, 0);
  }

  return config.taxRate || 0;
};

const calculateTransactionTotals = (transaction: Transaction, config: BusinessConfig) => {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  const isTaxIncluded = transaction.isTaxIncluded || false;

  let rawNetTotal = 0;
  let rawTaxTotal = 0;
  let rawGrossTotal = 0;

  transaction.items.forEach(item => {
    const originalPrice = item.originalPrice || item.price;
    const lineVal = item.price * item.quantity;
    const lineDiscount = (originalPrice - item.price) * item.quantity;

    discountTotal += lineDiscount;
    rawGrossTotal += lineVal;

    const itemTaxRate = getItemTaxRate(item, config);

    let lineNet = 0;
    let lineTax = 0;

    if (isTaxIncluded) {
      lineNet = lineVal / (1 + itemTaxRate);
      lineTax = lineVal - lineNet;
    } else {
      lineNet = lineVal;
      lineTax = lineNet * itemTaxRate;
    }

    rawNetTotal += lineNet;
    rawTaxTotal += lineTax;
  });

  if (transaction.discountAmount && transaction.discountAmount > 0) {
    discountTotal += transaction.discountAmount;

    if (isTaxIncluded) {
      const ratio = (rawGrossTotal - transaction.discountAmount) / (rawGrossTotal || 1);
      subtotal = rawNetTotal * ratio;
      taxTotal = rawTaxTotal * ratio;
    } else {
      subtotal = rawNetTotal - transaction.discountAmount;
      const ratio = subtotal / (rawNetTotal || 1);
      taxTotal = rawTaxTotal * ratio;
    }
  } else {
    subtotal = rawNetTotal;
    taxTotal = rawTaxTotal;
  }

  return {
    subtotal,
    discountTotal,
    taxTotal,
    total: transaction.total || (subtotal + taxTotal)
  };
};

const finalizeReceipt = (chunks: Uint8Array[], options?: { openCashDrawer?: boolean }) => {
  chunks.push(text(''));
  chunks.push(text(''));

  if (options?.openCashDrawer) {
    chunks.push(openDrawer());
  }

  chunks.push(fullCut());
};

const buildReceiptHeader = (chunks: Uint8Array[], config: BusinessConfig, title: string, width: number) => {
  const companyInfo = config.companyInfo;

  chunks.push(initPrinter());
  chunks.push(align(1));
  chunks.push(bold(true));
  chunks.push(size(0x11));
  chunks.push(text(companyInfo.name || 'CLIC POS'));
  chunks.push(size(0x00));
  chunks.push(bold(false));

  [companyInfo.rnc && `RNC: ${companyInfo.rnc}`, companyInfo.address, companyInfo.phone && `TEL: ${companyInfo.phone}`]
    .filter(Boolean)
    .forEach(line => pushTextLines(chunks, splitLines(String(line), width)));

  chunks.push(bold(true));
  pushTextLines(chunks, splitLines(title, width));
  chunks.push(bold(false));
  chunks.push(divider(width));
  chunks.push(align(0));
};

export const buildEscPosTicketPayload = (
  transaction: Transaction,
  config: BusinessConfig,
  users: Array<{ id: string; name: string }> = []
): string | null => {
  if (!transaction?.items?.length) return null;

  const width = RECEIPT_LINE_WIDTH;
  const chunks: Uint8Array[] = [];
  const totals = calculateTransactionTotals(transaction, config);
  const ncfTypeLabels: Record<string, string> = {
    B01: 'FACTURA DE CREDITO FISCAL',
    B02: 'FACTURA DE CONSUMO',
    B04: 'NOTA DE CREDITO',
    B14: 'REGIMENES ESPECIALES',
    B15: 'GUBERNAMENTAL'
  };
  const comprobanteTypeLabels: Record<string, string> = {
    B01: 'CREDITO FISCAL',
    B02: 'CONSUMIDOR FINAL',
    B04: 'NOTA DE CREDITO',
    B14: 'REGIMENES ESPECIALES',
    B15: 'GUBERNAMENTAL'
  };

  const documentTitle = transaction.ncfType
    ? (ncfTypeLabels[transaction.ncfType] || 'FACTURA DE VENTA')
    : 'TICKET DE VENTA';
  const qrPayload = String(transaction.displayId || transaction.id || '').trim();
  const foreignCurrencyLines = config.receiptConfig?.showForeignCurrencyTotals && config.currencies
    ? config.currencies
      .filter(currency => !currency.isBase && currency.isEnabled && Number(currency.rate || 0) > 0)
      .map(currency => ({
        code: currency.code,
        symbol: currency.symbol,
        amount: totals.total / Number(currency.rate || 1)
      }))
    : [];

  buildReceiptHeader(chunks, config, documentTitle, width);

  pushPair(chunks, `Ticket: ${transaction.displayId || transaction.id}`, new Date(transaction.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), width);
  pushTextLines(chunks, splitLines(new Date(transaction.date).toLocaleDateString(), width));
  if (config.receiptConfig?.showOrderNumber && transaction.orderNumber) {
    pushTextLines(chunks, splitLines(`No. Orden: ${transaction.orderNumber}`, width));
  }
  if (transaction.tableDisplayLabel) {
    pushTextLines(chunks, splitLines(`Mesa/Sala: ${transaction.tableDisplayLabel}`, width));
  }

  const snapshot = transaction.customerSnapshot;
  const customerName = (snapshot?.name || transaction.customerName || 'Cliente Mostrador').trim() || 'Cliente Mostrador';
  chunks.push(divider(width));
  pushTextLines(chunks, splitLines(`Cliente: ${customerName}`, width));
  if (snapshot?.taxId) pushTextLines(chunks, splitLines(`RNC/Ced: ${snapshot.taxId}`, width));
  if (snapshot?.phone) pushTextLines(chunks, splitLines(`Tel: ${snapshot.phone}`, width));

  chunks.push(divider(width));
  transaction.items.forEach(item => {
    pushTextLines(chunks, splitLines(item.name || 'Articulo', width));
    const qtyText = `${Number(item.quantity || 0).toFixed(item.quantity % 1 === 0 ? 0 : 3)} x ${formatMoney(config.currencySymbol || '$', item.price)}`;
    const lineTotal = formatMoney(config.currencySymbol || '$', item.price * item.quantity);
    pushPair(chunks, qtyText, lineTotal, width);

    if (item.variantInfo) {
      pushTextLines(chunks, splitLines(`Variante: ${item.variantInfo}`, width));
    }
    if (item.note) {
      pushTextLines(chunks, splitLines(`Nota: ${item.note}`, width));
    }
    if (item.salespersonId) {
      const sellerName = resolveTerminalSellerName(item.salespersonId, config, transaction.terminalId, users);
      if (sellerName) {
        pushTextLines(chunks, splitLines(`Vendedor: ${sellerName}`, width));
      }
    }
  });

  chunks.push(divider(width));
  pushPair(chunks, 'SUBTOTAL', formatMoney(config.currencySymbol || '$', totals.subtotal), width);
  if (totals.taxTotal > 0) {
    pushPair(chunks, 'ITBIS', formatMoney(config.currencySymbol || '$', totals.taxTotal), width);
  }
  if (totals.discountTotal > 0) {
    pushPair(chunks, 'DESCUENTO', formatMoney(config.currencySymbol || '$', totals.discountTotal), width);
  }
  chunks.push(bold(true));
  pushPair(chunks, 'TOTAL', formatMoney(config.currencySymbol || '$', totals.total), width);
  chunks.push(bold(false));

  if (foreignCurrencyLines.length > 0) {
    chunks.push(divider(width));
    foreignCurrencyLines.forEach(currency => {
      pushPair(
        chunks,
        currency.code,
        formatMoney(currency.symbol || currency.code, currency.amount),
        width
      );
    });
  }

  if (config.receiptConfig?.showSavings && totals.discountTotal > 0) {
    chunks.push(divider(width));
    chunks.push(align(1));
    chunks.push(bold(true));
    pushTextLines(chunks, splitLines('USTED AHORRO', width));
    pushTextLines(chunks, splitLines(formatMoney(config.currencySymbol || '$', totals.discountTotal), width));
    chunks.push(bold(false));
    chunks.push(align(0));
  }

  if ((transaction.payments || []).length > 0) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('PAGOS', width));
    const baseCurrencyCode = config.currencies?.find(currency => currency.isBase)?.code || 'DOP';
    const settlementSummary = buildPaymentSettlementSummary(
      Array.isArray(transaction.payments) ? transaction.payments as any : [],
      Number(totals.total || transaction.total || 0),
      baseCurrencyCode
    );
    const settlementLineById = new Map(settlementSummary.lines.map(line => [line.paymentId, line]));

    (settlementSummary.payments || []).forEach((payment: any) => {
      const settlementLine = settlementLineById.get(payment?.id);
      const methodLabel = payment?.methodLabel || payment?.methodId || payment?.method || 'PAGO';
      const paymentCurrencyCode = settlementLine?.currencyCode || payment?.currencyCode || baseCurrencyCode;
      const paymentCurrencySymbol = resolveCurrencySymbol(config, paymentCurrencyCode);
      const appliedBase = Number((settlementLine?.appliedBase ?? payment?.appliedAmount ?? payment?.amount) || 0);
      const receivedBase = Number((settlementLine?.receivedBase ?? payment?.amount) || 0);
      const receivedOriginal = Number((settlementLine?.receivedOriginal ?? payment?.amountOriginal ?? payment?.amount) || 0);
      const changeBase = Number((settlementLine?.changeBase ?? payment?.changeAmount) || 0);
      const exchangeRate = Number((settlementLine?.exchangeRate ?? payment?.exchangeRate) || 1);
      pushPair(chunks, methodLabel, formatMoney(config.currencySymbol || '$', appliedBase), width);
      if (paymentCurrencyCode !== baseCurrencyCode) {
        pushPair(chunks, 'Recibido', `${paymentCurrencySymbol}${receivedOriginal.toFixed(2)}`, width);
        pushPair(chunks, 'Tasa', formatMoney(config.currencySymbol || '$', exchangeRate), width);
      }
      if (paymentCurrencyCode !== baseCurrencyCode || Math.abs(receivedBase - appliedBase) > 0.0001) {
        pushPair(chunks, 'Equivalente', formatMoney(config.currencySymbol || '$', receivedBase), width);
      }
      if (changeBase > 0.0001) {
        pushPair(chunks, 'Cambio', formatMoney(config.currencySymbol || '$', changeBase), width);
      }
      const showAzulRefs =
        payment?.gatewayProvider === 'AZUL' || payment?.gatewayAuthorizationCode || payment?.gatewayReference;
      if (showAzulRefs) {
        if (payment?.gatewayAuthorizationCode) {
          pushTextLines(chunks, splitLines(`AUT No.: ${payment.gatewayAuthorizationCode}`, width));
        }
        if (payment?.gatewayReference) {
          pushTextLines(chunks, splitLines(`Ref No.: ${payment.gatewayReference}`, width));
        }
      }
    });

    pushPair(chunks, 'TOTAL APLICADO', formatMoney(config.currencySymbol || '$', settlementSummary.totalAppliedBase), width);
    if (settlementSummary.hasForeignCurrency || Math.abs(settlementSummary.totalReceivedBase - settlementSummary.totalAppliedBase) > 0.0001) {
      pushPair(chunks, 'TOTAL RECIBIDO', formatMoney(config.currencySymbol || '$', settlementSummary.totalReceivedBase), width);
    }
    if (settlementSummary.totalChangeBase > 0.0001) {
      pushPair(chunks, 'CAMBIO', formatMoney(config.currencySymbol || '$', settlementSummary.totalChangeBase), width);
    }
  }

  if (transaction.affectedInvoiceNumber || transaction.affectedNCF) {
    chunks.push(divider(width));
    if (transaction.affectedInvoiceNumber) {
      pushTextLines(chunks, splitLines(`Factura Afectada: ${transaction.affectedInvoiceNumber}`, width));
    }
    if (transaction.affectedNCF) {
      pushTextLines(chunks, splitLines(`NCF Afectado: ${transaction.affectedNCF}`, width));
    }
  }

  chunks.push(divider(width));
  const footerLines = (config.receiptConfig?.footerMessage || 'Gracias por su compra.\nVuelva pronto.')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  if (config.receiptConfig?.showQr && qrPayload) {
    chunks.push(align(0));
    if (transaction.ncfType) {
      pushTextLines(chunks, splitLines(comprobanteTypeLabels[transaction.ncfType] || transaction.ncfType, width));
    }
    if (transaction.ncf) {
      pushTextLines(chunks, splitLines(transaction.ncf, width));
    }
    chunks.push(divider(width));
    chunks.push(align(1));
    pushTextLines(chunks, splitLines('ESCANEA ESTE TICKET PARA DEVOLUCIONES Y CUPONES', width));
    pushQrCode(chunks, qrPayload);
    chunks.push(align(0));
  }

  chunks.push(align(1));
  footerLines.forEach(line => pushTextLines(chunks, splitLines(line, width)));
  chunks.push(align(0));
  finalizeReceipt(chunks, {
    openCashDrawer: shouldOpenDrawerForTransaction(transaction, config)
  });

  return toBase64(concat(chunks));
};

export const buildEscPosVoucherPayload = (
  providerLabel: string,
  copyLabel: string,
  receiptText: string
): string | null => {
  const normalizedText = String(receiptText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
  if (!normalizedText.trim()) return null;

  const width = RECEIPT_LINE_WIDTH;
  const chunks: Uint8Array[] = [];

  chunks.push(initPrinter());
  chunks.push(align(1));
  chunks.push(bold(true));
  pushTextLines(chunks, splitLines(providerLabel || 'VOUCHER', width));
  pushTextLines(chunks, splitLines(copyLabel, width));
  chunks.push(bold(false));
  chunks.push(divider(width));
  chunks.push(align(0));

  splitRawLines(normalizedText, width).forEach((line) => {
    chunks.push(text(line));
  });

  finalizeReceipt(chunks);
  return toBase64(concat(chunks));
};

export const buildEscPosReservationPayload = (reservation: Reservation, config: BusinessConfig): string | null => {
  if (!reservation?.items?.length) return null;

  const width = RECEIPT_LINE_WIDTH;
  const chunks: Uint8Array[] = [];

  buildReceiptHeader(chunks, config, 'NOTA DE RESERVA', width);

  pushTextLines(chunks, splitLines(`Codigo: ${reservation.code}`, width));
  pushPair(chunks, 'Fecha Doc', new Date(reservation.createdAt).toLocaleDateString(), width);
  if (reservation.deliveryDate) {
    pushPair(chunks, 'Entrega', new Date(reservation.deliveryDate).toLocaleDateString(), width);
  }
  pushPair(chunks, 'Vence', new Date(reservation.expiryDate).toLocaleDateString(), width);

  chunks.push(divider(width));
  pushTextLines(chunks, splitLines(`Cliente: ${reservation.customerName}`, width));

  chunks.push(divider(width));
  reservation.items.forEach(item => {
    pushTextLines(chunks, splitLines(item.name || 'Articulo', width));
    pushPair(
      chunks,
      `${Number(item.quantity || 0).toFixed(item.quantity % 1 === 0 ? 0 : 3)} x ${formatMoney(config.currencySymbol || '$', item.price)}`,
      formatMoney(config.currencySymbol || '$', item.price * item.quantity),
      width
    );
  });

  chunks.push(divider(width));
  pushPair(chunks, 'TOTAL RESERVA', formatMoney(config.currencySymbol || '$', reservation.total), width);
  pushPair(chunks, 'ABONO', formatMoney(config.currencySymbol || '$', reservation.balancePaid), width);
  pushPair(chunks, 'SALDO', formatMoney(config.currencySymbol || '$', reservation.total - reservation.balancePaid), width);

  if (reservation.notes) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines(`Nota: ${reservation.notes}`, width));
  }

  if (reservation.qrPayload) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('ESCANEA PARA RECUPERAR ESTA RESERVA', width));
    pushQrCode(chunks, reservation.qrPayload);
    chunks.push(align(1));
    pushTextLines(chunks, splitLines(reservation.code || reservation.qrPayload, width));
    chunks.push(align(0));
  }

  chunks.push(divider(width));
  chunks.push(align(1));
  pushTextLines(chunks, splitLines(config.receiptConfig?.footerMessage || 'Gracias por su preferencia.', width));
  chunks.push(align(0));
  finalizeReceipt(chunks);

  return toBase64(concat(chunks));
};

export const buildEscPosZReportPayload = (
  report: ZReport,
  hiddenModules: string[] = [],
  config?: BusinessConfig
): string | null => {
  if (!report) return null;

  const width = RECEIPT_LINE_WIDTH;
  const chunks: Uint8Array[] = [];
  const currencySymbol = resolveCurrencySymbol(config, report.baseCurrency);
  const totalCollected = Object.values(report.totalsByMethod || {}).reduce((sum, value) => sum + Number(value || 0), 0);

  chunks.push(initPrinter());
  chunks.push(align(1));
  chunks.push(bold(true));
  pushTextLines(chunks, splitLines(config?.companyInfo?.name || 'CLIC POS', width));
  chunks.push(size(0x11));
  pushTextLines(chunks, splitLines('REPORTE DE CIERRE (Z)', width));
  chunks.push(size(0x00));
  pushTextLines(chunks, splitLines(report.sequenceNumber || report.id, width));
  chunks.push(bold(false));
  chunks.push(align(0));
  chunks.push(divider(width));

  pushPair(chunks, 'Fecha', new Date(report.closedAt).toLocaleString(), width);
  pushPair(chunks, 'Cajero', report.closedByUserName || 'N/D', width);
  pushPair(chunks, 'Terminal', report.terminalId || 'POS-01', width);

  if (!hiddenModules.includes('FINANCIAL')) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('RESUMEN FINANCIERO', width));
    pushPair(chunks, 'Ventas Brutas', formatMoney(currencySymbol, report.stats?.grossSales || 0), width);
    pushPair(chunks, 'Devoluciones', formatMoney(currencySymbol, report.stats?.returnsTotal || 0), width);
    pushPair(chunks, 'Ventas Netas', formatMoney(currencySymbol, report.stats?.netSales || 0), width);
    pushPair(chunks, 'Recaudado', formatMoney(currencySymbol, totalCollected), width);
    pushPair(chunks, 'Transacciones', String(report.transactionCount || 0), width);
  }

  if (!hiddenModules.includes('PAYMENTS') && Object.keys(report.totalsByMethod || {}).length > 0) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('METODOS DE PAGO', width));
    Object.entries(report.totalsByMethod).forEach(([method, amount]) => {
      pushPair(chunks, method, formatMoney(currencySymbol, amount), width);
    });
  }

  if (!hiddenModules.includes('CASH_DETAILS') && Object.keys(report.cashExpected || {}).length > 0) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('ARQUEO DE CAJA', width));
    Object.keys(report.cashExpected).forEach(currency => {
      pushTextLines(chunks, splitLines(currency, width));
      pushPair(chunks, 'Esperado', Number(report.cashExpected[currency] || 0).toFixed(2), width);
      pushPair(chunks, 'Contado', Number(report.cashCounted[currency] || 0).toFixed(2), width);
      pushPair(chunks, 'Diferencia', Number(report.cashDiscrepancy[currency] || 0).toFixed(2), width);
    });
  }

  if (!hiddenModules.includes('AUDIT') && report.stats) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines('AUDITORIA', width));
    pushPair(chunks, 'Devoluciones', `${report.stats.returnsCount || 0}`, width);
    pushPair(chunks, 'Monto Dev.', formatMoney(currencySymbol, report.stats.returnsTotal || 0), width);
    pushPair(chunks, 'Descuentos', formatMoney(currencySymbol, report.stats.discountsTotal || 0), width);
  }

  if (report.notes) {
    chunks.push(divider(width));
    pushTextLines(chunks, splitLines(`Notas: ${report.notes}`, width));
  }

  chunks.push(divider(width));
  chunks.push(align(1));
  pushTextLines(chunks, splitLines('Firma del Cajero', width));
  chunks.push(align(0));
  finalizeReceipt(chunks);

  return toBase64(concat(chunks));
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

  chunks.push(initPrinter());
  chunks.push(align(1));
  chunks.push(bold(true));
  chunks.push(text(toAscii(header)));
  chunks.push(bold(false));
  chunks.push(divider(LABEL_LINE_WIDTH));

  prepared.forEach(record => {
    chunks.push(align(1));
    splitLines(record.productName || record.productId, LABEL_LINE_WIDTH).forEach(line => {
      chunks.push(text(line));
    });

    chunks.push(align(0));
    const sku = toAscii(record.sku || record.productId || 'SIN-SKU');
    chunks.push(text(padRight(`SKU: ${sku}`, LABEL_LINE_WIDTH)));

    if (typeof record.price === 'number') {
      const amount = `${currencySymbol}${record.price.toFixed(2)}`;
      chunks.push(text(padRight(`PRECIO: ${toAscii(amount)}`, LABEL_LINE_WIDTH)));
    }

    chunks.push(align(1));
    chunks.push(text(`*${sku}*`));
    chunks.push(align(0));
    chunks.push(divider(LABEL_LINE_WIDTH));
  });

  finalizeReceipt(chunks);
  return toBase64(concat(chunks));
};
