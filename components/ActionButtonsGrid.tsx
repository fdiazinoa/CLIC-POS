import React, { useMemo } from 'react';
import {
    Percent, QrCode, Inbox, StickyNote, ArrowRightLeft,
    Lock, LogOut, Settings, Package, Box, Save, CreditCard, Layout
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
            className: globalDiscountValue > 0 ? 'bg-red-50 border-red-200 text-red-600' : 'bg-pink-50 border-pink-100 text-pink-600 hover:bg-pink-100 hover:border-pink-200'
        },
        {
            id: 'COUPON',
            label: 'Cupón',
            icon: <QrCode size={14} />,
            onClick: () => onAction('COUPON'),
            className: 'bg-cyan-50 border-cyan-100 text-cyan-600 hover:bg-cyan-100 hover:border-cyan-200'
        },
        {
            id: 'PARK',
            label: 'Espera',
            icon: <Inbox size={14} />,
            onClick: () => onAction('PARK_LIST'),
            className: 'bg-orange-50 border-orange-100 text-orange-600 hover:bg-orange-100 hover:border-orange-200',
            badge: effectiveParkedCount > 0
        },
        {
            id: 'RESERVATION',
            label: 'Reserva',
            icon: <StickyNote size={14} />,
            onClick: () => onAction('RESERVATION'),
            className: 'bg-amber-50 border-amber-100 text-amber-700 hover:bg-amber-100 hover:border-amber-200'
        },
        {
            id: 'RECOVER_RESERVATION',
            label: 'Rec. Res.',
            icon: <QrCode size={14} />,
            onClick: () => onAction('RECOVER_RESERVATION'),
            className: 'bg-teal-50 border-teal-100 text-teal-700 hover:bg-teal-100 hover:border-teal-200'
        },
        {
            id: 'RETURN',
            label: isReturnMode ? 'VENTA' : 'DEVOL.',
            icon: <ArrowRightLeft size={14} />,
            onClick: () => onAction('RETURN'),
            className: isReturnMode ? 'bg-red-50 border-red-500 text-red-600' : 'bg-white border-gray-100 text-gray-400 hover:border-red-100 hover:text-red-500'
        }
    ];

    const groupB = [
        {
            id: 'Z_REPORT',
            label: 'Cierre Z',
            icon: <Lock size={14} />,
            onClick: () => onAction('Z_REPORT'), // Intercepted in POSInterface
            className: 'bg-indigo-50 border-indigo-100 text-indigo-600 hover:bg-indigo-100 hover:border-indigo-200'
        },
        {
            id: 'LOGOUT',
            label: 'Salir',
            icon: <LogOut size={14} />,
            onClick: () => onAction('LOGOUT'), // Intercepted in POSInterface
            className: 'bg-white border-gray-100 text-gray-400 hover:border-red-100 hover:text-red-500'
        },
        {
            id: 'SETTINGS',
            label: 'Ajustes', // "Configuración" shortened for UI balance
            icon: <Settings size={14} />,
            onClick: () => onAction('SETTINGS'),
            className: 'bg-white border-gray-100 text-gray-400 hover:text-blue-600 hover:bg-gray-50'
        },
        {
            id: 'TRACKING',
            label: 'Rastreo',
            icon: <Package size={14} />,
            onClick: () => onAction('TRACKING'),
            className: 'bg-indigo-50 border-indigo-100 text-indigo-600 hover:bg-indigo-100 hover:border-indigo-200'
        },
        {
            id: 'DRAWER',
            label: 'Cajón',
            icon: <Box size={14} />,
            onClick: () => onAction('DRAWER'),
            className: 'bg-white border-gray-100 text-gray-400 hover:text-green-600 hover:bg-green-50'
        },
        {
            id: 'SAVE',
            label: 'Guardar',
            icon: <Save size={14} />,
            onClick: () => onAction('SAVE'),
            className: 'bg-blue-50 border-blue-100 text-blue-600 hover:bg-blue-100 hover:border-blue-200'
        }
    ];

    // Optional Extra Buttons (handled cleanly)
    if (config?.operational?.usa_mesas) {
        groupB.push({
            id: 'TABLES',
            label: 'Mesas',
            icon: <Layout size={14} />,
            onClick: () => onAction('TABLES'),
            className: 'bg-teal-50 border-teal-100 text-teal-600 hover:bg-teal-100 hover:border-teal-200'
        });
    }

    // "Tarjeta" button legacy support
    groupB.push({
        id: 'CARD_MANAGEMENT',
        label: 'Tarjeta',
        icon: <CreditCard size={14} />,
        onClick: () => onAction('loyalty_card'), // Mapping to loyalty modal
        className: 'bg-white border-gray-100 text-blue-500 hover:border-blue-200 hover:bg-blue-50'
    });


    // --- RENDERERS ---

    const renderButton = (btn: any) => (
        <button
            key={btn.id}
            onClick={btn.onClick}
            className={`flex flex-col items-center justify-center py-2 rounded-xl border transition-all font-bold relative ${btn.className}`}
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
