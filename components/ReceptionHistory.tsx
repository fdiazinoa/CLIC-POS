import React, { useState, useMemo } from 'react';
import { Search, Package, Calendar, User, ArrowRight, Clock, X, Hash, Box } from 'lucide-react';
import { Reception, BusinessConfig } from '../types';

interface ReceptionHistoryProps {
    receptions: Reception[];
    config: BusinessConfig;
}

const ReceptionHistory: React.FC<ReceptionHistoryProps> = ({ receptions, config }) => {
    const [search, setSearch] = useState('');
    const [selectedReception, setSelectedReception] = useState<Reception | null>(null);

    const filteredReceptions = useMemo(() => {
        return receptions
            .filter(r => {
                const searchLower = search.toLowerCase();
                return (r.id || '').toLowerCase().includes(searchLower) ||
                    (r.purchaseOrderId || '').toLowerCase().includes(searchLower) ||
                    (r.receivedByUserName || '').toLowerCase().includes(searchLower);
            })
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [receptions, search]);

    return (
        <div className="flex flex-col h-full animate-in fade-in duration-300">
            {/* Header */}
            <div className="mb-6">
                <div className="relative w-full">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <input
                        type="text"
                        placeholder="Buscar por #REC, #PO o usuario..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-green-500/20 shadow-sm"
                    />
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-3 pb-20">
                {filteredReceptions.length === 0 ? (
                    <div className="py-20 text-center bg-white rounded-3xl border border-dashed border-gray-300">
                        <Package size={48} className="mx-auto mb-4 text-gray-300" />
                        <p className="text-gray-500 font-medium">No hay historial de recepciones</p>
                    </div>
                ) : (
                    filteredReceptions.map(r => (
                        <div
                            key={r.id}
                            onClick={() => setSelectedReception(r)}
                            className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                        >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-green-50 text-green-600 rounded-lg flex items-center justify-center shrink-0">
                                        <Package size={20} />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h4 className="font-bold text-gray-800">#{r.id}</h4>
                                            <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded">PO: {r.purchaseOrderId}</span>
                                        </div>
                                        <div className="flex items-center gap-3 mt-1">
                                            <div className="flex items-center gap-1 text-xs text-gray-500">
                                                <Calendar size={12} />
                                                {new Date(r.date).toLocaleDateString()}
                                            </div>
                                            <div className="flex items-center gap-1 text-xs text-gray-500">
                                                <Clock size={12} />
                                                {new Date(r.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-8">
                                    <div className="flex items-center gap-2">
                                        <div className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center text-gray-500">
                                            <User size={14} />
                                        </div>
                                        <span className="text-sm font-medium text-gray-700">{r.receivedByUserName}</span>
                                    </div>

                                    <div className="text-right min-w-[80px]">
                                        <p className="text-[10px] uppercase text-gray-400 font-bold">Items</p>
                                        <p className="text-sm font-black text-gray-800">{r.items.length}</p>
                                    </div>

                                    <button className="px-4 py-2 bg-green-50 text-green-700 rounded-lg font-bold text-xs hover:bg-green-100 transition-colors flex items-center gap-2">
                                        Ver Detalle <ArrowRight size={14} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Detail Modal */}
            {selectedReception && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-200">
                        <div className="p-6 bg-green-600 text-white flex justify-between items-center">
                            <div>
                                <h3 className="text-xl font-bold flex items-center gap-2">
                                    <Package size={24} /> Detalle de Recepción
                                </h3>
                                <p className="text-green-100 text-sm opacity-80">#{selectedReception.id} • PO: {selectedReception.purchaseOrderId}</p>
                            </div>
                            <button
                                onClick={() => setSelectedReception(null)}
                                className="p-2 hover:bg-white/20 rounded-full transition-colors"
                            >
                                <X size={24} />
                            </button>
                        </div>

                        <div className="p-6 border-b border-gray-100 bg-gray-50 flex flex-wrap gap-6">
                            <div>
                                <p className="text-[10px] uppercase text-gray-400 font-bold mb-1">Fecha y Hora</p>
                                <p className="text-sm font-bold text-gray-700">
                                    {new Date(selectedReception.date).toLocaleString()}
                                </p>
                            </div>
                            <div>
                                <p className="text-[10px] uppercase text-gray-400 font-bold mb-1">Recibido por</p>
                                <p className="text-sm font-bold text-gray-700">{selectedReception.receivedByUserName}</p>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            <table className="w-full text-left">
                                <thead className="text-[10px] uppercase text-gray-400 font-bold border-b border-gray-100">
                                    <tr>
                                        <th className="pb-3">Producto</th>
                                        <th className="pb-3 text-center">Cantidad</th>
                                        <th className="pb-3 text-right">Costo Unit.</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {selectedReception.items.map((item, idx) => (
                                        <tr key={idx} className="group">
                                            <td className="py-4">
                                                <p className="font-bold text-gray-800">{item.productName}</p>
                                                <p className="text-xs text-gray-400 font-mono">{item.productId}</p>
                                            </td>
                                            <td className="py-4 text-center">
                                                <span className="px-3 py-1 bg-green-50 text-green-700 rounded-lg font-black text-sm">
                                                    {item.quantityReceived}
                                                </span>
                                            </td>
                                            <td className="py-4 text-right font-mono text-gray-600">
                                                {config.currencySymbol}{item.cost.toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end">
                            <button
                                onClick={() => setSelectedReception(null)}
                                className="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-bold transition-colors"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReceptionHistory;
