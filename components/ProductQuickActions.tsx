import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import {
    DollarSign, Edit3, Box, Globe, Printer,
    PauseCircle, PlayCircle, Settings, X, Check, Save
} from 'lucide-react';
import { Product, BusinessConfig, Warehouse, ProductStock, RoleDefinition, User } from '../types';
import { db } from '../utils/db';
import NumericKeypad from './NumericKeypad';
import {
    canonicalizeWarehouseIds,
    canonicalizeWarehouseRecord,
    getWarehouseScopedNumber,
    resolveProductActiveWarehouseIds,
} from '../utils/masterIdentity';

const normalizeStockLookupKey = (value: unknown): string => String(value || '').trim().toLowerCase();

const buildProductStockLookupKeys = (product: Product): Set<string> => {
    const record = product as any;
    return new Set([
        product.id,
        record.productId,
        record.product_id,
        record.erpProductId,
        record.erp_product_id,
        record.operationalProductId,
        record.operational_product_id,
        record.sourceItemId,
        record.source_item_id,
        record.itemId,
        record.item_id,
        record.code,
        record.itemCode,
        record.item_code,
        record.sku,
        record.barcode,
        record.reference,
        record.referenceCode,
        record.reference_code,
    ].map(normalizeStockLookupKey).filter(Boolean));
};

const stockRowProductMatches = (stock: ProductStock, productKeys: Set<string>): boolean => {
    const record = stock as any;
    return [
        stock.productId,
        record.product_id,
        record.erpProductId,
        record.erp_product_id,
        record.operationalProductId,
        record.operational_product_id,
        record.sourceItemId,
        record.source_item_id,
        record.itemId,
        record.item_id,
        record.code,
        record.itemCode,
        record.item_code,
        record.sku,
        record.barcode,
        record.reference,
        record.referenceCode,
        record.reference_code,
    ].some(value => {
        const key = normalizeStockLookupKey(value);
        return key && productKeys.has(key);
    });
};

interface QuickActionsProps {
    product: Product;
    position: { x: number; y: number };
    onClose: () => void;
    onUpdateProduct: (updatedProduct: Product) => void;
    onAdvancedEdit: (product: Product) => void;
    onViewHistory: (product: Product) => void;
    warehouses: Warehouse[];
    config: BusinessConfig;
    currentUser: User;
    roles: RoleDefinition[];
}

