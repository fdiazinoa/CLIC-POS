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
            }, 1500); // Extended visual pulse
            return () => clearTimeout(timer);
        }
    }, [lastAddedCartId]);

    return (
        <div
            ref={containerRef}
            className="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-white scroll-smooth relative"
            style={containerStyle}
        >
            <table className="w-full text-left border-collapse table-fixed">
                <thead className="bg-gray-50 sticky top-0 z-10 text-[11px] uppercase text-gray-400 font-black tracking-[0.18em] shadow-sm">
                    <tr>
                        <th className="px-2 py-2 text-center w-16 text-gray-600">Cant</th>
                        <th className="px-3 py-2 w-auto">Descripción</th>
                        <th className="px-3 py-2 text-right w-24 hidden sm:table-cell">ITBIS</th>
                        <th className="px-3 py-2 text-right w-28">Precio</th>
                        <th className="px-3 py-2 text-right pr-4 w-32 text-gray-800">Total</th>
                        <th className="w-8"></th>
                    </tr>
                </thead>
                <tbody className="text-sm divide-y divide-gray-50">
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
                                    group transition-colors duration-500
                                    ${isHighlighted ? 'bg-blue-50/80 animate-pulse' : 'hover:bg-gray-50'}
                                    ${isReturn ? 'bg-red-50/30' : ''}
                                `}
                            >
                                {/* CANT */}
                                <td className={`px-2 py-3 text-center font-black text-xl ${isReturn ? 'text-red-600' : 'text-gray-900'}`}>
                                    {item.quantity}
                                </td>

                                {/* DESCRIPCION (Combined Name + SKU) */}
                                <td className="px-3 py-3">
                                    <div className="flex flex-col justify-center h-full">
                                        <div className="flex items-baseline gap-2 overflow-hidden">
                                            <span className={`font-black text-[1.02rem] truncate ${isReturn ? 'text-red-700' : 'text-gray-800'}`}>
                                                {item.name}
                                            </span>
                                            {displayCode && (
                                                <span className="text-xs text-gray-400 font-mono hidden md:inline shrink-0">
                                                    {displayCode}
                                                </span>
                                            )}
                                        </div>
                                        {hasDiscount && (
                                            <span className="text-[11px] text-red-500 font-bold leading-none mt-1">
                                                Desc. Aplicado
                                            </span>
                                        )}
                                    </div>
                                </td>

                                {/* ITBIS */}
                                <td className="px-3 py-3 text-right font-mono text-gray-500 text-sm tabular-nums hidden sm:table-cell">
                                    {currencySymbol}{taxAmount.toFixed(2)}
                                </td>

                                {/* PRECIO */}
                                <td className="px-3 py-3 text-right font-mono text-gray-700 tabular-nums font-bold text-lg">
                                    {currencySymbol}{item.price.toFixed(2)}
                                </td>

                                {/* TOTAL */}
                                <td className={`px-3 py-3 text-right pr-4 font-black font-mono tabular-nums text-2xl ${isReturn ? 'text-red-600' : 'text-gray-900'}`}>
                                    {currencySymbol}{total.toFixed(2)}
                                </td>

                                {/* ACCIONES (Hover) */}
                                <td className="px-1 text-center">
                                    <button
                                        onClick={() => onRemoveItem(item.cartId!)}
                                        className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all transform hover:scale-110"
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
                <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-300 pointer-events-none">
                    <p className="text-lg font-black opacity-50">Ticket Vacío</p>
                    <p className="text-xs opacity-40 mt-2 tracking-[0.24em] uppercase">Modo Supermercado Activo</p>
                </div>
            )}
        </div>
    );
};

export default ProductTableSupermarket;
