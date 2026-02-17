import React, { useState, useMemo, useCallback } from 'react';
import { Customer, Transaction, BusinessConfig, Collection } from '../types';
import { DollarSign, AlertTriangle, CheckCircle, CreditCard, Calendar, AlertCircle } from 'lucide-react';

interface CreditAccountDashboardProps {
    customer: Customer;
    transactions: Transaction[]; // Should be only the unpaid/pending ones ideally, or we filter here
    config: BusinessConfig;
    collections: Collection[];
    onRecordPayment: (selectedAmount: number, selectedInvoiceIds: string[]) => void;
}

const CreditAccountDashboard: React.FC<CreditAccountDashboardProps> = ({
    customer,
    transactions,
    config,
    collections,
    onRecordPayment
}) => {
    const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());

    const CREDIT_METHOD_MARKERS = useMemo(() => new Set(['CREDIT', 'CREDITO', 'PENDIENTE']), []);

    const normalizeMethod = (value: unknown): string => {
        if (typeof value !== 'string') return '';
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toUpperCase();
    };

    const toPositiveNumber = (value: unknown): number => {
        const num = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(num) || num <= 0) return 0;
        return num;
    };

    const allocationsByTransactionId = useMemo(() => {
        const map = new globalThis.Map<string, number>();
        for (const collection of collections || []) {
            if (collection?.customerId !== customer.id) continue;
            const allocations = Array.isArray(collection.allocations) ? collection.allocations : [];
            for (const alloc of allocations) {
                const txId = alloc?.transactionId;
                if (!txId) continue;
                const current = map.get(txId) || 0;
                map.set(txId, parseFloat((current + toPositiveNumber(alloc.amount)).toFixed(2)));
            }
        }
        return map;
    }, [collections, customer.id]);

    const getEffectivePendingBalance = useCallback((tx: Transaction): number => {
        if (tx.status === 'REFUNDED') return 0;

        const explicitPendingRaw = tx.pendingBalance;
        const hasExplicitPending = typeof explicitPendingRaw === 'number' && Number.isFinite(explicitPendingRaw);
        const explicitPending = hasExplicitPending ? Math.max(0, explicitPendingRaw) : 0;

        const paymentEntries = Array.isArray(tx.payments) ? tx.payments : [];
        const creditFromPayments = paymentEntries.reduce((sum: number, payment: any) => {
            const markers = [
                normalizeMethod(payment?.method),
                normalizeMethod(payment?.methodLabel),
                normalizeMethod(payment?.methodId),
                normalizeMethod(payment?.type)
            ];
            const isCredit = markers.some(marker => CREDIT_METHOD_MARKERS.has(marker));
            if (!isCredit) return sum;
            return sum + toPositiveNumber(payment?.amount);
        }, 0);

        const creditIssued = Math.max(
            creditFromPayments,
            toPositiveNumber(tx.balanceDueAtSale)
        );

        const allocated = allocationsByTransactionId.get(tx.id) || 0;
        const inferredPending = Math.max(0, parseFloat((creditIssued - allocated).toFixed(2)));

        if (hasExplicitPending && explicitPending > 0) {
            return parseFloat(explicitPending.toFixed(2));
        }

        if (creditIssued > 0) {
            return inferredPending;
        }

        return hasExplicitPending ? parseFloat(explicitPending.toFixed(2)) : 0;
    }, [allocationsByTransactionId, CREDIT_METHOD_MARKERS]);

    // Filter only unpaid transactions just in case (though parent might pass pre-filtered)
    const unpaidInvoices = useMemo(() => {
        return transactions
            .map(tx => ({ ...tx, pendingBalance: getEffectivePendingBalance(tx) }))
            .filter(tx => (tx.pendingBalance || 0) > 0 && tx.status !== 'REFUNDED')
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); // Oldest first
    }, [transactions, getEffectivePendingBalance]);

    // Calculate Stats
    const totalDebt = customer.currentDebt || 0;
    const creditLimit = customer.creditLimit || 0;
    const availableCredit = Math.max(0, creditLimit - totalDebt);

    // Calculate Selection Total
    const selectedTotal = useMemo(() => {
        let total = 0;
        selectedInvoiceIds.forEach(id => {
            const inv = unpaidInvoices.find(t => t.id === id);
            if (inv) total += (inv.pendingBalance || 0);
        });
        return total;
    }, [selectedInvoiceIds, unpaidInvoices]);

    const toggleInvoice = (id: string) => {
        const newSet = new Set(selectedInvoiceIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedInvoiceIds(newSet);
    };

    const toggleAll = () => {
        if (selectedInvoiceIds.size === unpaidInvoices.length) {
            setSelectedInvoiceIds(new Set());
        } else {
            setSelectedInvoiceIds(new Set(unpaidInvoices.map(t => t.id)));
        }
    };

    // Helper for days late
    const getDaysLate = (dateStr: string, dueDateStr?: string) => {
        const due = dueDateStr ? new Date(dueDateStr) : new Date(dateStr);
        const now = new Date();
        const diffTime = Math.ceil((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
        return diffTime;
    };

    return (
        <div className="space-y-6 h-full flex flex-col">
            {/* 1. HEADER STATES (Financial Stats) */}
            <div className="grid grid-cols-3 gap-4">
                {/* Tarjeta 1 (Peligro): Deuda Total */}
                <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <AlertCircle size={48} className="text-red-500" />
                    </div>
                    <p className="text-xs font-black text-red-400 uppercase tracking-widest z-10">Deuda Total</p>
                    <p className="text-2xl font-black text-red-600 z-10 mt-1">
                        {config.currencySymbol}{totalDebt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                </div>

                {/* Tarjeta 2 (Éxito): Crédito Disponible */}
                <div className="bg-green-50 border border-green-100 rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <CheckCircle size={48} className="text-green-500" />
                    </div>
                    <p className="text-xs font-black text-green-500 uppercase tracking-widest z-10">Disponible</p>
                    <p className="text-2xl font-black text-green-600 z-10 mt-1">
                        {config.currencySymbol}{availableCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                </div>

                {/* Tarjeta 3 (Neutral): Límite Autorizado */}
                <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        <CreditCard size={48} className="text-gray-500" />
                    </div>
                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest z-10">Límite Autorizado</p>
                    <p className="text-2xl font-black text-gray-700 z-10 mt-1">
                        {config.currencySymbol}{creditLimit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                </div>
            </div>

            {/* 2. LISTA DE FACTURAS (Smart List) */}
            <div className="flex-1 bg-white border border-gray-200 rounded-2xl flex flex-col overflow-hidden shadow-sm">
                <div className="p-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="relative flex items-center">
                            <input
                                type="checkbox"
                                checked={unpaidInvoices.length > 0 && selectedInvoiceIds.size === unpaidInvoices.length}
                                onChange={toggleAll}
                                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                disabled={unpaidInvoices.length === 0}
                            />
                        </div>
                        <h3 className="text-sm font-black text-gray-700 uppercase tracking-wide">Facturas Pendientes ({unpaidInvoices.length})</h3>
                    </div>

                    {/* 3. ACCIÓN PRINCIPAL (Moved to header/corner) */}
                    <button
                        onClick={() => onRecordPayment(selectedTotal > 0 ? selectedTotal : (unpaidInvoices.length > 0 ? unpaidInvoices[0].pendingBalance! : 0), Array.from(selectedInvoiceIds))} // Default to full selected amount or first invoice if none
                        disabled={unpaidInvoices.length === 0}
                        className={`
                     px-6 py-2 rounded-xl font-bold text-sm transition-all shadow-md flex items-center gap-2
                     ${selectedInvoiceIds.size > 0
                                ? 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95 shadow-blue-200'
                                : 'bg-white text-blue-600 border border-blue-200 hover:bg-blue-50'
                            }
                  `}
                    >
                        <DollarSign size={16} />
                        {selectedInvoiceIds.size > 0
                            ? `Cobrar Seleccionados (${config.currencySymbol}${selectedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
                            : "Cobrar"
                        }
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-0">
                    {unpaidInvoices.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400 p-8">
                            <CheckCircle size={48} className="mb-4 text-green-100" />
                            <p className="text-sm font-medium">No hay facturas pendientes.</p>
                            <p className="text-xs opacity-60">El cliente está al día.</p>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-white sticky top-0 z-10 shadow-sm text-[10px] uppercase font-black text-gray-400 tracking-wider">
                                <tr>
                                    <th className="p-4 w-12 text-center"></th>
                                    <th className="p-4">Documento</th>
                                    <th className="p-4">Vencimiento</th>
                                    <th className="p-4 text-right">Monto Pendiente</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {unpaidInvoices.map(inv => {
                                    const daysLate = getDaysLate(inv.date, inv.dueDate);
                                    const isLate = daysLate > 0;
                                    const isSelected = selectedInvoiceIds.has(inv.id);

                                    return (
                                        <tr
                                            key={inv.id}
                                            className={`
                                    group transition-colors cursor-pointer
                                    ${isSelected ? 'bg-blue-50/50 hover:bg-blue-50' : 'hover:bg-gray-50'}
                                 `}
                                            onClick={() => toggleInvoice(inv.id)}
                                        >
                                            <td className="p-4 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleInvoice(inv.id)}
                                                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-bold text-gray-800">#{inv.displayId || inv.id.substring(0, 8)}</span>
                                                    <span className="text-[10px] font-mono text-gray-400 mt-0.5">{inv.ncf || 'Sin NCF'}</span>
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col items-start gap-1">
                                                    <span className="text-xs font-medium text-gray-600 flex items-center gap-1">
                                                        <Calendar size={12} className="opacity-50" />
                                                        {new Date(inv.dueDate || inv.date).toLocaleDateString()}
                                                    </span>
                                                    {isLate ? (
                                                        <span className={`
                                             px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1
                                             ${daysLate > 15
                                                                ? 'bg-red-50 text-red-600 border-red-100'
                                                                : 'bg-amber-50 text-amber-600 border-amber-100'
                                                            }
                                          `}>
                                                            <AlertTriangle size={10} />
                                                            {daysLate} días vencido
                                                        </span>
                                                    ) : (
                                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-600 border border-green-100">
                                                            Al día
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-4 text-right">
                                                <span className="text-sm font-black text-gray-900">
                                                    {config.currencySymbol}{(inv.pendingBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CreditAccountDashboard;
