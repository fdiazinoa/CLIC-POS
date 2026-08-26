/**
 * InventoryHome
 * 
 * Home screen for handheld inventory terminals.
 * Quick access to common inventory tasks.
 */

import React, { useState } from 'react';
import { Package, ListChecks, Truck, Tag as TagIcon, BarChart3, RefreshCw } from 'lucide-react';
import { Warehouse } from '../../types';
import WarehouseSelectionModal from './WarehouseSelectionModal';

interface InventoryHomeProps {
    onNavigate: (view: string, data?: any) => void;
    onSyncNow?: () => Promise<{ purchaseOrders: number; transfers: number }>;
    userName?: string;
    warehouses: Warehouse[];
}

const InventoryHome: React.FC<InventoryHomeProps> = ({
    onNavigate,
    onSyncNow,
    userName = 'Usuario',
    warehouses = []
}) => {
    const [isWarehouseModalOpen, setIsWarehouseModalOpen] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

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
            id: 'HANDHELD_SYNC_NOW',
            icon: RefreshCw,
            label: 'Sincronizar ahora',
            description: 'Actualizar productos, OC y traspasos',
            color: 'indigo',
            gradient: 'from-indigo-500 to-indigo-600'
        },
        {
            id: 'INVENTORY_AUDIT',
            icon: BarChart3,
            label: 'Auditoría y Cierre',
            description: 'Revisar sesiones y cerrar inventario',
            color: 'rose',
            gradient: 'from-rose-500 to-rose-600'
        }
    ];

    const handleItemClick = async (id: string) => {
        if (id === 'INVENTORY_COUNT') {
            setIsWarehouseModalOpen(true);
        } else if (id === 'HANDHELD_SYNC_NOW') {
            if (!onSyncNow || isSyncing) return;
            setIsSyncing(true);
            setSyncFeedback('Sincronizando productos, órdenes y traspasos...');
            try {
                const result = await onSyncNow();
                setSyncFeedback(`Sincronización completa: ${result.purchaseOrders} OC y ${result.transfers} traspasos disponibles.`);
            } catch (error) {
                setSyncFeedback(`No se pudo sincronizar: ${error instanceof Error ? error.message : 'Error desconocido'}`);
            } finally {
                setIsSyncing(false);
            }
        } else {
            onNavigate(id);
        }
    };

    const handleWarehouseSelect = (warehouse: Warehouse) => {
        setIsWarehouseModalOpen(false);
        onNavigate('INVENTORY_COUNT', { warehouseId: warehouse.id, warehouseName: warehouse.name });
    };

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
                            onClick={() => void handleItemClick(item.id)}
                            disabled={item.id === 'HANDHELD_SYNC_NOW' && isSyncing}
                            className="w-full bg-white p-6 rounded-2xl shadow-sm border-2 border-gray-100 hover:border-blue-300 hover:shadow-md transition-all active:scale-98 text-left disabled:opacity-60"
                        >
                            <div className="flex items-center gap-4">
                                <div className={`w-16 h-16 bg-gradient-to-br ${item.gradient} rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg`}>
                                    <Icon size={32} className={`text-white ${item.id === 'HANDHELD_SYNC_NOW' && isSyncing ? 'animate-spin' : ''}`} strokeWidth={2.5} />
                                </div>

                                <div className="flex-1">
                                    <h3 className="text-lg font-black text-gray-800 mb-1">
                                        {item.id === 'HANDHELD_SYNC_NOW' && isSyncing ? 'Sincronizando...' : item.label}
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

            {syncFeedback && (
                <div
                    role="status"
                    className={`mb-6 rounded-2xl border px-4 py-3 text-sm font-bold ${syncFeedback.startsWith('No se pudo')
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    }`}
                >
                    {syncFeedback}
                </div>
            )}

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

            {/* Modals */}
            <WarehouseSelectionModal
                isOpen={isWarehouseModalOpen}
                onClose={() => setIsWarehouseModalOpen(false)}
                warehouses={warehouses}
                onSelect={handleWarehouseSelect}
            />
        </div>
    );
};

export default InventoryHome;
