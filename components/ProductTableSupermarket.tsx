import React, { CSSProperties, useEffect, useRef, useState } from 'react';
import { CartItem, BusinessConfig } from '../types';
import { createSupermarketLineInteraction } from '../utils/supermarketLineInteraction';
import './supermarketTicket.css';

interface ProductTableSupermarketProps {
    cart: CartItem[];
    config: BusinessConfig;
    currencySymbol: string;
    lastAddedCartId: string | null;
    onEditItem: (cartId: string) => void;
    containerStyle?: CSSProperties;
    taxIncluded?: boolean;
}

const ProductTableSupermarket: React.FC<ProductTableSupermarketProps> = ({
    cart,
    config,
    currencySymbol,
    lastAddedCartId,
    onEditItem,
    containerStyle,
    taxIncluded = false
}) => {
    const [highlightedId, setHighlightedId] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const onEditItemRef = useRef(onEditItem);
    onEditItemRef.current = onEditItem;
    const lineInteractionRef = useRef<ReturnType<typeof createSupermarketLineInteraction> | null>(null);
    if (!lineInteractionRef.current) {
        lineInteractionRef.current = createSupermarketLineInteraction((cartId) => onEditItemRef.current(cartId));
    }
    const lineInteraction = lineInteractionRef.current;

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
            <table className="supermarket-ticket-table w-full text-left border-collapse table-fixed">
                <thead className="bg-gray-50 sticky top-0 z-10 text-[11px] uppercase text-gray-400 font-black tracking-[0.18em] shadow-sm">
                    <tr>
                        <th className="px-2 py-2 text-center w-16 text-gray-600">Cant</th>
                        <th className="px-3 py-2 w-auto">Descripción</th>
                        <th className="supermarket-money px-4 py-3 text-right">Precio<span className="block text-[9px] tracking-normal font-medium normal-case">Unitario</span></th>
                        <th className="supermarket-money px-4 py-3 text-right">ITBIS<span className="block text-[9px] tracking-normal font-medium normal-case">{taxIncluded ? 'Incluido · línea' : 'Por línea'}</span></th>
                        <th className="supermarket-money px-4 py-3 text-right text-gray-800">Total</th>
                    </tr>
                </thead>
                <tbody className="text-sm divide-y divide-gray-50">
                    {cart.map((item) => {
                        const isHighlighted = highlightedId === item.cartId;
                        const taxAmount = item.price * item.quantity * (config.taxRate || 0.18);
                        const total = item.price * item.quantity;
                        const hasDiscount = item.originalPrice && item.price < item.originalPrice;
                        const displayCode = item.barcode || item.variantSku || item.sku || item.id;
                        const isReturn = item.quantity < 0;

                        return (
                            <tr
                                key={item.cartId}
                                tabIndex={0}
                                aria-label={`Editar ${item.name}, cantidad ${item.quantity}`}
                                onClick={() => item.cartId && lineInteraction.click(item.cartId)}
                                onContextMenu={(event) => item.cartId && lineInteraction.contextMenu(item.cartId, event)}
                                onKeyDown={(event) => item.cartId && lineInteraction.keyDown(item.cartId, {
                                    key: event.key,
                                    isRowTarget: event.target === event.currentTarget,
                                    preventDefault: () => event.preventDefault(),
                                })}
                                className={`
                                    group cursor-pointer transition-colors duration-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500
                                    ${isHighlighted ? 'bg-blue-50/80 animate-pulse' : 'hover:bg-gray-50'}
                                    ${isReturn ? 'bg-red-50/30' : ''}
                                `}
                            >
                                {/* CANT */}
                                <td className={`px-2 py-3 text-center font-black text-xl ${isReturn ? 'text-red-600' : 'text-gray-900'}`}>
                                    {item.quantity}
                                </td>

                                {/* Name and variant on top; code on its own secondary line. */}
                                <td className="px-3 py-3">
                                    <div className="flex flex-col justify-center h-full">
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                                            <span className={`font-black text-[1.02rem] break-words min-w-0 ${isReturn ? 'text-red-700' : 'text-gray-800'}`}>
                                                {item.name}
                                            </span>
                                            {item.variantInfo && (
                                                <span className="supermarket-variant inline-flex rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-sm font-bold text-blue-800">
                                                    {item.variantInfo}
                                                </span>
                                            )}
                                        </div>
                                        {displayCode && <span className="supermarket-code mt-1 block break-all text-xs text-slate-500 font-mono">{displayCode}</span>}
                                        {hasDiscount && (
                                            <span className="text-[11px] text-red-500 font-bold leading-none mt-1">
                                                Desc. Aplicado
                                            </span>
                                        )}
                                    </div>
                                </td>

                                {/* PRECIO */}
                                <td className={`supermarket-money px-4 py-3 text-right text-gray-700 tabular-nums font-bold ${currencySymbol.length + item.price.toFixed(2).length > 13 ? 'supermarket-money-long' : ''}`}>
                                    {currencySymbol}{item.price.toFixed(2)}
                                </td>

                                {/* ITBIS */}
                                <td className={`supermarket-money px-4 py-3 text-right text-gray-500 tabular-nums ${currencySymbol.length + taxAmount.toFixed(2).length > 13 ? 'supermarket-money-long' : ''}`}>
                                    {currencySymbol}{taxAmount.toFixed(2)}
                                </td>

                                {/* TOTAL */}
                                <td className={`supermarket-money supermarket-line-total px-4 py-3 text-right font-black tabular-nums ${currencySymbol.length + total.toFixed(2).length > 13 ? 'supermarket-money-long' : ''} ${isReturn ? 'text-red-600' : 'text-gray-900'}`}>
                                    {currencySymbol}{total.toFixed(2)}
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
