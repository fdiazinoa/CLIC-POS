import React, { useState, useEffect } from 'react';
import { X, RotateCcw, Check, AlertTriangle, Search } from 'lucide-react';
import { Transaction, CartItem, BusinessConfig } from '../types';
import { transactionService } from '../services/transactionService';

interface ReturnModalProps {
    isOpen: boolean;
    onClose: () => void;
    invoiceId: string | null;
    transactions: Transaction[];
    onProcessReturn: (originalTransaction: Transaction, itemsToReturn: { itemId: string, quantity: number }[]) => void;
    config: BusinessConfig;
}

const ReturnModal: React.FC<ReturnModalProps> = ({
    isOpen,
    onClose,
    invoiceId,
    transactions,
    onProcessReturn,
    config
}) => {
    const [transaction, setTransaction] = useState<Transaction | null>(null);
    const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && invoiceId) {
            loadTransaction(invoiceId);
        } else {
            setTransaction(null);
            setReturnQuantities({});
            setError(null);
        }
    }, [isOpen, invoiceId, transactions]);

    const loadTransaction = async (id: string) => {
        setLoading(true);
        setError(null);
        try {
            // First try to find in local props
            let found = transactions.find(t => t.id === id || t.displayId === id);

            // If not found, try service (if implemented) or show error
            // For now assuming it's in the list or we can't find it
            if (!found) {
                // Fallback: try to find by ID if the QR passed the UUID
                // In a real app we might fetch from API
                setError("Factura no encontrada en el historial local.");
            } else {
                setTransaction(found);
                // Initialize return quantities to 0
                const initialQuantities: Record<string, number> = {};
                found.items.forEach(item => {
                    initialQuantities[item.cartId] = 0;
                });
                setReturnQuantities(initialQuantities);
            }
        } catch (err) {
            setError("Error cargando la factura.");
        } finally {
            setLoading(false);
        }
    };

    const handleQuantityChange = (cartId: string, delta: number) => {
        if (!transaction) return;

        const item = transaction.items.find(i => i.cartId === cartId);
        if (!item) return;

        setReturnQuantities(prev => {
            const current = prev[cartId] || 0;
            const max = item.quantity; // TODO: Subtract already returned quantities if we track partial returns history
            const next = Math.max(0, Math.min(max, current + delta));
            return { ...prev, [cartId]: next };
        });
    };

    const handleSelectAll = () => {
        if (!transaction) return;
        const all: Record<string, number> = {};
        transaction.items.forEach(item => {
            all[item.cartId] = item.quantity;
        });
        setReturnQuantities(all);
    };

    const handleSubmit = () => {
        if (!transaction) return;

        const itemsToReturn = Object.entries(returnQuantities)
            .filter(([_, qty]) => qty > 0)
            .map(([cartId, qty]) => ({ itemId: cartId, quantity: qty }));

        if (itemsToReturn.length === 0) {
            alert("Seleccione al menos un artículo para devolver.");
            return;
        }

        onProcessReturn(transaction, itemsToReturn);
        onClose();
    };

    if (!isOpen) return null;

    const totalRefund = transaction?.items.reduce((sum, item) => {
        const qty = returnQuantities[item.cartId] || 0;
        return sum + (item.price * qty);
    }, 0) || 0;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="bg-gray-50 p-6 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-red-100 p-2 rounded-xl text-red-600">
                            <RotateCcw size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-gray-900">Devolución de Factura</h2>
                            <p className="text-sm text-gray-500 font-medium">
                                {transaction ? `Ticket #${transaction.displayId || transaction.id}` : 'Escaneando...'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                        <X size={20} className="text-gray-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                            <Search size={48} className="animate-pulse mb-4" />
                            <p>Buscando factura...</p>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center py-12 text-red-500">
                            <AlertTriangle size={48} className="mb-4" />
                            <p className="font-bold">{error}</p>
                            <p className="text-sm text-gray-400 mt-2">ID: {invoiceId}</p>
                        </div>
                    ) : transaction ? (
                        <div className="space-y-6">
                            {/* Info Card */}
                            <div className="bg-gray-50 rounded-2xl p-4 text-sm flex justify-between items-center">
                                <div>
                                    <p className="text-gray-500">Cliente</p>
                                    <p className="font-bold text-gray-900">{transaction.customerName || 'Cliente Mostrador'}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-gray-500">Fecha</p>
                                    <p className="font-bold text-gray-900">{new Date(transaction.date).toLocaleDateString()}</p>
                                </div>
                            </div>

                            {/* Items List */}
                            <div>
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="font-bold text-gray-900">Artículos</h3>
                                    <button
                                        onClick={handleSelectAll}
                                        className="text-sm font-bold text-blue-600 hover:text-blue-700 hover:underline"
                                    >
                                        Devolver Todo
                                    </button>
                                </div>
                                <div className="space-y-3">
                                    {transaction.items.map(item => {
                                        const returnQty = returnQuantities[item.cartId] || 0;
                                        const isSelected = returnQty > 0;

                                        return (
                                            <div key={item.cartId} className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${isSelected ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'}`}>
                                                <div className="flex-1">
                                                    <p className="font-bold text-gray-900">{item.name}</p>
                                                    <p className="text-xs text-gray-500">
                                                        Comprado: {item.quantity} x {config.currencySymbol}{item.price.toFixed(2)}
                                                    </p>
                                                </div>

                                                <div className="flex items-center gap-4">
                                                    <div className="flex items-center bg-white rounded-xl border border-gray-200 shadow-sm h-10">
                                                        <button
                                                            onClick={() => handleQuantityChange(item.cartId, -1)}
                                                            className="w-10 h-full flex items-center justify-center hover:bg-gray-50 text-gray-600 rounded-l-xl font-bold"
                                                            disabled={returnQty === 0}
                                                        >
                                                            -
                                                        </button>
                                                        <div className="w-12 text-center font-bold text-gray-900">
                                                            {returnQty}
                                                        </div>
                                                        <button
                                                            onClick={() => handleQuantityChange(item.cartId, 1)}
                                                            className="w-10 h-full flex items-center justify-center hover:bg-gray-50 text-gray-600 rounded-r-xl font-bold"
                                                            disabled={returnQty >= item.quantity}
                                                        >
                                                            +
                                                        </button>
                                                    </div>
                                                    <div className="w-24 text-right font-bold text-gray-900">
                                                        {config.currencySymbol}{(item.price * returnQty).toFixed(2)}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-100 bg-gray-50">
                    <div className="flex justify-between items-center mb-4">
                        <span className="text-gray-500 font-medium">Total a Devolver</span>
                        <span className="text-2xl font-black text-gray-900">{config.currencySymbol}{totalRefund.toFixed(2)}</span>
                    </div>
                    <button
                        onClick={handleSubmit}
                        disabled={totalRefund === 0}
                        className="w-full py-4 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-2xl font-bold text-lg shadow-lg shadow-red-200 transition-all flex items-center justify-center gap-2"
                    >
                        <Check size={24} />
                        Confirmar Devolución
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ReturnModal;
