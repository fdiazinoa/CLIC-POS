
export const formatCurrency = (amount: number, symbol: string = '$'): string => {
    return new Intl.NumberFormat('es-DO', {
        style: 'currency',
        currency: 'DOP',
        minimumFractionDigits: 2
    }).format(amount).replace('DOP', symbol).trim();
};
