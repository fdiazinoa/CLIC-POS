import React, { useState, useMemo } from 'react';
import { Transaction, Collection, BusinessConfig, Customer, CollectionAllocation } from '../types';
import {
    ChevronDown,
    ChevronRight,
    CheckCircle2,
    Calendar,
    Clock,
    FileText,
    Receipt,
    History,
    AlertCircle,
    TrendingDown,
    ArrowUpRight,
    ArrowDownLeft
} from 'lucide-react';
import { buildCollectionSettlementSummary, hasCollectionSettlementDetails } from '../utils/collectionSettlement';
import { resolveCurrencySymbol } from '../utils/paymentSettlement';

interface ProfessionalAccountStatementProps {
    customer: Customer;
    transactions: Transaction[];
    collections: Collection[];
    config: BusinessConfig;
}

const ProfessionalAccountStatement: React.FC<ProfessionalAccountStatementProps> = ({
    customer,
    transactions,
    collections,
    config
}) => {
    const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);

    const isRefundDocument = (tx: Transaction) => {
        const docType = typeof tx.documentType === 'string' ? tx.documentType.trim().toUpperCase() : '';
        const ncfType = typeof tx.ncfType === 'string' ? tx.ncfType.trim().toUpperCase() : '';
        const displayId = typeof tx.displayId === 'string' ? tx.displayId.trim().toUpperCase() : '';
        return docType === 'REFUND' || ncfType === 'B04' || displayId.startsWith('NC');
    };

    // Group allocations by transactionId
    const allocationsByTx = useMemo(() => {
        const baseCurrencyCode = config.currencies?.find(currency => currency.isBase)?.code || 'DOP';
        const map: Record<string, (CollectionAllocation & {
            collectionDisplayId: string,
            collectionDate: string,
            collectionMethod: string,
            collectionSettlement: ReturnType<typeof buildCollectionSettlementSummary>
        })[]> = {};
        (collections || []).forEach(col => {
            (col.allocations || []).forEach(alloc => {
                if (!map[alloc.transactionId]) map[alloc.transactionId] = [];
                map[alloc.transactionId].push({
                    ...alloc,
                    collectionDisplayId: col.displayId || 'S/N',
                    collectionDate: col.date,
                    collectionMethod: col.method,
                    collectionSettlement: buildCollectionSettlementSummary(col, baseCurrencyCode)
                });
            });
        });
        return map;
    }, [collections, config.currencies]);

    // Financial Indicators Calculation
    const stats = useMemo(() => {
        const unpaid = transactions.filter(tx => !isRefundDocument(tx) && tx.status !== 'REFUNDED' && (tx.pendingBalance || 0) > 0);
        const totalDebt = unpaid.reduce((acc, tx) => acc + (tx.pendingBalance || 0), 0);

        const overdueCount = unpaid.filter(tx => {
            const due = tx.dueDate ? new Date(tx.dueDate) : new Date(tx.date);
            return due < new Date();
        }).length;

        const lastCollection = [...(collections || [])]
            .filter(c => c.customerId === customer.id)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

        return {
            totalDebt,
            overdueCount,
            lastCollection
        };
    }, [transactions, collections, customer.id]);

    const sortedTransactions = useMemo(() => {
        return [...transactions]
            .filter(tx => isRefundDocument(tx) || tx.status !== 'REFUNDED')
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [transactions]);

    const toggleRow = (id: string) => {
        setExpandedInvoiceId(expandedInvoiceId === id ? null : id);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'DOP',
        }).format(amount).replace('DOP', config.currencySymbol);
    };

    const baseCurrencyCode = config.currencies?.find(currency => currency.isBase)?.code || 'DOP';

    const getStatusBadge = (tx: Transaction) => {
        if (isRefundDocument(tx)) {
            return <span className="px-2 py-0.5 rounded-sm bg-red-50 text-red-600 text-[10px] font-black uppercase ring-1 ring-red-100">Nota Crédito</span>;
        }
        const pending = tx.pendingBalance || 0;
        if (pending <= 0) {
            return <span className="px-2 py-0.5 rounded-sm bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase ring-1 ring-emerald-100">Pagado</span>;
        }
        if (pending < tx.total) {
            return <span className="px-2 py-0.5 rounded-sm bg-blue-50 text-blue-600 text-[10px] font-black uppercase ring-1 ring-blue-100">Parcial</span>;
        }
        return <span className="px-2 py-0.5 rounded-sm bg-amber-50 text-amber-600 text-[10px] font-black uppercase ring-1 ring-amber-100">Pendiente</span>;
    };

    return (
        <div className="flex flex-col h-full bg-white">
            {/* 3. FINANCIAL SUMMARY DASHBOARD */}
            <div className="grid grid-cols-3 gap-1 mb-6 border-b border-gray-100">
                <div className="p-4 border-r border-gray-50 bg-gray-50/30">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Balance Total</p>
                    <p className={`text-xl font-black ${stats.totalDebt > 0 ? 'text-red-600' : 'text-emerald-500'}`}>
                        {formatCurrency(stats.totalDebt)}
                    </p>
                </div>
                <div className="p-4 border-r border-gray-50 bg-gray-50/30">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Facturas Vencidas</p>
                    <p className={`text-xl font-black ${stats.overdueCount > 0 ? 'text-amber-500' : 'text-slate-400'}`}>
                        {stats.overdueCount} <span className="text-xs">Docs</span>
                    </p>
                </div>
                <div className="p-4 bg-gray-50/30">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Último Pago</p>
                    <div className="flex items-center gap-2">
                        {stats.lastCollection ? (
                            <>
                                <p className="text-xl font-black text-emerald-500">{formatCurrency(stats.lastCollection.totalAmount)}</p>
                                <p className="text-[10px] font-bold text-slate-400 leading-none">
                                    {new Date(stats.lastCollection.date).toLocaleDateString()}
                                </p>
                            </>
                        ) : (
                            <p className="text-sm font-bold text-slate-300 italic">No registra pagos</p>
                        )}
                    </div>
                </div>
            </div>

            {/* 1. AUDIT TABLE */}
            <div className="flex-1 overflow-auto">
                <table className="w-full border-separate border-spacing-0">
                    <thead className="sticky top-0 bg-white z-10">
                        <tr className="bg-slate-50 border-y border-gray-100">
                            <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-gray-200">Fecha</th>
                            <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-gray-200">Documento</th>
                            <th className="px-4 py-3 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-gray-200">NCF</th>
                            <th className="px-4 py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-gray-200">Estado</th>
                            <th className="px-4 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-gray-200">Total</th>
                            <th className="px-4 py-3 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-gray-200">Saldo Pendiente</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm divide-y divide-gray-50">
                        {sortedTransactions.map(tx => {
                            const isExpanded = expandedInvoiceId === tx.id;
                            const txAllocations = allocationsByTx[tx.id] || [];
                            const pending = tx.pendingBalance || 0;
                            const isRefund = isRefundDocument(tx);
                            const affectedInvoice = (tx.affectedInvoiceNumber || '').toString().trim();
                            const affectedNCF = (tx.affectedNCF || '').toString().trim();
                            const rowNcf = (tx.ncf || '').toString().trim();
                            const settlementCurrencyCode = String(tx.settlementCurrencyCode || tx.settlement_currency_code || '').trim().toUpperCase() || baseCurrencyCode;
                            const settlementExchangeRate = Number((tx.settlementExchangeRate ?? tx.settlement_exchange_rate ?? 1)) || 1;
                            const settlementReceivedOriginal = Number((tx.settlementReceivedOriginal ?? tx.settlement_received_original ?? tx.total ?? 0)) || 0;
                            const settlementReceivedBase = Number((tx.settlementReceivedBase ?? tx.settlement_received_base ?? tx.total ?? 0)) || 0;
                            const settlementAppliedBase = Number((tx.settlementAppliedBase ?? tx.settlement_applied_base ?? tx.total ?? 0)) || 0;
                            const settlementChangeBase = Number(tx.settlementChangeBase ?? tx.settlement_change_base ?? 0) || 0;
                            const shouldShowTxSettlement =
                                settlementCurrencyCode !== baseCurrencyCode
                                || settlementChangeBase > 0.009
                                || Math.abs(settlementReceivedBase - settlementAppliedBase) > 0.009;
                            const settlementSymbol = resolveCurrencySymbol(config, settlementCurrencyCode, config.currencySymbol);

                            return (
                                <React.Fragment key={tx.id}>
                                    <tr
                                        onClick={() => toggleRow(tx.id)}
                                        className={`hover:bg-blue-50/30 cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/50' : ''}`}
                                    >
                                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                                            {new Date(tx.date).toLocaleDateString()}
                                        </td>
                                        <td className="px-4 py-3 font-black text-slate-800">
                                            {tx.displayId || tx.id.slice(-8).toUpperCase()}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-[11px] text-slate-400 letter-spacing-1">
                                            {rowNcf || 'Sin NCF'}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {getStatusBadge(tx)}
                                        </td>
                                        <td className="px-4 py-3 text-right font-medium text-slate-400">
                                            {isRefundDocument(tx) ? `-${formatCurrency(Math.abs(tx.total || 0))}` : formatCurrency(tx.total)}
                                        </td>
                                        <td className={`px-4 py-3 text-right font-black ${pending > 0 ? 'text-red-600' : 'text-emerald-500'}`}>
                                            {formatCurrency(pending)}
                                        </td>
                                    </tr>

                                    {/* 2. SUB-LEDGER ROW DETAIL */}
                                    {isExpanded && (
                                        <tr>
                                            <td colSpan={6} className="bg-[#F9FAFB] border-b border-gray-200 p-0 shadow-inner">
                                                <div className="p-5 max-w-3xl border-l-[3px] border-blue-600 ml-4 my-2">
                                                    <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-4 flex items-center gap-2">
                                                        <History size={12} /> Movimientos de Cuenta
                                                    </h4>

                                                    <div className="space-y-2">
                                                        {/* Factura Generada */}
                                                        <div className="flex items-center justify-between py-2 border-b border-gray-100">
                                                            <div className="flex items-center gap-3">
                                                                <div className={`w-6 h-6 rounded-sm flex items-center justify-center ${isRefund ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                                                                    {isRefund ? <ArrowDownLeft size={12} /> : <CheckCircle2 size={12} />}
                                                                </div>
                                                                <div>
                                                                    <p className="text-[11px] font-black text-slate-800 uppercase">{isRefund ? 'Nota de Crédito Emitida' : 'Factura Generada'}</p>
                                                                    <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold">
                                                                        <Calendar size={10} /> {new Date(tx.date).toLocaleDateString()}
                                                                        <Clock size={10} /> {new Date(tx.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                    </div>
                                                                    {isRefund && (
                                                                        <div className="mt-1 space-y-0.5">
                                                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                                                                                Factura afectada: {affectedInvoice || 'No disponible'}
                                                                            </p>
                                                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                                                                                NCF afectado: {affectedNCF || 'No disponible'}
                                                                            </p>
                                                                        </div>
                                                                    )}
                                                                    {!isRefund && shouldShowTxSettlement && (
                                                                        <div className="mt-1 space-y-0.5">
                                                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                                                                                Cobro recibido: {settlementSymbol}{settlementReceivedOriginal.toFixed(2)} {settlementCurrencyCode}
                                                                                {settlementCurrencyCode !== baseCurrencyCode ? ` · Tasa ${config.currencySymbol}${settlementExchangeRate.toFixed(2)}` : ''}
                                                                            </p>
                                                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                                                                                Aplicado: {formatCurrency(settlementAppliedBase)}
                                                                                {settlementChangeBase > 0.009 ? ` · Cambio ${formatCurrency(settlementChangeBase)}` : ''}
                                                                            </p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <span className={`text-[11px] font-black ${isRefund ? 'text-red-500' : 'text-slate-500'}`}>
                                                                {isRefund ? `-${formatCurrency(Math.abs(tx.total || 0))}` : `+${formatCurrency(tx.total)}`}
                                                            </span>
                                                        </div>

                                                        {/* Abonos */}
                                                        {txAllocations.map(alloc => (
                                                            <div key={alloc.id} className="flex items-center justify-between py-2 border-b border-gray-100 animate-in fade-in slide-in-from-left-2 transition-all">
                                                                <div className="flex items-center gap-3">
                                                                    <div className="w-6 h-6 bg-emerald-50 text-emerald-500 rounded-sm flex items-center justify-center">
                                                                        <Receipt size={12} />
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[11px] font-black text-emerald-800 uppercase">Abono Recibo #{alloc.collectionDisplayId}</p>
                                                                        <div className="flex items-center gap-2 text-[10px] text-emerald-400 font-bold">
                                                                            <Calendar size={10} /> {new Date(alloc.collectionDate).toLocaleDateString()}
                                                                            <Clock size={10} /> {new Date(alloc.collectionDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                        </div>
                                                                        {hasCollectionSettlementDetails(alloc.collectionSettlement, baseCurrencyCode) && (
                                                                            <div className="mt-1 space-y-0.5">
                                                                                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide">
                                                                                    Recibido: {resolveCurrencySymbol(config, alloc.collectionSettlement.currencyCode, config.currencySymbol)}{alloc.collectionSettlement.receivedOriginal.toFixed(2)} {alloc.collectionSettlement.currencyCode}
                                                                                    {alloc.collectionSettlement.currencyCode !== baseCurrencyCode ? ` · Tasa ${config.currencySymbol}${alloc.collectionSettlement.exchangeRate.toFixed(2)}` : ''}
                                                                                </p>
                                                                                <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wide">
                                                                                    Aplicado a este documento: {formatCurrency(alloc.amount)}
                                                                                    {alloc.collectionSettlement.unappliedBase > 0.009 ? ` · Saldo a favor ${formatCurrency(alloc.collectionSettlement.unappliedBase)}` : ''}
                                                                                </p>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <span className="text-[11px] font-black text-red-500">-{formatCurrency(alloc.amount)}</span>
                                                            </div>
                                                        ))}

                                                        {/* Balance Final */}
                                                        <div className="flex items-center justify-between pt-3 mt-2 border-t-2 border-slate-200">
                                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Saldo Documento</span>
                                                            <span className={`text-sm font-black ${pending > 0 ? 'text-blue-600' : 'text-emerald-500'}`}>
                                                                {formatCurrency(pending)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Empty State */}
            {sortedTransactions.length === 0 && (
                <div className="flex flex-col items-center justify-center p-20 text-center">
                    <div className="p-4 bg-slate-50 text-slate-200 rounded-full mb-4">
                        <AlertCircle size={48} />
                    </div>
                    <p className="text-slate-400 font-bold">No se registran facturas ni movimientos contables para este cliente.</p>
                </div>
            )}
        </div>
    );
};

export default ProfessionalAccountStatement;
