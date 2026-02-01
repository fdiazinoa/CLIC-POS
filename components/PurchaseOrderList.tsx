import React, { useState, useMemo } from 'react';
import { Search, Plus, FileText, Calendar, ArrowRight, Mail, Clock } from 'lucide-react';
import { PurchaseOrder, Supplier, BusinessConfig } from '../types';

interface PurchaseOrderListProps {
    purchaseOrders: PurchaseOrder[];
    suppliers: Supplier[];
    config: BusinessConfig;
    onNewOrder: () => void;
    onViewDetail: (orderId: string) => void;
    onSendEmail: (order: PurchaseOrder) => void;
}

const PurchaseOrderList: React.FC<PurchaseOrderListProps> = ({
    purchaseOrders,
    suppliers,
    config,
    onNewOrder,
    onViewDetail,
    onSendEmail
}) => {
    const [search, setSearch] = useState('');

    const filteredOrders = useMemo(() => {
        if (!Array.isArray(purchaseOrders)) return [];

        return (purchaseOrders || [])
            .filter(po => {
                const supplier = (suppliers || []).find(s => s.id === po.supplierId);
                const searchLower = (search || '').toLowerCase();
                const supplierName = supplier?.name || '';
                const orderId = po.id || '';
                return orderId.toLowerCase().includes(searchLower) ||
                    supplierName.toLowerCase().includes(searchLower);
            })
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [purchaseOrders, suppliers, search]);

    const getStatusBadge = (status: string, progress: number) => {
        switch (status) {
            case 'COMPLETED':
                return <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold uppercase">Completado</span>;
            case 'PARTIAL':
                return (
                    <div className="flex flex-col gap-1">
                        <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-bold uppercase">Parcial</span>
                        <div className="w-20 bg-gray-100 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-orange-500 h-full" style={{ width: `${progress}%` }}></div>
                        </div>
                    </div>
                );
            case 'ORDERED':
                return <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold uppercase">Enviado</span>;
            default:
                return <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-bold uppercase">Borrador</span>;
        }
    };

    return (
        <div className="flex flex-col h-full animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
                <div className="relative flex-1 w-full">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <input
                        type="text"
                        placeholder="Buscar proveedor o #PO..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-purple-500/20 shadow-sm"
                    />
                </div>
                <button
                    onClick={onNewOrder}
                    className="w-full md:w-auto px-6 py-3 bg-purple-600 text-white rounded-xl font-bold shadow-lg hover:bg-purple-700 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                    <Plus size={20} /> Nuevo Pedido
                </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-4 pb-20">
                {filteredOrders.length === 0 ? (
                    <div className="py-20 text-center bg-white rounded-3xl border border-dashed border-gray-300">
                        <FileText size={48} className="mx-auto mb-4 text-gray-300" />
                        <p className="text-gray-500 font-medium">No se encontraron órdenes de compra</p>
                    </div>
                ) : (
                    (filteredOrders || []).map(po => {
                        const supplier = (suppliers || []).find(s => s.id === po.supplierId);
                        const items = Array.isArray(po.items) ? po.items : [];
                        const totalOrdered = items.reduce((acc, i) => acc + i.quantityOrdered, 0);
                        const totalReceived = items.reduce((acc, i) => acc + i.quantityReceived, 0);
                        const progress = totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 0;

                        return (
                            <div
                                key={po.id}
                                onClick={() => onViewDetail(po.id)}
                                className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                            >
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center shrink-0">
                                            <FileText size={24} />
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-gray-800 text-lg">#{po.id}</h4>
                                            <p className="text-gray-500 text-sm font-medium">{supplier?.name || 'Proveedor Desconocido'}</p>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-6">
                                        <div className="text-center md:text-left">
                                            <p className="text-[10px] uppercase text-gray-400 font-bold mb-1">Fecha</p>
                                            <div className="flex items-center gap-1 text-gray-700 font-bold text-sm">
                                                <Calendar size={14} />
                                                {new Date(po.date).toLocaleDateString()}
                                            </div>
                                        </div>

                                        <div className="text-center md:text-left">
                                            <p className="text-[10px] uppercase text-gray-400 font-bold mb-1">Monto Total</p>
                                            <p className="text-gray-800 font-black">{config.currencySymbol}{po.totalCost.toLocaleString()}</p>
                                        </div>

                                        <div className="min-w-[100px] flex justify-center md:justify-start">
                                            {getStatusBadge(po.status, progress)}
                                        </div>

                                        <div className="flex gap-2">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onSendEmail(po); }}
                                                className="p-2 bg-gray-50 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                                                title="Enviar por Email"
                                            >
                                                <Mail size={20} />
                                            </button>
                                            <div className="p-2 text-gray-300 group-hover:text-purple-600 transition-colors">
                                                <ArrowRight size={24} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default PurchaseOrderList;
