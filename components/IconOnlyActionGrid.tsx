import React, { useState } from 'react';
import {
    Percent, QrCode, Inbox, StickyNote, Box, Save, Settings,
    Lock, LogOut, Package, RotateCcw, CreditCard
} from 'lucide-react';
import { BusinessConfig } from '../types';

interface IconOnlyActionGridProps {
    onAction: (action: string) => void;
    config: BusinessConfig;
    parkedTicketsCount: number;
    globalDiscountValue: number;
    isReturnMode: boolean;
    hasCartItems: boolean;
}

const IconOnlyActionGrid: React.FC<IconOnlyActionGridProps> = ({
    onAction,
    config,
    parkedTicketsCount,
    globalDiscountValue,
    isReturnMode,
    hasCartItems
}) => {
    const [hint, setHint] = useState<string | null>(null);

    const renderButton = (
        id: string,
        label: string,
        icon: React.ReactElement,
        group: 'sales' | 'wait' | 'utility' | 'closing',
        disabled: boolean = false,
        badge?: number | boolean
    ) => {
        let colors = "";

        switch (group) {
            case 'sales':
                colors = "bg-blue-600/10 text-blue-800 hover:bg-blue-600/20";
                break;
            case 'wait':
                colors = "bg-orange-500/10 text-orange-800 hover:bg-orange-500/20";
                break;
            case 'utility':
                colors = "bg-slate-500/10 text-slate-800 hover:bg-slate-500/20";
                break;
            case 'closing':
                colors = "bg-red-600/10 text-red-800 hover:bg-red-600/20";
                break;
        }

        const isActiveDiscount = id === 'DISCOUNT' && globalDiscountValue > 0;
        const finalColors = isActiveDiscount ? "bg-red-600/15 text-red-600 hover:bg-red-600/25" : colors;

        return (
            <div
                key={id}
                className="relative group"
                onMouseEnter={() => setHint(label)}
                onMouseLeave={() => setHint(null)}
            >
                <button
                    disabled={disabled}
                    onClick={() => onAction(id)}
                    className={`
                        flex items-center justify-center w-full h-16
                        ${finalColors} rounded-xl
                        transition-all duration-200
                        active:scale-90
                        ${disabled ? 'opacity-30 grayscale pointer-events-none' : ''}
                    `}
                >
                    {React.cloneElement(icon, { size: 28, strokeWidth: 2.5 })}

                    {badge && (
                        <span className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-orange-600 text-[10px] font-black text-white shadow-md border-2 border-white animate-in zoom-in-50">
                            {typeof badge === 'number' ? badge : ''}
                        </span>
                    )}
                </button>

                {/* Desktop Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-black/80 backdrop-blur-sm text-white text-[10px] font-bold uppercase tracking-wider rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                    {label}
                </div>
            </div>
        );
    };

    return (
        <div className="w-full bg-white border-t border-gray-100 p-3 shadow-inner">
            <div className="max-w-[1800px] mx-auto grid grid-cols-6 gap-3">
                {/* SALES GROUP (Blue) */}
                {renderButton('DISCOUNT', 'Descuento', <Percent />, 'sales')}
                {renderButton('COUPON', 'Cupón', <QrCode />, 'sales')}
                {renderButton('loyalty_card', 'Tarjeta', <CreditCard />, 'sales')}
                {renderButton('RECOVER_RESERVATION', 'Rec. Res.', <RotateCcw />, 'sales')}

                {/* WAIT GROUP (Orange) */}
                {renderButton('PARK_LIST', 'Espera', <Inbox />, 'wait', false, parkedTicketsCount > 0 ? parkedTicketsCount : false)}
                {renderButton('RESERVATION', 'Reserva', <StickyNote />, 'wait')}
                {renderButton('SAVE', 'Guardar', <Save />, 'wait')}

                {/* UTILITY GROUP (Gray) */}
                {renderButton('SETTINGS', 'Ajustes', <Settings />, 'utility')}
                {renderButton('DRAWER', 'Cajón', <Box />, 'utility')}
                {renderButton('TRACKING', 'Rastreo', <Package />, 'utility')}

                {/* CLOSING GROUP (Red) */}
                {renderButton('Z_REPORT', 'Cierre Z', <Lock />, 'closing')}
                {renderButton('LOGOUT', 'Salir', <LogOut />, 'closing')}
            </div>
        </div>
    );
};

export default IconOnlyActionGrid;
