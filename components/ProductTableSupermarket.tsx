import React, { CSSProperties, useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { CartItem, BusinessConfig } from '../types';

interface ProductTableSupermarketProps {
    cart: CartItem[];
    config: BusinessConfig;
    currencySymbol: string;
    lastAddedCartId: string | null;
    onRemoveItem: (cartId: string) => void;
    containerStyle?: CSSProperties;
}

const ProductTableSupermarket: React.FC<ProductTableSupermarketProps> = ({
    cart,
    config,
    currencySymbol,
    lastAddedCartId,
    onRemoveItem,
    containerStyle
}) => {
    const [highlightedId, setHighlightedId] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (lastAddedCartId) {
            setHighlightedId(lastAddedCartId);
            // Auto-scroll to top for new items (assuming prepend logic)
            if (containerRef.current) {
                containerRef.current.scrollTop = 0;
            }
            const timer = setTimeout(() => {
                setHighlightedId(null);
            }, 2000); // Extended visual pulse
            return () => clearTimeout(timer);
        }
    }, [lastAddedCartId]);

    return (
        <div
            ref={containerRef}
            className="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-[#f8fafc] scroll-smooth shadow-inner relative"
            style={containerStyle}
        >
            <table className="w-full text-left border-collapse table-fixed">
                <thead className="bg-[#1e293b] sticky top-0 z-10 text-[10px] uppercase text-gray-300 font-extrabold tracking-widest shadow-md">
                    <tr>
                        <th className="px-2 py-3 text-center w-14 border-b border-gray-700">Cant</th>
                        <th className="px-3 py-3 w-auto border-b border-gray-700">Descripción</th>
                        <th className="px-3 py-3 text-right w-24 hidden sm:table-cell border-b border-gray-700">ITBIS</th>
                        <th className="px-3 py-3 text-right w-24 border-b border-gray-700">Precio</th>
                        <th className="px-3 py-3 text-right pr-5 w-32 border-b border-gray-700 text-blue-300">Total</th>
                        <th className="w-10 border-b border-gray-700"></th>
                    </tr>
                </thead>
                <tbody className="text-sm divide-y divide-gray-200 bg-white">
                    {cart.map((item) => {
                        const isHighlighted = highlightedId === item.cartId;
                        const taxAmount = item.price * item.quantity * (config.taxRate || 0.18);
                        const total = item.price * item.quantity;
                        const hasDiscount = item.originalPrice && item.price < item.originalPrice;
                        const displayCode = item.barcode || item.variantSku || item.id;
                        const isReturn = item.quantity < 0;

                        return (
                            <tr
                                key={item.cartId}
                                className={`
                                    group transition-all duration-300 border-l-4
                                    ${isHighlighted ? 'bg-indigo-50 border-indigo-500 shadow-[inset_0_4px_10px_rgba(99,102,241,0.1)] scale-[1.002]' : 'hover:bg-slate-50 border-transparent'}
                                    ${isReturn ? 'bg-rose-50/60 border-rose-400' : ''}
                                `}
                            >
                                {/* CANT */}
                                <td className={`px-2 py-3.5 text-center font-black text-lg ${isReturn ? 'text-rose-600' : 'text-slate-800'}`}>
                                    {item.quantity}
                                </td>

                                {/* DESCRIPCION (Combined Name + SKU) */}
                                <td className="px-3 py-3.5">
                                    <div className="flex flex-col justify-center h-full">
                                        <div className="flex items-baseline gap-2 overflow-hidden">
                                            <span className={`font-extrabold text-sm truncate ${isReturn ? 'text-rose-700' : 'text-slate-900'} ${isHighlighted ? 'text-indigo-900' : ''}`}>
                                                {item.name}
                                            </span>
                                            {displayCode && (
                                                <span className="text-[10px] text-slate-400 font-mono hidden md:inline shrink-0 bg-slate-100 px-1.5 py-0.5 rounded">
                                                    {displayCode}
                                                </span>
                                            )}
                                        </div>
                                        {hasDiscount && (
                                            <span className="text-[10px] text-rose-500 font-bold leading-none mt-1 inline-block">
                                                ★ Descuento Aplicado
                                            </span>
                                        )}
                                    </div>
                                </td>

                                {/* ITBIS */}
                                <td className="px-3 py-3.5 text-right font-mono text-slate-400 text-xs tabular-nums hidden sm:table-cell font-medium">
                                    {currencySymbol}{taxAmount.toFixed(2)}
                                </td>

                                {/* PRECIO */}
                                <td className="px-3 py-3.5 text-right font-mono text-slate-500 tabular-nums font-semibold text-sm">
                                    {currencySymbol}{item.price.toFixed(2)}
                                </td>

                                {/* TOTAL */}
                                <td className={`px-3 py-3.5 text-right pr-5 font-black font-mono tabular-nums text-lg ${isReturn ? 'text-rose-600' : 'text-indigo-700'}`}>
                                    {currencySymbol}{total.toFixed(2)}
                                </td>

                                {/* ACCIONES (Hover) */}
                                <td className="px-1 text-center">
                                    <button
                                        onClick={() => onRemoveItem(item.cartId!)}
                                        className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-rose-500 opacity-0 group-hover:opacity-100 transition-all transform hover:scale-110 active:scale-95 shadow-sm"
                                        title="Eliminar línea"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {cart.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <div className="bg-slate-100/50 rounded-full w-24 h-24 flex items-center justify-center mb-4">
                        <Trash2 size={32} className="text-slate-300 opacity-80" />
                    </div>
                    <p className="text-lg font-black text-slate-400">TICKET VACÍO</p>
                    <p className="text-xs font-bold text-slate-400 tracking-widest uppercase mt-1">SUPERMARKET MODE</p>
                </div>
            )}
        </div>
    );
};

export default ProductTableSupermarket;
