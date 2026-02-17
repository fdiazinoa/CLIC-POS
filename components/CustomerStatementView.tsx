import React, { useMemo, useState } from 'react';
import { Transaction, Collection, BusinessConfig, Customer, CollectionAllocation } from '../types';
import {
    FileText,
    ChevronDown,
    ChevronRight,
    Plus,
    Minus,
    Equal,
    Download,
    MessageCircle,
    Calendar,
    AlertTriangle,
    X,
    History,
    TrendingDown,
    Printer
} from 'lucide-react';

interface CustomerStatementViewProps {
    customer: Customer;
    transactions: Transaction[];
    collections: Collection[];
    config: BusinessConfig;
    initialType?: 'SUMMARY' | 'DETAILED';
    onClose: () => void;
}

const CustomerStatementView: React.FC<CustomerStatementViewProps> = ({
    customer,
    transactions,
    collections,
    config,
    initialType = 'SUMMARY',
    onClose
}) => {
    const [viewType, setViewType] = useState<'SUMMARY' | 'DETAILED'>(initialType);
    const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());

    // Logical Join: Group allocations by transactionId
    const allocationsByTx = useMemo(() => {
        const map: Record<string, (CollectionAllocation & { collectionDisplayId: string, collectionDate: string })[]> = {};

        (collections || []).forEach(col => {
            (col.allocations || []).forEach(alloc => {
                if (!map[alloc.transactionId]) map[alloc.transactionId] = [];
                map[alloc.transactionId].push({
                    ...alloc,
                    collectionDisplayId: col.displayId,
                    collectionDate: col.date
                });
            });
        });

        return map;
    }, [collections]);

    // Data processing for Summary View (Only pendingBalance > 0)
    const summaryData = useMemo(() => {
        return transactions
            .filter(tx => tx.status !== 'REFUNDED' && (tx.pendingBalance || 0) > 0)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }, [transactions]);

    // Data processing for Detailed View (All transactions for the customer)
    const detailedData = useMemo(() => {
        return transactions
            .filter(tx => tx.status !== 'REFUNDED')
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Newest first
    }, [transactions]);

    const toggleInvoice = (id: string) => {
        const newSet = new Set(expandedInvoices);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setExpandedInvoices(newSet);
    };

    const getDaysLate = (dateStr: string, dueDateStr?: string) => {
        const due = dueDateStr ? new Date(dueDateStr) : new Date(dateStr);
        const now = new Date();
        const diffTime = Math.ceil((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
        return diffTime > 0 ? diffTime : 0;
    };

    const totalUnpaid = summaryData.reduce((acc, tx) => acc + (tx.pendingBalance || 0), 0);

    return (
        <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white rounded-[2.5rem] w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col h-[90vh] border border-white/20">

                {/* HEADER */}
                <div className="p-8 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-600 text-white rounded-2xl shadow-lg shadow-blue-200">
                            <History size={24} />
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-slate-800 tracking-tight">Estado de Cuenta</h3>
                            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest leading-none mt-1">{customer.name}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="bg-white p-1 rounded-2xl border border-slate-200 flex shadow-sm">
                            <button
                                onClick={() => setViewType('SUMMARY')}
                                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${viewType === 'SUMMARY' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                Resumido
                            </button>
                            <button
                                onClick={() => setViewType('DETAILED')}
                                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${viewType === 'DETAILED' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                Movimientos
                            </button>
                        </div>

                        <div className="flex gap-2 border-l pl-3 ml-3 border-gray-200">
                            <button className="p-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors shadow-sm group">
                                <Download size={18} className="group-hover:translate-y-0.5 transition-transform" />
                            </button>
                            <button className="p-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-200 group">
                                <MessageCircle size={18} className="group-hover:scale-110 transition-transform" />
                            </button>
                            <button
                                onClick={onClose}
                                className="p-2.5 bg-white border border-slate-200 text-slate-400 hover:text-red-500 rounded-xl hover:bg-red-50 transition-colors shadow-sm"
                            >
                                <X size={18} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* CONTENT */}
                <div className="flex-1 overflow-y-auto p-8">
                    {viewType === 'SUMMARY' ? (
                        <div className="space-y-6">
                            <div className="bg-slate-50 rounded-[2rem] border border-slate-100 overflow-hidden shadow-sm">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-slate-800 text-[10px] uppercase font-black text-slate-300 tracking-widest">
                                        <tr>
                                            <th className="p-5">Fecha</th>
                                            <th className="p-5">Documento</th>
                                            <th className="p-5">NCF</th>
                                            <th className="p-5 text-center">Días Mora</th>
                                            <th className="p-5 text-right">Total</th>
                                            <th className="p-5 text-right">Saldo</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {summaryData.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="p-20 text-center">
                                                    <AlertTriangle size={48} className="mx-auto mb-4 text-slate-200" />
                                                    <p className="text-slate-400 font-bold">No hay facturas pendientes pendientes para este cliente.</p>
                                                </td>
                                            </tr>
                                        ) : (
                                            summaryData.map(tx => {
                                                const daysLate = getDaysLate(tx.date, tx.dueDate);
                                                return (
                                                    <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors group">
                                                        <td className="p-5">
                                                            <div className="flex items-center gap-3">
                                                                <Calendar size={14} className="text-slate-400" />
                                                                <span className="text-sm font-bold text-slate-600">{new Date(tx.date).toLocaleDateString()}</span>
                                                            </div>
                                                        </td>
                                                        <td className="p-5">
                                                            <span className="text-sm font-black text-slate-800">{tx.displayId || tx.id.slice(-8).toUpperCase()}</span>
                                                        </td>
                                                        <td className="p-5 font-mono text-xs font-bold text-slate-400">{tx.ncf || 'Consumo'}</td>
                                                        <td className="p-5 text-center">
                                                            {daysLate > 0 ? (
                                                                <span className={`px-3 py-1 rounded-full text-[10px] font-black italic shadow-sm border ${daysLate > 15 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>
                                                                    {daysLate} DÍAS
                                                                </span>
                                                            ) : (
                                                                <span className="text-[10px] font-black text-emerald-500 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">AL DÍA</span>
                                                            )}
                                                        </td>
                                                        <td className="p-5 text-right font-bold text-slate-400">{config.currencySymbol}{tx.total.toFixed(2)}</td>
                                                        <td className="p-5 text-right font-black text-slate-900">{config.currencySymbol}{(tx.pendingBalance || 0).toFixed(2)}</td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                    <tfoot className="bg-slate-800">
                                        <tr>
                                            <td colSpan={5} className="p-6 text-right text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Deuda Total Acumulada</td>
                                            <td className="p-6 text-right text-xl font-black text-white">{config.currencySymbol}{totalUnpaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {detailedData.map(tx => {
                                const isExpanded = expandedInvoices.has(tx.id);
                                const txAllocations = allocationsByTx[tx.id] || [];
                                const creditIssued = Math.max(0, (tx.balanceDueAtSale || tx.total));

                                const allocationsSum = txAllocations.reduce((sum, a) => sum + a.amount, 0);
                                const currentBalance = Math.min(
                                    tx.pendingBalance || 0,
                                    Math.max(0, creditIssued - allocationsSum)
                                );

                                return (
                                    <div key={tx.id} className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-all">
                                        <div
                                            onClick={() => toggleInvoice(tx.id)}
                                            className={`p-5 flex items-center justify-between cursor-pointer transition-colors ${isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50/50'}`}
                                        >
                                            <div className="flex items-center gap-5">
                                                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-colors ${currentBalance === 0 ? 'bg-emerald-50 text-emerald-500' : 'bg-blue-50 text-blue-500'}`}>
                                                    {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                                                </div>
                                                <div>
                                                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">#{tx.displayId || tx.id.slice(-8).toUpperCase()}</p>
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-sm font-black text-slate-800">{new Date(tx.date).toLocaleDateString()}</span>
                                                        <span className="text-xs font-bold text-slate-400">•</span>
                                                        <span className="text-xs font-bold text-slate-400 font-mono">{tx.ncf || 'Consumo'}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-12">
                                                <div className="text-right">
                                                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Total</p>
                                                    <p className="text-sm font-bold text-slate-700">{config.currencySymbol}{tx.total.toFixed(2)}</p>
                                                </div>
                                                <div className="text-right pr-4">
                                                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Saldo</p>
                                                    <p className={`text-lg font-black ${currentBalance > 0 ? 'text-blue-600' : 'text-emerald-500'}`}>
                                                        {config.currencySymbol}{currentBalance.toFixed(2)}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {isExpanded && (
                                            <div className="p-6 pt-0 border-t border-slate-100 bg-white animate-in slide-in-from-top-2 duration-300">
                                                <div className="max-w-2xl ml-14 space-y-3 pt-6">

                                                    {/* Original Transaction */}
                                                    <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50/80 border border-slate-100 group">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-sm">
                                                                <Plus size={14} strokeWidth={3} />
                                                            </div>
                                                            <div>
                                                                <p className="text-xs font-black text-slate-800 uppercase tracking-tighter">Factura Original {tx.displayId || tx.id.slice(-8).toUpperCase()}</p>
                                                                <p className="text-[10px] font-bold text-slate-400">{new Date(tx.date).toLocaleString()}</p>
                                                            </div>
                                                        </div>
                                                        <span className="text-sm font-black text-slate-600">+{config.currencySymbol}{tx.total.toFixed(2)}</span>
                                                    </div>

                                                    {/* Payments/Allocations */}
                                                    {txAllocations.length > 0 ? (
                                                        txAllocations.map(alloc => (
                                                            <div key={alloc.id} className="flex items-center justify-between p-4 rounded-2xl bg-emerald-50 border border-emerald-100 group">
                                                                <div className="flex items-center gap-4">
                                                                    <div className="w-8 h-8 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-sm">
                                                                        <Minus size={14} strokeWidth={3} />
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-xs font-black text-emerald-800 uppercase tracking-tighter">
                                                                            Abono / Recibo #{alloc.collectionDisplayId || 'PENDIENTE'}
                                                                        </p>
                                                                        <p className="text-[10px] font-bold text-emerald-500">
                                                                            {alloc.collectionDate ? new Date(alloc.collectionDate).toLocaleString() : 'Fecha desconocida'}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                                <span className="text-sm font-black text-emerald-600">
                                                                    -{config.currencySymbol}{Math.abs(alloc.amount).toFixed(2)}
                                                                </span>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        tx.status !== 'COMPLETED' && (
                                                            <div className="px-4 py-2 text-[10px] font-bold text-slate-400 italic">No registra pagos aplicados</div>
                                                        )
                                                    )}

                                                    {/* Result */}
                                                    <div className="flex items-center justify-between p-5 mt-2 rounded-2xl bg-slate-900 text-white shadow-xl shadow-slate-200">
                                                        <div className="flex items-center gap-4">
                                                            <div className="p-2 bg-white/10 text-white rounded-xl">
                                                                <Equal size={14} strokeWidth={3} />
                                                            </div>
                                                            <span className="text-xs font-black uppercase tracking-widest opacity-60">Saldo Actual</span>
                                                        </div>
                                                        <span className="text-lg font-black">{config.currencySymbol}{(tx.pendingBalance || 0).toFixed(2)}</span>
                                                    </div>

                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* FOOTER ACTIONS */}
                <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex justify-between items-center">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">CLIC POS • Sistema de Gestión de Créditos</p>
                    <button
                        onClick={() => window.print()}
                        className="px-6 py-2.5 bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 hover:bg-slate-700 transition-colors shadow-lg"
                    >
                        <Printer size={16} /> Imprimir Reporte
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CustomerStatementView;
