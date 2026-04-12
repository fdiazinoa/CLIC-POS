import { Transaction, BusinessConfig, Reservation, CartItem, Table } from '../types';
import { PrintRouterService } from '../services/printer/PrintRouterService';
import { buildEscPosReservationPayload, buildEscPosTicketPayload, buildEscPosVoucherPayload } from '../services/printer/EscPosFormatter';
import { shouldSuppressBrowserPrintFallback } from '../services/printer/PrintRuntime';
import { dbAdapter } from '../services/db';
import { calculateTaxBreakdownFromItems, calculateTransactionFiscalSummary, formatTaxLineLabel } from './fiscalBreakdown';
import { buildPaymentSettlementSummary, resolveCurrencySymbol } from './paymentSettlement';

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const escapeHtml = (value: string): string => {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

const normalizeVoucherText = (value?: string): string => {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trimEnd();
};

const buildGatewayVoucherHtml = (providerLabel: string, copyLabel: string, voucherText: string): string => `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${escapeHtml(providerLabel)} - ${escapeHtml(copyLabel)}</title>
        <style>
            @page { size: 80mm auto; margin: 0; }
            body {
                font-family: 'Courier New', Courier, monospace;
                width: 72mm;
                margin: 0 auto;
                padding: 4mm;
                font-size: 12px;
                line-height: 1.25;
                color: #000;
                background: #fff;
            }
            .header {
                text-align: center;
                margin-bottom: 8px;
            }
            .title {
                font-size: 16px;
                font-weight: 900;
                text-transform: uppercase;
            }
            .subtitle {
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                margin-top: 4px;
            }
            .divider {
                border-top: 1px dashed #000;
                margin: 8px 0;
            }
            pre {
                white-space: pre-wrap;
                word-break: break-word;
                margin: 0;
                font-family: inherit;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <div class="title">${escapeHtml(providerLabel)}</div>
            <div class="subtitle">${escapeHtml(copyLabel)}</div>
        </div>
        <div class="divider"></div>
        <pre>${escapeHtml(voucherText)}</pre>
        <script>
            window.onload = function () {
                setTimeout(() => window.print(), 300);
            };
        </script>
    </body>
    </html>
`;

const printGatewayVoucher = async (
    config: BusinessConfig,
    params: {
        providerLabel: string;
        copyLabel: string;
        voucherText: string;
        referenceId: string;
        terminalId?: string;
    }
): Promise<boolean> => {
    const normalizedText = normalizeVoucherText(params.voucherText);
    if (!normalizedText) return false;

    const silentHtml = buildGatewayVoucherHtml(params.providerLabel, params.copyLabel, normalizedText).replace(
        /<script>[\s\S]*?window\.onload[\s\S]*?<\/script>/,
        ''
    );
    const escPosBase64 = buildEscPosVoucherPayload(params.providerLabel, params.copyLabel, normalizedText);

    let printedSilently = false;

    if (escPosBase64) {
        printedSilently = await PrintRouterService.routeAndPrintEscPos({
            config,
            escPosBase64,
            role: 'TICKET',
            terminalId: params.terminalId,
            jobType: 'PAYMENT_VOUCHER',
            referenceId: params.referenceId,
        });
    }

    if (printedSilently) return true;

    if (!shouldSuppressBrowserPrintFallback()) {
        printedSilently = await PrintRouterService.routeAndPrintHtml({
            config,
            html: silentHtml,
            role: 'TICKET',
            terminalId: params.terminalId,
            jobType: 'PAYMENT_VOUCHER',
            referenceId: params.referenceId,
        });
    }

    if (printedSilently) return true;

    if (shouldSuppressBrowserPrintFallback()) {
        console.warn('Silent native voucher print failed; browser print fallback suppressed.');
        return false;
    }

    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
        printWindow.document.write(buildGatewayVoucherHtml(params.providerLabel, params.copyLabel, normalizedText));
        printWindow.document.close();
        return true;
    }

    alert('Por favor, permita las ventanas emergentes para imprimir el voucher.');
    return false;
};

export const printGatewayReceipt = async (
    config: BusinessConfig,
    params: {
        providerLabel: string;
        copyLabel: string;
        voucherText: string;
        referenceId: string;
        terminalId?: string;
    }
): Promise<boolean> => printGatewayVoucher(config, params);

