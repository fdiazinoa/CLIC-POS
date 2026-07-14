import React from 'react';
import {
    Percent, QrCode, Inbox, StickyNote, ArrowRightLeft,
    Lock, LogOut, Settings, Box, Save, CreditCard, RotateCcw, Package, Power
} from 'lucide-react';
import { BusinessConfig } from '../types';

interface SolidFlatActionFooterProps {
    onAction: (action: string) => void;
    config: BusinessConfig;
    parkedTicketsCount: number;
    globalDiscountValue: number;
    isReturnMode: boolean;
    hasCartItems: boolean;
}

const SolidFlatActionFooter: React.FC<SolidFlatActionFooterProps> = ({
    onAction,
    config,
    parkedTicketsCount,
    globalDiscountValue,
    isReturnMode,
    hasCartItems
}) => {

    const renderButton = (
        id: string,
        label: string,
        icon: React.ReactElement,
        group: 'sales' | 'wait' | 'config' | 'closing',
        disabled: boolean = false,
        badge?: number | boolean
    ) => {
        let colors = {
            bg: "",
            border: "",
            icon: "",
            hover: ""
        };

        switch (group) {
            case 'sales':
                colors = {
                    bg: "bg-blue-600",
                    border: "border-blue-500",
                    icon: "text-white",
                    hover: "hover:bg-blue-700"
                };
                break;
            case 'wait':
                colors = {
                    bg: "bg-orange-500",
                    border: "border-orange-400",
                    icon: "text-white",
                    hover: "hover:bg-orange-600"
                };
                break;
            case 'config':
                colors = {
                    bg: "bg-emerald-600",
                    border: "border-emerald-500",
                    icon: "text-white",
                    hover: "hover:bg-emerald-700"
                };
                break;
            case 'closing':
                colors = {
                    bg: "bg-red-600",
                    border: "border-red-500",
                    icon: "text-white",
                    hover: "hover:bg-red-700"
                };
                break;
        }

        // Special state for active discount
        const isActiveDiscount = id === 'DISCOUNT' && globalDiscountValue > 0;
        if (isActiveDiscount) {
            colors.bg = "bg-rose-600";
            colors.border = "border-rose-500";
            colors.icon = "text-white";
            colors.hover = "hover:bg-rose-700";
        }

        return (
            <button
                key={id}
                disabled={disabled}
                onClick={() => onAction(id)}
                className={`
                    flex flex-col items-center justify-center 
                    ${colors.bg} ${colors.border} border
                    shadow-sm shadow-slate-900/10
                    rounded-xl transition-all duration-200
                    hover:-translate-y-1 ${colors.hover}
                    active:scale-95 py-2 px-1 h-16 w-full
                    ${disabled ? 'opacity-40 grayscale pointer-events-none' : ''}
                    group
                `}
            >
                <div className={`${colors.icon} mb-1 scale-100 transition-transform group-hover:scale-110`}>
                    {React.cloneElement(icon, { size: 24, strokeWidth: 2.5 })}
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wider text-center leading-none ${disabled ? 'text-slate-400' : colors.icon}`}>
                    {label}
                </span>

                {badge && (
                    <span className="absolute top-1 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-orange-600 text-[10px] font-black text-white shadow-lg border-2 border-white">
                        {typeof badge === 'number' ? badge : ''}
                    </span>
                )}
            </button>
        );
    };

    return (
        <div className="w-full bg-white border-t border-gray-100 p-3 shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
            <div className="max-w-[1800px] mx-auto grid grid-cols-6 gap-3">
                {/* ACCIONES DE VENTA (Cobalt Blue) */}
                {renderButton('DISCOUNT', 'Descuento', <Percent />, 'sales')}
                {renderButton('COUPON', 'Cupón', <QrCode />, 'sales')}
                {renderButton('loyalty_card', 'Tarjeta', <CreditCard />, 'sales')}
                {renderButton('RECOVER_RESERVATION', 'Rec. Res.', <RotateCcw />, 'sales')}

                {/* ESTADOS DE ESPERA (Amber/Orange) */}
                {renderButton('PARK_LIST', 'Espera', <Inbox />, 'wait', false, parkedTicketsCount > 0 ? parkedTicketsCount : false)}
                {renderButton('RESERVATION', 'Reserva', <StickyNote />, 'wait')}
                {renderButton('SAVE', 'Guardar', <Save />, 'wait')}

                {/* CONFIGURACIÓN (Slate Gray) */}
                {renderButton('SETTINGS', 'Ajustes', <Settings />, 'config')}
                {renderButton('DRAWER', 'Cajón', <Box />, 'config')}
                {renderButton('TRACKING', 'Rastreo', <Package />, 'config')}

                {/* CIERRE Y SALIDA (Red/Violet) */}
                {renderButton('Z_REPORT', 'Cierre Z', <Lock />, 'closing')}
                {renderButton('LOGOUT', 'Salir', <LogOut />, 'closing')}
                {renderButton('EXIT_APP', 'Cerrar App', <Power />, 'closing')}
            </div>
        </div>
    );
};

export default SolidFlatActionFooter;
