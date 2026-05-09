import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { X, Clock, Tag, ChevronRight } from 'lucide-react';
import { Product, BusinessConfig } from '../types';
import { markPerfInteraction, measureSync, useRenderPerfDebug, useVisualUpdatePerfDebug } from '../utils/perfDebug';

interface PromoBottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    product: Product | null;
    onAddToCart: (product: Product) => void;
    config: BusinessConfig;
}

const PromoBottomSheet: React.FC<PromoBottomSheetProps> = ({
    isOpen,
    onClose,
    product,
    onAddToCart,
    config
}) => {
    const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
    const closeTransitionMs = isNativeAndroid ? 120 : 300;
    const transitionDurationClass = isNativeAndroid ? 'duration-150' : 'duration-300';
    const backdropVisualClass = isNativeAndroid ? 'bg-black/50' : 'bg-black/60 backdrop-blur-sm';
    const sheetShadowClass = isNativeAndroid ? 'shadow-lg' : 'shadow-2xl';
    const closedSheetTransformClass = isNativeAndroid ? 'translate-y-full sm:translate-y-6' : 'translate-y-full sm:translate-y-10 sm:scale-95';
    const [isVisible, setIsVisible] = useState(false);
    useRenderPerfDebug('PromoBottomSheet', { isOpen, isNativeAndroid });
    useVisualUpdatePerfDebug('PromoBottomSheet', { isOpen, isNativeAndroid });

    useEffect(() => {
        if (isOpen) {
            setIsVisible(true);
        } else {
            const timer = setTimeout(() => setIsVisible(false), closeTransitionMs); // Match transition duration
            return () => clearTimeout(timer);
        }
    }, [closeTransitionMs, isOpen]);

    if (!isVisible && !isOpen) return null;

    // Dummy Data / Fallbacks
    const promoTitle = (product?.attributes?.find(a => a.name === 'PromoTitle') as any)?.value || "¡Oferta Especial!";
    const promoDescription = (product?.attributes?.find(a => a.name === 'PromoDesc') as any)?.value || "Aprovecha este descuento exclusivo por tiempo limitado. ¡No te lo pierdas!";
    const promoExpiration = (product?.attributes?.find(a => a.name === 'PromoExp') as any)?.value || "Válido hasta agotar existencia";

    // Calculate price display
    const originalPrice = product?.price || 0;
    // Assuming the current price in product object is already the discounted one if a simple discount applies,
    // or we might want to show a "fake" higher price to emphasize savings if we had that data.
    // For now, let's assume product.price is the OFFER price.
    // We can simulate an "original" price for visual impact if needed, or just show the current price.
    const handleClose = () => {
        markPerfInteraction('promoBottomSheet.close', 2000, { isNativeAndroid });
        measureSync('promoBottomSheet.close', onClose, { isNativeAndroid });
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center pointer-events-none">
            {/* Backdrop */}
            <div
                className={`absolute inset-0 ${backdropVisualClass} transition-opacity ${transitionDurationClass} pointer-events-auto ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={handleClose}
            />

            {/* Sheet */}
            <div
                className={`
                    relative w-full max-w-lg bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] p-6 sm:p-8 ${sheetShadowClass}
                    transform transition-transform ${transitionDurationClass} ease-out pointer-events-auto
                    ${isOpen ? 'translate-y-0 scale-100' : closedSheetTransformClass}
                `}
            >
                {/* Handle for mobile dragging visual cue */}
                <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6 sm:hidden" />

                {/* Close Button */}
                <button
                    onClick={handleClose}
                    className="absolute top-6 right-6 p-2 bg-gray-100 rounded-full text-gray-500 hover:bg-gray-200 transition-colors"
                >
                    <X size={20} />
                </button>

                {/* Content */}
                <div className="flex flex-col items-center text-center">

                    {/* Promo Badge Icon */}
                    <div className={`w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4 ${isNativeAndroid ? '' : 'animate-in zoom-in-50 duration-500 delay-100'}`}>
                        <Tag size={32} className="fill-current" />
                    </div>

                    <h2 className="text-2xl font-black text-gray-900 mb-2 leading-tight">
                        {promoTitle}
                    </h2>

                    <p className="text-gray-500 text-sm mb-6 leading-relaxed max-w-xs">
                        {promoDescription}
                    </p>

                    {/* Product Preview Card */}
                    {product && (
                        <div className="w-full bg-gray-50 rounded-2xl p-4 flex items-center gap-4 mb-6 border border-gray-100 text-left">
                            <div className="w-16 h-16 bg-white rounded-xl overflow-hidden shrink-0 border border-gray-200">
                                {product.image ? (
                                    <img src={product.image} className="w-full h-full object-cover" alt={product.name} />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-300 font-bold text-xl">
                                        {product.name.charAt(0)}
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-bold text-gray-900 truncate">{product.name}</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="font-black text-lg text-red-600">{config.currencySymbol}{product.price.toFixed(2)}</span>
                                    {/* Fake original price for demo effect if not provided */}
                                    <span className="text-xs text-gray-400 line-through font-medium">{config.currencySymbol}{(product.price * 1.2).toFixed(2)}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Expiration Info */}
                    <div className="flex items-center gap-2 text-xs font-bold text-orange-600 bg-orange-50 px-3 py-1.5 rounded-lg mb-8">
                        <Clock size={14} />
                        <span>{promoExpiration}</span>
                    </div>

                    {/* CTA Button */}
                    <button
                        onClick={() => {
                            if (product) onAddToCart(product);
                            handleClose();
                        }}
                        className="pos-touch-button pos-touch-critical w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-lg shadow-md shadow-blue-200 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                        <span>Aprovechar Oferta</span>
                        <ChevronRight size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PromoBottomSheet;