export const printTicket = async (transaction: Transaction, config: BusinessConfig): Promise<boolean> => {
    const { companyInfo, currencySymbol, receiptConfig, currencies } = config;
    const users = ((await dbAdapter.getCollection('users')) || []) as any[];
    const dateStr = new Date(transaction.date).toLocaleDateString();
    const timeStr = new Date(transaction.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const terminalConfig = config.terminals?.find(t => t.id === transaction.terminalId)?.config;

    // Calculate totals and savings
    let discountTotal = 0;
    const isTaxIncluded = transaction.isTaxIncluded || false;

    transaction.items.forEach(item => {
        const originalPrice = item.originalPrice || item.price;
        discountTotal += (originalPrice - item.price) * item.quantity;
    });

    if (transaction.discountAmount && transaction.discountAmount > 0) {
        discountTotal += transaction.discountAmount;
    }

    const fiscalSummary = calculateTransactionFiscalSummary(transaction, config, { terminalConfig });
    const subtotal = fiscalSummary.subtotal;
    const taxTotal = fiscalSummary.taxTotal;
    const finalTotal = fiscalSummary.total;
    const savings = discountTotal;

    // NCF Type Label Map
    const ncfTypeLabels: Record<string, string> = {
        'B01': 'FACTURA DE CRÉDITO FISCAL',
        'B02': 'FACTURA DE CONSUMO',
        'B04': 'NOTA DE CRÉDITO',
        'B14': 'REGÍMENES ESPECIALES',
        'B15': 'GUBERNAMENTAL'
    };
    const comprobanteTypeLabels: Record<string, string> = {
        'B01': 'Crédito Fiscal',
        'B02': 'Consumidor Final',
        'B04': 'Nota de Crédito',
        'B14': 'Regímenes Especiales',
        'B15': 'Gubernamental'
    };

    const documentTitle = transaction.ncfType ? (ncfTypeLabels[transaction.ncfType] || 'FACTURA DE VENTA') : 'TICKET DE VENTA';
    const isCreditNote = transaction.ncfType === 'B04' || transaction.documentType === 'REFUND';
    const qrPayload = String(transaction.displayId || transaction.id || '').trim();

    // Foreign Currency Calculation
    const foreignCurrenciesHtml = receiptConfig?.showForeignCurrencyTotals && currencies ? currencies
        .filter(c => !c.isBase && c.isEnabled)
        .map(c => {
            const converted = finalTotal / c.rate;
            return `<div class="meta-row" style="font-size: 11px; font-weight: bold;">${c.code}: ${c.symbol}${converted.toFixed(2)}</div>`;
        }).join('') : '';

    // Generate HTML content for the receipt
    const receiptHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Ticket #${transaction.displayId || transaction.id}</title>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
            <style>
                @page { size: 80mm auto; margin: 0; }
                body {
                    font-family: 'Courier New', Courier, monospace;
                    width: 72mm;
                    margin: 0 auto;
                    padding: 4mm;
                    font-size: 14px;
                    line-height: 1.2;
                    color: #000;
                    background: #fff;
                }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .text-left { text-align: left; }
                .font-bold { font-weight: 700; }
                .font-black { font-weight: 900; }
                
                .header-logo {
                    display: block;
                    margin: 0 auto 5px auto;
                    max-width: 100%;
                    height: auto;
                    object-fit: contain;
                    filter: grayscale(100%) contrast(150%);
                }
                
                .company-name { font-size: 18px; font-weight: 900; margin-bottom: 2px; text-transform: uppercase; }
                .company-info { font-size: 12px; color: #000; }
                
                .divider { border-top: 1px dashed #000; margin: 8px 0; }
                .divider-solid { border-top: 2px solid #000; margin: 8px 0; }
                
                .doc-title { font-size: 16px; font-weight: 900; text-transform: uppercase; margin-bottom: 2px; }
                .ncf-row { font-size: 14px; font-weight: 700; margin-bottom: 2px; }
                .meta-row { font-size: 12px; color: #000; }

                .items-table { width: 100%; border-collapse: collapse; margin-top: 5px; }
                .items-table th { text-align: left; font-size: 12px; border-bottom: 1px solid #000; padding-bottom: 2px; }
                .items-table td { padding: 4px 0; vertical-align: top; border-bottom: none; }
                
                .item-name { font-weight: 700; font-size: 14px; display: block; }
                .item-meta { font-size: 12px; color: #000; display: block; line-height: 1.1; margin-left: 5px; }
                .item-price { text-align: right; font-weight: 700; font-size: 14px; white-space: nowrap; }

                .totals-section { margin-top: 5px; }
                .total-row { display: flex; justify-content: space-between; margin-bottom: 2px; font-size: 14px; }
                .total-final { font-size: 20px; font-weight: 900; margin-top: 5px; border-top: 2px solid #000; padding-top: 5px; }
                
                .savings-box {
                    border: 2px solid #000;
                    padding: 5px;
                    margin: 10px 0;
                    text-align: center;
                    font-weight: 700;
                    font-size: 14px;
                }
                
                .footer { margin-top: 15px; text-align: center; font-size: 11px; }
                
                #qrcode {
                    width: 80px;
                    height: 80px;
                    margin: 10px auto;
                }
                #qrcode img { margin: 0 auto; }
            </style>
        </head>
        <body>
            <div class="text-center">
                ${receiptConfig?.logo ? `<img src="${receiptConfig.logo}" class="header-logo" alt="Logo" />` : ''}
                <div class="company-name">${companyInfo.name}</div>
                <div class="company-info">
                    <div>RNC: ${companyInfo.rnc}</div>
                    <div>${companyInfo.address}</div>
                    <div>TEL: ${companyInfo.phone}</div>
                </div>
            </div>

            <div class="divider"></div>
            
            <div class="text-center">
                <div class="doc-title">${documentTitle}</div>
                <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                    <div class="meta-row" style="font-weight: bold;">Ticket: ${transaction.displayId || transaction.id}</div>
                    <div class="meta-row">${dateStr} ${timeStr}</div>
                </div>
            </div>

            <div class="divider"></div>

            ${(() => {
            const snapshot = transaction.customerSnapshot;
            const name = snapshot?.name || transaction.customerName || 'Cliente Mostrador';
            const cleanName = (name === 'null' || !name) ? 'Cliente Mostrador' : name;

            let html = `<div class="text-left" style="margin-bottom: 5px;">
                    <div style="font-weight: bold;">Cliente: ${cleanName}</div>`;

            if (snapshot && cleanName !== 'Cliente Mostrador') {
                if (snapshot.taxId) html += `<div class="meta-row">RNC/Ced: ${snapshot.taxId}</div>`;
                if (snapshot.address) html += `<div class="meta-row">Dir: ${snapshot.address}</div>`;
                if (snapshot.phone) html += `<div class="meta-row">Tel: ${snapshot.phone}</div>`;
                if (snapshot.email) html += `<div class="meta-row">Email: ${snapshot.email}</div>`;
            }

            html += `</div>`;
            return html;
        })()}

            <div class="divider"></div>

            <table class="items-table">
                <tbody>
                    ${transaction.items.map(item => {
            const lineVal = item.price * item.quantity;
            const itemTaxBreakdown = calculateTaxBreakdownFromItems([item], config, {
                isTaxIncluded,
                terminalConfig,
                absoluteLineValues: true,
            });
            const iTax = Math.abs(itemTaxBreakdown.reduce((sum, tax) => sum + Number(tax.amount || 0), 0));
            const taxLineHtml = itemTaxBreakdown.length > 0
                ? `<br/>${itemTaxBreakdown.map(tax => `${formatTaxLineLabel(tax)}: ${currencySymbol}${Number(tax.amount || 0).toFixed(2)}`).join('<br/>')}`
                : '';
            const originalPrice = item.originalPrice || item.price;
            const hasDiscount = originalPrice > item.price;

            const trackingHtml = [];
            if (item.trackingData && item.trackingData.length > 0) {
                if (receiptConfig?.showSerialNumbers) {
                    const serials = item.trackingData.filter(t => t.type === 'SERIE' || t.type === 'SERIAL').map(t => t.trackingCode);
                    if (serials.length > 0) {
                        trackingHtml.push(`No. Serie: ${serials.join(', ')}`);
                    }
                }
                if (receiptConfig?.showLotNumbers) {
                    const lots = item.trackingData.filter(t => t.type === 'LOTE' || t.type === 'LOT').map(t => t.trackingCode);
                    if (lots.length > 0) {
                        trackingHtml.push(`Lote: ${lots.join(', ')}`);
                    }
                }
            }
            const hasTrackingHtml = trackingHtml.length > 0;
            let sellerNameHtml = '';
            if (item.salespersonId) {
                const sellerUser = users.find((u: any) => u.id === item.salespersonId);
                const sellerName = sellerUser ? sellerUser.name.split(' ')[0] : 'Vendedor';
                sellerNameHtml = `<br/>Vendedor: ${sellerName}`;
            }

            return `
                        <tr>
                            <td style="width: 70%;">
                                <span class="item-name">${item.name}</span>
                                <span class="item-meta">
                                    ${item.quantity} x ${currencySymbol}${item.price.toFixed(2)}
                                    ${hasDiscount ? `<span style="text-decoration: line-through; color: #999; margin-left: 5px;">${currencySymbol}${originalPrice.toFixed(2)}</span>` : ''}
                                    ${item.modifiers ? `<br/>Op: ${item.modifiers.join(', ')}` : ''}
                                    ${taxLineHtml || `<br/>Impuestos: ${currencySymbol}${iTax.toFixed(2)}`}
                                    ${sellerNameHtml}
                                    ${hasTrackingHtml ? `<br/>${trackingHtml.join('<br/>')}` : ''}
                                </span>
                            </td>
                            <td class="item-price">
                                ${currencySymbol}${lineVal.toFixed(2)}
                            </td>
                        </tr>
                    `}).join('')}
                </tbody>
            </table>

            <div class="divider"></div>

            <div class="totals-section">
                <div class="total-row">
                    <span>SUBTOTAL</span>
                    <span>${currencySymbol}${(subtotal || 0).toFixed(2)}</span>
                </div>
                ${discountTotal > 0 ? `
                <div class="total-row">
                    <span>DESCUENTO TOTAL</span>
                    <span>-${currencySymbol}${(discountTotal || 0).toFixed(2)}</span>
                </div>` : ''}
                <div class="total-row">
                    <span>TOTAL IMPUESTOS</span>
                    <span>${currencySymbol}${(taxTotal || 0).toFixed(2)}</span>
                </div>
                
                <div class="total-row total-final">
                    <span>TOTAL</span>
                    <span>${currencySymbol}${(finalTotal || 0).toFixed(2)}</span>
                </div>
                
                ${foreignCurrenciesHtml ? `
                <div class="currency-section">
                    ${foreignCurrenciesHtml}
                </div>
                ` : ''}
            </div>

            ${receiptConfig?.showSavings && savings > 0 ? `
            <div class="savings-box">
                <div>¡USTED HA AHORRADO!</div>
                <div style="font-size: 16px;">${currencySymbol}${savings.toFixed(2)}</div>
            </div>
            ` : ''}

            ${(() => {
            const payments = transaction.payments || [];
            const baseCurrencyCode = config.currencies?.find(currency => currency.isBase)?.code || 'DOP';
            const settlementSummary = buildPaymentSettlementSummary(payments as any, finalTotal || transaction.total || 0, baseCurrencyCode);
            const settlementLineById = new Map(settlementSummary.lines.map(line => [line.paymentId, line]));

            if (payments.length === 0) return '';

            return `
                <div class="divider"></div>
                <div class="totals-section">
                    <div style="font-weight: bold; margin-bottom: 4px; font-size: 10px;">FORMAS DE PAGO</div>
                    ${payments.map((p: any) => {
            const settlementLine = settlementLineById.get(p.id);
            const methodLabel = p.method === 'CASH' ? 'EFECTIVO' : p.method === 'CARD' ? 'TARJETA' : p.method === 'STORE_CREDIT' ? 'NOTA DE CRÉDITO' : p.method;
            const paymentCurrencyCode = settlementLine?.currencyCode || p.currencyCode || baseCurrencyCode;
            const paymentCurrencySymbol = resolveCurrencySymbol(config, paymentCurrencyCode, currencySymbol);
            const appliedBase = Number((settlementLine?.appliedBase ?? p.appliedAmount ?? p.amount) || 0);
            const receivedBase = Number((settlementLine?.receivedBase ?? p.amount) || 0);
            const receivedOriginal = Number((settlementLine?.receivedOriginal ?? p.amountOriginal ?? p.amount) || 0);
            const changeBase = Number((settlementLine?.changeBase ?? p.changeAmount) || 0);
            const exchangeRate = Number((settlementLine?.exchangeRate ?? p.exchangeRate) || 1);
            const showAzulRefs = p.gatewayProvider === 'AZUL' || p.gatewayAuthorizationCode || p.gatewayReference;
            const azulLines = showAzulRefs
               ? [
                  p.gatewayAuthorizationCode ? `<div class="meta-row" style="font-size: 11px;">AUT No.: ${p.gatewayAuthorizationCode}</div>` : '',
                  p.gatewayReference ? `<div class="meta-row" style="font-size: 11px;">Ref No.: ${p.gatewayReference}</div>` : '',
               ].join('')
               : '';
            const settlementLines = [
               paymentCurrencyCode !== baseCurrencyCode ? `<div class="meta-row" style="font-size: 11px;">Recibido: ${paymentCurrencySymbol}${receivedOriginal.toFixed(2)}</div>` : '',
               paymentCurrencyCode !== baseCurrencyCode ? `<div class="meta-row" style="font-size: 11px;">Tasa: ${currencySymbol}${exchangeRate.toFixed(2)}</div>` : '',
               (paymentCurrencyCode !== baseCurrencyCode || Math.abs(receivedBase - appliedBase) > 0.0001)
                  ? `<div class="meta-row" style="font-size: 11px;">Equivalente: ${currencySymbol}${receivedBase.toFixed(2)}</div>`
                  : '',
               changeBase > 0.0001 ? `<div class="meta-row" style="font-size: 11px;">Cambio: ${currencySymbol}${changeBase.toFixed(2)}</div>` : '',
            ].join('');
            return `
                    <div class="total-row">
                        <span>${methodLabel}</span>
                        <span>${currencySymbol}${appliedBase.toFixed(2)}</span>
                    </div>
                    ${settlementLines}
                    ${azulLines}
                    `;
         }).join('')}
                    <div class="total-row" style="margin-top: 4px; font-weight: bold;">
                        <span>TOTAL APLICADO</span>
                        <span>${currencySymbol}${settlementSummary.totalAppliedBase.toFixed(2)}</span>
                    </div>
                    ${settlementSummary.hasForeignCurrency || Math.abs(settlementSummary.totalReceivedBase - settlementSummary.totalAppliedBase) > 0.0001 ? `
                    <div class="total-row" style="margin-top: 4px; font-weight: bold;">
                        <span>TOTAL RECIBIDO</span>
                        <span>${currencySymbol}${settlementSummary.totalReceivedBase.toFixed(2)}</span>
                    </div>
                    ` : ''}
                    ${settlementSummary.totalChangeBase > 0 ? `
                    <div class="total-row" style="margin-top: 4px; font-weight: bold;">
                        <span>CAMBIO</span>
                        <span>${currencySymbol}${settlementSummary.totalChangeBase.toFixed(2)}</span>
                    </div>
                    ` : ''}
                </div>
                `;
        })()}

            <!-- SECCIÓN: FACTURA AFECTADA (ALINEADA A LA IZQUIERDA) -->
            ${isCreditNote ? `
                <div class="divider"></div>
                <div class="text-left" style="margin-top: 10px; font-size: 12px; line-height: 1.4;">
                    <span style="font-weight: bold; text-decoration: underline;">FACTURA AFECTADA:</span><br/>
                    ${(transaction.affectedInvoiceNumber || transaction.originalTransactionId) ? `
                        <span>No. ${transaction.affectedInvoiceNumber || transaction.originalTransactionId}</span><br/>
                    ` : ''}
                    ${transaction.affectedNCF ? `
                        <span>NCF: ${transaction.affectedNCF}</span>
                    ` : ''}
                    ${!(transaction.affectedInvoiceNumber || transaction.affectedNCF || transaction.originalTransactionId) ? `
                        <span style="font-style: italic; color: #666;">Sin referencia disponible</span>
                    ` : ''}
                </div>
            ` : ''}

            <div class="footer">
                ${receiptConfig?.footerMessage ? `<div style="margin-bottom: 8px;">${receiptConfig.footerMessage}</div>` : ''}
                <div>¡Gracias por su compra!</div>
                <div>Vuelva pronto.</div>
                
                ${receiptConfig?.showQr ? `
                <div class="divider"></div>
                <div style="text-align: left; margin: 6px 0;">
                    ${transaction.ncfType ? `<div style="font-weight: bold; font-size: 12px;">${comprobanteTypeLabels[transaction.ncfType] || transaction.ncfType}</div>` : ''}
                    ${transaction.ncf ? `<div class="ncf-row" style="margin-top: 2px; text-align: left;">${transaction.ncf}</div>` : ''}
                </div>
                <div class="divider"></div>
                <div id="qrcode"></div>
                <div style="font-weight: bold; font-size: 9px; margin-top: 5px;">ESCANEA ESTE TICKET PARA DEVOLUCIONES Y CUPONES</div>
                ` : ''}
            </div>
            
            <script>
                window.onload = function() {
                    ${receiptConfig?.showQr ? `
                    try {
                        new QRCode(document.getElementById("qrcode"), {
                            text: "${qrPayload}",
                            width: 100,
                            height: 100,
                            colorDark : "#000000",
                            colorLight : "#ffffff",
                            correctLevel : QRCode.CorrectLevel.H
                        });
                    } catch (e) {
                        console.error("QR Code generation failed", e);
                        document.getElementById("qrcode").innerHTML = "QR ERROR";
                    }
                    ` : ''}
                    
                    setTimeout(() => {
                        window.print();
                    }, 500);
                }
            </script>
        </body>
        </html>
    `;

    const silentHtml = receiptHtml.replace(
        /<script>[\s\S]*?window\.onload[\s\S]*?<\/script>/,
        ''
    );

    const escPosBase64 = buildEscPosTicketPayload(transaction, config, users);
    let printedSilently = false;

    if (escPosBase64) {
        printedSilently = await PrintRouterService.routeAndPrintEscPos({
            config,
            escPosBase64,
            role: 'TICKET',
            terminalId: transaction.terminalId,
            jobType: 'TICKET',
            referenceId: transaction.id,
        });
    }

    if (printedSilently) return true;

    if (!shouldSuppressBrowserPrintFallback()) {
        printedSilently = await PrintRouterService.routeAndPrintHtml({
            config,
            html: silentHtml,
            role: 'TICKET',
            terminalId: transaction.terminalId,
            jobType: 'TICKET',
            referenceId: transaction.id,
        });
    }

    if (printedSilently) return true;

    if (shouldSuppressBrowserPrintFallback()) {
        console.warn('Silent native ticket print failed; browser print fallback suppressed.');
        return false;
    }

    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
        printWindow.document.write(receiptHtml);
        printWindow.document.close();
        return true;
    } else {
        alert('Por favor, permita las ventanas emergentes para imprimir el ticket.');
    }
    return false;
};

export const printIntegratedPaymentArtifacts = async (
    transaction: Transaction,
    config: BusinessConfig
): Promise<{ ticketPrinted: boolean; voucherCopiesPrinted: number; voucherCopiesFailed: string[] }> => {
    const payments = (transaction.payments || []) as Array<Record<string, any>>;
    const gatewayPayments = payments.filter(payment =>
        payment?.gatewayProvider && (payment?.gatewayReceiptMerchant || payment?.gatewayReceiptClient)
    );

    let voucherCopiesPrinted = 0;
    const voucherCopiesFailed: string[] = [];

    for (let index = 0; index < gatewayPayments.length; index += 1) {
        const payment = gatewayPayments[index];
        const providerLabel = String(payment.gatewayProvider || 'Procesador');

        if (payment.gatewayReceiptMerchant) {
            const printed = await printGatewayVoucher(config, {
                providerLabel,
                copyLabel: 'Copia Comercio',
                voucherText: payment.gatewayReceiptMerchant,
                referenceId: `${transaction.id}-merchant-voucher-${index + 1}`,
                terminalId: transaction.terminalId,
            });
            if (printed) {
                voucherCopiesPrinted += 1;
            } else {
                voucherCopiesFailed.push(`${providerLabel} comercio`);
            }
            await delay(150);
        }

        if (payment.gatewayReceiptClient) {
            const printed = await printGatewayVoucher(config, {
                providerLabel,
                copyLabel: 'Copia Cliente',
                voucherText: payment.gatewayReceiptClient,
                referenceId: `${transaction.id}-client-voucher-${index + 1}`,
                terminalId: transaction.terminalId,
            });
            if (printed) {
                voucherCopiesPrinted += 1;
            } else {
                voucherCopiesFailed.push(`${providerLabel} cliente`);
            }
            await delay(150);
        }
    }

    const ticketPrinted = await printTicket(transaction, config);
    if (!ticketPrinted) {
        voucherCopiesFailed.push('ticket');
    }

    return {
        ticketPrinted,
        voucherCopiesPrinted,
        voucherCopiesFailed,
    };
};

export const printReservation = async (
    reservation: Reservation,
    config: BusinessConfig,
    copies = 1
): Promise<boolean> => {
    const { companyInfo, currencySymbol, receiptConfig } = config;
    const dateStr = new Date(reservation.createdAt).toLocaleDateString();
    const timeStr = new Date(reservation.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const deliveryStr = reservation.deliveryDate ? new Date(reservation.deliveryDate).toLocaleDateString() : 'No especificada';
    const expiryStr = new Date(reservation.expiryDate).toLocaleDateString();

    const receiptHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Reserva #${reservation.code}</title>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
            <style>
                @page { size: 80mm auto; margin: 0; }
                body {
                    font-family: 'Courier New', Courier, monospace;
                    width: 72mm;
                    margin: 0 auto;
                    padding: 4mm;
                    font-size: 14px;
                    line-height: 1.2;
                    color: #000;
                    background: #fff;
                }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .font-bold { font-weight: 700; }
                .font-black { font-weight: 900; }
                .company-name { font-size: 18px; font-weight: 900; margin-bottom: 2px; text-transform: uppercase; }
                .company-info { font-size: 12px; }
                .divider { border-top: 1px dashed #000; margin: 8px 0; }
                .doc-title { font-size: 16px; font-weight: 900; text-transform: uppercase; margin-bottom: 5px; }
                .meta-row { font-size: 12px; }
                .items-table { width: 100%; border-collapse: collapse; margin-top: 5px; }
                .items-table td { padding: 4px 0; vertical-align: top; }
                .item-name { font-weight: 700; display: block; }
                .item-meta { font-size: 12px; display: block; }
                .totals-section { margin-top: 10px; }
                .total-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
                .total-final { font-size: 18px; font-weight: 900; border-top: 2px solid #000; padding-top: 5px; }
                #qrcode { width: 100px; height: 100px; margin: 10px auto; }
            </style>
        </head>
        <body>
            <div class="text-center">
                <div class="company-name">${companyInfo.name}</div>
                <div class="company-info">
                    <div>RNC: ${companyInfo.rnc}</div>
                    <div>${companyInfo.address}</div>
                    <div>TEL: ${companyInfo.phone}</div>
                </div>
            </div>

            <div class="divider"></div>
            
            <div class="text-center">
                <div class="doc-title">NOTA DE RESERVA</div>
                <div class="font-bold">Código: ${reservation.code}</div>
            </div>

            <div class="divider"></div>

            <div class="meta-row">
                <div><strong>Cliente:</strong> ${reservation.customerName}</div>
                <div><strong>Fecha Doc:</strong> ${dateStr} ${timeStr}</div>
                <div><strong>Fecha Entrega:</strong> ${deliveryStr}</div>
                <div><strong>Vence:</strong> ${expiryStr}</div>
            </div>

            <div class="divider"></div>

            <table class="items-table">
                <tbody>
                    ${reservation.items.map(item => `
                        <tr>
                            <td style="width: 70%;">
                                <span class="item-name">${item.name}</span>
                                <span class="item-meta">${item.quantity} x ${currencySymbol}${item.price.toFixed(2)}</span>
                            </td>
                            <td class="text-right font-bold">
                                ${currencySymbol}${(item.price * item.quantity).toFixed(2)}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="divider"></div>

            <div class="totals-section">
                <div class="total-row">
                    <span>TOTAL RESERVA</span>
                    <span>${currencySymbol}${reservation.total.toFixed(2)}</span>
                </div>
                <div class="total-row">
                    <span>ABONO RECIBIDO</span>
                    <span>${currencySymbol}${reservation.balancePaid.toFixed(2)}</span>
                </div>
                <div class="total-row total-final">
                    <span>SALDO PENDIENTE</span>
                    <span>${currencySymbol}${(reservation.total - reservation.balancePaid).toFixed(2)}</span>
                </div>
            </div>

            <div class="text-center" style="margin-top: 20px;">
                <div id="qrcode"></div>
                <div style="font-size: 10px; font-weight: bold; margin-top: 5px;">ESTE DOCUMENTO SE USA PARA RECUPERAR SU RESERVA</div>
            </div>

            <div class="text-center" style="margin-top: 15px; font-size: 11px;">
                ${receiptConfig?.footerMessage || '¡Gracias por su preferencia!'}
            </div>

            <script>
                window.onload = function() {
                    new QRCode(document.getElementById("qrcode"), {
                        text: "${reservation.qrPayload}",
                        width: 100,
                        height: 100
                    });
                    setTimeout(() => { window.print(); }, 500);
                }
            </script>
        </body>
        </html>
    `;

    const silentHtml = receiptHtml.replace(/<script>[\s\S]*?window\.onload[\s\S]*?<\/script>/, '');
    const escPosBase64 = buildEscPosReservationPayload(reservation, config);
    let printedSilently = false;

    if (escPosBase64) {
        printedSilently = await PrintRouterService.routeAndPrintEscPos({
            config,
            escPosBase64,
            role: 'TICKET',
            terminalId: reservation.terminalId,
            jobType: 'TICKET',
            referenceId: reservation.id,
            copies,
        });
    }

    if (printedSilently) return true;

    if (!shouldSuppressBrowserPrintFallback()) {
        printedSilently = await PrintRouterService.routeAndPrintHtml({
            config,
            html: silentHtml,
            role: 'TICKET',
            jobType: 'TICKET',
            referenceId: reservation.id,
            copies,
        });
    }

    if (printedSilently) return true;

    if (shouldSuppressBrowserPrintFallback()) {
        console.warn('Silent native reservation print failed; browser print fallback suppressed.');
        return false;
    }

    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
        printWindow.document.write(receiptHtml);
        printWindow.document.close();
        return true;
    }

    return false;
};

export const printPrecuenta = async (
    config: BusinessConfig,
    params: {
        items: CartItem[];
        subtotal: number;
        discountTotal: number;
        taxTotal: number;
        finalTotal: number;
        table?: Table | null;
        customerName?: string;
        terminalId?: string;
    }
): Promise<boolean> => {
    const { companyInfo, currencySymbol } = config;
    const dateStr = new Date().toLocaleDateString();
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const receiptHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Pre-Cuenta</title>
            <style>
                @page { size: 80mm auto; margin: 0; }
                body {
                    font-family: 'Courier New', Courier, monospace;
                    width: 72mm;
                    margin: 0 auto;
                    padding: 4mm;
                    font-size: 14px;
                    line-height: 1.2;
                    color: #000;
                    background: #fff;
                }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .font-bold { font-weight: 700; }
                .font-black { font-weight: 900; }
                .company-name { font-size: 18px; font-weight: 900; margin-bottom: 2px; text-transform: uppercase; }
                .company-info { font-size: 12px; }
                .divider { border-top: 1px dashed #000; margin: 8px 0; }
                .doc-title { font-size: 16px; font-weight: 900; text-transform: uppercase; margin-bottom: 5px; }
                .warning-title { font-size: 12px; font-weight: bold; background: #000; color: #fff; padding: 3px; display: inline-block; margin-bottom: 5px; }
                .meta-row { font-size: 12px; }
                .items-table { width: 100%; border-collapse: collapse; margin-top: 5px; }
                .items-table td { padding: 4px 0; vertical-align: top; }
                .item-name { font-weight: 700; display: block; }
                .item-meta { font-size: 12px; display: block; margin-left: 5px; }
                .totals-section { margin-top: 10px; }
                .total-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
                .total-final { font-size: 18px; font-weight: 900; border-top: 2px solid #000; padding-top: 5px; }
            </style>
        </head>
        <body>
            <div class="text-center">
                <div class="company-name">${companyInfo.name}</div>
                <div class="company-info">
                    <div>RNC: ${companyInfo.rnc}</div>
                    <div>${companyInfo.address}</div>
                    <div>TEL: ${companyInfo.phone}</div>
                </div>
            </div>

            <div class="divider"></div>
            
            <div class="text-center">
                <div class="warning-title">NO VÁLIDO COMO FACTURA FISCAL</div>
                <div class="doc-title">PRE-CUENTA</div>
            </div>

            <div class="divider"></div>

            <div class="meta-row">
                ${params.table ? `<div><strong>Mesa:</strong> ${params.table.name || params.table.nombre}</div>` : ''}
                ${params.customerName ? `<div><strong>Cliente:</strong> ${params.customerName}</div>` : ''}
                <div><strong>Fecha:</strong> ${dateStr} ${timeStr}</div>
            </div>

            <div class="divider"></div>

            <table class="items-table">
                <tbody>
                    ${params.items.map(item => `
                        <tr>
                            <td style="width: 70%;">
                                <span class="item-name">${item.name}</span>
                                <span class="item-meta">
                                    ${item.quantity} x ${currencySymbol}${item.price.toFixed(2)}
                                    ${item.modifiers && item.modifiers.length > 0 ? `<br/>Op: ${item.modifiers.join(', ')}` : ''}
                                </span>
                            </td>
                            <td class="text-right font-bold">
                                ${currencySymbol}${(item.price * item.quantity).toFixed(2)}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="divider"></div>

            <div class="totals-section">
                <div class="total-row">
                    <span>SUBTOTAL</span>
                    <span>${currencySymbol}${params.subtotal.toFixed(2)}</span>
                </div>
                ${params.discountTotal > 0 ? `
                <div class="total-row">
                    <span>DESCUENTO</span>
                    <span>-${currencySymbol}${params.discountTotal.toFixed(2)}</span>
                </div>` : ''}
                <div class="total-row">
                    <span>IMPUESTOS</span>
                    <span>${currencySymbol}${params.taxTotal.toFixed(2)}</span>
                </div>
                
                <div class="total-row total-final">
                    <span>TOTAL A PAGAR</span>
                    <span>${currencySymbol}${params.finalTotal.toFixed(2)}</span>
                </div>
            </div>

            <div class="text-center" style="margin-top: 20px; font-size: 11px; margin-bottom: 20px;">
                Verifique su consumo antes de emitir la factura.
                <br/><br/>
                Propina Legal no incluida.
            </div>

            <script>
                window.onload = function() {
                    setTimeout(() => { window.print(); }, 500);
                }
            </script>
        </body>
        </html>
    `;

    const silentHtml = receiptHtml.replace(/<script>[\s\S]*?window\.onload[\s\S]*?<\/script>/, '');
    let printedSilently = false;

    if (!shouldSuppressBrowserPrintFallback()) {
        printedSilently = await PrintRouterService.routeAndPrintHtml({
            config,
            html: silentHtml,
            role: 'TICKET',
            jobType: 'TICKET',
            referenceId: `PRECUENTA-${Date.now()}`,
            copies: 1,
        });
    }

    if (printedSilently) return true;

    if (shouldSuppressBrowserPrintFallback()) {
        console.warn('Silent native precuenta print failed; fallback suppressed.');
        return false;
    }

    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
        printWindow.document.write(receiptHtml);
        printWindow.document.close();
        return true;
    }

    return false;
};

export const printComanda = async (
    config: BusinessConfig,
    params: {
        items: CartItem[];
        table?: Table | null;
        customerName?: string;
        orderNumber?: string;
        terminalId?: string;
    }
): Promise<boolean> => {
    const { companyInfo } = config;
    const dateStr = new Date().toLocaleDateString();
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const receiptHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Comanda - Cocina</title>
            <style>
                @page { size: 80mm auto; margin: 0; }
                body {
                    font-family: 'Courier New', Courier, monospace;
                    width: 72mm;
                    margin: 0 auto;
                    padding: 4mm;
                    font-size: 16px;
                    line-height: 1.1;
                    color: #000;
                    background: #fff;
                }
                .text-center { text-align: center; }
                .font-bold { font-weight: 700; }
                .font-black { font-weight: 900; }
                .divider { border-top: 2px solid #000; margin: 8px 0; }
                .doc-title { font-size: 22px; font-weight: 900; text-transform: uppercase; margin-bottom: 5px; border: 3px solid #000; padding: 5px; }
                .meta-row { font-size: 14px; margin-bottom: 5px; }
                .items-table { width: 100%; border-collapse: collapse; margin-top: 5px; }
                .items-table td { padding: 6px 0; vertical-align: top; border-bottom: 1px solid #eee; }
                .qty-cell { font-size: 24px; font-weight: 900; width: 40px; text-align: center; border: 2px solid #000; }
                .item-name { font-size: 18px; font-weight: 900; display: block; margin-left: 10px; }
                .item-meta { font-size: 14px; display: block; margin-left: 10px; font-style: italic; background: #f0f0f0; padding: 2px; }
                .footer { margin-top: 20px; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="text-center">
                <div class="doc-title">COCINA</div>
            </div>

            <div class="meta-row text-center">
                ${params.table ? `<div style="font-size: 24px; font-weight: 900;">MESA: ${params.table.name || params.table.nombre}</div>` : ''}
                ${params.orderNumber ? `<div>ORDEN: #${params.orderNumber}</div>` : ''}
                <div>${dateStr} ${timeStr}</div>
                ${params.customerName ? `<div>Cliente: ${params.customerName}</div>` : ''}
            </div>

            <div class="divider"></div>

            <table class="items-table">
                <tbody>
                    ${params.items.filter(i => i.quantity > 0).map(item => `
                        <tr>
                            <td class="qty-cell">${item.quantity}</td>
                            <td>
                                <span class="item-name">${item.name}</span>
                                ${item.modifiers && item.modifiers.length > 0 ? `<span class="item-meta">*** ${item.modifiers.join(', ')}</span>` : ''}
                                ${item.note ? `<span class="item-meta">NOTA: ${item.note}</span>` : ''}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="divider"></div>
            
            <div class="footer text-center">
                Impreso en Terminal: ${params.terminalId || 'POS'}
            </div>

            <script>
                window.onload = function() {
                    setTimeout(() => { window.print(); }, 500);
                }
            </script>
        </body>
        </html>
    `;

    const silentHtml = receiptHtml.replace(/<script>[\s\S]*?window\.onload[\s\S]*?<\/script>/, '');
    let printedSilently = false;

    // Use KITCHEN role for routing
    if (!shouldSuppressBrowserPrintFallback()) {
        printedSilently = await PrintRouterService.routeAndPrintHtml({
            config,
            html: silentHtml,
            role: 'KITCHEN',
            jobType: 'TICKET',
            referenceId: `COMANDA-${Date.now()}`,
            copies: 1,
        });
    }

    if (printedSilently) return true;

    if (shouldSuppressBrowserPrintFallback()) {
        console.warn('Silent native kitchen print failed; fallback suppressed.');
        return false;
    }

    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
        printWindow.document.write(receiptHtml);
        printWindow.document.close();
        return true;
    }

    return false;
};
