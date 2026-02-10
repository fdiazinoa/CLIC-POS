import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, AlertTriangle, Calculator, Package, ChefHat, Search, Info } from 'lucide-react';
import { Product, RecipeDetail, ProductType } from '../types';

const formatCurrency = (amount: number, symbol: string = '$'): string => {
    return new Intl.NumberFormat('es-DO', {
        style: 'currency',
        currency: 'DOP',
        minimumFractionDigits: 2
    }).format(amount).replace('DOP', symbol).trim();
};

interface RecipeManagerProps {
    product: Product;
    allProducts: Product[]; // For ingredient search
    onUpdate: (updates: Partial<Product>) => void;
    currencySymbol: string;
}

const RecipeManager: React.FC<RecipeManagerProps> = ({ product, allProducts, onUpdate, currencySymbol }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<Product[]>([]);

    // Local state for recursive cost preview, could be fetched from backend for deep trees
    // asking backend to calc cost is better, but for UI responsiveness we do basic calc here

    const recipeType = product.type === 'KIT' ? 'KIT' : 'RECETA';

    useEffect(() => {
        if (searchTerm.length > 1) {
            const results = allProducts.filter(p =>
                p.id !== product.id && // Prevent circular dependency (simple check)
                p.name.toLowerCase().includes(searchTerm.toLowerCase())
            ).slice(0, 5);
            setSearchResults(results);
        } else {
            setSearchResults([]);
        }
    }, [searchTerm, allProducts, product.id]);

    const handleAddIngredient = (ingredient: Product) => {
        const newDetail: RecipeDetail = {
            id: crypto.randomUUID(), // Temp ID
            parentItemId: product.id,
            childItemId: ingredient.id,
            childItemName: ingredient.name,
            quantity: 1,
            unit: ingredient.attributes?.find(a => a.name === 'Unidad')?.options[0] || 'un',
            wasteFactor: 0,
            isOptional: false,
            cost: ingredient.cost || 0
        };

        const currentDetails = product.recipeDetails || [];
        onUpdate({ recipeDetails: [...currentDetails, newDetail] });
        setSearchTerm('');
    };

    const handleRemoveIngredient = (id: string) => {
        const currentDetails = product.recipeDetails || [];
        onUpdate({ recipeDetails: currentDetails.filter(d => d.id !== id) });
    };

    const handleUpdateDetail = (id: string, field: keyof RecipeDetail, value: any) => {
        const currentDetails = product.recipeDetails || [];
        onUpdate({
            recipeDetails: currentDetails.map(d =>
                d.id === id ? { ...d, [field]: value } : d
            )
        });
    };

    // Calculations
    const totalIngredientsCost = useMemo(() => {
        return (product.recipeDetails || []).reduce((sum, detail) => {
            const ing = allProducts.find(p => p.id === detail.childItemId);
            const baseCost = ing?.cost || 0;

            let waste = parseFloat(detail.wasteFactor.toString());
            if (isNaN(waste) || waste >= 1) waste = 0;

            const realCost = (baseCost * detail.quantity) / (1 - waste);
            return sum + realCost;
        }, 0);
    }, [product.recipeDetails, allProducts]);

    const batchYield = product.batchYield || 1;
    const unitCost = totalIngredientsCost / batchYield;

    const foodCostPct = product.price > 0 ? (unitCost / product.price) * 100 : 0;

    // Sync cost to parent product theoretical cost
    useEffect(() => {
        if (Math.abs((product.theoreticalCost || 0) - unitCost) > 0.01) {
            onUpdate({ theoreticalCost: unitCost });
        }
    }, [unitCost]);

    return (
        <div className="space-y-6 animate-in fade-in">
            {/* Header / Type Selector */}
            <div className="flex flex-col md:flex-row gap-6 p-6 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex-1">
                    <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                        {recipeType === 'RECETA' ? <ChefHat size={20} className="text-orange-500" /> : <Package size={20} className="text-blue-500" />}
                        Composición del Producto
                    </h3>
                    <p className="text-sm text-slate-500 mt-1">
                        {recipeType === 'RECETA'
                            ? "Define los ingredientes y mermas para calcular el costo de producción."
                            : "Agrupa productos para venderlos como un combo (Kit / Bundle)."}
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    {/* BATCH YIELD INPUT */}
                    {recipeType === 'RECETA' && (
                        <div className="bg-white p-2 rounded-xl border border-orange-200 flex flex-col items-center min-w-[100px]">
                            <label className="text-[10px] font-black text-orange-400 uppercase tracking-wide mb-1">Rendimiento</label>
                            <div className="flex items-baseline gap-1">
                                <input
                                    type="number"
                                    min="1"
                                    value={product.batchYield || 1}
                                    onChange={(e) => onUpdate({ batchYield: parseFloat(e.target.value) || 1 })}
                                    className="w-12 text-center font-black text-lg text-slate-800 outline-none border-b border-transparent focus:border-orange-300"
                                />
                                <span className="text-[10px] font-bold text-slate-400">unids.</span>
                            </div>
                        </div>
                    )}

                    <div className="flex bg-white p-1 rounded-xl border border-slate-200 h-fit">
                        <button
                            onClick={() => onUpdate({ type: 'RECETA' })}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${product.type === 'RECETA' ? 'bg-orange-100 text-orange-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            <ChefHat size={16} /> Receta
                        </button>
                        <button
                            onClick={() => onUpdate({ type: 'KIT' })}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${product.type === 'KIT' ? 'bg-blue-100 text-blue-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            <Package size={16} /> Kit
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-8">
                {/* Left: Ingredients List */}
                <div className="flex-1 space-y-4">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar ingrediente o producto..."
                            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-700 focus:ring-2 focus:ring-blue-100 outline-none"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        {searchResults.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden">
                                {searchResults.map(res => (
                                    <button
                                        key={res.id}
                                        onClick={() => handleAddIngredient(res)}
                                        className="w-full text-left px-4 py-3 hover:bg-slate-50 flex justify-between items-center group border-b border-slate-100 last:border-0"
                                    >
                                        <div>
                                            <div className="font-bold text-slate-700">{res.name}</div>
                                            <div className="text-xs text-slate-400">Costo: {formatCurrency(res.cost || 0, currencySymbol)}</div>
                                        </div>
                                        <Plus size={18} className="text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* List */}
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50 text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">
                                <tr>
                                    <th className="px-4 py-3">Ingrediente</th>
                                    <th className="px-4 py-3 text-center">Cant.</th>
                                    {recipeType === 'RECETA' && <th className="px-4 py-3 text-center">Merma %</th>}
                                    <th className="px-4 py-3 text-right">Costo Est.</th>
                                    <th className="px-4 py-3 w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {(product.recipeDetails || []).map((detail, idx) => {
                                    const ing = allProducts.find(p => p.id === detail.childItemId);
                                    const baseCost = ing?.cost || 0;
                                    let waste = detail.wasteFactor || 0;
                                    const realCost = (baseCost * detail.quantity) / (1 - waste);

                                    return (
                                        <tr key={detail.id || idx} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="font-bold text-slate-700 text-sm">{detail.childItemName || ing?.name || '---'}</div>
                                                <div className="text-[10px] text-slate-400">{formatCurrency(baseCost, currencySymbol)} / unidad</div>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.001"
                                                    value={detail.quantity}
                                                    onChange={(e) => handleUpdateDetail(detail.id, 'quantity', parseFloat(e.target.value))}
                                                    className="w-20 text-center font-bold bg-slate-100 rounded-lg py-1 text-sm border-transparent focus:bg-white focus:border-blue-300 outline-none border transition-all"
                                                />
                                                <span className="text-xs text-slate-400 ml-1">{detail.unit}</span>
                                            </td>
                                            {recipeType === 'RECETA' && (
                                                <td className="px-4 py-3 text-center">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="99"
                                                        value={(detail.wasteFactor * 100).toFixed(0)}
                                                        onChange={(e) => handleUpdateDetail(detail.id, 'wasteFactor', parseFloat(e.target.value) / 100)}
                                                        className="w-16 text-center font-bold bg-slate-100 rounded-lg py-1 text-sm border-transparent focus:bg-white focus:border-blue-300 outline-none border transition-all"
                                                    />
                                                    <span className="text-xs text-slate-400 ml-1">%</span>
                                                </td>
                                            )}
                                            <td className="px-4 py-3 text-right text-sm font-mono text-slate-600">
                                                {formatCurrency(realCost, currencySymbol)}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <button
                                                    onClick={() => handleRemoveIngredient(detail.id)}
                                                    className="p-2 text-slate-300 hover:text-red-500 transition-colors rounded-full hover:bg-red-50"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {(product.recipeDetails?.length === 0) && (
                                    <tr>
                                        <td colSpan={5} className="p-8 text-center text-slate-400 italic text-sm">
                                            Agrega ingredientes usando el buscador superior.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Right: Cost Summary */}
                <div className="lg:w-80 shrink-0 space-y-6">
                    <div className="bg-slate-900 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">

                        {/* Dynamic color warning bg */}
                        {foodCostPct > 35 && (
                            <div className="absolute top-0 right-0 w-32 h-32 bg-red-500 rounded-full blur-[60px] opacity-20 pointer-events-none"></div>
                        )}

                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Calculator size={14} /> Análisis de Costo
                        </h4>

                        <div className="space-y-4 mb-6">
                            <div className="flex justify-between items-end border-b border-slate-700 pb-2">
                                <span className="text-slate-400 text-sm">Costo Ingredientes</span>
                                <span className="text-lg font-bold text-slate-300">{formatCurrency(totalIngredientsCost, currencySymbol)}</span>
                            </div>
                            {batchYield > 1 && (
                                <div className="flex justify-between items-end border-b border-slate-700 pb-2">
                                    <span className="text-orange-400 text-sm">Yield Divider</span>
                                    <span className="text-sm font-bold text-orange-400">÷ {batchYield}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-end border-b border-slate-700 pb-2">
                                <span className="text-slate-100 text-sm font-bold">Costo Unitario</span>
                                <span className="text-2xl font-black">{formatCurrency(unitCost, currencySymbol)}</span>
                            </div>
                            <div className="flex justify-between items-end pb-2">
                                <span className="text-slate-400 text-sm">Precio Venta</span>
                                <span className="text-xl font-bold text-slate-300">{formatCurrency(product.price, currencySymbol)}</span>
                            </div>
                        </div>

                        <div className={`p-4 rounded-xl border flex items-center justify-between ${foodCostPct > 35
                            ? 'bg-red-500/10 border-red-500/30 text-red-400'
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            }`}>
                            <div>
                                <div className="text-xs font-bold uppercase mb-0.5">Food Cost</div>
                                <div className="text-2xl font-black">{foodCostPct.toFixed(1)}%</div>
                            </div>
                            {foodCostPct > 35 && <AlertTriangle size={24} />}
                        </div>

                        {foodCostPct > 35 && (
                            <p className="text-[10px] text-red-300 mt-3 leading-relaxed">
                                ⚠️ El costo supera el 35% del precio de venta. Considera ajustar la receta o subir el precio.
                            </p>
                        )}
                    </div>

                    <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                        <h5 className="font-bold text-blue-800 text-sm mb-2 flex items-center gap-2">
                            <Info size={16} /> Nota
                        </h5>
                        <p className="text-xs text-blue-600 leading-relaxed">
                            Al realizar una venta de este porducto, el inventario se descontará automáticamente de los ingredientes listados aquí.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RecipeManager;
