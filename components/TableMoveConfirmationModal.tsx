import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, Minus, Plus, X } from 'lucide-react';
import { CartItem } from '../types';

interface TableMoveConfirmationModalProps {
    sourceLabel: string;
    targetLabel: string;
    items: CartItem[];
    onClose: () => void;
    onMoveAll: () => void;
    onMovePartial: (items: CartItem[]) => void;
}

export const buildPartialMoveItems = (
    items: CartItem[],
    quantities: Record<string, number>
): CartItem[] => items
    .map(item => {
        const key = String(item.cartId || item.id);
        const available = Math.max(0, Number(item.quantity || 0));
        const requested = Math.max(0, Number(quantities[key] || 0));
        return {
            ...item,
            quantity: Math.min(available, requested)
        };
    })
    .filter(item => Number(item.quantity || 0) > 0);

const TableMoveConfirmationModal: React.FC<TableMoveConfirmationModalProps> = ({
    sourceLabel,
    targetLabel,
    items,
    onClose,
    onMoveAll,
    onMovePartial
}) => {
    const [mode, setMode] = useState<'ALL' | 'PARTIAL' | null>(null);
    const [quantities, setQuantities] = useState<Record<string, number>>({});
    const selectedItems = useMemo(
        () => buildPartialMoveItems(items, quantities),
        [items, quantities]
    );
    const selectedQuantity = selectedItems.reduce(
        (total, item) => total + Number(item.quantity || 0),
        0
    );

    return (
        <div
            className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
                onClick={event => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-500">
                            Mover pedido
                        </p>
                        <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">
                            ¿Qué deseas mover?
                        </h2>
                        <div className="mt-3 flex min-w-0 items-center gap-2 text-sm font-bold text-slate-500">
                            <span className="truncate">{sourceLabel}</span>
                            <ArrowRightLeft size={16} className="shrink-0 text-blue-500" />
                            <span className="truncate">{targetLabel}</span>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Cerrar"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="overflow-y-auto p-5">
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={() => setMode('ALL')}
                            className={`min-h-20 rounded-2xl border px-4 py-3 text-left transition-colors ${
                                mode === 'ALL'
                                    ? 'border-blue-600 bg-blue-50 text-blue-800'
                                    : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'
                            }`}
                        >
                            <span className="block text-base font-black">Cuenta completa</span>
                            <span className="mt-1 block text-xs font-semibold opacity-70">Mover todos los artículos</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode('PARTIAL')}
                            className={`min-h-20 rounded-2xl border px-4 py-3 text-left transition-colors ${
                                mode === 'PARTIAL'
                                    ? 'border-blue-600 bg-blue-50 text-blue-800'
                                    : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'
                            }`}
                        >
                            <span className="block text-base font-black">Una parte</span>
                            <span className="mt-1 block text-xs font-semibold opacity-70">Elegir artículos y cantidades</span>
                        </button>
                    </div>

                    {mode === 'PARTIAL' && (
                        <div className="mt-5 space-y-2">
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                                Artículos a mover
                            </p>
                            {items.map(item => {
                                const key = String(item.cartId || item.id);
                                const available = Math.max(0, Number(item.quantity || 0));
                                const selected = Math.min(available, Number(quantities[key] || 0));
                                return (
                                    <div
                                        key={key}
                                        className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                                    >
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-black text-slate-800">{item.name}</p>
                                            <p className="text-xs font-semibold text-slate-400">Disponible: {available}</p>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setQuantities(current => ({
                                                    ...current,
                                                    [key]: Math.max(0, selected - 1)
                                                }))}
                                                aria-label={`Reducir ${item.name}`}
                                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600"
                                            >
                                                <Minus size={16} />
                                            </button>
                                            <span className="w-12 text-center text-sm font-black text-slate-800">
                                                {selected}/{available}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setQuantities(current => ({
                                                    ...current,
                                                    [key]: Math.min(available, selected + 1)
                                                }))}
                                                aria-label={`Aumentar ${item.name}`}
                                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600"
                                            >
                                                <Plus size={16} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-xl px-4 py-3 text-sm font-black text-slate-500 hover:bg-slate-200"
                    >
                        Cancelar
                    </button>
                    {mode && (
                        <button
                            type="button"
                            disabled={mode === 'PARTIAL' && selectedQuantity === 0}
                            onClick={() => {
                                if (mode === 'ALL') {
                                    onMoveAll();
                                    return;
                                }
                                onMovePartial(selectedItems);
                            }}
                            className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {mode === 'ALL' ? 'Mover cuenta completa' : `Mover selección (${selectedQuantity})`}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TableMoveConfirmationModal;