const ProductQuickActions: React.FC<QuickActionsProps> = ({
    product,
    position,
    onClose,
    onUpdateProduct,
    onAdvancedEdit,
    onViewHistory,
    warehouses,
    config,
    currentUser,
    roles
}) => {
    const isAndroid = Capacitor.getPlatform() === 'android';
    const productBasePrice = Number.isFinite(Number(product.price)) ? Number(product.price) : 0;
    const [activeModal, setActiveModal] = useState<'NONE' | 'PRICE' | 'NAME' | 'WAREHOUSE' | 'STOCK'>('NONE');
    const [tempPrice, setTempPrice] = useState(String(productBasePrice));
    const [tempName, setTempName] = useState(product.name);
    const [productStocks, setProductStocks] = useState<ProductStock[]>([]);
    const menuRef = useRef<HTMLDivElement>(null);
    const panelWidth = 220;
    const safeLeft = Math.max(16, Math.min(position.x, window.innerWidth - panelWidth - 16));
    const safeTop = Math.max(16, Math.min(position.y, window.innerHeight - 520));

    // Check Permission
    const hasPermission = (permission: string): boolean => {
        const userRole = roles.find(r => r.id === currentUser.role || r.id === currentUser.roleId);
        if (!userRole) return false;
        if (userRole.permissions.includes('ALL')) return true;
        return userRole.permissions.includes(permission as any);
    };

    const isAuthorized = hasPermission('CATALOG_MANAGE');

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    useEffect(() => {
        if (activeModal === 'STOCK') {
            const loadStocks = async () => {
                const stocks = (await db.get('productStocks') || []) as ProductStock[];
                const productKeys = buildProductStockLookupKeys(product);
                setProductStocks(stocks.filter(s => stockRowProductMatches(s, productKeys)));
            };
            loadStocks();
        }
    }, [activeModal, product]);

    if (!isAuthorized) return null;

    const stockDisplayRows = (() => {
        const rows = new Map<string, { key: string; name: string; code: string; quantity: number }>();
        const putRow = (key: unknown, row: { name: string; code?: string; quantity: unknown }, replace = false) => {
            const normalizedKey = normalizeStockLookupKey(key);
            if (!normalizedKey) return;
            if (!replace && rows.has(normalizedKey)) return;
            rows.set(normalizedKey, {
                key: String(key || normalizedKey),
                name: row.name,
                code: String(row.code || key || ''),
                quantity: Number(row.quantity || 0),
            });
        };

        if (warehouses.length > 0) {
            warehouses.forEach((warehouse) => {
                const warehouseKeys = [
                    warehouse.id,
                    warehouse.code,
                    warehouse.name,
                    (warehouse as any).erpWarehouseId,
                    (warehouse as any).warehouseId,
                    (warehouse as any).inventoryLocalId,
                    (warehouse as any).sourceWarehouseId,
                ].map(normalizeStockLookupKey).filter(Boolean);
                const stock = productStocks.find((entry) => warehouseKeys.includes(normalizeStockLookupKey(entry.warehouseId)));
                const qty = stock ? stock.quantity : getWarehouseScopedNumber(product.stockBalances || {}, warehouse.id, warehouses, 0);
                putRow(warehouse.id, { name: warehouse.name, code: warehouse.code, quantity: qty }, true);
            });
            return Array.from(rows.values());
        }

        productStocks.forEach((stock, index) => {
            const warehouseId = String(stock.warehouseId || `almacen-${index + 1}`);
            putRow(warehouseId, {
                name: `Almacén ${rows.size + 1}`,
                code: warehouseId,
                quantity: stock.quantity,
            });
        });

        Object.entries(product.stockBalances || {}).forEach(([warehouseId, quantity]) => {
            putRow(warehouseId, {
                name: `Almacén ${rows.size + 1}`,
                code: warehouseId,
                quantity,
            });
        });

        return Array.from(rows.values());
    })();

    const handleSavePrice = async () => {
        const newPrice = parseFloat(tempPrice);
        if (isNaN(newPrice)) return;

        const updatedProduct = { ...product, price: newPrice, updatedAt: new Date().toISOString() };
        await persistProductUpdate(updatedProduct);
        setActiveModal('NONE');
        onClose();
    };

    const handleSaveName = async () => {
        if (!tempName.trim()) return;
        const updatedProduct = { ...product, name: tempName, updatedAt: new Date().toISOString() };
        await persistProductUpdate(updatedProduct);
        setActiveModal('NONE');
        onClose();
    };

    const toggleWarehouse = async (warehouseId: string) => {
        const currentActive = resolveProductActiveWarehouseIds(product, warehouses);
        const isCurrentlyActive = currentActive.includes(warehouseId);

        let nextActive;
        if (isCurrentlyActive) {
            nextActive = currentActive.filter(id => id !== warehouseId);
        } else {
            nextActive = [...currentActive, warehouseId];
        }

        const nextWarehouseSettings = canonicalizeWarehouseRecord(product.warehouseSettings || {}, warehouses);
        if (isCurrentlyActive) {
            delete nextWarehouseSettings[warehouseId];
        } else {
            nextWarehouseSettings[warehouseId] = nextWarehouseSettings[warehouseId] || { min: 0, max: 0 };
        }

        const updatedProduct = {
            ...product,
            activeInWarehouses: canonicalizeWarehouseIds(nextActive, warehouses),
            warehouseSettings: nextWarehouseSettings,
            updatedAt: new Date().toISOString()
        };
        await persistProductUpdate(updatedProduct);
    };

    const toggleStatus = async () => {
        // We'll use a custom property in operationalFlags if available, or just toggle isActive if added
        // For now let's assume pausing means removing from all warehouses or similar, 
        // but the request asks for a "Pausar/Descatalogar" switch.
        // Let's add an 'isActive' flag to the product if it doesn't exist, or use internal visibility.
        const isPaused = (product as any).isPaused;
        const updatedProduct = { ...product, isPaused: !isPaused, updatedAt: new Date().toISOString() } as any;
        await persistProductUpdate(updatedProduct);
        onClose();
    };

    const persistProductUpdate = async (updatedProduct: Product) => {
        const allProducts = (await db.get('products') || []) as Product[];
        const newList = allProducts.map(p => p.id === updatedProduct.id ? updatedProduct : p);
        await db.save('products', newList);
        onUpdateProduct(updatedProduct);

        // Trigger toast in parent if possible, but for now we'll just rely on state update
    };

    return (
        <div
            className="fixed z-[100] inset-0 bg-black/5 backdrop-blur-[1px]"
            onClick={onClose}
        >
            <div
                ref={menuRef}
                className="absolute bg-white rounded-[1.35rem] shadow-[0_22px_60px_rgba(15,23,42,0.18)] border border-gray-100 w-[220px] max-w-[calc(100vw-2rem)] overflow-hidden animate-in zoom-in-95 duration-100"
                style={{ top: safeTop, left: safeLeft }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-4 pt-4 pb-3 bg-white">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.22em] mb-2">Acciones Rápidas</p>
                    <h4 className="font-black text-gray-800 text-[11px] leading-tight line-clamp-2">{product.name}</h4>
                </div>

                {/* Action Groups */}
                <div className="px-3 pb-3">
                    {/* Grupo A: Edición Rápida */}
                    <div className="space-y-0.5">
                        <button onClick={() => setActiveModal('PRICE')} className="w-full flex items-center gap-3 px-3 py-2 text-[12px] font-bold text-gray-700 bg-white hover:bg-gray-50 rounded-xl transition-colors">
                            <DollarSign size={15} strokeWidth={2.2} /> Modificar Precio Base
                        </button>
                        <button onClick={() => setActiveModal('NAME')} className="w-full flex items-center gap-3 px-3 py-2 text-[12px] font-bold text-gray-700 bg-white hover:bg-gray-50 rounded-xl transition-colors">
                            <Edit3 size={15} strokeWidth={2.2} /> Renombrar Producto
                        </button>
                        <button onClick={() => setActiveModal('WAREHOUSE')} className="w-full flex items-center gap-3 px-3 py-2 text-[12px] font-bold text-gray-700 bg-white hover:bg-gray-50 rounded-xl transition-colors">
                            <Box size={15} strokeWidth={2.2} /> Asignar Almacenes
                        </button>
                    </div>

                    <div className="h-px bg-gray-100 my-2 mx-3" />

                    {/* Grupo B: Operatividad */}
                    <div className="space-y-0.5">
                        <button onClick={() => setActiveModal('STOCK')} className="w-full flex items-center gap-3 px-3 py-2 text-[12px] font-bold text-gray-700 bg-white hover:bg-gray-50 rounded-xl transition-colors">
                            <Globe size={15} strokeWidth={2.2} /> Ver Stock Global
                        </button>
                        <button onClick={() => { onViewHistory(product); onClose(); }} className="w-full flex items-center gap-3 px-3 py-2 text-[12px] font-bold text-gray-700 bg-white hover:bg-gray-50 rounded-xl transition-colors">
                            <Box size={15} strokeWidth={2.2} /> Ver Historial
                        </button>
                        <button className="w-full flex items-center gap-3 px-3 py-2 text-[12px] font-bold text-gray-300 bg-white rounded-xl transition-colors opacity-80 cursor-not-allowed">
                            <Printer size={15} strokeWidth={2.2} /> Imprimir Etiqueta
                        </button>
                        <button onClick={toggleStatus} className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-[12px] font-bold rounded-xl transition-colors ${(product as any).isPaused ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                            <div className="flex items-center gap-3">
                                {(product as any).isPaused ? <PlayCircle size={15} strokeWidth={2.2} /> : <PauseCircle size={15} strokeWidth={2.2} />}
                                <span>{(product as any).isPaused ? 'Reactivar Venta' : 'Pausar Venta'}</span>
                            </div>
                        </button>
                    </div>

                    <div className="h-px bg-gray-100 my-2 mx-3" />

                    {/* Grupo C: Navegación */}
                    <div className="space-y-0.5">
                        <button
                            onClick={() => onAdvancedEdit(product)}
                            className="w-full flex items-center gap-3 px-3 py-2 text-[12px] font-bold text-purple-600 bg-white hover:bg-purple-50 rounded-xl transition-colors"
                        >
                            <Settings size={15} strokeWidth={2.2} /> Edición Avanzada
                        </button>
                    </div>
                </div>
            </div>

            {/* Sub-Modals */}
            {activeModal === 'PRICE' && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={(e) => setActiveModal('NONE')}>
                    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-2xl w-full max-w-sm animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-black text-gray-800 dark:text-white mb-4">Modificar Precio</h3>
                        <div className="space-y-4">
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">{config.currencySymbol}</span>
                                <input
                                    type={isAndroid ? 'text' : 'number'}
                                    inputMode={isAndroid ? 'none' : 'decimal'}
                                    readOnly={isAndroid}
                                    data-disable-native-soft-keyboard={isAndroid ? 'true' : undefined}
                                    value={tempPrice}
                                    autoFocus={!isAndroid}
                                    onChange={e => setTempPrice(e.target.value)}
                                    className="w-full pl-10 pr-4 py-4 bg-gray-50 dark:bg-slate-900 border-2 border-gray-100 dark:border-slate-700 rounded-2xl text-2xl font-black focus:border-blue-500 transition-all outline-none"
                                />
                            </div>
                            {isAndroid && <NumericKeypad value={tempPrice} onChange={setTempPrice} />}
                            <div className="flex gap-3">
                                <button onClick={() => setActiveModal('NONE')} className="flex-1 py-3 font-bold text-gray-500 bg-gray-100 dark:bg-slate-700 rounded-xl hover:bg-gray-200 transition-all">Cancelar</button>
                                <button onClick={handleSavePrice} className="flex-1 py-3 font-bold text-white bg-blue-600 rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all flex items-center justify-center gap-2">
                                    <Save size={18} /> Guardar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeModal === 'NAME' && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={(e) => setActiveModal('NONE')}>
                    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-2xl w-full max-w-sm animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-black text-gray-800 dark:text-white mb-4">Renombrar Producto</h3>
                        <div className="space-y-4">
                            <input
                                type="text"
                                value={tempName}
                                autoFocus
                                onChange={e => setTempName(e.target.value)}
                                className="w-full px-4 py-4 bg-gray-50 dark:bg-slate-900 border-2 border-gray-100 dark:border-slate-700 rounded-2xl text-lg font-bold focus:border-blue-500 transition-all outline-none"
                            />
                            <div className="flex gap-3">
                                <button onClick={() => setActiveModal('NONE')} className="flex-1 py-3 font-bold text-gray-500 bg-gray-100 dark:bg-slate-700 rounded-xl hover:bg-gray-200 transition-all">Cancelar</button>
                                <button onClick={handleSaveName} className="flex-1 py-3 font-bold text-white bg-blue-600 rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all flex items-center justify-center gap-2">
                                    <Save size={18} /> Guardar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeModal === 'WAREHOUSE' && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={(e) => setActiveModal('NONE')}>
                    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-2xl w-full max-w-sm animate-in zoom-in-95 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <h3 className="text-lg font-black text-gray-800 dark:text-white mb-4 shrink-0">Almacenes Disponibles</h3>
                        <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                            {warehouses.map(wh => {
                                const isActive = resolveProductActiveWarehouseIds(product, warehouses).includes(wh.id);
                                return (
                                    <button
                                        key={wh.id}
                                        onClick={() => toggleWarehouse(wh.id)}
                                        className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${isActive ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-100 text-gray-400'}`}
                                    >
                                        <div className="text-left">
                                            <p className="font-bold">{wh.name}</p>
                                            <p className="text-[10px] opacity-70 uppercase tracking-widest">{wh.code}</p>
                                        </div>
                                        {isActive ? <Check size={20} className="text-blue-600" /> : <div className="w-5 h-5 rounded-full border-2 border-gray-200" />}
                                    </button>
                                );
                            })}
                        </div>
                        <button onClick={() => { setActiveModal('NONE'); onClose(); }} className="mt-6 w-full py-4 font-black text-white bg-slate-900 rounded-2xl hover:bg-black transition-all">LISTO</button>
                    </div>
                </div>
            )}

            {activeModal === 'STOCK' && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={(e) => setActiveModal('NONE')}>
                    <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 shadow-2xl w-full max-w-sm animate-in zoom-in-95 flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-black text-gray-800 dark:text-white">Existencias Globales</h3>
                            <button onClick={() => setActiveModal('NONE')} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-full transition-colors"><X size={20} /></button>
                        </div>
                        <div className="space-y-3">
                            {stockDisplayRows.map((row) => (
                                <div key={row.key} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-900 rounded-2xl">
                                    <div className="flex items-center gap-3">
                                        <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                                        <div>
                                            <p className="font-bold text-gray-800 dark:text-slate-200">{row.name}</p>
                                            <p className="text-[10px] text-gray-400 uppercase tracking-widest">{row.code}</p>
                                        </div>
                                    </div>
                                    <span className={`text-xl font-black ${row.quantity > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                        {row.quantity}
                                    </span>
                                </div>
                            ))}
                            {stockDisplayRows.length === 0 && (
                                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-bold text-amber-700">
                                    No hay existencias registradas para este artículo en esta caja.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProductQuickActions;
