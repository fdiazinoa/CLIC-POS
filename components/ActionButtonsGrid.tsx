import React, { useMemo } from 'react';
import {
    Percent, QrCode, Inbox, StickyNote, ArrowRightLeft,
    Lock, LogOut, Settings, Package, Box, Save, CreditCard, Layout, Power
} from 'lucide-react';
import { CartItem, Product, BusinessConfig } from '../types';

interface ActionButtonsGridProps {
    onAction: (action: string) => void;
    cartItemCount?: number;
    config: BusinessConfig;
    isMobile: boolean;
    mode?: 'RETAIL' | 'SUPERMARKET';
    variant?: 'HORIZONTAL' | 'GRID';
    showLabels?: boolean;
    screenWidth?: number;
    parkedTicketsCount?: number;
    globalDiscountValue?: number;
    isReturnMode?: boolean;
    parkedCount?: number; // Alias for nested compatibility if needed, but per previous file read, POSInterface passed parkedCount
}

const ActionButtonsGrid: React.FC<ActionButtonsGridProps> = ({
    onAction,
    cartItemCount = 0,
    config,
    isMobile,
    mode = 'RETAIL',
    variant,
    showLabels = true,
    screenWidth = window.innerWidth, // Default to window width if not provided
    parkedTicketsCount = 0,
    parkedCount,
    globalDiscountValue = 0,
    isReturnMode = false
}) => {
    // Resolve parked count alias
    const effectiveParkedCount = parkedCount ?? parkedTicketsCount;

    // --- BUTTON DEFINITIONS ---
    const groupA = [
        {
            id: 'DISCOUNT',
            label: 'Descuento',
            icon: <Percent size={14} />,
            onClick: () => onAction('DISCOUNT'),
            className: globalDiscountValue > 0 ? 'bg-rose-600 border-rose-500 text-white shadow-sm shadow-rose-600/25 hover:bg-rose-700' : 'bg-blue-600 border-blue-500 text-white shadow-sm shadow-blue-600/25 hover:bg-blue-700'
        },
        {
            id: 'COUPON',
            label: 'Cupón',
            icon: <QrCode size={14} />,
            onClick: () => onAction('COUPON'),
            className: 'bg-blue-600 border-blue-500 text-white shadow-sm shadow-blue-600/25 hover:bg-blue-700'
        },
        {
            id: 'PARK',
            label: 'Espera',
            icon: <Inbox size={14} />,
            onClick: () => onAction('PARK_LIST'),
            className: 'bg-orange-500 border-orange-400 text-white shadow-sm shadow-orange-500/25 hover:bg-orange-600',
            badge: effectiveParkedCount > 0
        },
        {
            id: 'RESERVATION',
            label: 'Reserva',
            icon: <StickyNote size={14} />,
            onClick: () => onAction('RESERVATION'),
            className: 'bg-orange-500 border-orange-400 text-white shadow-sm shadow-orange-500/25 hover:bg-orange-600'
        },
        {
            id: 'RECOVER_RESERVATION',
            label: 'Rec. Res.',
            icon: <QrCode size={14} />,
            onClick: () => onAction('RECOVER_RESERVATION'),
            className: 'bg-blue-600 border-blue-500 text-white shadow-sm shadow-blue-600/25 hover:bg-blue-700'
        },
        {
            id: 'RETURN',
            label: isReturnMode ? 'VENTA' : 'DEVOL.',
            icon: <ArrowRightLeft size={14} />,
            onClick: () => onAction('RETURN'),
            className: isReturnMode ? 'bg-rose-600 border-rose-500 text-white shadow-sm shadow-rose-600/25 hover:bg-rose-700' : 'bg-slate-600 border-slate-500 text-white shadow-sm shadow-slate-600/25 hover:bg-slate-700'
        }
    ];

    const groupB = [
        {
            id: 'Z_REPORT',
            label: 'Cierre Z',
            icon: <Lock size={14} />,
            onClick: () => onAction('Z_REPORT'), // Intercepted in POSInterface
            className: 'bg-red-600 border-red-500 text-white shadow-sm shadow-red-600/25 hover:bg-red-700'
        },
        {
            id: 'LOGOUT',
            label: 'Salir',
            icon: <LogOut size={14} />,
            onClick: () => onAction('LOGOUT'), // Intercepted in POSInterface
            className: 'bg-red-600 border-red-500 text-white shadow-sm shadow-red-600/25 hover:bg-red-700'
        },
        {
            id: 'EXIT_APP',
            label: 'Cerrar App',
            icon: <Power size={14} />,
            onClick: () => onAction('EXIT_APP'),
            className: 'bg-red-700 border-red-600 text-white shadow-sm shadow-red-700/25 hover:bg-red-800'
        },
        {
            id: 'SETTINGS',
            label: 'Ajustes', // "Configuración" shortened for UI balance
            icon: <Settings size={14} />,
            onClick: () => onAction('SETTINGS'),
            className: 'bg-emerald-600 border-emerald-500 text-white shadow-sm shadow-emerald-600/25 hover:bg-emerald-700'
        },
        {
            id: 'TRACKING',
            label: 'Rastreo',
            icon: <Package size={14} />,
            onClick: () => onAction('TRACKING'),
            className: 'bg-emerald-600 border-emerald-500 text-white shadow-sm shadow-emerald-600/25 hover:bg-emerald-700'
        },
        {
            id: 'DRAWER',
            label: 'Cajón',
            icon: <Box size={14} />,
            onClick: () => onAction('DRAWER'),
            className: 'bg-emerald-600 border-emerald-500 text-white shadow-sm shadow-emerald-600/25 hover:bg-emerald-700'
        },
        {
            id: 'SAVE',
            label: 'Guardar',
            icon: <Save size={14} />,
            onClick: () => onAction('SAVE'),
            className: 'bg-orange-500 border-orange-400 text-white shadow-sm shadow-orange-500/25 hover:bg-orange-600'
        }
    ];

    // Optional Extra Buttons (handled cleanly)
    if (config?.operational?.usa_mesas) {
        groupB.push({
            id: 'TABLES',
            label: 'Mesas',
            icon: <Layout size={14} />,
            onClick: () => onAction('TABLES'),
            className: 'bg-emerald-600 border-emerald-500 text-white shadow-sm shadow-emerald-600/25 hover:bg-emerald-700'
        });
    }

    // "Tarjeta" button legacy support
    groupB.push({
        id: 'CARD_MANAGEMENT',
        label: 'Tarjeta',
        icon: <CreditCard size={14} />,
        onClick: () => onAction('loyalty_card'), // Mapping to loyalty modal
        className: 'bg-blue-600 border-blue-500 text-white shadow-sm shadow-blue-600/25 hover:bg-blue-700'
    });


    // --- RENDERERS ---

    const renderButton = (btn: any) => (
        <button
            key={btn.id}
            onClick={btn.onClick}
            className={`flex flex-col items-center justify-center py-2 rounded-xl border transition-all font-bold relative active:scale-95 ${btn.className}`}
        >
            {btn.icon}
            {showLabels && <span className="text-[9px] font-black uppercase mt-1 leading-tight text-center">{btn.label}</span>}
            {btn.badge && <span className="absolute top-1 right-2 w-2 h-2 bg-orange-500 rounded-full border border-white"></span>}
        </button>
    );

    // --- LAYOUT LOGIC ---

    // 1. Explicit Variant Override
    if (variant === 'GRID') {
        return (
            <div className={`grid grid-cols-3 gap-2 bg-white`}>
                {groupA.map(renderButton)}
                <div className="col-span-3 h-px bg-gray-100 my-1"></div>
                {groupB.map(renderButton)}
            </div>
        );
    }

    if (variant === 'HORIZONTAL') {
        return (
            <div className="flex gap-2 w-full overflow-x-auto">
                <div className="flex gap-2 flex-1">
                    {groupA.map(btn => (
                        <div key={btn.id} className="flex-1 min-w-[80px]">
                            {renderButton({ ...btn, className: `${btn.className} h-full` })}
                        </div>
                    ))}
                </div>
                <div className="w-px bg-gray-300 mx-2"></div>
                <div className="flex gap-2 flex-1">
                    {groupB.map(btn => (
                        <div key={btn.id} className="flex-1 min-w-[80px]">
                            {renderButton({ ...btn, className: `${btn.className} h-full` })}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // 2. Retail Mode Default
    if (mode === 'RETAIL') {
        return (
            <div className={`grid grid-cols-3 gap-2 bg-white`}>
                {groupA.map(renderButton)}
                <div className="col-span-3 h-px bg-gray-100 my-1"></div>
                {groupB.map(renderButton)}
            </div>
        );
    }

    // 3. Supermarket Mode
    const isWideScreen = screenWidth > 1400;

    if (isWideScreen) {
        return (
            <div className="flex gap-2 w-full overflow-x-auto">
                <div className="flex gap-2 flex-1">
                    {groupA.map(btn => (
                        <div key={btn.id} className="flex-1 min-w-[80px]">
                            {renderButton({ ...btn, className: `${btn.className} h-full` })}
                        </div>
                    ))}
                </div>
                <div className="w-px bg-gray-300 mx-2"></div>
                <div className="flex gap-2 flex-1 opacity-90 hover:opacity-100 transition-opacity">
                    {groupB.map(btn => (
                        <div key={btn.id} className="flex-1 min-w-[80px]">
                            {renderButton({ ...btn, className: `${btn.className} h-full` })}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Low Res Supermarket (14" Mac) -> 6x2 Stacked
    return (
        <div className="flex flex-col gap-2 w-full">
            <div className="grid grid-cols-6 gap-2 h-14">
                {groupA.map(renderButton)}
            </div>
            <div className="grid grid-cols-6 gap-2 h-14 opacity-80 hover:opacity-100 transition-opacity">
                {groupB.slice(0, 6).map(renderButton)}
                {groupB.length > 6 && groupB.slice(6).map(renderButton)}
            </div>
        </div>
    );
};

export default ActionButtonsGrid;
