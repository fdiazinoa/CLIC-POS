
import React, { useState, useMemo } from 'react';
import {
    ShoppingBag, Filter, ChevronDown, ChevronUp, Search,
    Package, TrendingUp, AlertTriangle, CheckCircle2,
    Save, RefreshCcw, Info, Calendar, Warehouse as WarehouseIcon,
    PackagePlus, Truck, ArrowRight, Calculator, Check, FileText,
    DollarSign, History as HistoryIcon
} from 'lucide-react';
import { Product, Warehouse, Transaction, Supplier, BusinessConfig, PurchaseOrder, PurchaseOrderItem, InventoryLedgerEntry, StockTransfer, CartItem, SupplierProductPrice } from '../types';
import { db } from '../utils/db';
import { syncManager } from '../services/sync/SyncManager';

interface SmartReplenishmentProps {
    products: Product[];
    warehouses: Warehouse[];
    suppliers: Supplier[];
    purchaseOrders: PurchaseOrder[];
    parkedTickets: any[];
    config: BusinessConfig;
    onOrdersGenerated: (orders: PurchaseOrder[]) => void;
}

const SmartReplenishment: React.FC<SmartReplenishmentProps> = ({
    products,
    warehouses,
    suppliers,
    purchaseOrders,
    config,
    parkedTickets,
    onOrdersGenerated
}) => {
    const [isFiltersOpen, setIsFiltersOpen] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
    const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);
    const [selectedWarehouses, setSelectedWarehouses] = useState<string[]>(warehouses.map(w => w.id));

    // Algorithm Parameters
    const [daysLookback, setDaysLookback] = useState(30);
    const [coverageDays, setCoverageDays] = useState(15);
    const [growthFactor, setGrowthFactor] = useState(0);
    const [onlyUnderMin, setOnlyUnderMin] = useState(false);

    const [isCalculating, setIsCalculating] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [results, setResults] = useState<any[]>([]);
    const [priceCatalog, setPriceCatalog] = useState<SupplierProductPrice[]>([]);

    // Filter Options
    const departments = useMemo(() => Array.from(new Set(products.map(p => p.category))).filter(Boolean).sort(), [products]);
    const supplierList = useMemo(() => suppliers.map(s => ({ id: s.id, name: s.name })), [suppliers]);

    const handleCalculate = async () => {
        setIsCalculating(true);
        try {
            const ledger = await db.get('inventoryLedger') as InventoryLedgerEntry[] || [];
            const allTransfers = await db.get('transfers') as StockTransfer[] || [];
            const catalog = await db.get('supplierProductPrices') as SupplierProductPrice[] || [];
            setPriceCatalog(catalog);

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - daysLookback);

            const filteredProducts = products.filter(p => {
                const matchesSearch = !searchTerm || p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.barcode?.includes(searchTerm);
                const matchesDept = selectedDepts.length === 0 || selectedDepts.includes(p.category);

                // Enhanced Supplier Filter: Check primary OR historical purchase
                const hasHistoricalPurchase = catalog.some(c => c.productId === p.id && selectedSuppliers.includes(c.supplierId));
                const matchesSupplier = selectedSuppliers.length === 0 || selectedSuppliers.includes(p.primarySupplierId || '') || hasHistoricalPurchase;

                return matchesSearch && matchesDept && matchesSupplier;
            });

            const newResults: any[] = [];

            for (const product of filteredProducts) {
                // 1. Aggregated Physical Stock in selected warehouses
                let physicalStock = 0;
                selectedWarehouses.forEach(whId => {
                    physicalStock += product.stockBalances?.[whId] || 0;
                });

                // 2. In Transit to selected warehouses
                const inTransit = allTransfers
                    .filter(t => t.status === 'IN_TRANSIT' && selectedWarehouses.includes(t.destinationWarehouseId))
                    .reduce((acc, t) => {
                        const item = t.items.find(i => i.productId === product.id);
                        return acc + (item?.quantity || 0);
                    }, 0);

                // 3. Pending Receive (from POs)
                const pendingReceive = purchaseOrders
                    .filter(po => po.status !== 'COMPLETED')
                    .reduce((acc, po) => {
                        const item = po.items.find(i => i.productId === product.id);
                        if (!item) return acc;
                        return acc + (item.quantityOrdered - (item.quantityReceived || 0));
                    }, 0);

                // 4. Committed (Parked Tickets / Pending Deliveries)
                const committed = parkedTickets.reduce((acc, ticket) => {
                    const item = ticket.items.find((i: CartItem) => i.id === product.id);
                    return acc + (item?.quantity || 0);
                }, 0);

                // 5. VMD Calculation (Aggregated sales in selected warehouses)
                const sales = ledger.filter(e =>
                    e.productId === product.id &&
                    selectedWarehouses.includes(e.warehouseId) &&
                    e.concept === 'VENTA' &&
                    new Date(e.createdAt) >= startDate
                );
                const totalSales = sales.reduce((acc, e) => acc + (e.qtyOut || 0), 0);
                const vmd = totalSales / daysLookback;

                // 6. Magic Buy Formula
                // Suggestion = (Projected Sale + Min Stock + Committed) - (Physical + In Transit + Pending Reception)
                const projectedSale = vmd * coverageDays;
                const bufferAmount = projectedSale * (growthFactor / 100);

                // Aggregated Min Stock
                let totalMinStock = 0;
                selectedWarehouses.forEach(whId => {
                    totalMinStock += product.warehouseSettings?.[whId]?.min || 0;
                });

                const totalNeeds = projectedSale + bufferAmount + totalMinStock + committed;
                const availableAndOnTheWay = physicalStock + inTransit + pendingReceive;

                const suggestion = Math.max(0, Math.ceil(totalNeeds - availableAndOnTheWay));

                if (onlyUnderMin && physicalStock > totalMinStock && suggestion === 0) continue;
                if (!searchTerm && !onlyUnderMin && suggestion === 0 && vmd === 0) continue;

                // Find last cost for this supplier (if filtered) or absolute last cost
                const relevantPrices = catalog.filter(c => c.productId === product.id);
                const supplierPrice = selectedSuppliers.length > 0
                    ? relevantPrices.find(c => selectedSuppliers.includes(c.supplierId))
                    : relevantPrices.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

                const lastCost = supplierPrice?.lastCost || product.cost || 0;

                newResults.push({
                    productId: product.id,
                    productName: product.name,
                    barcode: product.barcode,
                    cost: lastCost,
                    primarySupplierId: product.primarySupplierId,
                    physicalStock,
                    committed,
                    inTransit,
                    pendingReceive,
                    vmd,
                    projectedSale,
                    suggestion,
                    manualAdjustment: suggestion,
                    minStock: totalMinStock,
                    historicalCost: lastCost
                });
            }

            setResults(newResults);
        } catch (err) {
            console.error("Calculation Error:", err);
            alert("Error al calcular necesidades de reabastecimiento.");
        } finally {
            setIsCalculating(false);
        }
    };

    const handleProcesarPedidos = async () => {
        const itemsToOrder = results.filter(r => r.manualAdjustment > 0);
        if (itemsToOrder.length === 0) {
            alert("No hay artículos con cantidad de ajuste para procesar.");
            return;
        }

        if (!await clicConfirm(`¿Desea generar Órdenes de Pedido para ${itemsToOrder.length} artículos?`)) return;

        setIsGenerating(true);
        try {
            // Group by supplier
            const groupedBySupplier: Record<string, typeof itemsToOrder> = {};
            itemsToOrder.forEach(item => {
                const sId = item.primarySupplierId || 'UNKNOWN';
                if (!groupedBySupplier[sId]) groupedBySupplier[sId] = [];
                groupedBySupplier[sId].push(item);
            });

            const newOrders: PurchaseOrder[] = [];

            for (const supplierId in groupedBySupplier) {
                const supplierItems = groupedBySupplier[supplierId];
                const supplier = suppliers.find(s => s.id === supplierId);

                // Calculate Due Date
                const dueDate = new Date();
                if (supplier?.paymentTermDays) {
                    dueDate.setDate(dueDate.getDate() + supplier.paymentTermDays);
                }

                const poItems: PurchaseOrderItem[] = supplierItems.map(item => ({
                    productId: item.productId,
                    productName: item.productName,
                    quantityOrdered: item.manualAdjustment,
                    quantityReceived: 0,
                    cost: item.cost
                }));

                const totalCost = poItems.reduce((acc, it) => acc + (it.cost * it.quantityOrdered), 0);

                const newPO: PurchaseOrder = {
                    id: `PO-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`,
                    supplierId: supplierId === 'UNKNOWN' ? suppliers[0]?.id || '' : supplierId,
                    date: new Date().toISOString(),
                    expectedDate: dueDate.toISOString(),
                    dueDate: dueDate.toISOString(),
                    status: 'ORDERED',
                    items: poItems,
                    totalCost
                };

                newOrders.push(newPO);

                // Save to DB
                await db.saveDocument('purchaseOrders', newPO);

                // Broadcast
                syncManager.broadcastChange('purchaseOrders', newPO, 'CREATE');
            }

            onOrdersGenerated(newOrders);
            alert(`Se han generado con éxito ${newOrders.length} Órdenes de Compra.`);

            // Clear or refresh results
            setResults([]);
        } catch (err) {
            console.error("Batch PO Error:", err);
            alert("Error al generar las órdenes de pedido.");
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="h-full flex flex-col bg-gray-50/50">
            {/* Top Toolbar */}
            <div className="bg-white border-b border-gray-100 p-4 flex justify-between items-center shadow-sm z-10">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
                        <ShoppingBag size={20} />
                    </div>
                    <div>
                        <h2 className="font-black text-gray-800 tracking-tighter uppercase italic">Previsión y Abastecimiento Inteligente</h2>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Smart Replenishment Engine</p>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                        className={`p-2 rounded-xl transition-all ${isFiltersOpen ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                    >
                        <Filter size={20} />
                    </button>
                    <button
                        onClick={handleProcesarPedidos}
                        disabled={isGenerating || results.length === 0}
                        className="px-4 py-2 bg-amber-600 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-amber-700 transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                        {isGenerating ? <RefreshCcw size={16} className="animate-spin" /> : <PackagePlus size={16} />}
                        Procesar Órdenes de Pedido
                    </button>
                </div>
            </div>

            {/* Filters Sub-Panel */}
            {isFiltersOpen && (
                <div className="bg-white border-b border-gray-100 p-6 animate-in slide-in-from-top duration-300">
                    <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8">
                        {/* Scope: Inclusion Criteria */}
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-black text-amber-600 uppercase tracking-widest flex items-center gap-2">
                                <Filter size={12} /> Criterios de Inclusión
                            </h3>

                            <div className="space-y-3">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Almacenes a Abastecer</label>
                                    <div className="flex flex-wrap gap-1">
                                        {warehouses.map(w => (
                                            <button
                                                key={w.id}
                                                onClick={() => setSelectedWarehouses(prev => prev.includes(w.id) ? prev.filter(id => id !== w.id) : [...prev, w.id])}
                                                className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${selectedWarehouses.includes(w.id) ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-gray-50 text-gray-400 border border-gray-100 hover:bg-gray-100'}`}
                                            >
                                                {w.code}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <select
                                        className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs"
                                        onChange={(e) => setSelectedDepts(prev => prev.includes(e.target.value) ? prev : [...prev, e.target.value])}
                                    >
                                        <option value="">+ Departamento</option>
                                        {departments.map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                    <select
                                        className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs"
                                        onChange={(e) => setSelectedSuppliers(prev => prev.includes(e.target.value) ? prev : [...prev, e.target.value])}
                                    >
                                        <option value="">+ Proveedor</option>
                                        {supplierList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {selectedDepts.map(d => (
                                            <span key={d} onClick={() => setSelectedDepts(prev => prev.filter(x => x !== d))} className="bg-amber-50 text-amber-600 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer hover:bg-red-50 hover:text-red-600 transition-colors">
                                                {d}
                                            </span>
                                        ))}
                                        {selectedSuppliers.map(sId => (
                                            <span key={sId} onClick={() => setSelectedSuppliers(prev => prev.filter(x => x !== sId))} className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer hover:bg-red-50 hover:text-red-600 transition-colors">
                                                {supplierList.find(s => s.id === sId)?.name || sId}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex justify-between items-center">
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <div className={`w-8 h-4 rounded-full transition-colors relative ${onlyUnderMin ? 'bg-amber-500' : 'bg-gray-200'}`}>
                                            <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${onlyUnderMin ? 'translate-x-4' : ''}`} />
                                        </div>
                                        <input type="checkbox" className="hidden" checked={onlyUnderMin} onChange={e => setOnlyUnderMin(e.target.checked)} />
                                        <span className="text-[10px] font-bold text-gray-500 uppercase group-hover:text-amber-600">Solo Bajo Mínimos</span>
                                    </label>

                                    <button
                                        onClick={() => {
                                            setSelectedDepts([]);
                                            setSelectedSuppliers([]);
                                            setSearchTerm('');
                                        }}
                                        className="text-[9px] font-bold text-gray-400 hover:text-red-500 uppercase tracking-widest"
                                    >
                                        Limpiar
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Analysis Parameters */}
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-2">
                                <TrendingUp size={12} /> Lógica de Cálculo
                            </h3>
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 flex justify-between">
                                        VMD (Periodo de Análisis)
                                        <span className="text-indigo-600">{daysLookback} días</span>
                                    </label>
                                    <input
                                        type="range" min="7" max="180" step="1"
                                        value={daysLookback}
                                        onChange={(e) => setDaysLookback(parseInt(e.target.value))}
                                        className="w-full accent-indigo-600"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Días Cobertura</label>
                                        <div className="relative">
                                            <Calendar className="absolute left-3 top-2.5 text-gray-300" size={14} />
                                            <input
                                                type="number"
                                                value={coverageDays}
                                                onChange={(e) => setCoverageDays(parseInt(e.target.value) || 0)}
                                                className="w-full pl-9 p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Crecimiento %</label>
                                        <div className="relative">
                                            <TrendingUp className="absolute left-3 top-2.5 text-gray-300" size={14} />
                                            <input
                                                type="number"
                                                value={growthFactor}
                                                onChange={(e) => setGrowthFactor(parseInt(e.target.value) || 0)}
                                                className="w-full pl-9 p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Dynamic Summary Display */}
                        <div className="md:col-span-2 bg-gray-900 rounded-2xl p-6 text-white relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
                                <Calculator size={120} />
                            </div>
                            <div className="relative z-10 h-full flex flex-col justify-between">
                                <div className="grid grid-cols-2 gap-4 h-full">
                                    <div>
                                        <h3 className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-4">Magic Buy Formula</h3>
                                        <div className="font-mono text-[11px] space-y-2 opacity-80 italic">
                                            <p>Venta Proy. = VMD × {coverageDays} d.</p>
                                            <p>Buffer = {growthFactor}%</p>
                                            <p className="pt-2 border-t border-white/20 text-[10px] text-amber-200 font-bold not-italic">
                                                Sugerencia = (Venta + Mín + Comp) - (Disp + Trán + Pend)
                                            </p>
                                        </div>
                                    </div>
                                    <div className="bg-white/5 rounded-xl border border-white/10 p-4 flex flex-col justify-center items-center backdrop-blur-sm">
                                        <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Items Requeridos</p>
                                        <p className="text-4xl font-black text-amber-500">
                                            {results.filter(r => r.suggestion > 0).length}
                                        </p>
                                        <p className="text-[9px] font-bold text-gray-500 mt-1 uppercase tracking-widest">
                                            Total OC Sugeridas: {new Set(results.filter(r => r.suggestion > 0).map(r => r.primarySupplierId)).size}
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-4 flex justify-end">
                                    <button
                                        onClick={handleCalculate}
                                        disabled={isCalculating}
                                        className="px-6 py-2 bg-white text-gray-900 font-black text-xs uppercase tracking-widest rounded-xl shadow-lg hover:bg-amber-400 transition-all flex items-center gap-2 disabled:opacity-50"
                                    >
                                        {isCalculating ? <RefreshCcw size={16} className="animate-spin" /> : <Calculator size={16} />}
                                        Recalcular Necesidades
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content: The Decision Grid */}
            <div className="flex-1 overflow-hidden flex flex-col">
                <div className="p-4 bg-gray-100/50 flex justify-between items-center border-b border-gray-200">
                    <div className="relative w-96">
                        <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
                        <input
                            type="text"
                            placeholder="Buscar por nombre, SKU o código..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-amber-500 shadow-sm"
                        />
                    </div>
                    <div className="flex items-center gap-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        <span>Resultados: <span className="text-gray-900 font-mono">{results.length}</span></span>
                    </div>
                </div>

                <div className="flex-1 overflow-auto bg-white">
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-white/95 backdrop-blur shadow-sm z-10">
                            <tr className="border-b border-gray-100">
                                <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-tighter">Producto</th>
                                <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-tighter">Costo / Prov.</th>
                                <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-tighter">Situación Actual</th>
                                <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-tighter text-center">BI Previsión</th>
                                <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-tighter text-center">Magic Buy</th>
                                <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-tighter text-center">Ajuste Manual</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {results.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="p-20 text-center text-gray-400 italic">
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="p-4 bg-gray-50 rounded-full">
                                                <TrendingUp size={48} className="text-gray-200" />
                                            </div>
                                            <p>Configure los filtros y el motor de cálculo para generar sugerencias de abastecimiento.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                results.map((res, idx) => (
                                    <tr key={res.productId} className={`hover:bg-amber-50/30 transition-colors ${res.manualAdjustment > 0 ? 'border-l-4 border-amber-500 bg-amber-50/10' : ''}`}>
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="bg-gray-100 rounded p-2 text-gray-400">
                                                    <Package size={20} />
                                                </div>
                                                <div>
                                                    <p className="font-bold text-gray-800 text-sm whitespace-nowrap overflow-hidden text-ellipsis max-w-xs">{res.productName}</p>
                                                    <p className="text-[10px] text-gray-400 font-mono italic">{res.barcode || 'NO_SKU'}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col gap-1">
                                                <div className="text-xs font-black text-gray-700 flex items-center gap-1">
                                                    <DollarSign size={10} className="text-green-500" />
                                                    {res.cost.toLocaleString('es-DO', { minimumFractionDigits: 2 })}
                                                </div>
                                                {res.historicalCost > 0 && (
                                                    <span className="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded flex items-center gap-1 self-start">
                                                        <HistoryIcon size={8} /> Histórico
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-black uppercase">
                                                <div className="flex justify-between items-center bg-gray-50 px-2 py-1 rounded">
                                                    <span className="text-gray-400">Físico</span>
                                                    <span className="text-gray-900">{res.physicalStock}</span>
                                                </div>
                                                <div className="flex justify-between items-center bg-blue-50 px-2 py-1 rounded border border-blue-100">
                                                    <span className="text-blue-400">Tránsito</span>
                                                    <span className="text-blue-700">{res.inTransit}</span>
                                                </div>
                                                <div className="flex justify-between items-center bg-orange-50 px-2 py-1 rounded border border-orange-100">
                                                    <span className="text-orange-400">En OC</span>
                                                    <span className="text-orange-700">{res.pendingReceive}</span>
                                                </div>
                                                <div className="flex justify-between items-center bg-purple-50 px-2 py-1 rounded">
                                                    <span className="text-purple-400">Comp.</span>
                                                    <span className="text-purple-700">{res.committed}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex flex-col items-center">
                                                <span className="text-xs font-black text-indigo-600">{res.vmd.toFixed(2)} / día</span>
                                                <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-1.5 rounded mt-1">
                                                    🎯 {Math.ceil(res.projectedSale)} u.
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex flex-col items-center gap-1">
                                                <div className={`text-lg font-black px-3 py-0.5 rounded-full ${res.suggestion > 0 ? 'bg-amber-100 text-amber-700 animate-pulse border border-amber-200' : 'bg-gray-100 text-gray-400'}`}>
                                                    {res.suggestion}
                                                </div>
                                                {res.physicalStock <= res.minStock && res.minStock > 0 && (
                                                    <span className="text-[9px] font-bold text-red-500 uppercase flex items-center gap-1 bg-red-50 px-1 rounded">
                                                        <AlertTriangle size={8} /> Quiebre
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex justify-center">
                                                <input
                                                    type="number"
                                                    value={res.manualAdjustment}
                                                    onChange={(e) => {
                                                        const val = parseInt(e.target.value) || 0;
                                                        setResults(prev => prev.map((r, i) => i === idx ? { ...r, manualAdjustment: val } : r));
                                                    }}
                                                    className={`w-20 p-2 text-center rounded-xl font-bold text-sm outline-none transition-all ${res.manualAdjustment > 0 ? 'bg-amber-600 text-white shadow-lg shadow-amber-200' : 'bg-gray-50 border border-gray-100 text-gray-400 focus:bg-white'}`}
                                                />
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default SmartReplenishment;
