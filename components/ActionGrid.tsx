import React from 'react';
import {
    Percent, QrCode, Inbox, StickyNote, Box, Save, Settings,
    Lock, LogOut, Package, RotateCcw, CreditCard
} from 'lucide-react';
import { BusinessConfig } from '../types';

interface ActionGridProps {
    onAction: (action: string) => void;
    config: BusinessConfig;
    parkedTicketsCount: number;
    globalDiscountValue: number;
    isReturnMode: boolean;
    hasCartItems: boolean;
    orientation?: 'horizontal' | 'vertical';
}

const ActionGrid: React.FC<ActionGridProps> = ({
    onAction,
    config,
    parkedTicketsCount,
    globalDiscountValue,
    isReturnMode,
    hasCartItems,
    orientation = 'horizontal'
}) => {
    const isHorizontal = orientation === 'horizontal';

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
            <div key={id} className="relative w-full">
                <button
                    disabled={disabled}
                    onClick={() => onAction(id)}
                    className={`
                        flex flex-col items-center justify-center w-full
                        ${isHorizontal ? 'h-14 py-1 gap-0.5' : 'h-20 py-3 gap-1.5'}
                        ${finalColors} rounded-xl
                        transition-all duration-200
                        active:scale-90
                        ${disabled ? 'opacity-30 grayscale pointer-events-none' : ''}
                    `}
                >
                    <div className="shrink-0">
                        {React.cloneElement(icon, { size: isHorizontal ? 24 : 22, strokeWidth: 2.5 })}
                    </div>

                    <span className="text-[10px] font-bold uppercase tracking-tight text-center leading-none px-0.5">
                        {label}
                    </span>

                    {badge && (
                        <span className={`absolute ${isHorizontal ? 'top-1 right-1' : 'top-2 right-2'} flex h-5 w-5 items-center justify-center rounded-full bg-orange-600 text-[10px] font-black text-white shadow-md border-2 border-white animate-in zoom-in-50`}>
                            {typeof badge === 'number' ? badge : ''}
                        </span>
                    )}
                </button>
            </div>
        );
    };

    return (
        <div className={`w-full ${isHorizontal ? 'bg-white border-t border-gray-100 p-2 shadow-inner' : ''}`}>
            <div className={`mx-auto grid ${isHorizontal ? 'max-w-[1800px] grid-cols-6 gap-2' : 'grid-cols-3 gap-2'}`}>
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

export default ActionGrid;
