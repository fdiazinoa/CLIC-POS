import { Transaction, BusinessConfig } from '../types';

export const printTicket = (transaction: Transaction, config: BusinessConfig) => {
    const { companyInfo, currencySymbol, receiptConfig, currencies } = config;
    const dateStr = new Date(transaction.date).toLocaleDateString();
    const timeStr = new Date(transaction.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Calculate totals and savings
    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    const isTaxIncluded = transaction.isTaxIncluded || false;

    // 1. Calculate Raw Totals (Pre-Global Discount)
    let rawNetTotal = 0;
    let rawTaxTotal = 0;
    let rawGrossTotal = 0;

    transaction.items.forEach(item => {
        const originalPrice = item.originalPrice || item.price;
        const lineVal = item.price * item.quantity;
        const lineDiscount = (originalPrice - item.price) * item.quantity;

        discountTotal += lineDiscount;
        rawGrossTotal += lineVal;

        // Determine Tax Rate for this item
        let itemTaxRate = 0;
        if (item.appliedTaxIds && item.appliedTaxIds.length > 0) {
            item.appliedTaxIds.forEach(id => {
                const t = config.taxes.find(tax => tax.id === id);
                if (t) itemTaxRate += t.rate;
            });
        } else {
            itemTaxRate = config.taxRate; // Fallback
        }

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

    // 2. Apply Global Discount
    if (transaction.discountAmount) {
        discountTotal += transaction.discountAmount;

        // Discount reduces the base. We need to scale down Net and Tax.
        // If Tax Included: Discount is on Gross.
        // If Tax Excluded: Discount is on Net.

        if (isTaxIncluded) {
            // Discount is removed from Gross Total
            // New Gross = Old Gross - Discount
            // Ratio = New Gross / Old Gross
            const ratio = (rawGrossTotal - transaction.discountAmount) / (rawGrossTotal || 1);
            subtotal = rawNetTotal * ratio;
            taxTotal = rawTaxTotal * ratio;
        } else {
            // Discount is removed from Net Total
            // New Net = Old Net - Discount
            subtotal = rawNetTotal - transaction.discountAmount;
            // Tax is recalculated on new Net? 
            // Usually yes, tax is on the discounted amount.
            // Ratio = New Net / Old Net
            const ratio = subtotal / (rawNetTotal || 1);
            taxTotal = rawTaxTotal * ratio;
        }
    } else {
        subtotal = rawNetTotal;
        taxTotal = rawTaxTotal;
    }

    const finalTotal = transaction.total;
    const savings = discountTotal;

    // NCF Type Label Map
    const ncfTypeLabels: Record<string, string> = {
        'B01': 'FACTURA DE CRÉDITO FISCAL',
        'B02': 'FACTURA DE CONSUMO',
        'B14': 'REGÍMENES ESPECIALES',
        'B15': 'GUBERNAMENTAL'
    };

    const documentTitle = transaction.ncfType ? (ncfTypeLabels[transaction.ncfType] || 'FACTURA DE VENTA') : 'TICKET DE VENTA';

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
            <title>Ticket #${transaction.id}</title>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
            <style>
                @page { margin: 0; }
                body {
                    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
                    width: 80mm;
                    margin: 0 auto;
                    padding: 10px;
                    font-size: 12px;
                    line-height: 1.3;
                    color: #000;
                    -webkit-font-smoothing: antialiased;
                }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .text-left { text-align: left; }
                .font-bold { font-weight: 700; }
                .font-black { font-weight: 900; }
                
                .header-logo {
                    display: block;
                    margin: 0 auto 10px auto;
                    max-width: 60%;
                    height: auto;
                    object-fit: contain;
                }
                
                .company-name { font-size: 16px; font-weight: 900; margin-bottom: 4px; text-transform: uppercase; }
                .company-info { font-size: 10px; color: #333; }
                
                .divider { border-top: 1px dashed #000; margin: 10px 0; }
                .divider-solid { border-top: 2px solid #000; margin: 10px 0; }
                
                .doc-title { font-size: 14px; font-weight: 900; text-transform: uppercase; margin-bottom: 4px; }
                .ncf-row { font-size: 13px; font-weight: 700; margin-bottom: 2px; }
                .meta-row { font-size: 10px; color: #555; }

                .items-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                .items-table th { text-align: left; font-size: 10px; border-bottom: 1px solid #000; padding-bottom: 4px; }
                .items-table td { padding: 6px 0; vertical-align: top; border-bottom: 1px dotted #ccc; }
                .items-table tr:last-child td { border-bottom: none; }
                
                .item-name { font-weight: 700; font-size: 12px; display: block; }
                .item-meta { font-size: 10px; color: #555; display: block; line-height: 1.4; }
                .item-price { text-align: right; font-weight: 700; font-size: 12px; }

                .totals-section { margin-top: 10px; }
                .total-row { display: flex; justify-content: space-between; margin-bottom: 2px; font-size: 11px; }
                .total-final { font-size: 20px; font-weight: 900; margin-top: 8px; border-top: 2px solid #000; padding-top: 8px; }
                
                .savings-box {
                    border: 2px dashed #000;
                    padding: 8px;
                    margin: 15px 0;
                    text-align: center;
                    font-weight: 700;
                    font-size: 12px;
                }
                
                .footer { margin-top: 20px; text-align: center; font-size: 10px; }
                
                #qrcode {
                    width: 100px;
                    height: 100px;
                    margin: 15px auto;
                }
                #qrcode img { margin: 0 auto; }
                
                .currency-section {
                    margin-top: 10px;
                    padding-top: 5px;
                    border-top: 1px dotted #000;
                    text-align: center;
                }
            </style>
        </head>
        <body>
            <!-- HEADER -->
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
            
            <!-- DOCUMENT INFO -->
            <div class="text-center">
                <div class="doc-title">${documentTitle}</div>
                ${transaction.ncf ? `<div class="ncf-row">NCF: ${transaction.ncf}</div>` : ''}
                <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                    <div class="meta-row" style="font-weight: bold;">Ticket: ${transaction.id}</div>
                    <div class="meta-row">${dateStr} ${timeStr}</div>
                </div>
            </div>

            <div class="divider"></div>

            <!-- CUSTOMER INFO -->
            ${(() => {
            const snapshot = transaction.customerSnapshot;
            const name = snapshot?.name || transaction.customerName || 'Cliente Mostrador';

            // Always show name
            let html = `<div class="text-left" style="margin-bottom: 5px;">
                    <div style="font-weight: bold;">Cliente: ${name}</div>`;

            // Show details if not "Cliente Mostrador" and snapshot exists
            if (snapshot && !name.toLowerCase().includes('mostrador')) {
                if (snapshot.taxId) html += `<div class="meta-row">RNC/Ced: ${snapshot.taxId}</div>`;
                if (snapshot.address) html += `<div class="meta-row">Dir: ${snapshot.address}</div>`;
                if (snapshot.phone) html += `<div class="meta-row">Tel: ${snapshot.phone}</div>`;
                if (snapshot.email) html += `<div class="meta-row">Email: ${snapshot.email}</div>`;
            }

            html += `</div>`;
            return html;
        })()}

            <div class="divider"></div>

            <!-- ITEMS -->
            <table class="items-table">
                <tbody>
                    ${transaction.items.map(item => {
            const itemTax = (item.price * item.quantity) * config.taxRate;
            const originalPrice = item.originalPrice || item.price;
            const hasDiscount = originalPrice > item.price;

            return `
                        <tr>
                            <td style="width: 70%;">
                                <span class="item-name">${item.name}</span>
                                <span class="item-meta">
                                    ${item.quantity} x ${currencySymbol}${item.price.toFixed(2)}
                                    ${hasDiscount ? `<span style="text-decoration: line-through; color: #999; margin-left: 5px;">${currencySymbol}${originalPrice.toFixed(2)}</span>` : ''}
                                    ${item.modifiers ? `<br/>Op: ${item.modifiers.join(', ')}` : ''}
                                    <br/>ITBIS Aplicado: ${currencySymbol}${itemTax.toFixed(2)}
                                </span>
                            </td>
                            <td class="item-price">
                                ${currencySymbol}${(item.price * item.quantity).toFixed(2)}
                            </td>
                        </tr>
                    `}).join('')}
                </tbody>
            </table>

            <div class="divider"></div>

            <!-- TOTALS -->
            <div class="totals-section">
                <div class="total-row">
                    <span>SUBTOTAL</span>
                    <span>${currencySymbol}${subtotal.toFixed(2)}</span>
                </div>
                ${discountTotal > 0 ? `
                <div class="total-row" style="color: #000;">
                    <span>DESCUENTO TOTAL</span>
                    <span>-${currencySymbol}${discountTotal.toFixed(2)}</span>
                </div>` : ''}
                <div class="total-row">
                    <span>TOTAL IMPUESTOS</span>
                    <span>${currencySymbol}${taxTotal.toFixed(2)}</span>
                </div>
                
                <div class="total-row total-final">
                    <span>TOTAL</span>
                    <span>${currencySymbol}${finalTotal.toFixed(2)}</span>
                </div>
                
                ${foreignCurrenciesHtml ? `
                <div class="currency-section">
                    <div style="font-size: 9px; text-transform: uppercase; margin-bottom: 2px;">Equivalente en Divisas</div>
                    ${foreignCurrenciesHtml}
                </div>
                ` : ''}
            </div>

            <!-- SAVINGS BOX -->
            ${savings > 0 ? `
            <div class="savings-box">
                <div>¡USTED HA AHORRADO!</div>
                <div style="font-size: 16px;">${currencySymbol}${savings.toFixed(2)}</div>
            </div>
            ` : ''}

            <!-- PAYMENT BREAKDOWN -->
            ${(() => {
            const payments = transaction.payments || [];
            const totalPaid = payments.reduce((acc: number, p: any) => acc + (p.amount || 0), 0);
            const change = Math.max(0, totalPaid - finalTotal);

            if (payments.length === 0) return '';

            return `
                <div class="divider"></div>
                <div class="totals-section">
                    <div style="font-weight: bold; margin-bottom: 4px; font-size: 10px;">FORMAS DE PAGO</div>
                    ${payments.map((p: any) => `
                    <div class="total-row">
                        <span>${p.method === 'CASH' ? 'EFECTIVO' : p.method === 'CARD' ? 'TARJETA' : p.method}</span>
                        <span>${currencySymbol}${(p.amount || 0).toFixed(2)}</span>
                    </div>
                    `).join('')}
                    
                    ${change > 0 ? `
                    <div class="total-row" style="margin-top: 4px; font-weight: bold;">
                        <span>CAMBIO</span>
                        <span>${currencySymbol}${change.toFixed(2)}</span>
                    </div>
                    ` : ''}
                </div>
                `;
        })()}

            <!-- FOOTER -->
            <div class="footer">
                ${receiptConfig?.footerMessage ? `<div style="margin-bottom: 8px;">${receiptConfig.footerMessage}</div>` : ''}
                <div>¡Gracias por su compra!</div>
                <div>Vuelva pronto.</div>
                
                ${receiptConfig?.showQr ? `
                <div id="qrcode"></div>
                <div style="font-weight: bold; font-size: 9px; margin-top: 5px;">E-FACTURA VALIDADA</div>
                ` : ''}
            </div>
            
            <script>
                window.onload = function() {
                    // Generate QR Code
                    ${receiptConfig?.showQr ? `
                    try {
                        new QRCode(document.getElementById("qrcode"), {
                            text: "${transaction.ncf || transaction.id}",
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
                    
                    // Auto print after a short delay to ensure QR is rendered
                    setTimeout(() => {
                        window.print();
                        // Optional: window.close();
                    }, 500);
                }
            </script>
        </body>
        </html>
    `;

    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
        printWindow.document.write(receiptHtml);
        printWindow.document.close();
    } else {
        alert('Por favor, permita las ventanas emergentes para imprimir el ticket.');
    }
};
