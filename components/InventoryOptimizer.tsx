
import React, { useState, useMemo } from 'react';
import {
    Zap, Calculator, Settings2, Filter, ChevronDown, ChevronUp,
    Search, Package, TrendingUp, AlertTriangle, CheckCircle2,
    Save, RefreshCcw, Info, Calendar, Warehouse as WarehouseIcon,
    AlertCircle
} from 'lucide-react';
import { Product, Warehouse, Transaction, Supplier, BusinessConfig, InventoryLedgerEntry } from '../types';
import { db } from '../utils/db';
import { syncManager } from '../services/sync/SyncManager';

interface InventoryOptimizerProps {
    products: Product[];
    warehouses: Warehouse[];
    transactions: Transaction[];
    suppliers: Supplier[];
    config: BusinessConfig;
    onUpdateProducts: (products: Product[]) => void;
}

const InventoryOptimizer: React.FC<InventoryOptimizerProps> = ({
    products,
    warehouses,
    transactions,
    suppliers,
    config,
    onUpdateProducts
}) => {
    const [isFiltersOpen, setIsFiltersOpen] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isCalculating, setIsCalculating] = useState(false);

    // Algorithm Parameters
    const [daysLookback, setDaysLookback] = useState(30);
    const [minCoverageDays, setMinCoverageDays] = useState(7);
    const [maxCoverageDays, setMaxCoverageDays] = useState(30);
    const [safetyFactor, setSafetyFactor] = useState(20); // 20%
    const [includeNoMovement, setIncludeNoMovement] = useState(true);

    // Filter Options (Extracted from data)
    // Filter Options (Source: Config)
    const departments = useMemo(() => {
        if (config.departments?.length) return config.departments.map(d => d.name).sort();
        return Array.from(new Set(products.map(p => p.category))).filter(Boolean).sort();
    }, [products, config.departments]);

    const brands = useMemo(() => {
        if (config.brands?.length) return config.brands.map(b => ({ id: b.id, name: b.name })).sort((a, b) => a.name.localeCompare(b.name));
        return Array.from(new Set(products.map(p => p.brandId))).filter(Boolean).map(id => ({ id, name: id }));
    }, [products, config.brands]);

    const families = useMemo(() => {
        if (config.families?.length) return config.families.map(f => ({ id: f.id, name: f.name })).sort((a, b) => a.name.localeCompare(b.name));
        return Array.from(new Set(products.map(p => p.familyId))).filter(Boolean).map(id => ({ id, name: id }));
    }, [products, config.families]);
    const supplierList = useMemo(() => suppliers.map(s => ({ id: s.id, name: s.name })), [suppliers]);

    // Selection State
    const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
    const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
    const [selectedFamilies, setSelectedFamilies] = useState<string[]>([]);
    const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);
    const [selectedWarehouses, setSelectedWarehouses] = useState<string[]>(warehouses.map(w => w.id));

    // Results State
    const [results, setResults] = useState<any[]>([]);

    const handleCalculate = async () => {
        setIsCalculating(true);
        try {
            const ledger = await db.get('inventoryLedger') as InventoryLedgerEntry[] || [];
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - daysLookback);

            const filteredProducts = products.filter(p => {
                const matchesSearch = !searchTerm || p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.barcode?.includes(searchTerm);
                const matchesDept = selectedDepts.length === 0 || selectedDepts.includes(p.category);
                const matchesBrand = selectedBrands.length === 0 || selectedBrands.includes(p.brandId || '');
                const matchesFamily = selectedFamilies.length === 0 || selectedFamilies.includes(p.familyId || '');
                const matchesSupplier = selectedSuppliers.length === 0 || selectedSuppliers.includes(p.primarySupplierId || '');
                return matchesSearch && matchesDept && matchesBrand && matchesFamily && matchesSupplier;
            });

            const newResults: any[] = [];

            for (const product of filteredProducts) {
                for (const whId of selectedWarehouses) {
                    const wh = warehouses.find(w => w.id === whId);
                    if (!wh) continue;

                    // Calculate VMD for this product/warehouse
                    const sales = ledger.filter(e =>
                        e.productId === product.id &&
                        e.warehouseId === whId &&
                        e.concept === 'VENTA' &&
                        new Date(e.createdAt) >= startDate
                    );
                    const totalSales = sales.reduce((acc, e) => acc + (e.qtyOut || 0), 0);
                    const vmd = totalSales / daysLookback;

                    if (vmd === 0 && !includeNoMovement) continue;

                    const currentStock = product.stockBalances?.[whId] || 0;
                    const warehouseSetting = product.warehouseSettings?.[whId] || { min: 0, max: 0 };

                    // Suggested Formula: (VMD * CoverageDays) * (1 + SafetyFactor)
                    const buffer = 1 + (safetyFactor / 100);
                    const suggestedMin = Math.ceil((vmd * minCoverageDays) * buffer) || 0;
                    const suggestedMax = Math.ceil((vmd * maxCoverageDays) * buffer) || 0;

                    // Indicators
                    const isOverstock = currentStock > suggestedMax * 1.5 && suggestedMax > 0;
                    const estStockoutDays = vmd > 0 ? currentStock / vmd : Infinity;
                    const isStockoutRisk = estStockoutDays < 7 && vmd > 0; // Risk if stockout in less than 7 days

                    newResults.push({
                        productId: product.id,
                        productName: product.name,
                        productImage: product.image,
                        barcode: product.barcode,
                        warehouseId: whId,
                        warehouseName: wh.name,
                        vmd,
                        currentStock,
                        currentMin: warehouseSetting.min,
                        currentMax: warehouseSetting.max,
                        suggestedMin,
                        suggestedMax,
                        manualMin: suggestedMin,
                        manualMax: suggestedMax,
                        isOverstock,
                        isStockoutRisk,
                        estStockoutDays: estStockoutDays === Infinity ? '---' : Math.floor(estStockoutDays)
                    });
                }
            }

            setResults(newResults);
        } catch (err) {
            console.error("Calculation Error:", err);
            alert("Error al calcular sugerencias.");
        } finally {
            setIsCalculating(false);
        }
    };

    const handleApplyChanges = async () => {
        if (results.length === 0) return;
        if (!await clicConfirm(`¿Está seguro que desea aplicar ${results.length} cambios de niveles de inventario?`)) return;

        setIsCalculating(true);
        try {
            const updatedProducts = [...products];

            for (const res of results) {
                const pIdx = updatedProducts.findIndex(p => p.id === res.productId);
                if (pIdx === -1) continue;

                const product = { ...updatedProducts[pIdx] };
                if (!product.warehouseSettings) product.warehouseSettings = {};

                product.warehouseSettings[res.warehouseId] = {
                    min: res.manualMin,
                    max: res.manualMax
                };

                updatedProducts[pIdx] = product;

                // Save to DB
                await db.saveDocument('products', product);

                // Broadcast for sync
                syncManager.broadcastChange('products', product, 'UPDATE');
            }

            onUpdateProducts(updatedProducts);
            alert('¡Niveles de inventario actualizados correctamente!');
        } catch (err) {
            console.error("Save Error:", err);
            alert("Error al guardar los cambios.");
        } finally {
            setIsCalculating(false);
        }
    };

    return (
        <div className="h-full flex flex-col bg-gray-50/50 overflow-y-auto">
            {/* Top Toolbar: Filter Toggle & Title */}
            <div className="flex-none flex justify-between items-center mb-6 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl">
                        <Zap size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-gray-800">Optimizador de Inventario</h2>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Cálculo Masivo de Niveles BI</p>
                    </div>
                </div>
                <button
                    onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-600 font-bold text-sm transition-all border border-gray-200"
                >
                    <Filter size={18} />
                    {isFiltersOpen ? 'Ocultar Filtros' : 'Mostrar Filtros'}
                    {isFiltersOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
            </div>

            {/* Scope selection panel (Filters) */}
            {isFiltersOpen && (
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm mb-6 animate-in slide-in-from-top-4 duration-300">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {/* Filters placeholder */}
                        <div className="space-y-4">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-tighter">Categorización</label>
                            <div className="space-y-3">
                                <div>
                                    <select
                                        className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs"
                                        onChange={(e) => setSelectedDepts(prev => prev.includes(e.target.value) ? prev : [...prev, e.target.value])}
                                    >
                                        <option value="">+ Departamento / Categoría</option>
                                        {departments.map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {selectedDepts.map(d => (
                                            <span key={d} onClick={() => setSelectedDepts(prev => prev.filter(x => x !== d))} className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer hover:bg-red-50 hover:text-red-600 transition-colors">
                                                {d}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <select
                                        className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs"
                                        onChange={(e) => setSelectedBrands(prev => prev.includes(e.target.value) ? prev : [...prev, e.target.value])}
                                    >
                                        <option value="">+ Marca</option>
                                        {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                    </select>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {selectedBrands.map(id => (
                                            <span key={id} onClick={() => setSelectedBrands(prev => prev.filter(x => x !== id))} className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer hover:bg-red-50 hover:text-red-600 transition-colors">
                                                {brands.find(b => b.id === id)?.name || id}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <select
                                        className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs"
                                        onChange={(e) => setSelectedFamilies(prev => prev.includes(e.target.value) ? prev : [...prev, e.target.value])}
                                    >
                                        <option value="">+ Familia</option>
                                        {families.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                    </select>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {selectedFamilies.map(id => (
                                            <span key={id} onClick={() => setSelectedFamilies(prev => prev.filter(x => x !== id))} className="bg-green-50 text-green-600 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer hover:bg-red-50 hover:text-red-600 transition-colors">
                                                {families.find(f => f.id === id)?.name || id}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <select
                                        className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs"
                                        onChange={(e) => setSelectedSuppliers(prev => prev.includes(e.target.value) ? prev : [...prev, e.target.value])}
                                    >
                                        <option value="">+ Proveedor</option>
                                        {supplierList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {selectedSuppliers.map(sId => (
                                            <span key={sId} onClick={() => setSelectedSuppliers(prev => prev.filter(x => x !== sId))} className="bg-amber-50 text-amber-600 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer hover:bg-red-50 hover:text-red-600 transition-colors">
                                                {suppliers.find(s => s.id === sId)?.name || sId}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-tighter">Almacenes Destino</label>
                            <div className="max-h-32 overflow-y-auto space-y-2 pr-2">
                                {warehouses.map(wh => (
                                    <label key={wh.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors group">
                                        <input
                                            type="checkbox"
                                            checked={selectedWarehouses.includes(wh.id)}
                                            onChange={(e) => {
                                                if (e.target.checked) setSelectedWarehouses([...selectedWarehouses, wh.id]);
                                                else setSelectedWarehouses(selectedWarehouses.filter(id => id !== wh.id));
                                            }}
                                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span className="text-sm font-bold text-gray-600 group-hover:text-gray-900">{wh.name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Algorithm Parameters */}
                        <div className="md:col-span-2 grid grid-cols-2 gap-4 bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100/50">
                            <div>
                                <label className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter block mb-2">Ventana de Análisis (Días)</label>
                                <div className="flex items-center gap-3">
                                    <TrendingUp size={18} className="text-indigo-400" />
                                    <input
                                        type="number"
                                        value={daysLookback}
                                        onChange={(e) => setDaysLookback(parseInt(e.target.value) || 0)}
                                        className="w-full p-2 bg-white border border-indigo-100 rounded-lg font-bold text-indigo-900 outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter block mb-2">Factor de Seguridad (%)</label>
                                <div className="flex items-center gap-3">
                                    <Settings2 size={18} className="text-indigo-400" />
                                    <input
                                        type="number"
                                        value={safetyFactor}
                                        onChange={(e) => setSafetyFactor(parseInt(e.target.value) || 0)}
                                        className="w-full p-2 bg-white border border-indigo-100 rounded-lg font-bold text-indigo-900 outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter block mb-2">Cobertura Mínima (Días)</label>
                                <input
                                    type="number"
                                    value={minCoverageDays}
                                    onChange={(e) => setMinCoverageDays(parseInt(e.target.value) || 0)}
                                    className="w-full p-2 bg-white border border-indigo-100 rounded-lg font-bold text-indigo-900 outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter block mb-2">Cobertura Máxima (Días)</label>
                                <input
                                    type="number"
                                    value={maxCoverageDays}
                                    onChange={(e) => setMaxCoverageDays(parseInt(e.target.value) || 0)}
                                    className="w-full p-2 bg-white border border-indigo-100 rounded-lg font-bold text-indigo-900 outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                            <div className="col-span-2 mt-2">
                                <label className="flex items-center gap-2 cursor-pointer group">
                                    <input
                                        type="checkbox"
                                        checked={includeNoMovement}
                                        onChange={(e) => setIncludeNoMovement(e.target.checked)}
                                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span className="text-xs font-bold text-gray-500 group-hover:text-indigo-600 transition-colors">Incluir artículos sin rotación</span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 pt-6 border-t border-gray-100 flex justify-end gap-3">
                        <button
                            onClick={handleCalculate}
                            disabled={isCalculating}
                            className="px-6 py-2 bg-indigo-600 text-white font-black text-xs uppercase tracking-widest rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isCalculating ? <RefreshCcw size={16} className="animate-spin" /> : <Calculator size={16} />}
                            {isCalculating ? 'Calculando...' : 'Calcular Sugerencias'}
                        </button>
                    </div>
                </div>
            )}

            {/* Smart Decision Grid Placeholder */}
            <div className="flex-1 min-h-[500px] flex-shrink-0 bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden flex flex-col mb-6">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                    <div className="flex items-center gap-4 flex-1 max-w-md relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar en resultados..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                        />
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleApplyChanges}
                            disabled={isCalculating || results.length === 0}
                            className="px-4 py-2 bg-gray-800 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-black transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Save size={16} /> Aplicar Cambios
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-gray-50/90 backdrop-blur-md z-10">
                            <tr className="border-b border-gray-100">
                                <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-tighter">Producto</th>
                                <th className="p-4 text-[10px] font-black text-gray-400 uppercase tracking-tighter">Variant</th>
                                <th className="p-4 text-center text-[10px] font-black text-gray-400 uppercase tracking-tighter">Almacén</th>
                                <th className="p-4 text-center text-[10px] font-black text-gray-400 uppercase tracking-tighter">
                                    <div className="flex items-center justify-center gap-1 group/hint relative cursor-help">
                                        VMD (BI) <Info size={12} className="text-gray-300" />
                                        <div className="absolute top-full mt-2 hidden group-hover/hint:block w-48 p-2 bg-gray-800 text-white text-[9px] font-bold rounded-lg shadow-xl z-20 normal-case tracking-normal">
                                            Venta Media Diaria: Promedio de unidades vendidas por día en el periodo seleccionado.
                                            <br /><br />
                                            <span className="text-indigo-300">VMD = Ventas / Días Análisis</span>
                                        </div>
                                    </div>
                                </th>
                                <th className="p-4 text-center text-[10px] font-black text-gray-400 uppercase tracking-tighter">Stock Act.</th>
                                <th className="p-4 text-center text-[10px] font-black text-gray-400 uppercase tracking-tighter">Actual (Mín/Máx)</th>
                                <th className="p-4 text-center text-[10px] font-black text-gray-400 uppercase tracking-tighter">
                                    <div className="flex items-center justify-center gap-1 group/hint relative cursor-help">
                                        Sugerencia BI <Info size={12} className="text-gray-300" />
                                        <div className="absolute top-full mt-2 hidden group-hover/hint:block w-48 p-2 bg-gray-800 text-white text-[9px] font-bold rounded-lg shadow-xl z-20 normal-case tracking-normal">
                                            Fórmula: (VMD × Días Cobertura) × (1 + Factor Seguridad)
                                        </div>
                                    </div>
                                </th>
                                <th className="p-4 text-center text-[10px] font-black text-gray-400 uppercase tracking-tighter">Ajuste Manual</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {results.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="p-20 text-center text-gray-400 italic">
                                        Configure los filtros y presione "Calcular Sugerencias" para ver los datos.
                                    </td>
                                </tr>
                            ) : (
                                results.map((res, idx) => (
                                    <tr key={`${res.productId}-${res.warehouseId}`} className="hover:bg-gray-50/50 transition-colors group">
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden border border-gray-200">
                                                    {res.productImage ? <img src={res.productImage} className="w-full h-full object-cover" /> : <Package className="m-2 text-gray-300" />}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-gray-800 text-sm">{res.productName}</p>
                                                    <p className="text-[10px] text-gray-400 font-mono">{res.barcode}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-xs text-gray-400">---</td>
                                        <td className="p-4 text-center">
                                            <span className="text-[10px] font-black bg-gray-100 text-gray-600 px-2 py-1 rounded-full uppercase">{res.warehouseName}</span>
                                        </td>
                                        <td className="p-4 text-center">
                                            <p className="font-mono font-bold text-indigo-600">{res.vmd.toFixed(2)}</p>
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex flex-col items-center">
                                                <span className={`font-mono font-bold ${res.isOverstock ? 'text-red-600' : res.isStockoutRisk ? 'text-amber-600' : 'text-gray-700'}`}>
                                                    {res.currentStock}
                                                </span>
                                                <span className="text-[9px] text-gray-400 mt-1 whitespace-nowrap">
                                                    Rec: {res.estStockoutDays} {typeof res.estStockoutDays === 'number' ? 'días' : ''}
                                                    {res.isStockoutRisk && <AlertCircle size={10} className="inline ml-1 text-amber-500" />}
                                                    {res.isOverstock && <AlertTriangle size={10} className="inline ml-1 text-red-500" />}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className="text-[10px] font-bold text-gray-400">{res.currentMin} / {res.currentMax}</span>
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <span className="px-2 py-1 bg-green-50 text-green-700 rounded-lg text-xs font-black border border-green-100">
                                                    {res.suggestedMin}
                                                </span>
                                                <span className="text-gray-300">/</span>
                                                <span className="px-2 py-1 bg-green-50 text-green-700 rounded-lg text-xs font-black border border-green-100">
                                                    {res.suggestedMax}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center justify-center gap-2">
                                                <input
                                                    type="number"
                                                    value={res.manualMin}
                                                    onChange={(e) => {
                                                        const val = parseInt(e.target.value) || 0;
                                                        setResults(prev => prev.map((r, i) => i === idx ? { ...r, manualMin: val } : r));
                                                    }}
                                                    className="w-16 p-1 bg-white border border-gray-200 rounded text-center text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                                                />
                                                <input
                                                    type="number"
                                                    value={res.manualMax}
                                                    onChange={(e) => {
                                                        const val = parseInt(e.target.value) || 0;
                                                        setResults(prev => prev.map((r, i) => i === idx ? { ...r, manualMax: val } : r));
                                                    }}
                                                    className="w-16 p-1 bg-white border border-gray-200 rounded text-center text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
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

export default InventoryOptimizer;
