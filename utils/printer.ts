import { Transaction, BusinessConfig } from '../types';

export const printTicket = (transaction: Transaction, config: BusinessConfig) => {
    const { companyInfo, currencySymbol, receiptConfig } = config;
    const dateStr = new Date(transaction.date).toLocaleDateString();
    const timeStr = new Date(transaction.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Calculate totals
    const subtotal = transaction.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const taxTotal = subtotal * config.taxRate;
    const discountTotal = 0; // TODO: Calculate if available in transaction
    const finalTotal = transaction.total;

    // NCF Type Label Map
    const ncfTypeLabels: Record<string, string> = {
        'B01': 'FACTURA DE CRÉDITO FISCAL',
        'B02': 'FACTURA DE CONSUMO',
        'B14': 'REGÍMENES ESPECIALES',
        'B15': 'GUBERNAMENTAL'
    };

    const documentTitle = transaction.ncfType ? (ncfTypeLabels[transaction.ncfType] || 'FACTURA DE VENTA') : 'TICKET DE VENTA';

    // Generate HTML content for the receipt
    const receiptHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Ticket #${transaction.id}</title>
            <style>
                @page { margin: 0; }
                body {
                    font-family: 'Courier New', Courier, monospace;
                    width: 80mm;
                    margin: 0 auto;
                    padding: 10px;
                    font-size: 12px;
                    line-height: 1.2;
                    color: black;
                }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .text-left { text-align: left; }
                .font-bold { font-weight: bold; }
                .text-lg { font-size: 16px; }
                .text-xl { font-size: 20px; }
                .text-sm { font-size: 10px; }
                
                .mb-1 { margin-bottom: 4px; }
                .mb-2 { margin-bottom: 8px; }
                .mt-2 { margin-top: 8px; }
                
                .divider { border-top: 1px dashed #000; margin: 8px 0; }
                
                .item-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
                .item-details { font-size: 10px; color: #444; margin-left: 10px; }
                
                .totals-row { display: flex; justify-content: space-between; margin-bottom: 2px; }
                .total-final { font-size: 18px; font-weight: 900; margin-top: 5px; }
                
                .qr-placeholder {
                    margin: 15px auto;
                    width: 80px;
                    height: 80px;
                    border: 2px solid #000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 8px;
                }
            </style>
        </head>
        <body>
            <!-- HEADER -->
            <div class="text-center">
                <div class="font-bold text-lg mb-1">${companyInfo.name}</div>
                <div class="text-sm">RNC: ${companyInfo.rnc}</div>
                <div class="text-sm">${companyInfo.address}</div>
                <div class="text-sm">TEL: ${companyInfo.phone}</div>
            </div>

            <div class="divider"></div>
            
            <!-- DOCUMENT INFO -->
            <div class="text-center">
                <div class="font-bold mb-1">${documentTitle}</div>
                ${transaction.ncf ? `<div class="font-bold">NCF: ${transaction.ncf}</div>` : ''}
                <div class="text-sm">Ticket No.: ${transaction.id}</div>
                <div class="text-sm mt-1">${dateStr} ${timeStr}</div>
            </div>

            <div class="divider"></div>

            <!-- ITEMS -->
            <div class="items">
                ${transaction.items.map(item => `
                    <div class="mb-2">
                        <div class="item-row font-bold">
                            <span>${item.name}</span>
                            <span>${currencySymbol}${(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                        <div class="item-details">
                            ${item.quantity} x ${item.price.toFixed(2)}
                            ${item.modifiers ? `<br/>Op: ${item.modifiers.join(', ')}` : ''}
                            ${item.salespersonId ? `<br/>Vend: ${item.salespersonId}` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="divider"></div>

            <!-- TOTALS -->
            <div class="totals">
                <div class="totals-row text-sm">
                    <span>SUBTOTAL</span>
                    <span>${currencySymbol}${subtotal.toFixed(2)}</span>
                </div>
                ${discountTotal > 0 ? `
                <div class="totals-row text-sm">
                    <span>DESCUENTO</span>
                    <span>-${currencySymbol}${discountTotal.toFixed(2)}</span>
                </div>` : ''}
                <div class="totals-row text-sm">
                    <span>TOTAL IMPUESTOS</span>
                    <span>${currencySymbol}${taxTotal.toFixed(2)}</span>
                </div>
                
                <div class="totals-row total-final">
                    <span>TOTAL</span>
                    <span>${currencySymbol}${finalTotal.toFixed(2)}</span>
                </div>
            </div>

            <!-- FOOTER -->
            <div class="text-center mt-2">
                ${receiptConfig?.footerMessage ? `<div class="text-sm mb-2">${receiptConfig.footerMessage}</div>` : ''}
                <div class="text-sm">¡Gracias por su compra!</div>
                <div class="text-sm">Vuelva pronto.</div>
                
                ${receiptConfig?.showQr ? `
                <div class="qr-placeholder">
                    QR CODE
                </div>
                <div class="text-sm font-bold">E-FACTURA VALIDADA</div>
                ` : ''}
            </div>
            
            <script>
                window.onload = function() {
                    window.print();
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
