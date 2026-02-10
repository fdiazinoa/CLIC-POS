import React from 'react';
import { Warehouse as WarehouseIcon, X, Check } from 'lucide-react';
import { Warehouse } from '../../types';

interface WarehouseSelectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    warehouses: Warehouse[];
    onSelect: (warehouse: Warehouse) => void;
}

const WarehouseSelectionModal: React.FC<WarehouseSelectionModalProps> = ({
    isOpen,
    onClose,
    warehouses,
    onSelect
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="bg-blue-600 p-6 text-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                            <WarehouseIcon size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black">Seleccionar Almacén</h2>
                            <p className="text-sm text-blue-100 font-medium">Indique dónde realizará el inventario</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* List */}
                <div className="p-4 max-h-[60vh] overflow-y-auto bg-gray-50">
                    <div className="space-y-3">
                        {warehouses.length === 0 ? (
                            <div className="text-center py-10 text-gray-400">
                                <p className="font-bold">No hay almacenes configurados</p>
                            </div>
                        ) : (
                            warehouses.map((warehouse) => (
                                <button
                                    key={warehouse.id}
                                    onClick={() => onSelect(warehouse)}
                                    className="w-full bg-white p-5 rounded-2xl border-2 border-transparent hover:border-blue-500 hover:shadow-md transition-all text-left flex items-center justify-between group"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                            <WarehouseIcon size={24} />
                                        </div>
                                        <div>
                                            <div className="font-black text-gray-800 text-lg">{warehouse.name}</div>
                                            <div className="text-sm text-gray-500 font-bold">{warehouse.code}</div>
                                        </div>
                                    </div>
                                    <div className="w-8 h-8 rounded-full border-2 border-gray-100 flex items-center justify-center group-hover:border-transparent group-hover:bg-blue-100 text-transparent group-hover:text-blue-600 transition-all">
                                        <Check size={18} strokeWidth={3} />
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 bg-white border-t border-gray-100 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl font-black transition-colors"
                    >
                        Cancelar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WarehouseSelectionModal;
