/**
 * InventoryCount
 * 
 * Inventory counting interface for handheld devices.
 * Scan products and adjust quantities.
 */

import React, { useState } from 'react';
import { ScanBarcode, Plus, Minus, Save, X } from 'lucide-react';
import { Product } from '../../types';

interface CountedItem {
    productId: string;
    productName: string;
    expectedQty: number;
    countedQty: number;
    difference: number;
}

interface InventoryCountProps {
    products: Product[];
    onSave: (counts: CountedItem[]) => void;
    onCancel: () => void;
}

const InventoryCount: React.FC<InventoryCountProps> = ({
    products,
    onSave,
    onCancel
}) => {
    const [counts, setCounts] = useState<CountedItem[]>([]);
    const [scanInput, setScanInput] = useState('');
    const [selectedItem, setSelectedItem] = useState<string | null>(null);

    // Handle scan
    const handleScan = () => {
        if (!scanInput.trim()) return;

        const product = products.find(p =>
            p.barcode === scanInput.trim() || p.id === scanInput.trim()
        );

        if (product) {
            const existing = counts.find(c => c.productId === product.id);

            if (existing) {
                // Increment count
                setCounts(counts.map(c =>
                    c.productId === product.id
                        ? { ...c, countedQty: c.countedQty + 1, difference: c.countedQty + 1 - c.expectedQty }
                        : c
                ));
            } else {
                // Add new item
                setCounts([...counts, {
                    productId: product.id,
                    productName: product.name,
                    expectedQty: product.stock || 0,
                    countedQty: 1,
                    difference: 1 - (product.stock || 0)
                }]);
            }

            // Clear input
            setScanInput('');
        } else {
            alert('Producto no encontrado');
            setScanInput('');
        }
    };

    // Adjust quantity
    const adjustQty = (productId: string, delta: number) => {
        setCounts(counts.map(c =>
            c.productId === productId
                ? {
                    ...c,
                    countedQty: Math.max(0, c.countedQty + delta),
                    difference: Math.max(0, c.countedQty + delta) - c.expectedQty
                }
                : c
        ));
    };

    // Remove item
    const removeItem = (productId: string) => {
        setCounts(counts.filter(c => c.productId !== productId));
    };

    // Handle save
    const handleSave = () => {
        if (counts.length === 0) {
            alert('No hay items contados');
            return;
        }

        if (confirm(`¿Guardar conteo de ${counts.length} productos?`)) {
            onSave(counts);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Header */}
            <div className="bg-blue-600 text-white p-4 shadow-md">
                <div className="flex items-center justify-between mb-3">
                    <h1 className="text-xl font-black">Conteo de Inventario</h1>
                    <button
                        onClick={onCancel}
                        className="p-2 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Scan Input */}
                <div className="flex gap-2">
                    <div className="flex-1 relative">
                        <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-200" size={20} />
                        <input
                            type="text"
                            value={scanInput}
                            onChange={(e) => setScanInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleScan()}
                            placeholder="Escanear código..."
                            className="w-full pl-10 pr-4 py-3 bg-white/10 border-2 border-white/20 rounded-xl text-white placeholder-blue-200 font-bold outline-none focus:bg-white/20"
                            autoFocus
                        />
                    </div>
                    <button
                        onClick={handleScan}
                        className="px-6 py-3 bg-white text-blue-600 rounded-xl font-bold hover:bg-blue-50"
                    >
                        Agregar
                    </button>
                </div>
            </div>

            {/* Count Summary */}
            <div className="bg-white border-b border-gray-200 p-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                        <div className="text-sm font-bold text-gray-500">Productos</div>
                        <div className="text-2xl font-black text-gray-900">{counts.length}</div>
                    </div>
                    <div>
                        <div className="text-sm font-bold text-gray-500">Contados</div>
                        <div className="text-2xl font-black text-blue-600">
                            {counts.reduce((sum, c) => sum + c.countedQty, 0)}
                        </div>
                    </div>
                    <div>
                        <div className="text-sm font-bold text-gray-500">Diferencias</div>
                        <div className="text-2xl font-black text-orange-600">
                            {counts.filter(c => c.difference !== 0).length}
                        </div>
                    </div>
                </div>
            </div>

            {/* Counted Items List */}
            <div className="flex-1 overflow-y-auto p-4">
                {counts.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="text-6xl mb-4">📦</div>
                        <p className="text-lg font-bold text-gray-400">No hay productos contados</p>
                        <p className="text-sm text-gray-400 mt-2">Escanea un código para comenzar</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {counts.map(item => (
                            <div
                                key={item.productId}
                                className={`bg-white rounded-2xl border-2 ${item.difference === 0
                                    ? 'border-gray-200'
                                    : 'border-orange-300 bg-orange-50'
                                    } p-4`}
                            >
                                {/* Product Name */}
                                <div className="font-bold text-gray-800 mb-3">{item.productName}</div>

                                {/* Quantity Controls */}
                                <div className="flex items-center gap-3 mb-3">
                                    <button
                                        onClick={() => adjustQty(item.productId, -1)}
                                        className="w-12 h-12 bg-gray-200 hover:bg-gray-300 rounded-xl flex items-center justify-center transition-colors"
                                    >
                                        <Minus size={20} strokeWidth={3} />
                                    </button>

                                    <div className="flex-1 text-center">
                                        <div className="text-4xl font-black text-gray-900 mb-1">
                                            {item.countedQty}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            Esperado: {item.expectedQty}
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => adjustQty(item.productId, 1)}
                                        className="w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center justify-center transition-colors"
                                    >
                                        <Plus size={20} strokeWidth={3} />
                                    </button>
                                </div>

                                {/* Difference Badge */}
                                {item.difference !== 0 && (
                                    <div className={`text-center py-2 px-4 rounded-xl font-bold text-sm ${item.difference > 0
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-red-100 text-red-700'
                                        }`}>
                                        {item.difference > 0 ? '+' : ''}{item.difference} unidades
                                    </div>
                                )}

                                {/* Remove Button */}
                                <button
                                    onClick={() => removeItem(item.productId)}
                                    className="w-full mt-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg font-bold text-sm transition-colors"
                                >
                                    Eliminar
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Save Button */}
            {counts.length > 0 && (
                <div className="p-4 bg-white border-t border-gray-200">
                    <button
                        onClick={handleSave}
                        className="w-full py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-black text-lg shadow-lg flex items-center justify-center gap-2"
                    >
                        <Save size={24} strokeWidth={2.5} />
                        Guardar Conteo ({counts.length} productos)
                    </button>
                </div>
            )}
        </div>
    );
};

export default InventoryCount;
