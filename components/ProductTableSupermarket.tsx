import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { CartItem, BusinessConfig } from '../types';

interface ProductTableSupermarketProps {
    cart: CartItem[];
    config: BusinessConfig;
    currencySymbol: string;
    lastAddedCartId: string | null;
    onRemoveItem: (cartId: string) => void;
}

const ProductTableSupermarket: React.FC<ProductTableSupermarketProps> = ({
    cart,
    config,
    currencySymbol,
    lastAddedCartId,
    onRemoveItem
}) => {
    const [highlightedId, setHighlightedId] = useState<string | null>(null);

    useEffect(() => {
        if (lastAddedCartId) {
            setHighlightedId(lastAddedCartId);
            const timer = setTimeout(() => {
                setHighlightedId(null);
            }, 1000); // 1s visual pulse
            return () => clearTimeout(timer);
        }
    }, [lastAddedCartId]);

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-white">
            <table className="w-full text-left border-collapse">
                <thead className="bg-gray-100 sticky top-0 z-10 text-[10px] uppercase text-gray-500 font-bold tracking-wider">
                    <tr>
                        <th className="px-2 py-2 text-center w-12 text-black">Cant</th>
                        <th className="px-2 py-2">Descripción</th>
                        <th className="px-2 py-2 text-right">ITBIS</th>
                        <th className="px-2 py-2 text-right">Precio</th>
                        <th className="px-2 py-2 text-right pr-4 text-black">Total</th>
                        <th className="w-8"></th>
                    </tr>
                </thead>
                <tbody className="text-xs">
                    {cart.map((item) => {
                        const isHighlighted = highlightedId === item.cartId;
                        const taxAmount = item.price * item.quantity * (config.taxRate || 0.18);
                        const total = item.price * item.quantity;
                        const hasDiscount = item.originalPrice && item.price < item.originalPrice;
                        const displayCode = item.barcode || item.variantSku || item.id;

                        return (
                            <tr
                                key={item.cartId}
                                className={`
                           border-b border-gray-50 bg-white group transition-colors duration-500
                           ${isHighlighted ? 'bg-blue-50' : 'hover:bg-gray-50'}
                        `}
                            >
                                {/* CANT */}
                                <td className="px-2 py-1.5 text-center font-bold text-gray-800">
                                    {item.quantity}
                                </td>

                                {/* DESCRIPCION */}
                                <td className="px-2 py-1.5">
                                    <div className="flex flex-col leading-tight">
                                        <span className="font-bold text-gray-800 text-xs line-clamp-1">
                                            {item.name}
                                        </span>
                                        {displayCode && (
                                            <span className="text-[9px] text-gray-400 font-mono">
                                                {displayCode}
                                            </span>
                                        )}
                                        {hasDiscount && (
                                            <span className="text-[9px] text-red-500 font-bold">
                                                Desc. Aplicado
                                            </span>
                                        )}
                                    </div>
                                </td>

                                {/* ITBIS */}
                                <td className="px-2 py-1.5 text-right font-mono text-gray-400 text-[10px] tabular-nums">
                                    {currencySymbol}{taxAmount.toFixed(2)}
                                </td>

                                {/* PRECIO */}
                                <td className="px-2 py-1.5 text-right font-mono text-gray-600 tabular-nums">
                                    {currencySymbol}{item.price.toFixed(2)}
                                </td>

                                {/* TOTAL */}
                                <td className="px-2 py-1.5 text-right pr-4 font-black text-gray-900 font-mono tabular-nums text-sm">
                                    {currencySymbol}{total.toFixed(2)}
                                </td>

                                {/* ACCIONES (Hover) */}
                                <td className="px-1 text-center">
                                    <button
                                        onClick={() => onRemoveItem(item.cartId!)}
                                        className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="Eliminar línea"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {cart.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-gray-300 pb-20">
                    <p className="text-sm font-medium">Ticket Vacío</p>
                    <p className="text-xs">Escanea un producto para comenzar</p>
                </div>
            )}
        </div>
    );
};

export default ProductTableSupermarket;
