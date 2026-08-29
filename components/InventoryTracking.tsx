import React, { useState, useMemo, useEffect } from 'react';
import {
    Search, Calendar, Filter, Download, Eye, Copy,
    Box, ArrowRight, Truck, CheckCircle2, Clock,
    AlertCircle, MapPin, User, FileText, ChevronRight, X
} from 'lucide-react';

// --- Types ---
interface TrackingItem {
    id: string;
    serialNumber: string;
    productName: string;
    sku: string;
    entryDate: string; // ISO
    warehouse: string;
    status: 'AVAILABLE' | 'SHIPPED' | 'OUT' | 'LOCKED';
    quantity: number;
    exitDate?: string;
    customer?: string;
    productId?: string; // Link to actual product
}

interface TimelineEvent {
    id: string;
    type: 'ENTRY' | 'MOVE' | 'EXIT';
    date: string;
    title: string;
    description: string;
    user: string;
    location?: string;
    documentRef?: string;
}

// --- Mock Data ---
const MOCK_ITEMS: TrackingItem[] = [
    { id: '1', serialNumber: 'SN-2024-001', productName: 'Laptop Pro X1', sku: 'LP-X1', entryDate: '2023-10-15T09:00:00Z', warehouse: 'Central', status: 'AVAILABLE', quantity: 1, productId: 'prod_1' },
    { id: '2', serialNumber: 'SN-2024-002', productName: 'Laptop Pro X1', sku: 'LP-X1', entryDate: '2023-11-20T10:30:00Z', warehouse: 'Norte', status: 'SHIPPED', quantity: 1, exitDate: '2024-01-05T14:00:00Z', customer: 'TechCorp Inc.', productId: 'prod_1' },
    { id: '3', serialNumber: 'LOT-9921', productName: 'Monitor 4K', sku: 'MON-4K', entryDate: '2023-09-01T08:00:00Z', warehouse: 'Central', status: 'AVAILABLE', quantity: 50, productId: 'prod_2' },
    { id: '4', serialNumber: 'SN-2024-045', productName: 'GPU RTX 4090', sku: 'GPU-4090', entryDate: '2024-01-10T11:15:00Z', warehouse: 'Sur', status: 'LOCKED', quantity: 1, productId: 'prod_3' },
    { id: '5', serialNumber: 'SN-2024-099', productName: 'Server Rack 2U', sku: 'SR-2U', entryDate: '2023-08-15T09:30:00Z', warehouse: 'Oeste', status: 'OUT', quantity: 1, exitDate: '2023-12-20T16:45:00Z', productId: 'prod_4' },
];

const MOCK_TIMELINE: TimelineEvent[] = [
    { id: 't1', type: 'ENTRY', date: '2023-10-15T09:00:00Z', title: 'Recepción Inicial', description: 'Ingreso por Compra OC-10023', user: 'Juan Pérez', location: 'Almacén Central', documentRef: 'REC-001' },
    { id: 't2', type: 'MOVE', date: '2023-11-05T14:20:00Z', title: 'Transferencia Interna', description: 'Traslado a zona de seguridad', user: 'Maria Vega', location: 'Almacén Central (Zona B)' },
    { id: 't3', type: 'EXIT', date: '2024-01-05T14:00:00Z', title: 'Despacho a Cliente', description: 'Venta Factura F001-2930', user: 'Carlos Ruiz', location: 'Cliente Final', documentRef: 'FAC-2930' },
];

