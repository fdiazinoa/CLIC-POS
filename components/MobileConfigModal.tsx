import React, { useState, useEffect } from 'react';
import { Warehouse, BusinessConfig, DocumentSeries, Tariff } from '../types';
import { X, Save, Box, FileText, Tag, Layers } from 'lucide-react';

interface MobileConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (config: {
        warehouseId: string;
        tariffId: string;
        categoryId: string; // Using category filter as "category"
        seriesId: string;
        zReportId?: string; // Optional for now
    }) => void;
    config: BusinessConfig;
    warehouses: Warehouse[];
    currentWarehouseId?: string;
    currentTariffId?: string;
    currentCategory?: string;
}

const MobileConfigModal: React.FC<MobileConfigModalProps> = ({
    isOpen,
    onClose,
    onSave,
    config,
    warehouses,
    currentWarehouseId,
    currentTariffId,
    currentCategory
}) => {
    const [warehouseId, setWarehouseId] = useState(currentWarehouseId || (warehouses || [])[0]?.id || '');
    const [tariffId, setTariffId] = useState(currentTariffId || (config?.tariffs || [])[0]?.id || '');
    const [categoryId, setCategoryId] = useState(currentCategory || 'ALL');
    const [seriesId, setSeriesId] = useState('');

    // Initialize series based on default assignment if available
    useEffect(() => {
        const defaultSeries = config?.terminals?.[0]?.config?.documentAssignments?.['TICKET'];
        if (defaultSeries) setSeriesId(defaultSeries);
        else {
            const ticketSeries = config?.terminals?.[0]?.config?.documentSeries?.find(s => s.id === 'TICKET' || s.documentType === 'TICKET');
            if (ticketSeries) setSeriesId(ticketSeries.id);
        }
    }, [config]);

    // Sync internal state when props change
    useEffect(() => {
        if (currentWarehouseId) setWarehouseId(currentWarehouseId);
        if (currentTariffId) setTariffId(currentTariffId);
        if (currentCategory) setCategoryId(currentCategory);
    }, [currentWarehouseId, currentTariffId, currentCategory]);

    if (!isOpen) return null;

    const handleSave = () => {
        if (!warehouseId) {
            alert('Debe seleccionar un almacén');
            return;
        }
        onSave({
            warehouseId,
            tariffId,
            categoryId,
            seriesId
        });
        onClose();
    };

    // Extract unique categories from products is not directly available here without products prop.
    // We will assume 'ALL' is valid and user can filter later, or we can pass categories.
    // For this specific requirement "Modal de Selección de Almacén, tarifas, categorias, serie/documento, cierre z",
    // we will implement the selectors.

    const ticketSeriesList = config?.terminals?.[0]?.config?.documentSeries?.filter(s => s.documentType === 'TICKET' || s.id === 'TICKET') || [];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="bg-blue-600 p-5 flex justify-between items-center text-white shrink-0">
                    <h2 className="font-black text-lg uppercase tracking-wide">Configuración de Venta</h2>
                    <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6">

                    {/* Warehouse Selector */}
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <Box size={14} /> Almacén de Origen
                        </label>
                        <select
                            value={warehouseId}
                            onChange={(e) => setWarehouseId(e.target.value)}
                            className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
                        >
                            <option value="" disabled>Seleccione Almacén</option>
                            {warehouses?.map(w => (
                                <option key={w.id} value={w.id}>{w.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Tariff Selector */}
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <Tag size={14} /> Tarifa de Precios
                        </label>
                        <select
                            value={tariffId}
                            onChange={(e) => setTariffId(e.target.value)}
                            className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
                        >
                            {config?.tariffs?.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Document Series Selector */}
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <FileText size={14} /> Secuencia de Documento
                        </label>
                        <select
                            value={seriesId}
                            onChange={(e) => setSeriesId(e.target.value)}
                            className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
                        >
                            {ticketSeriesList.map(s => (
                                <option key={s.id} value={s.id}>{s.name} ({s.prefix})</option>
                            ))}
                        </select>
                    </div>

                    {/* Category Filter (Initial) */}
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider">
                            <Layers size={14} /> Categoría Inicial
                        </label>
                        <select
                            value={categoryId}
                            onChange={(e) => setCategoryId(e.target.value)}
                            className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none appearance-none"
                        >
                            <option value="ALL">Todas las Categorías</option>
                            {/* Categories would ideally be passed in, but for now we keep it simple or generic */}
                        </select>
                    </div>

                </div>

                <div className="p-5 border-t border-gray-100 bg-gray-50 shrink-0">
                    <button
                        onClick={handleSave}
                        className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-lg shadow-lg shadow-blue-200 flex items-center justify-center gap-2 transition-all active:scale-95"
                    >
                        <Save size={20} />
                        CONFIRMAR Y VENDER
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MobileConfigModal;
