/**
 * KioskWelcome
 * 
 * Welcome screen for self-checkout kiosk.
 * Simple, inviting interface to start shopping.
 */

import React from 'react';
import { ShoppingCart, ArrowRight } from 'lucide-react';

interface KioskWelcomeProps {
    onStartShopping: () => void;
    storeName?: string;
}

const KioskWelcome: React.FC<KioskWelcomeProps> = ({
    onStartShopping,
    storeName = 'CLIC POS'
}) => {
    return (
        <div
            onClick={onStartShopping}
            className="w-full h-full relative overflow-hidden cursor-pointer"
        >
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
                        <ShoppingCart size={80} className="text-white" strokeWidth={1.5} />
                    </div>
                </div>

                {/* Welcome Message */}
                <h1 className="text-7xl font-black mb-6 text-center tracking-tight drop-shadow-lg">
                    ¡Bienvenido!
                </h1>

                <p className="text-3xl font-light mb-16 text-center max-w-3xl text-white/90 drop-shadow-md">
                    Toca la pantalla para comenzar a comprar
                </p>

                {/* Pulse Indicator */}
                <div className="animate-pulse">
                    <div className="w-24 h-24 rounded-full border-4 border-white/30 flex items-center justify-center">
                        <div className="w-16 h-16 bg-white rounded-full opacity-20" />
                    </div>
                </div>

                {/* Store Info */}
                <div className="absolute bottom-12 text-center">
                    <p className="text-xl font-medium text-white/80 tracking-widest uppercase">
                        {storeName}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default KioskWelcome;
