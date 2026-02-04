import React, { useState, useMemo, useEffect } from 'react';
import { X, Check, Zap, Info, AlertCircle, ShoppingCart } from 'lucide-react';
import { Product, ProductVariant, BusinessConfig } from '../types';

interface OrderMatrixModalProps {
    isOpen: boolean;
    onClose: () => void;
    product: Product;
    config: BusinessConfig;
    onConfirm: (entries: { variant: ProductVariant, quantity: number }[]) => void;
}

const OrderMatrixModal: React.FC<OrderMatrixModalProps> = ({
    isOpen,
    onClose,
    product,
    config,
    onConfirm
}) => {
    // Local state for quantities in the matrix: { [sku]: quantity }
    const [matrixData, setMatrixData] = useState<Record<string, number>>({});

    // Identify matrix dimensions based on attributes
    // We assume the first attribute is Rows (e.g., Color) and second is Columns (e.g., Size)
    const rowAttr = product.attributes[0];
    const colAttr = product.attributes[1] || { name: 'Única', options: ['-'], optionCodes: ['-'] };

    // Initialize matrix data if needed
    useEffect(() => {
        if (isOpen) {
            setMatrixData({});
        }
    }, [isOpen, product]);

    const getVariant = (rowVal: string, colVal: string) => {
        return product.variants.find(v => {
            const hasRow = v.attributeValues[rowAttr.name] === rowVal;
            const hasCol = product.attributes.length > 1
                ? v.attributeValues[colAttr.name] === colVal
                : true;
            return hasRow && hasCol;
        });
    };

    // Magic Suggestion Logic: Fill up to Max stock
    const handleMagicSuggestion = () => {
        const suggestedData: Record<string, number> = {};
        const warehouseId = 'wh_central';

        // Use parent settings
        const min = product.warehouseSettings?.[warehouseId]?.min || 0;
        const max = product.warehouseSettings?.[warehouseId]?.max || 0;
        const currentStock = product.stockBalances?.[warehouseId] || 0;

        if (currentStock < min && product.variants.length > 0) {
            const totalNeeded = max - currentStock;
            // Distribute units among variants evenly
            const perVariant = Math.ceil(totalNeeded / product.variants.length);

            product.variants.forEach(variant => {
                suggestedData[variant.sku] = perVariant;
            });
        }

        setMatrixData(prev => ({ ...prev, ...suggestedData }));
    };

    const handleInputChange = (sku: string, value: string) => {
        const qty = parseInt(value) || 0;
        setMatrixData(prev => ({
            ...prev,
            [sku]: Math.max(0, qty)
        }));
    };

    const handleConfirm = () => {
        const entries = Object.entries(matrixData)
            .filter(([_, qty]) => qty > 0)
            .map(([sku, qty]) => {
                const variant = product.variants.find(v => v.sku === sku);
                return { variant: variant!, quantity: qty };
            });

        if (entries.length > 0) {
            onConfirm(entries);
            onClose();
        }
    };

    const totalItems = Object.values(matrixData).reduce((acc, qty) => acc + qty, 0);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0 z-10">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
                            <ShoppingCart size={24} />
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-gray-900 leading-tight">Matriz de Pedido</h3>
                            <p className="text-sm text-gray-500 font-medium">{product.name} <span className="text-gray-300 mx-1">/</span> {product.category}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Matrix Body */}
                <div className="flex-1 overflow-auto p-6 bg-gray-50/50">
                    <div className="mb-6 flex justify-between items-end">
                        <div className="flex items-center gap-2 text-indigo-600 bg-indigo-50 px-4 py-2 rounded-xl text-sm font-bold border border-indigo-100">
                            <Info size={16} />
                            Ingresa las cantidades por cada combinación de {rowAttr.name} y {colAttr.name}
                        </div>
                        <button
                            onClick={handleMagicSuggestion}
                            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold text-sm shadow-md transition-all active:scale-95 group"
                        >
                            <Zap size={16} className="group-hover:animate-pulse" />
                            Magic Sugerencia
                        </button>
                    </div>

                    <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="bg-gray-50/80">
                                    <th className="p-4 text-left border-b border-gray-100 text-[10px] font-black uppercase text-gray-400">
                                        {rowAttr.name} \ {colAttr.name}
                                    </th>
                                    {colAttr.options.map((opt, i) => (
                                        <th key={`col-${i}`} className="p-4 text-center border-b border-gray-100 text-xs font-black uppercase text-gray-800">
                                            {opt}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rowAttr.options.map((rowOpt, rIdx) => (
                                    <tr key={`row-${rIdx}`} className="group hover:bg-indigo-50/30 transition-colors">
                                        <td className="p-4 border-b border-gray-100 font-bold text-gray-700 bg-gray-50/30">
                                            <div className="flex items-center gap-2">
                                                {rowAttr.id === 'color' && (
                                                    <div
                                                        className="w-3 h-3 rounded-full border border-gray-200"
                                                        style={{ backgroundColor: rowAttr.optionCodes[rIdx] || '#ccc' }}
                                                    />
                                                )}
                                                {rowOpt}
                                            </div>
                                        </td>
                                        {colAttr.options.map((colOpt, cIdx) => {
                                            const variant = getVariant(rowOpt, colOpt);
                                            if (!variant) return <td key={`cell-${rIdx}-${cIdx}`} className="p-2 border-b border-gray-100 bg-gray-100/50" />;

                                            const warehouseId = 'wh_central';
                                            const stock = product.stockBalances?.[warehouseId] || 0; // In real life, should be variant.stock
                                            const min = product.warehouseSettings?.[warehouseId]?.min || 0;
                                            const isCritical = stock < min;

                                            return (
                                                <td key={`cell-${rIdx}-${cIdx}`} className="p-3 border-b border-gray-100 text-center">
                                                    <div className="flex flex-col items-center gap-1.5">
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            className={`w-16 h-10 text-center font-black rounded-xl border-2 transition-all outline-none focus:ring-4 focus:ring-indigo-100 ${matrixData[variant.sku] > 0
                                                                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                                                : isCritical
                                                                    ? 'border-orange-200 bg-orange-50/30 text-gray-400 focus:border-orange-400'
                                                                    : 'border-gray-100 bg-gray-50 text-gray-400 focus:border-indigo-400 focus:bg-white'
                                                                }`}
                                                            placeholder="0"
                                                            value={matrixData[variant.sku] || ''}
                                                            onChange={(e) => handleInputChange(variant.sku, e.target.value)}
                                                        />
                                                        <div className={`flex flex-col text-[9px] font-bold leading-tight ${isCritical ? 'text-orange-500' : 'text-gray-400'}`}>
                                                            <span>STK: {stock}</span>
                                                            <span>MIN: {min}</span>
                                                        </div>
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 bg-white border-t border-gray-100 flex justify-between items-center sticky bottom-0 z-10">
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-black text-gray-400 tracking-wider">Resumen de Selección</span>
                        <div className="flex items-center gap-2">
                            <span className="text-2xl font-black text-gray-900">{totalItems}</span>
                            <span className="text-sm font-bold text-gray-500">unidades totales</span>
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-2xl transition-all"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={totalItems === 0}
                            className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-50 disabled:active:scale-100 text-white rounded-2xl font-black shadow-lg shadow-indigo-200 flex items-center gap-2 transition-all"
                        >
                            <Check size={20} />
                            Confirmar Pedido
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OrderMatrixModal;
