import React, { useState, useEffect } from 'react';
import {
    X, Package, Tag, DollarSign, StickyNote,
    Save, AlertCircle, Check, Store
} from 'lucide-react';
import { Product, Warehouse, ProductStock, User } from '../types';
import { db } from '../utils/db';
import { hasProductPromotion } from '../utils/promotionEngine';

interface ProductActionModalProps {
    isOpen: boolean;
    onClose: () => void;
    product: Product | null;
    onSave: (productId: string, price?: number, note?: string) => void;
    currentWarehouseId: string;
    warehouses: Warehouse[];
    currentUser: User;
    existingCartItem?: { price: number; note?: string };
}

type Tab = 'STOCK' | 'PROMOS' | 'PRICE' | 'NOTES';

const ProductActionModal: React.FC<ProductActionModalProps> = ({
    isOpen,
    onClose,
    product,
    onSave,
    currentWarehouseId,
    warehouses,
    currentUser,
    existingCartItem
}) => {
    const [activeTab, setActiveTab] = useState<Tab>('STOCK');
    const [stockData, setStockData] = useState<ProductStock[]>([]);
    const [loadingStock, setLoadingStock] = useState(false);
    const [priceOverride, setPriceOverride] = useState<string>('');
    const [note, setNote] = useState<string>('');

    useEffect(() => {
        if (isOpen && product) {
            // Reset state
            setActiveTab('STOCK');
            setPriceOverride(existingCartItem?.price?.toString() || product.price.toString());
            setNote(existingCartItem?.note || '');

            // Fetch stock
            fetchStock(product.id);
        }
    }, [isOpen, product, existingCartItem]);

    const fetchStock = async (productId: string) => {
        setLoadingStock(true);
        try {
            const allStocks = await db.get('productStocks') as ProductStock[];
            const productStocks = allStocks.filter(s => s.productId === productId);
            setStockData(productStocks);
        } catch (error) {
            console.error("Error fetching stock:", error);
        } finally {
            setLoadingStock(false);
        }
    };

    const handleSave = () => {
        if (!product) return;

        const finalPrice = priceOverride ? parseFloat(priceOverride) : undefined;
        onSave(product.id, finalPrice, note);
        onClose();
    };

    if (!isOpen || !product) return null;

    const hasPromo = hasProductPromotion(product);
    const canChangePrice = product.operationalFlags?.promptPrice ||
        currentUser.role === 'ADMIN' ||
        currentUser.role === 'MANAGER'; // Simplified role check

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">{product.name}</h2>
                        <p className="text-sm text-gray-500">{product.barcode || 'Sin código'}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full">
                        <X size={24} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b">
                    <TabButton
                        active={activeTab === 'STOCK'}
                        onClick={() => setActiveTab('STOCK')}
                        icon={<Package size={20} />}
                        label="Stock"
                    />
                    <TabButton
                        active={activeTab === 'PROMOS'}
                        onClick={() => setActiveTab('PROMOS')}
                        icon={<Tag size={20} />}
                        label="Promos"
                    />
                    <TabButton
                        active={activeTab === 'PRICE'}
                        onClick={() => setActiveTab('PRICE')}
                        icon={<DollarSign size={20} />}
                        label="Precio"
                    />
                    <TabButton
                        active={activeTab === 'NOTES'}
                        onClick={() => setActiveTab('NOTES')}
                        icon={<StickyNote size={20} />}
                        label="Notas"
                    />
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {activeTab === 'STOCK' && (
                        <div className="space-y-4">
                            <h3 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                <Store size={18} /> Disponibilidad por Almacén
                            </h3>
                            {loadingStock ? (
                                <div className="text-center py-8 text-gray-400">Cargando stock...</div>
                            ) : (
                                <div className="space-y-2">
                                    {warehouses.map(wh => {
                                        const stock = stockData.find(s => s.warehouseId === wh.id);
                                        const qty = stock?.quantity || 0;
                                        const isCurrent = wh.id === currentWarehouseId;

                                        return (
                                            <div key={wh.id} className={`flex justify-between items-center p-3 rounded-lg border ${isCurrent ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-300' : 'bg-gray-50 border-gray-100'}`}>
                                                <div className="flex items-center gap-2">
                                                    <span className={`font-medium ${isCurrent ? 'text-blue-700' : 'text-gray-700'}`}>
                                                        {wh.name}
                                                    </span>
                                                    {isCurrent && <span className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full">Actual</span>}
                                                </div>
                                                <span className={`font-bold text-lg ${qty > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                                    {qty}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'PROMOS' && (
                        <div className="space-y-4">
                            {hasPromo ? (
                                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="bg-green-100 p-2 rounded-full text-green-600">
                                            <Tag size={24} />
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-green-800">Promoción Activa</h4>
                                            <p className="text-green-700 text-sm mt-1">
                                                Este producto tiene promociones aplicables.
                                                Las reglas se aplicarán automáticamente al agregarlo al ticket.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-10 text-gray-400">
                                    <Tag size={48} className="mx-auto mb-3 opacity-20" />
                                    <p>No hay promociones activas para este producto.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'PRICE' && (
                        <div className="space-y-4">
                            {!canChangePrice && (
                                <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg flex items-center gap-2 text-yellow-800 text-sm mb-4">
                                    <AlertCircle size={16} />
                                    <span>Requiere permisos de administrador para modificar el precio.</span>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Precio Unitario</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <span className="text-gray-500 font-bold">$</span>
                                    </div>
                                    <input
                                        type="number"
                                        value={priceOverride}
                                        onChange={(e) => setPriceOverride(e.target.value)}
                                        disabled={!canChangePrice}
                                        className="block w-full pl-8 pr-4 py-3 text-lg border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                                        placeholder="0.00"
                                    />
                                </div>
                                <p className="text-xs text-gray-500 mt-2">
                                    Precio original: <span className="font-medium">${product.price.toFixed(2)}</span>
                                </p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'NOTES' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Notas / Instrucciones</label>
                                <textarea
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    rows={4}
                                    className="block w-full p-3 border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="Ej: Sin cebolla, Empaque de regalo..."
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-200 rounded-lg transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-lg shadow-blue-200"
                    >
                        <Save size={18} />
                        Guardar Cambios
                    </button>
                </div>
            </div>
        </div>
    );
};

const TabButton = ({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) => (
    <button
        onClick={onClick}
        className={`flex-1 py-3 flex flex-col items-center gap-1 text-sm font-medium transition-colors border-b-2 ${active
                ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
    >
        {icon}
        {label}
    </button>
);

export default ProductActionModal;
