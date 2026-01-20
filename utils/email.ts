import { Transaction, BusinessConfig, CashMovement } from '../types';

interface ZReportEmailData {
    transactions: Transaction[];
    cashMovements: CashMovement[];
    config: BusinessConfig;
    userName: string;
    cashCounted: number;
    notes: string;
    expectedCash: number;
    discrepancy: number;
    cashSalesTotal: number;
    cashIn: number;
    cashOut: number;
}

export const sendZReportEmail = (recipient: string, data: ZReportEmailData) => {
    const {
        config,
        userName,
        cashCounted,
        notes,
        expectedCash,
        discrepancy,
        cashSalesTotal,
        cashIn,
        cashOut
    } = data;

    const dateStr = new Date().toLocaleDateString();
    const timeStr = new Date().toLocaleTimeString();
    const currency = config.currencySymbol;

    const subject = `Reporte Z - ${config.companyInfo.name} - ${dateStr}`;

    const body = `
REPORTE DE CIERRE DE CAJA (Z)
================================
Empresa: ${config.companyInfo.name}
Fecha: ${dateStr} ${timeStr}
Responsable: ${userName}
================================

RESUMEN DE EFECTIVO
--------------------------------
Ventas en Efectivo: ${currency}${cashSalesTotal.toFixed(2)}
(+) Entradas:       ${currency}${cashIn.toFixed(2)}
(-) Salidas:        ${currency}${cashOut.toFixed(2)}
--------------------------------
Total Esperado:     ${currency}${expectedCash.toFixed(2)}
Conteo Físico:      ${currency}${cashCounted.toFixed(2)}
--------------------------------
DIFERENCIA:         ${currency}${discrepancy > 0 ? '+' : ''}${discrepancy.toFixed(2)}
${discrepancy === 0 ? '(Cuadre Perfecto)' : '(DESCUADRE DETECTADO)'}

NOTAS DEL CIERRE
--------------------------------
${notes || 'Sin notas adicionales.'}

================================
Generado automáticamente por CLIC-POS
    `.trim();

    const mailtoLink = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    // Open in a new window/tab to avoid disrupting the app flow, 
    // though mailto usually just opens the client.
    window.open(mailtoLink, '_blank');
};
