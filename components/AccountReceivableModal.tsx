import React, { useState, useMemo, useEffect } from 'react';
import { X, DollarSign, Check, AlertCircle, Printer, Save, Banknote, CreditCard, ArrowRightLeft, FileText } from 'lucide-react';
import { Customer, Transaction, BusinessConfig, Collection, CollectionMethod, User } from '../types';
import { suggestFIFOAllocation, DelinquentInvoice } from '../hooks/useCreditControl';
import { db } from '../utils/db';

interface AccountReceivableModalProps {
    isOpen: boolean;
    onClose: () => void;
    customer: Customer;
    transactions: Transaction[];
    collections: Collection[];
    currentUser: User;
    terminalId: string;
    config: BusinessConfig;
    onSuccess: () => void;
    initialAmount?: number;
    initialInvoices?: string[];
}

const AccountReceivableModal: React.FC<AccountReceivableModalProps> = ({
    isOpen,
    onClose,
    customer,
    transactions,
    collections,
    currentUser,
    terminalId,
    config,
    onSuccess,
    initialAmount,
    initialInvoices
}) => {
    const [amount, setAmount] = useState<string>(initialAmount ? initialAmount.toString() : '');
    const [method, setMethod] = useState<CollectionMethod>('CASH');
    const [reference, setReference] = useState('');
    const [notes, setNotes] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    // Initial Selection State
    const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(
        initialInvoices ? new Set(initialInvoices) : new Set()
    );

    // If initialInvoices are provided, we should respect them.
    // If not, we might default to auto-allocation which is handled by the suggestFIFO logic later,
    // but the manual toggle state needs to be initialized.

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

    const getEffectivePendingBalance = (tx: Transaction): number => {
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
    };

    const unpaidInvoices = useMemo(() => {
        return transactions
            .filter(tx => tx.customerId === customer.id)
            .map(tx => ({ ...tx, pendingBalance: getEffectivePendingBalance(tx) }))
            .filter(tx => (tx.pendingBalance || 0) > 0)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()) as DelinquentInvoice[];
    }, [transactions, customer.id, collections]);

    const totalOwed = unpaidInvoices.reduce((sum, inv) => sum + (inv.pendingBalance || 0), 0);
    const pendingByTxId = useMemo(() => {
        const map = new globalThis.Map<string, number>();
        for (const inv of unpaidInvoices) {
            map.set(inv.id, toPositiveNumber(inv.pendingBalance));
        }
        return map;
    }, [unpaidInvoices]);

    const allocationResult = useMemo(() => {
        const numAmount = parseFloat(amount) || 0;

        // Filter invoices if selection is active
        const eligibleInvoices = selectedInvoices.size > 0
            ? unpaidInvoices.filter(inv => selectedInvoices.has(inv.id))
            : unpaidInvoices;

        return suggestFIFOAllocation(numAmount, eligibleInvoices);
    }, [amount, unpaidInvoices, selectedInvoices]);
    const enteredAmount = parseFloat(amount) || 0;

    const generateCollectionDisplayId = async (): Promise<{
        displayId: string;
        seriesId: string;
        seriesNumber: number;
    }> => {
        const normalizeTerminalId = (value?: string | null) => (value || '').trim().toLowerCase();
        const activeTerminal = (config.terminals || []).find(
            t => normalizeTerminalId(t.id) === normalizeTerminalId(terminalId)
        );
        const assignedSeriesId = activeTerminal?.config?.documentAssignments?.['PAYMENT_IN'];

        if (!assignedSeriesId) {
            throw new Error('No hay secuencia vinculada para "Cobro Recibido". Configurela en Terminales > Serie / Documentos.');
        }

        const sequences = await db.get('internalSequences') as any[] || [];
        const sequenceIndex = sequences.findIndex((s: any) => s.id === assignedSeriesId);
        if (sequenceIndex < 0) {
            throw new Error(`La secuencia vinculada (${assignedSeriesId}) no existe en Document Center.`);
        }

        const sequence = sequences[sequenceIndex];
        const seriesNumber = Number(sequence?.nextNumber || 1);
        const padding = Number(sequence?.padding || 6);
        const prefix = String(sequence?.prefix || '').trim();
        if (!prefix) {
            throw new Error(`La secuencia ${assignedSeriesId} no tiene prefijo configurado.`);
        }

        const displayId = `${prefix}${seriesNumber.toString().padStart(padding, '0')}`;
        const updatedSequence = { ...sequence, nextNumber: seriesNumber + 1 };
        sequences[sequenceIndex] = updatedSequence;
        await db.save('internalSequences', sequences);

        try {
            const { syncManager } = await import('../services/sync/SyncManager');
            await syncManager.broadcastChange('internalSequences', updatedSequence, 'UPDATE');
        } catch (syncError) {
            console.warn('Failed to sync collection sequence update:', syncError);
        }

        return { displayId, seriesId: assignedSeriesId, seriesNumber };
    };

    const handleProcessPayment = async () => {
        const numAmount = parseFloat(amount) || 0;
        if (numAmount <= 0) return;
        if (numAmount > totalOwed + 0.01) {
            alert('El monto no puede exceder la deuda total.');
            return;
        }

        setIsProcessing(true);
        try {
            const collectionId = `RC-${Date.now()}`;
            const { displayId, seriesId, seriesNumber } = await generateCollectionDisplayId();

            const newCollection: Collection = {
                id: collectionId,
                displayId: displayId,
                seriesId,
                seriesNumber,
                customerId: customer.id,
                customerName: customer.name,
                date: new Date().toISOString(),
                totalAmount: numAmount,
                method,
                reference,
                userId: currentUser.id,
                userName: currentUser.name,
                terminalId,
                notes,
                allocations: allocationResult.allocations.map(a => ({
                    id: `AL-${Date.now()}-${Math.random()}`,
                    collectionId: collectionId,
                    transactionId: a.transactionId,
                    amount: a.amount,
                    timestamp: new Date().toISOString()
                })),
                syncStatus: 'PENDING'
            };

            // 1. Save Collection
            await db.saveDocument('collections', newCollection);

            // 2. Update affected transactions
            const [activeTransactions, historyTransactions] = await Promise.all([
                db.get('transactions') as Promise<Transaction[]>,
                db.get('transactionHistory') as Promise<Transaction[]>
            ]);
            const activeIds = new Set((activeTransactions || []).map(tx => tx.id));
            const historyIds = new Set((historyTransactions || []).map(tx => tx.id));

            for (const alloc of allocationResult.allocations) {
                const tx = transactions.find(t => t.id === alloc.transactionId);
                if (tx) {
                    const currentPending = pendingByTxId.get(tx.id) || 0;
                    const updatedTx = {
                        ...tx,
                        pendingBalance: Math.max(0, parseFloat((currentPending - alloc.amount).toFixed(2))),
                        updatedAt: new Date().toISOString(),
                        syncStatus: 'PENDING' as const
                    };

                    if (activeIds.has(tx.id)) {
                        await db.saveDocument('transactions', updatedTx);
                    }
                    if (historyIds.has(tx.id)) {
                        await db.saveDocument('transactionHistory', updatedTx);
                    }
                }
            }

            // 3. Update customer currentDebt
            const updatedCustomer = {
                ...customer,
                currentDebt: Math.max(0, parseFloat(((customer.currentDebt || 0) - numAmount).toFixed(2))),
                updatedAt: new Date().toISOString()
            };
            await db.saveDocument('customers', updatedCustomer);

            alert('Abono registrado correctamente.');
            onSuccess();
            onClose();
        } catch (error) {
            console.error('Error saving collection:', error);
            const msg = error instanceof Error ? error.message : 'Error al registrar el abono.';
            alert(msg);
        } finally {
            setIsProcessing(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-700 to-indigo-800 p-6 text-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/10 rounded-xl">
                            <DollarSign size={24} />
                        </div>
                        <div>
                            <h3 className="text-xl font-black uppercase tracking-tight">Registrar Abono</h3>
                            <p className="text-blue-100 text-xs font-bold">{customer.name}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={24} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Summary & Input */}
                        <div className="space-y-6">
                            <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Deuda Total</p>
                                <p className="text-3xl font-black text-gray-900">{config.currencySymbol}{totalOwed.toLocaleString()}</p>
                            </div>

                            <div className="space-y-4">
                                <label className="block">
                                    <span className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">Monto a Recibir</span>
                                    <input
                                        type="text"
                                        value={amount ? Number(amount.replace(/,/g, '')).toLocaleString() : ''}
                                        onChange={(e) => {
                                            const rawValue = e.target.value.replace(/,/g, '');
                                            if (!isNaN(Number(rawValue)) || rawValue === '') {
                                                setAmount(rawValue);
                                            }
                                        }}
                                        className="w-full mt-2 p-4 bg-gray-100 rounded-2xl text-2xl font-black text-gray-800 focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                                        placeholder="0.00"
                                    />
                                </label>

                                <div className="grid grid-cols-2 gap-3">
                                    {(['CASH', 'TRANSFER', 'CARD', 'CHECK'] as CollectionMethod[]).map(m => (
                                        <button
                                            key={m}
                                            onClick={() => setMethod(m)}
                                            className={`p-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all ${method === m ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-100 text-gray-400 hover:bg-gray-50'}`}
                                        >
                                            {m === 'CASH' && <Banknote size={20} />}
                                            {m === 'CARD' && <CreditCard size={20} />}
                                            {m === 'TRANSFER' && <ArrowRightLeft size={20} />}
                                            {m === 'CHECK' && <FileText size={20} />}
                                            <span className="text-[9px] font-black uppercase tracking-widest">{m === 'CASH' ? 'Efectivo' : m === 'CARD' ? 'Tarjeta' : m === 'TRANSFER' ? 'Transferencia' : 'Cheque'}</span>
                                        </button>
                                    ))}
                                </div>

                                <input
                                    type="text"
                                    value={reference}
                                    onChange={(e) => setReference(e.target.value)}
                                    placeholder="Referencia / No. Operación"
                                    className="w-full p-4 bg-gray-50 rounded-xl text-sm font-bold border border-gray-100 outline-none focus:border-blue-500"
                                />

                                <textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Notas adicionales..."
                                    className="w-full p-4 bg-gray-50 rounded-xl text-sm font-bold border border-gray-100 outline-none focus:border-blue-500 h-24 resize-none"
                                />
                            </div>
                        </div>

                        {/* Distribution Preview */}
                        <div>
                            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">DISTRIBUCIÓN AUTOMÁTICA</h4>
                            <div className="space-y-3">
                                {enteredAmount <= 0 && unpaidInvoices.length > 0 && (
                                    <p className="text-xs text-gray-500 font-bold p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                        Ingrese un monto para previsualizar la distribución. Facturas pendientes:
                                    </p>
                                )}

                                {enteredAmount <= 0 && unpaidInvoices.map(inv => (
                                    <div key={`pending-${inv.id}`} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex justify-between items-center">
                                        <div>
                                            <p className="text-[10px] font-black text-gray-900">#{inv.displayId || inv.id.slice(-8).toUpperCase()}</p>
                                            <p className="text-[10px] text-gray-500 font-bold">Pendiente</p>
                                        </div>
                                        <p className="text-lg font-black text-gray-900">{config.currencySymbol}{(inv.pendingBalance || 0).toFixed(2)}</p>
                                    </div>
                                ))}

                                {enteredAmount > 0 && allocationResult.allocations.map(alloc => (
                                    <div key={alloc.transactionId} className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100 flex justify-between items-center animate-in slide-in-from-right-2">
                                        <div>
                                            <p className="text-[10px] font-black text-blue-900">#{alloc.displayId}</p>
                                            <p className="text-[10px] text-blue-600 font-bold">Acreditado</p>
                                        </div>
                                        <p className="text-lg font-black text-blue-900">+{config.currencySymbol}{alloc.amount.toFixed(2)}</p>
                                    </div>
                                ))}

                                {enteredAmount > 0 && allocationResult.allocations.length === 0 && (
                                    <p className="text-xs text-amber-600 font-bold p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-center gap-2">
                                        <AlertCircle size={16} /> No se encontraron facturas para liquidar.
                                    </p>
                                )}
                                {allocationResult.remaining > 0 && (
                                    <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 flex justify-between items-center">
                                        <p className="text-[10px] font-black text-emerald-900 uppercase">Sobrante (A favor)</p>
                                        <p className="text-lg font-black text-emerald-900">{config.currencySymbol}{allocationResult.remaining.toFixed(2)}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-4">
                    <button onClick={onClose} className="flex-1 py-4 text-gray-500 font-black uppercase text-sm hover:bg-gray-100 rounded-2xl transition-all">Cancelar</button>
                    <button
                        onClick={handleProcessPayment}
                        disabled={isProcessing || parseFloat(amount) <= 0}
                        className="flex-[2] py-4 bg-indigo-600 text-white font-black uppercase text-sm rounded-2xl hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 disabled:bg-gray-200 disabled:shadow-none flex items-center justify-center gap-2"
                    >
                        {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        Confirmar y Generar Recibo
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AccountReceivableModal;

const Loader2 = ({ size, className }: { size: number, className?: string }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
);