// --- 1. Component: TrackingStats (Header) ---
const TrackingStats = ({ items }: { items: TrackingItem[] }) => {
    const total = items.length;
    const available = items.filter(i => i.status === 'AVAILABLE').length;
    const shipped = items.filter(i => ['SHIPPED', 'OUT'].includes(i.status)).length;

    // Calculate avg age
    const avgAge = useMemo(() => {
        if (total === 0) return 0;
        const totalDays = items.reduce((acc, item) => {
            const start = new Date(item.entryDate).getTime();
            const end = Date.now();
            return acc + (end - start);
        }, 0);
        return Math.floor(totalDays / (1000 * 60 * 60 * 24 * total));
    }, [items, total]);

    const StatCard = ({ title, value, icon: Icon, color, subtext }: any) => (
        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-start justify-between">
            <div>
                <p className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">{title}</p>
                <h3 className="text-2xl font-black text-slate-800">{value}</h3>
                {subtext && <p className="text-xs text-gray-400 mt-1">{subtext}</p>}
            </div>
            <div className={`p-3 rounded-lg ${color}`}>
                <Icon size={20} className="text-white" />
            </div>
        </div>
    );

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard title="Total Ítems" value={total} icon={Box} color="bg-blue-500" subtext="En registro" />
            <StatCard title="En Almacén" value={available} icon={CheckCircle2} color="bg-emerald-500" subtext="Disponibles" />
            <StatCard title="Despachados" value={shipped} icon={Truck} color="bg-indigo-500" subtext="Salidas confirmadas" />
            <StatCard title="Antigüedad Prom." value={`${avgAge} días`} icon={Clock} color="bg-amber-500" subtext="Rotación inventario" />
        </div>
    );
};

