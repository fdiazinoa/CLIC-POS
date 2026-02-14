/**
 * InventoryCount
 * 
 * Inventory counting interface for handheld devices.
 * Scan products and adjust quantities.
 */

import React, { useEffect, useState } from 'react';
import { ScanBarcode, Plus, Minus, Save, X, Camera, Cloud, Wifi, WifiOff } from 'lucide-react';
import { Product } from '../../types';
import BarcodeScannerModal from '../BarcodeScannerModal';
import { useOfflineSync } from '../../hooks/useOfflineSync';

interface CountedItem {
    productId: string;
    productName: string;
    expectedQty: number;
    countedQty: number;
    difference: number;
}

interface InventoryCountProps {
    products: Product[];
    warehouseId?: string;
    warehouseName?: string;
    onSave?: (counts: CountedItem[]) => Promise<{ message?: string } | void>;
    onCancel: () => void;
    terminalId: string;
    userId: string;
    userName: string;
}

const InventoryCount: React.FC<InventoryCountProps> = ({
    products,
    warehouseId,
    warehouseName,
    onSave,
    onCancel,
    terminalId,
    userId,
    userName
}) => {
    const {
        isOnline,
        isSyncing,
        pendingCount,
        conflicts,
        syncToast,
        enqueueOfflineCount,
        recordOfflineScan,
        processPendingQueue,
        resolveConflict,
        clearSyncToast
    } = useOfflineSync();

    const [counts, setCounts] = useState<CountedItem[]>([]);
    const [scanInput, setScanInput] = useState('');
    const [selectedItem, setSelectedItem] = useState<string | null>(null);
    const [showCameraScanner, setShowCameraScanner] = useState(false);
    const [syncTab, setSyncTab] = useState<'PENDING' | 'CONFLICTS'>('PENDING');
    const [startedAt] = useState(() => new Date().toISOString());
    const [sessionId] = useState(() => `CNT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

    // Get expected qty for a product in the selected warehouse
    const getExpectedQty = (product: Product) => {
        if (!warehouseId) return product.stock || 0;
        return product.stockBalances?.[warehouseId] ?? 0;
    };

    // Handle scan
    const handleScan = async () => {
        if (!scanInput.trim()) return;

        const product = products.find(p =>
            p.barcode === scanInput.trim() || p.id === scanInput.trim()
        );

        if (product) {
            const existing = counts.find(c => c.productId === product.id);
            const expected = getExpectedQty(product);

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
                    expectedQty: expected,
                    countedQty: 1,
                    difference: 1 - expected
                }]);
            }

            if (onSave) {
                // Legacy support if needed, but we prefer hook
            }

            await recordOfflineScan({
                documentId: sessionId,
                documentCode: sessionId,
                warehouseId,
                productId: product.id,
                code: scanInput.trim()
            } as any);

            // Clear input
            setScanInput('');
        } else {
            alert('Producto no encontrado');
            setScanInput('');
        }
    };

    useEffect(() => {
        if (!syncToast || !clearSyncToast) return;
        const timer = window.setTimeout(() => clearSyncToast(), 4500);
        return () => window.clearTimeout(timer);
    }, [clearSyncToast, syncToast]);

    // Handle camera scan
    const handleCameraScan = async (code: string): Promise<{ success: boolean; message?: string }> => {
        const product = products.find(p =>
            p.barcode === code.trim() || p.id === code.trim()
        );

        if (product) {
            const existing = counts.find(c => c.productId === product.id);
            const expected = getExpectedQty(product);

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
                    expectedQty: expected,
                    countedQty: 1,
                    difference: 1 - expected
                }]);
            }

            await recordOfflineScan({
                documentId: sessionId,
                documentCode: sessionId,
                warehouseId,
                productId: product.id,
                code: code.trim()
            } as any);

            return { success: true, message: `${product.name} agregado` };
        } else {
            return { success: false, message: 'Producto no encontrado' };
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
    const handleSave = async () => {
        if (counts.length === 0) {
            alert('No hay items contados');
            return;
        }

        if (confirm(`¿Guardar conteo de ${counts.length} productos para ${warehouseName || 'el almacén seleccionado'}?`)) {
            const payload = {
                id: sessionId,
                warehouseId: warehouseId || '',
                warehouseName: warehouseName || '',
                items: counts.map(c => ({ ...c, warehouseId })),
                startedAt,
                finishedAt: new Date().toISOString(),
                terminalId,
                userId,
                userName
            };

            await enqueueOfflineCount(payload);
            setCounts([]); // Clear local session
            alert('Conteo guardado en cola de sincronización.');
            onCancel(); // Return to home
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {!isOnline && (
                <div className="sticky top-0 z-30 h-7 bg-amber-100 border-b border-amber-200 text-amber-800 text-[11px] font-bold flex items-center justify-center">
                    Modo Offline: Los datos se guardarán localmente
                </div>
            )}

            {/* Header */}
            <div className="bg-blue-600 text-white p-4 shadow-md">
                <div className="flex items-center justify-between mb-1">
                    <div>
                        <h1 className="text-xl font-black leading-tight">Conteo de Inventario</h1>
                        {warehouseName && (
                            <div className="flex items-center gap-1.5 text-blue-100 font-bold text-sm bg-black/10 px-2 py-0.5 rounded-lg w-fit">
                                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                                {warehouseName}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={onCancel}
                        className="p-2 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="flex items-center justify-between gap-2 mt-2">
                    <div className="flex items-center gap-2">
                        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-black ${isOnline ? 'bg-emerald-500/20 text-emerald-100' : 'bg-amber-500/25 text-amber-100'}`}>
                            {isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
                            {isOnline ? 'Online' : 'Offline'}
                        </div>
                        {isSyncing && (
                            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-500/25 text-sky-100 text-[11px] font-black">
                                <Cloud size={13} className="animate-pulse" />
                                Syncing...
                            </div>
                        )}
                    </div>
                    <button
                        onClick={processPendingQueue}
                        disabled={!isOnline || pendingCount === 0 || isSyncing}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/20 text-[11px] font-black disabled:opacity-40"
                    >
                        <Cloud size={13} />
                        Cola: {pendingCount}
                    </button>
                </div>

                {/* Scan Input */}
                <div className="flex gap-2 mt-4">
                    <div className="flex-1 relative">
                        <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-200" size={20} />
                        <input
                            type="text"
                            value={scanInput}
                            onChange={(e) => setScanInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && void handleScan()}
                            placeholder="Escanear código..."
                            className="w-full pl-10 pr-12 py-3 bg-white/10 border-2 border-white/20 rounded-xl text-white placeholder-blue-200 font-bold outline-none focus:bg-white/20"
                            autoFocus
                        />
                        {/* Camera Button */}
                        <button
                            onClick={() => setShowCameraScanner(true)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                            title="Abrir cámara"
                        >
                            <Camera size={20} className="text-white" />
                        </button>
                    </div>
                    <button
                        onClick={() => void handleScan()}
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

                <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                        onClick={() => setSyncTab('PENDING')}
                        className={`rounded-lg py-1.5 text-[11px] font-black ${syncTab === 'PENDING' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}
                    >
                        Pendientes ({pendingCount})
                    </button>
                    <button
                        onClick={() => setSyncTab('CONFLICTS')}
                        className={`rounded-lg py-1.5 text-[11px] font-black ${syncTab === 'CONFLICTS' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-500'}`}
                    >
                        Conflictos ({conflicts.length})
                    </button>
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
                        {syncTab === 'CONFLICTS' && conflicts.length > 0 && (
                            <div className="space-y-2">
                                {conflicts.map((conflict) => (
                                    <div key={conflict.id} className="bg-white rounded-2xl border-2 border-red-200 p-3">
                                        <p className="text-[10px] font-black uppercase text-red-500">Conflicto de sincronización</p>
                                        <p className="text-xs font-bold text-gray-500 mt-1">
                                            Sesión: {conflict.queueItem?.payload?.sessionId || conflict.queueItem?.payload?.documentId || 'N/A'}
                                        </p>
                                        <p className="text-xs font-bold text-red-700 mt-2 bg-red-50 border border-red-200 rounded-lg p-2">
                                            {conflict.reason}
                                        </p>
                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => resolveConflict?.(conflict.id, 'OVERWRITE')}
                                                className="rounded-lg py-2 bg-blue-600 text-white text-xs font-black"
                                            >
                                                Sobrescribir
                                            </button>
                                            <button
                                                onClick={() => resolveConflict?.(conflict.id, 'CANCEL')}
                                                className="rounded-lg py-2 bg-gray-100 text-gray-700 text-xs font-black"
                                            >
                                                Cancelar
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

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

            {/* Camera Scanner Modal */}
            <BarcodeScannerModal
                isOpen={showCameraScanner}
                onClose={() => setShowCameraScanner(false)}
                onScan={handleCameraScan}
            />

            {syncToast && (
                <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[160] px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black shadow-xl">
                    {syncToast}
                </div>
            )}
        </div>
    );
};

export default InventoryCount;
