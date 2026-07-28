import React from 'react';
import {
    Percent, QrCode, Inbox, StickyNote, Box, Save, Settings,
    Lock, LogOut, Package, RotateCcw, CreditCard, Calendar, Power,
    ArrowDownLeft, ArrowUpRight, Clock
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
    showLogout?: boolean;
    allowWaitList?: boolean;
}

const ActionGrid: React.FC<ActionGridProps> = ({
    onAction,
    config,
    parkedTicketsCount,
    globalDiscountValue,
    isReturnMode,
    hasCartItems,
    orientation = 'horizontal',
    showLogout = true,
    allowWaitList = true,
}) => {
    const isHorizontal = orientation === 'horizontal';
    const shouldRenderLogout = showLogout && isHorizontal;

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
                colors = "bg-blue-600 text-white shadow-sm shadow-blue-600/25 hover:bg-blue-700";
                break;
            case 'wait':
                colors = "bg-orange-500 text-white shadow-sm shadow-orange-500/25 hover:bg-orange-600";
                break;
            case 'utility':
                colors = "bg-emerald-600 text-white shadow-sm shadow-emerald-600/25 hover:bg-emerald-700";
                break;
            case 'closing':
                colors = "bg-red-600 text-white shadow-sm shadow-red-600/25 hover:bg-red-700";
                break;
        }

        const isActiveDiscount = id === 'DISCOUNT' && globalDiscountValue > 0;
        const finalColors = isActiveDiscount ? "bg-rose-600 text-white shadow-sm shadow-rose-600/25 hover:bg-rose-700" : colors;

        return (
            <div key={id} className={`relative ${isHorizontal ? 'w-[112px] shrink-0' : 'w-full'}`}>
                <button
                    disabled={disabled}
                    onClick={() => onAction(id)}
                    className={`
                        flex flex-col items-center justify-center w-full
                        ${isHorizontal ? 'h-14 py-1 gap-0.5' : 'h-20 py-3 gap-1.5'}
                        ${finalColors} rounded-xl
                        transition-all duration-200
                        active:scale-90 border border-white/25
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
        <div className={`w-full ${isHorizontal ? 'bg-white border-t border-gray-100 p-2 shadow-inner overflow-x-auto overflow-y-hidden no-scrollbar' : ''}`}>
            <div className={`mx-auto ${isHorizontal ? 'flex w-max min-w-full gap-2' : 'grid grid-cols-3 gap-2'}`}>
                {/* SALES GROUP (Blue) */}
                {renderButton('DISCOUNT', 'Descuento', <Percent />, 'sales')}
                {renderButton('COUPON', 'Cupón', <QrCode />, 'sales')}
                {renderButton('loyalty_card', 'Tarjeta', <CreditCard />, 'sales')}
                {renderButton('RECOVER_RESERVATION', 'Rec. Res.', <RotateCcw />, 'sales')}

                {/* WAIT GROUP (Orange) */}
                {allowWaitList && renderButton('PARK_LIST', 'Espera', <Inbox />, 'wait', false, parkedTicketsCount > 0 ? parkedTicketsCount : false)}
                {renderButton('RESERVATION', 'Reserva', <StickyNote />, 'wait')}
                {renderButton('SAVE', 'Guardar', <Save />, 'wait')}

                {/* UTILITY GROUP (Gray) */}
                {renderButton('SETTINGS', 'Ajustes', <Settings />, 'utility')}
                {renderButton('ATTENDANCE', 'Asistencia', <Clock />, 'utility')}
                {renderButton('DRAWER', 'Cajón', <Box />, 'utility')}
                {renderButton('CASH_IN', 'Entrada', <ArrowDownLeft />, 'utility')}
                {renderButton('CASH_OUT', 'Salida', <ArrowUpRight />, 'utility')}
                {renderButton('TRACKING', 'Rastreo', <Package />, 'utility')}
                {renderButton('AGENDA', 'Agenda', <Calendar />, 'utility')}

                {/* CLOSING GROUP (Red) */}
                {renderButton('Z_REPORT', 'Cierre Z', <Lock />, 'closing')}
                {shouldRenderLogout && renderButton('LOGOUT', 'Salir', <LogOut />, 'closing')}
                {renderButton('EXIT_APP', 'Cerrar App', <Power />, 'closing')}
            </div>
        </div>
    );
};

export default ActionGrid;
