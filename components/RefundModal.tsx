import React, { useState, useEffect } from 'react';
import { X, RotateCcw, AlertTriangle, Check, Archive, Trash2, Wallet, Banknote } from 'lucide-react';
import { Transaction, CartItem, Customer, RefundProcessingOptions } from '../types';

type RefundModalMode = 'STANDARD' | 'AZUL_GATEWAY_REFUND';

interface RefundModalProps {
    isOpen: boolean;
    onClose: () => void;
    transaction: Transaction | null;
    onConfirm: (
        originalTx: Transaction,
        refundItems: CartItem[],
        conditions: Map<string, 'SELLABLE' | 'DAMAGED'>,
        reason: string,
        options?: RefundProcessingOptions
    ) => void;
    currencySymbol: string;
    mode?: RefundModalMode;
    customers?: Customer[];
}

export const RefundModal: React.FC<RefundModalProps> = ({
    isOpen,
    onClose,
    transaction,
    onConfirm,
    currencySymbol,
    mode = 'STANDARD',
    customers = []
}) => {
    const [refundQuantities, setRefundQuantities] = useState<Map<string, number>>(new Map());
    const [itemConditions, setItemConditions] = useState<Map<string, 'SELLABLE' | 'DAMAGED'>>(new Map());
    const [reason, setReason] = useState('Devolución de Cliente');
    const [settlementMode, setSettlementMode] = useState<'STANDARD' | 'WALLET_ADVANCE'>('STANDARD');
    const [customerSearch, setCustomerSearch] = useState('');
    const [selectedAdvanceCustomerId, setSelectedAdvanceCustomerId] = useState('');
    const [isAdvanceCustomerPickerOpen, setIsAdvanceCustomerPickerOpen] = useState(false);

    useEffect(() => {
        if (isOpen && transaction) {
            const initialQuantities = new Map<string, number>();
            if (mode === 'AZUL_GATEWAY_REFUND') {
                transaction.items.forEach(item => {
                    initialQuantities.set(item.cartId, item.quantity);
                });
            }
            setRefundQuantities(initialQuantities);

            // Default to SELLABLE condition
            const initialConditions = new Map<string, 'SELLABLE' | 'DAMAGED'>();
            transaction.items.forEach(item => {
                initialConditions.set(item.cartId, 'SELLABLE');
            });
            setItemConditions(initialConditions);
            setReason('');
            setSettlementMode('STANDARD');
            setCustomerSearch('');
            setIsAdvanceCustomerPickerOpen(false);
            const normalizedTransactionCustomer = String(transaction.customerName || '').trim().toLowerCase();
            const matchedCustomer = transaction.customerId
                ? customers.find(customer => customer.id === transaction.customerId)
                : customers.find(customer =>
                    normalizedTransactionCustomer &&
                    customer.name.trim().toLowerCase() === normalizedTransactionCustomer
                );
            setSelectedAdvanceCustomerId(matchedCustomer?.id || '');
        }
    }, [isOpen, mode, transaction, customers]);

    if (!isOpen || !transaction) return null;

    const isGatewayRefundMode = mode === 'AZUL_GATEWAY_REFUND';
    const selectedAdvanceCustomer = customers.find(customer => customer.id === selectedAdvanceCustomerId) || null;
    const originalCustomerName = transaction.customerName || customers.find(customer => customer.id === transaction.customerId)?.name || '';
    const normalizedCustomerSearch = customerSearch.trim().toLowerCase();
    const filteredCustomers = customers
        .filter(customer => {
            if (!normalizedCustomerSearch) return true;
            const haystack = [
                customer.name,
                customer.phone,
                customer.email,
                customer.taxId,
            ].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(normalizedCustomerSearch);
        })
        .slice(0, 8);

    const handleSelectAdvanceSettlement = () => {
        setSettlementMode('WALLET_ADVANCE');
        if (!selectedAdvanceCustomer) {
            setIsAdvanceCustomerPickerOpen(true);
        }
    };

    const handleSelectAdvanceCustomer = (customer: Customer) => {
        setSelectedAdvanceCustomerId(customer.id);
        setCustomerSearch(customer.name);
        setIsAdvanceCustomerPickerOpen(false);
    };

    const handleQtyChange = (cartId: string, max: number, delta: number) => {
        if (isGatewayRefundMode) return;
        const current = refundQuantities.get(cartId) || 0;
        const next = Math.max(0, Math.min(max, current + delta));

        const newMap = new Map(refundQuantities);
        if (next === 0) {
            newMap.delete(cartId);
        } else {
            newMap.set(cartId, next);
        }
        setRefundQuantities(newMap);
    };

    const toggleCondition = (cartId: string) => {
        const current = itemConditions.get(cartId) || 'SELLABLE';
        const next = current === 'SELLABLE' ? 'DAMAGED' : 'SELLABLE';
        const newMap = new Map(itemConditions);
        newMap.set(cartId, next);
        setItemConditions(newMap);
    };

    const totalRefundAmount = transaction.items.reduce((sum, item) => {
        const qty = refundQuantities.get(item.cartId) || 0;
        return sum + (item.price * qty);
    }, 0);

    const isFullRefund = transaction.items.every(item =>
        (refundQuantities.get(item.cartId) || 0) === item.quantity
    );

    const handleConfirm = () => {
        if (refundQuantities.size === 0) return;
        if (settlementMode === 'WALLET_ADVANCE' && !selectedAdvanceCustomer) {
            setIsAdvanceCustomerPickerOpen(true);
            return;
        }

        const itemsToRefund = transaction.items
            .filter(item => (refundQuantities.get(item.cartId) || 0) > 0)
            .map(item => ({
                ...item,
                quantity: refundQuantities.get(item.cartId) || 0
            }));

        onConfirm(
            transaction,
            itemsToRefund,
            itemConditions,
            reason || 'Devolución General',
            settlementMode === 'WALLET_ADVANCE'
                ? {
                    settlementMode: 'WALLET',
                    customerId: selectedAdvanceCustomer.id,
                    customerName: selectedAdvanceCustomer.name,
                }
                : { skipWalletDeposit: true }
        );
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl relative flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50 rounded-t-2xl">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-100 text-red-600 rounded-lg">
                            <RotateCcw size={24} />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-gray-900">{isGatewayRefundMode ? 'Procesar Refund AZUL' : 'Procesar Devolución'}</h2>
                            <p className="text-xs text-gray-500 font-medium">Ticket #{transaction.displayId || transaction.id}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">

                    <div className="mb-6 flex gap-4 p-4 bg-blue-50/50 border border-blue-100 rounded-xl items-start">
                        <AlertTriangle className="text-blue-500 shrink-0 mt-0.5" size={18} />
                        <div className="text-sm text-blue-800">
                            <p className="font-bold mb-1">{isGatewayRefundMode ? 'Refund AZUL + Nota de Crédito Fiscal (B04)' : 'Nota de Crédito Fiscal (B04)'}</p>
                            <p className="opacity-80">
                                {isGatewayRefundMode
                                    ? 'Este flujo ejecutará el refund total en AZUL y luego generará la nota de crédito vinculada a este comprobante.'
                                    : 'Se generará automáticamente una nota de crédito fiscal vinculada a este comprobante. Asegúrese de seleccionar el estado correcto del inventario.'}
                            </p>
                        </div>
                    </div>

                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="text-xs font-bold text-gray-400 uppercase border-b border-gray-100">
                                <th className="pb-3 pl-2">Producto</th>
                                <th className="pb-3 text-center">Cant. Comprada</th>
                                <th className="pb-3 text-center">A Devolver</th>
                                <th className="pb-3 text-center">Destino Stock</th>
                                <th className="pb-3 text-right pr-2">Total Reembolso</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {transaction.items.map((item) => {
                                const returnQty = refundQuantities.get(item.cartId) || 0;
                                const condition = itemConditions.get(item.cartId) || 'SELLABLE';
                                const isSelected = returnQty > 0;

                                return (
                                    <tr key={item.cartId} className={`group ${isSelected ? 'bg-red-50/30' : ''}`}>
                                        <td className="py-3 pl-2">
                                            <p className="text-sm font-bold text-gray-800">{item.name}</p>
                                            <p className="text-xs text-gray-400">{currencySymbol}{item.price.toFixed(2)} c/u</p>
                                        </td>
                                        <td className="py-3 text-center text-sm font-medium text-gray-500">
                                            {item.quantity}
                                        </td>
                                        <td className="py-3">
                                            <div className="flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => handleQtyChange(item.cartId, item.quantity, -1)}
                                                    className={`w-7 h-7 flex items-center justify-center rounded-lg border transition-colors ${
                                                        isGatewayRefundMode
                                                            ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                                                            : returnQty > 0
                                                                ? 'border-red-200 text-red-600 hover:bg-red-50'
                                                                : 'border-gray-200 text-gray-300'
                                                    }`}
                                                    disabled={returnQty === 0 || isGatewayRefundMode}
                                                >
                                                    -
                                                </button>
                                                <span className={`w-6 text-center font-bold ${returnQty > 0 ? 'text-red-600' : 'text-gray-300'}`}>
                                                    {returnQty}
                                                </span>
                                                <button
                                                    onClick={() => handleQtyChange(item.cartId, item.quantity, 1)}
                                                    className={`w-7 h-7 flex items-center justify-center rounded-lg border transition-colors ${
                                                        isGatewayRefundMode
                                                            ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                                                            : returnQty < item.quantity
                                                                ? 'border-gray-200 text-gray-600 hover:bg-gray-100'
                                                                : 'border-gray-100 text-gray-300'
                                                    }`}
                                                    disabled={returnQty >= item.quantity || isGatewayRefundMode}
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </td>
                                        <td className="py-3 text-center">
                                            {isSelected && (
                                                <button
                                                    onClick={() => toggleCondition(item.cartId)}
                                                    className={`
                             inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border
                             ${condition === 'SELLABLE'
                                                            ? 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200'
                                                            : 'bg-red-100 text-red-700 border-red-200 hover:bg-red-200'}
                           `}
                                                >
                                                    {condition === 'SELLABLE' ? (
                                                        <>
                                                            <Archive size={12} /> Apto Venta
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Trash2 size={12} /> Merma
                                                        </>
                                                    )}
                                                </button>
                                            )}
                                        </td>
                                        <td className="py-3 text-right pr-2">
                                            <span className={`font-mono font-bold ${isSelected ? 'text-red-600' : 'text-gray-300'}`}>
                                                {currencySymbol}{(item.price * returnQty).toFixed(2)}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    <div className="mt-6">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Motivo de la Devolución</label>
                        <input
                            type="text"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Ej: Producto defectuoso, cambio de opinión..."
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        />
                    </div>

                    {!isGatewayRefundMode && (
                        <div className="mt-6">
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Destino del Crédito</label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setSettlementMode('STANDARD')}
                                    className={`p-4 rounded-2xl border text-left transition-all ${
                                        settlementMode === 'STANDARD'
                                            ? 'border-red-300 bg-red-50 text-red-800'
                                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 font-black text-sm">
                                        <Banknote size={18} />
                                        Reembolso normal
                                    </div>
                                    <p className="text-xs mt-1 opacity-75">Genera la nota de crédito sin cargar anticipo al cliente.</p>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSelectAdvanceSettlement}
                                    className={`p-4 rounded-2xl border text-left transition-all ${
                                        settlementMode === 'WALLET_ADVANCE'
                                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 font-black text-sm">
                                        <Wallet size={18} />
                                        Generar Anticipo
                                    </div>
                                    <p className="text-xs mt-1 opacity-75">
                                        Asigna cliente y carga el valor como crédito a favor.
                                    </p>
                                </button>
                            </div>
                            {settlementMode === 'WALLET_ADVANCE' && (
                                <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 flex items-center justify-between gap-3">
                                    {selectedAdvanceCustomer && (
                                        <div>
                                            <p className="text-xs font-bold text-emerald-700 uppercase">Cliente asignado</p>
                                            <p className="text-sm font-black text-emerald-900">{selectedAdvanceCustomer.name}</p>
                                        </div>
                                    )}
                                    {!selectedAdvanceCustomer && (
                                        <div>
                                            <p className="text-xs font-bold text-emerald-700 uppercase">Cliente requerido</p>
                                            <p className="text-sm font-semibold text-emerald-900">Asigna un cliente al anticipo y a la nota de crédito.</p>
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setIsAdvanceCustomerPickerOpen(true)}
                                        className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700"
                                    >
                                        {selectedAdvanceCustomer ? 'Cambiar cliente' : 'Asignar cliente'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-between items-center">
                    <div>
                        <p className="text-xs font-bold text-gray-400 uppercase">Total a Reembolsar</p>
                        <p className="text-2xl font-black text-red-600">
                            {currencySymbol}{totalRefundAmount.toFixed(2)}
                        </p>
                        {isFullRefund && refundQuantities.size > 0 && (
                            <span className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-md">
                                {isGatewayRefundMode ? 'REFUND TOTAL AZUL' : 'ANULACIÓN TOTAL'}
                            </span>
                        )}
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-bold hover:bg-gray-100 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={refundQuantities.size === 0}
                            className={`
                 px-6 py-2.5 rounded-xl font-bold text-white flex items-center gap-2 shadow-lg transition-all
                 ${refundQuantities.size === 0
                                    ? 'bg-gray-300 cursor-not-allowed shadow-none'
                                    : 'bg-red-600 hover:bg-red-700 active:scale-[0.98] shadow-red-500/30'}
               `}
                        >
                            <Check size={18} /> {isGatewayRefundMode ? 'Confirmar Refund AZUL' : 'Confirmar Devolución'}
                        </button>
                    </div>
                </div>

            </div>

            {isAdvanceCustomerPickerOpen && (
                <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-950/60" onClick={() => setIsAdvanceCustomerPickerOpen(false)} />
                    <div className="relative w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
                        <div className="p-5 border-b border-gray-100 flex items-start justify-between bg-emerald-50">
                            <div>
                                <h3 className="text-lg font-black text-gray-900">Asignar cliente</h3>
                                <p className="text-xs font-semibold text-emerald-800 mt-1">
                                    Este cliente quedará asociado al anticipo y a la nota de crédito.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsAdvanceCustomerPickerOpen(false)}
                                className="p-2 rounded-full text-gray-400 hover:bg-white hover:text-gray-700"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-5">
                            {originalCustomerName && (
                                <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-xs font-semibold text-emerald-800">
                                    Cliente registrado en la factura: <span className="font-black">{originalCustomerName}</span>
                                </div>
                            )}

                            <input
                                type="text"
                                autoFocus
                                value={customerSearch}
                                onChange={(event) => setCustomerSearch(event.target.value)}
                                placeholder="Buscar por nombre, teléfono, email o RNC..."
                                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-emerald-400"
                            />

                            <div className="mt-4 max-h-72 overflow-y-auto space-y-2">
                                {filteredCustomers.map(customer => (
                                    <button
                                        key={customer.id}
                                        type="button"
                                        onClick={() => handleSelectAdvanceCustomer(customer)}
                                        className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                                            selectedAdvanceCustomerId === customer.id
                                                ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                                                : 'border-gray-100 bg-white text-gray-700 hover:border-emerald-200 hover:bg-emerald-50/40'
                                        }`}
                                    >
                                        <p className="text-sm font-black">{customer.name}</p>
                                        <p className="text-xs text-gray-500">
                                            {[customer.taxId, customer.phone, customer.email].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
                                        </p>
                                    </button>
                                ))}
                                {filteredCustomers.length === 0 && (
                                    <p className="py-8 text-center text-sm font-semibold text-gray-500">
                                        No hay clientes que coincidan. Crea el cliente en Clientes y vuelve a esta devolución.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
