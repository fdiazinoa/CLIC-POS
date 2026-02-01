/**
 * InventoryHome
 * 
 * Home screen for handheld inventory terminals.
 * Quick access to common inventory tasks.
 */

import React from 'react';
import { Package, ListChecks, Truck, Tag as TagIcon, BarChart3, RefreshCw } from 'lucide-react';

interface InventoryHomeProps {
    onNavigate: (view: string) => void;
    userName?: string;
}

const InventoryHome: React.FC<InventoryHomeProps> = ({
    onNavigate,
    userName = 'Usuario'
}) => {
    const menuItems = [
        {
            id: 'INVENTORY_COUNT',
            icon: ListChecks,
            label: 'Conteo de Inventario',
            description: 'Escanea productos para conteo',
            color: 'blue',
            gradient: 'from-blue-500 to-blue-600'
        },
        {
            id: 'INVENTORY_RECEPTION',
            icon: Truck,
            label: 'Recepción de Mercancía',
            description: 'Registrar entrada de productos',
            color: 'green',
            gradient: 'from-green-500 to-green-600'
        },
        {
            id: 'INVENTORY_LABELS',
            icon: TagIcon,
            label: 'Imprimir Etiquetas',
            description: 'Generar etiquetas de precio',
            color: 'purple',
            gradient: 'from-purple-500 to-purple-600'
        },
        {
            id: 'SETTINGS_SYNC',
            icon: RefreshCw,
            label: 'Sincronización',
            description: 'Probar conexión con Maestra',
            color: 'indigo',
            gradient: 'from-indigo-500 to-indigo-600'
        }
    ];

    return (
        <div className="min-h-screen bg-gray-50 p-4">
            {/* Welcome Header */}
            <div className="bg-white rounded-2xl p-6 mb-6 shadow-sm border border-gray-200">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                        <Package size={24} className="text-blue-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-gray-800">
                            Hola, {userName}
                        </h1>
                        <p className="text-sm text-gray-500">
                            {new Date().toLocaleDateString('es-DO', {
                                weekday: 'long',
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                            })}
                        </p>
                    </div>
                </div>
            </div>

            {/* Quick Actions */}
            <div className="space-y-4 mb-6">
                {menuItems.map(item => {
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.id}
                            onClick={() => onNavigate(item.id)}
                            className="w-full bg-white p-6 rounded-2xl shadow-sm border-2 border-gray-100 hover:border-blue-300 hover:shadow-md transition-all active:scale-98 text-left"
                        >
                            <div className="flex items-center gap-4">
                                <div className={`w-16 h-16 bg-gradient-to-br ${item.gradient} rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg`}>
                                    <Icon size={32} className="text-white" strokeWidth={2.5} />
                                </div>

                                <div className="flex-1">
                                    <h3 className="text-lg font-black text-gray-800 mb-1">
                                        {item.label}
                                    </h3>
                                    <p className="text-sm text-gray-500">
                                        {item.description}
                                    </p>
                                </div>

                                <div className="text-gray-300">
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M9 18l6-6-6-6" />
                                    </svg>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Quick Stats */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
                <h3 className="text-lg font-black text-gray-800 mb-4 flex items-center gap-2">
                    <BarChart3 size={20} className="text-gray-600" />
                    Resumen Rápido
                </h3>

                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-blue-50 p-4 rounded-xl">
                        <div className="text-sm font-bold text-blue-600 mb-1">Tareas Hoy</div>
                        <div className="text-3xl font-black text-blue-900">3</div>
                    </div>

                    <div className="bg-green-50 p-4 rounded-xl">
                        <div className="text-sm font-bold text-green-600 mb-1">Completadas</div>
                        <div className="text-3xl font-black text-green-900">1</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InventoryHome;