// --- 3. Component: ItemLifecycle (Modal) ---
const ItemLifecycle = ({ item, onClose }: { item: TrackingItem; onClose: () => void }) => {
    // In a real app, fetch timeline based on item.id here
    const events = item.status === 'SHIPPED' ? MOCK_TIMELINE : MOCK_TIMELINE.slice(0, 2);

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-slate-50">
                    <div>
                        <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                            <Box className="text-blue-600" size={24} />
                            Historial del Ítem
                        </h2>
                        <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
                            <span className="font-mono bg-white px-2 py-0.5 rounded border border-gray-200">{item.serialNumber}</span>
                            <span>•</span>
                            <span className="font-bold">{item.productName}</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white rounded-full transition-colors text-gray-400 hover:text-red-500">
                        <X size={24} />
                    </button>
                </div>

                {/* Body - Timeline */}
                <div className="p-8 overflow-y-auto flex-1 bg-white">
                    <div className="relative border-l-2 border-gray-100 ml-3 space-y-8">
                        {events.map((event, idx) => {
                            const isLast = idx === events.length - 1;
                            let colorClass = 'bg-gray-200 text-gray-500';
                            let icon = Box;

                            if (event.type === 'ENTRY') { colorClass = 'bg-emerald-100 text-emerald-600 border-emerald-200'; icon = CheckCircle2; }
                            if (event.type === 'MOVE') { colorClass = 'bg-blue-100 text-blue-600 border-blue-200'; icon = MapPin; }
                            if (event.type === 'EXIT') { colorClass = 'bg-amber-100 text-amber-600 border-amber-200'; icon = Truck; }

                            return (
                                <div key={event.id} className="relative pl-8">
                                    {/* Dot */}
                                    <div className={`absolute -left-[9px] top-0 w-5 h-5 rounded-full border-2 border-white ring-2 ${event.type === 'ENTRY' ? 'ring-emerald-500 bg-emerald-500' : event.type === 'EXIT' ? 'ring-amber-500 bg-amber-500' : 'ring-blue-500 bg-blue-500'}`}></div>

                                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 group">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${colorClass}`}>
                                                    {event.type}
                                                </span>
                                                <span className="text-xs text-gray-400 font-medium">
                                                    {new Date(event.date).toLocaleDateString()} {new Date(event.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <h4 className="text-base font-bold text-slate-800 mb-1">{event.title}</h4>
                                            <p className="text-sm text-gray-600 leading-relaxed bg-gray-50 p-3 rounded-lg border border-gray-100">
                                                {event.description}
                                            </p>
                                        </div>

                                        <div className="flex flex-col items-end gap-1 text-right min-w-[120px]">
                                            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                                                <User size={12} /> {event.user}
                                            </div>
                                            {event.location && (
                                                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                                                    <MapPin size={12} /> {event.location}
                                                </div>
                                            )}
                                            {event.documentRef && (
                                                <div className="flex items-center gap-1.5 text-xs text-blue-600 mt-1 cursor-pointer hover:underline">
                                                    <FileText size={12} /> {event.documentRef}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- 2. Component: InventoryGrid (Main Table) ---
const InventoryGrid = ({ items, onOpenHistory }: { items: TrackingItem[]; onOpenHistory: (item: TrackingItem) => void }) => {
    const [search, setSearch] = useState('');

    // Filter logic
    const filtered = useMemo(() => {
        const term = search.toLowerCase();
        return items.filter(i =>
            i.serialNumber.toLowerCase().includes(term) ||
            i.productName.toLowerCase().includes(term) ||
            i.sku.toLowerCase().includes(term)
        );
    }, [items, search]);

    const getAge = (dateStr: string) => {
        const diff = Date.now() - new Date(dateStr).getTime();
        return Math.floor(diff / (1000 * 60 * 60 * 24));
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex-1 flex flex-col">
            {/* Toolbar */}
            <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por serie, producto o SKU..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-gray-700 placeholder-gray-400"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <button className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors">
                        <Calendar size={16} /> Rango Fecha
                    </button>
                    <button className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors">
                        <Filter size={16} /> Filtros
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                            <Search className="text-gray-300" size={40} />
                        </div>
                        <h3 className="text-lg font-bold text-gray-800">No se encontraron resultados</h3>
                        <p className="text-sm text-gray-500 max-w-xs mt-1">Intenta ajustar los filtros o tu búsqueda para encontrar lo que necesitas.</p>
                    </div>
                ) : (
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 border-b border-gray-200">
                                <th className="px-6 py-3 text-[11px] font-black text-slate-500 uppercase tracking-wider">Serie / Lote</th>
                                <th className="px-6 py-3 text-[11px] font-black text-slate-500 uppercase tracking-wider">Producto</th>
                                <th className="px-6 py-3 text-[11px] font-black text-slate-500 uppercase tracking-wider">Fecha Ingreso</th>
                                <th className="px-6 py-3 text-[11px] font-black text-slate-500 uppercase tracking-wider">Ubicación</th>
                                <th className="px-6 py-3 text-[11px] font-black text-slate-500 uppercase tracking-wider">Antigüedad</th>
                                <th className="px-6 py-3 text-[11px] font-black text-slate-500 uppercase tracking-wider text-right">Cant.</th>
                                <th className="px-6 py-3 text-[11px] font-black text-slate-500 uppercase tracking-wider">Fecha Salida</th>
                                <th className="px-6 py-3 text-[11px] font-black text-slate-500 uppercase tracking-wider">Estado</th>
                                <th className="px-6 py-3 text-[11px] font-black text-slate-500 uppercase tracking-wider text-right">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filtered.map((item) => {
                                const age = getAge(item.entryDate);
                                return (
                                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors group">
                                        <td className="px-6 py-3">
                                            <div className="flex items-center gap-2 group/code">
                                                <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                                    {item.serialNumber}
                                                </span>
                                                <button
                                                    className="opacity-0 group-hover/code:opacity-100 text-gray-400 hover:text-indigo-600 transition-opacity"
                                                    title="Copiar"
                                                    onClick={() => navigator.clipboard.writeText(item.serialNumber)}
                                                >
                                                    <Copy size={12} />
                                                </button>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-gray-800">{item.productName}</span>
                                                <span className="text-[10px] font-bold text-gray-400">SKU: {item.sku}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-3 text-sm text-gray-600 font-medium">
                                            {new Date(item.entryDate).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-3 text-sm text-gray-600 font-medium">
                                            {item.warehouse}
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className={`text-xs font-bold px-2 py-0.5 rounded ${age > 90 ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-600'}`}>
                                                {age} días
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 text-sm text-gray-800 font-bold text-right">
                                            {item.quantity}
                                        </td>
                                        <td className="px-6 py-3 text-sm text-gray-500">
                                            {item.exitDate ? new Date(item.exitDate).toLocaleDateString() : '---'}
                                        </td>
                                        <td className="px-6 py-3">
                                            {item.status === 'AVAILABLE' && <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-700 border border-emerald-200"><CheckCircle2 size={10} /> Disponible</span>}
                                            {(item.status === 'SHIPPED' || item.status === 'OUT') && <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-gray-100 text-gray-600 border border-gray-200"><Truck size={10} /> Despachado</span>}
                                            {item.status === 'LOCKED' && <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-amber-100 text-amber-700 border border-amber-200"><AlertCircle size={10} /> Bloqueado</span>}
                                        </td>
                                        <td className="px-6 py-3 text-right">
                                            <button
                                                onClick={() => onOpenHistory(item)}
                                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-lg text-xs font-bold hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-100 transition-all shadow-sm"
                                            >
                                                Ver Detalle <ChevronRight size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Footer / Pagination */}
            <div className="p-4 border-t border-gray-100 bg-gray-50 rounded-b-xl flex justify-between items-center text-xs text-gray-500">
                <span>Mostrando {filtered.length} resultados</span>
                <div className="flex gap-2">
                    <button className="px-3 py-1 bg-white border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-50" disabled>Anterior</button>
                    <button className="px-3 py-1 bg-white border border-gray-200 rounded hover:bg-gray-100">Siguiente</button>
                </div>
            </div>
        </div>
    );
};

// --- Main Container ---
const InventoryTracking = ({ onClose, initialProductId }: { onClose?: () => void; initialProductId?: string }) => {
    const [selectedItem, setSelectedItem] = useState<TrackingItem | null>(null);
    const [items, setItems] = useState<TrackingItem[]>(MOCK_ITEMS);

    useEffect(() => {
        // Here you would fetch data from backend
        // fetch('/api/inventory/tracking').then(...)
        if (initialProductId) {
            // Simulate filtering by product ID
            const filtered = MOCK_ITEMS.filter(i => i.productName.includes(initialProductId) || i.id === initialProductId || i.productId === initialProductId);
            // For demo purposes, since IDs might not match mocks, if no match found, show all or show empty? 
            // Let's just show mock items that "match" (or if no match in mocks, just show all for now to avoid empty screen in demo if IDs differ)
            if (filtered.length > 0) setItems(filtered);
            // In real app: setItems(await fetchByProduct(initialProductId));
        }
    }, [initialProductId]);

    return (
        <div className="h-full min-h-0 flex flex-col overflow-y-auto bg-slate-50/50 p-4 md:p-6" data-view="inventory-tracking">
            {/* Header */}
            <div className="mb-6 flex justify-between items-end">
                <div>
                    <div className="flex items-center gap-3">
                        {onClose && (
                            <button onClick={onClose} className="p-2 -ml-2 hover:bg-white rounded-full transition-colors text-slate-400 hover:text-slate-800">
                                <ArrowRight className="rotate-180" size={24} />
                            </button>
                        )}
                        <h1 className="text-2xl font-black text-slate-800 tracking-tight">Trazabilidad de Series</h1>
                    </div>
                    <p className="text-sm text-gray-500 font-medium mt-1 ml-10">Gestión del ciclo de vida de inventario serializado</p>
                </div>
                <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all hover:-translate-y-0.5">
                    <Download size={18} /> Exportar Reporte
                </button>
            </div>

            {/* KPIs */}
            <TrackingStats items={items} />

            {/* Main Table */}
            <InventoryGrid items={items} onOpenHistory={setSelectedItem} />

            {/* Modal */}
            {selectedItem && (
                <ItemLifecycle item={selectedItem} onClose={() => setSelectedItem(null)} />
            )}
        </div>
    );
};

export default InventoryTracking;
