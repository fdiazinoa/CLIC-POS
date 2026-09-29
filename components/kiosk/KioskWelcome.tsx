/**
 * KioskWelcome
 * 
 * Welcome screen for self-checkout kiosk.
 * Simple, inviting interface to start shopping.
 */

import React from 'react';
import { Building2, ShoppingBag, ShoppingCart, Settings, UtensilsCrossed } from 'lucide-react';
import type { OrderServiceType } from '../../types';

interface KioskWelcomeProps {
    onStartShopping: () => void;
    storeName?: string;
    onAdminAccess?: () => void;
    restaurantMode?: boolean;
    onSelectServiceType?: (serviceType: Extract<OrderServiceType, 'DINE_IN' | 'TAKEOUT'>) => void;
}

const KioskWelcome: React.FC<KioskWelcomeProps> = ({
    onStartShopping,
    storeName = 'CLIC POS',
    onAdminAccess,
    restaurantMode = false,
    onSelectServiceType,
}) => {
    const normalizedStoreName = storeName
        .replace(/\bDEMO(S)?\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^CLIC POS$/i, 'CLIC-POS') || 'CLIC-POS';

    return (
        <div
            onClick={restaurantMode ? undefined : onStartShopping}
            className="w-full h-full relative overflow-hidden cursor-pointer"
        >
            {onAdminAccess && (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onAdminAccess();
                    }}
                    className="absolute top-4 right-4 z-20 w-12 h-12 rounded-full bg-black/5 border border-white/10 flex items-center justify-center text-white/10 hover:text-white/35 hover:bg-black/20 active:bg-black/30 transition-all"
                    title="Acceso administrativo"
                    aria-label="Acceso administrativo"
                >
                    <Settings size={16} />
                </button>
            )}

            {/* Video Background */}
            <video
                autoPlay
                muted
                loop
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
            >
                <source src="https://assets.mixkit.co/videos/preview/mixkit-woman-shopping-for-clothes-in-store-3444-large.mp4" type="video/mp4" />
                {/* Fallback for when video fails or loads */}
                <div className="w-full h-full bg-gradient-to-br from-blue-900 to-indigo-900" />
            </video>

            {/* Dark Overlay */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />

            {/* Content Container */}
            <div className="relative z-10 w-full h-full flex flex-col items-center justify-center text-white p-8 animate-in fade-in duration-1000">

                {/* Logo/Icon */}
                <div className="mb-8 animate-bounce-slow">
                    <div className="w-40 h-40 bg-white/10 backdrop-blur-md border border-white/20 rounded-full flex items-center justify-center shadow-2xl">
                        {restaurantMode
                            ? <UtensilsCrossed size={80} className="text-white" strokeWidth={1.5} />
                            : <ShoppingCart size={80} className="text-white" strokeWidth={1.5} />}
                    </div>
                </div>

                {/* Welcome Message */}
                <h1 className="text-7xl font-black mb-6 text-center tracking-tight drop-shadow-lg">
                    ¡Bienvenido!
                </h1>

                <p className="text-3xl font-light mb-16 text-center max-w-3xl text-white/90 drop-shadow-md">
                    {restaurantMode ? '¿Cómo deseas disfrutar tu pedido?' : 'Toca la pantalla para comenzar a comprar'}
                </p>

                {restaurantMode ? (
                    <div className="grid w-full max-w-3xl grid-cols-2 gap-6" role="group" aria-label="Modalidad del pedido">
                        <button
                            type="button"
                            onClick={() => onSelectServiceType?.('DINE_IN')}
                            className="flex min-h-44 flex-col items-center justify-center gap-4 rounded-3xl border-2 border-white/30 bg-white/15 p-6 text-2xl font-black shadow-2xl backdrop-blur-md transition hover:bg-white/25 active:scale-[0.98]"
                        >
                            <Building2 size={54} />
                            Comer aquí
                        </button>
                        <button
                            type="button"
                            onClick={() => onSelectServiceType?.('TAKEOUT')}
                            className="flex min-h-44 flex-col items-center justify-center gap-4 rounded-3xl border-2 border-white/30 bg-white/15 p-6 text-2xl font-black shadow-2xl backdrop-blur-md transition hover:bg-white/25 active:scale-[0.98]"
                        >
                            <ShoppingBag size={54} />
                            Para llevar
                        </button>
                    </div>
                ) : (
                    <div className="animate-pulse">
                        <div className="w-24 h-24 rounded-full border-4 border-white/30 flex items-center justify-center">
                            <div className="w-16 h-16 bg-white rounded-full opacity-20" />
                        </div>
                    </div>
                )}

                {/* Store Info */}
                <div className="absolute bottom-12 text-center">
                    <p className="text-xl font-medium text-white/80 tracking-widest uppercase">
                        {normalizedStoreName}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default KioskWelcome;
