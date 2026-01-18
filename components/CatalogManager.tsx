
import React, { useState, useMemo } from 'react';
import { 
  Package, Search, Plus, Edit2, Trash2, ArrowLeft, 
  Filter, Tag, Image as ImageIcon, DollarSign,
  Calendar, CheckCircle2, XCircle, Layers, ClipboardList,
  ChevronDown, ChevronRight, Box, AlertCircle, MapPin, Grid, Sun,
  CheckSquare, Square, MoreHorizontal, Settings2, Activity
} from 'lucide-react';
import { Product, BusinessConfig, Tariff, Transaction, ProductVariant, Warehouse, ProductGroup, Season, Watchlist } from '../types';
import ProductForm from './ProductForm';
import TariffForm from './TariffForm';
import VariantManager from './VariantManager';
import GroupForm from './GroupForm';
import SeasonForm from './SeasonForm';
import BulkEditModal from './BulkEditModal';
import WatchlistMonitor from './WatchlistMonitor';
import { db } from '../utils/db';

interface CatalogManagerProps {
  products: Product[];
  config: BusinessConfig;
  warehouses: Warehouse[];
  transactions: Transaction[];
  onUpdateProducts: (products: Product[]) => void;
  onUpdateConfig: (config: BusinessConfig) => void;
  onClose: () => void;
}

type ViewMode = 'PRODUCTS' | 'TARIFFS' | 'VARIANTS' | 'STOCKS' | 'GROUPS' | 'SEASONS' | 'BI_MONITOR';

// --- SUB-COMPONENT: STOCK ROW ---
const StockRow: React.FC<{ product: Product; warehouseId: string }> = ({ product, warehouseId }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasVariants = product.variants && product.variants.length > 0;
  const warehouseStock = product.stockBalances?.[warehouseId] || 0;

  const getStatusBadge = (qty: number) => {
    if (qty > 10) return <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full"><CheckCircle2 size={12} /> Disponible</span>;
    if (qty > 0) return <span className="inline-flex items-center gap-1 text-xs font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-full"><AlertCircle size={12} /> Bajo Stock</span>;
    return <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-full"><XCircle size={12} /> Agotado</span>;
  };

  const toggleExpand = () => {
    if (hasVariants) setIsExpanded(!isExpanded);
  };

  return (
    <>
      <tr 
        onClick={toggleExpand}
        className={`group border-b border-gray-100 transition-colors ${hasVariants ? 'cursor-pointer hover:bg-gray-50' : ''}`}
      >
        <td className="p-4">
          <div className="flex items-center gap-3">
            <div className={`w-6 flex justify-center text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-90 text-blue-500' : ''}`}>
               {hasVariants && <ChevronRight size={18} />}
            </div>
            
            <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden border border-gray-200 shrink-0 relative">
               {product.image ? <img src={product.image} className="w-full h-full object-cover" /> : <ImageIcon className="m-2 text-gray-300" />}
               {hasVariants && (
                 <div className="absolute bottom-0 right-0 bg-blue-500 text-white p-0.5 rounded-tl-md">
                   <Layers size={8} />
                 </div>
               )}
            </div>
            <div>
               <p className="font-bold text-gray-800 text-sm line-clamp-1">{product.name}</p>
               <p className="text-xs text-gray-400 font-mono">{product.barcode || '---'}</p>
            </div>
          </div>
        </td>
        <td className="p-4">
           {hasVariants ? (
              <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100">
                 {product.variants.length} Variantes
              </span>
           ) : (
              <span className="text-xs text-gray-400 italic">N/A</span>
           )}
        </td>
        <td className="p-4 text-center font-mono font-bold text-gray-700 text-sm">
           {warehouseStock}
        </td>
        <td className="p-4 text-right">
           {getStatusBadge(warehouseStock)}
        </td>
      </tr>
      {hasVariants && isExpanded && product.variants.map((variant, idx) => (
            <tr key={`${product.id}-var-${idx}`} className="bg-slate-50/80 border-b border-gray-100 animate-in slide-in-from-top-1">
               <td className="p-3 pl-16">
                  <div className="flex items-center gap-2 relative">
                     <div className="absolute -left-6 top-1/2 w-4 h-px bg-gray-300"></div>
                     <div className="absolute -left-6 -top-1/2 bottom-1/2 w-px bg-gray-300"></div>
                     <span className="font-mono text-xs text-gray-500 bg-white px-1.5 py-0.5 rounded border border-gray-200">
                        {variant.sku}
                     </span>
                  </div>
               </td>
               <td className="p-3">
                  <div className="flex gap-1 flex-wrap">
                     {Object.entries(variant.attributeValues).map(([k, v]) => (
                        <span key={k} className="text-xs text-gray-600">
                           <span className="font-bold text-gray-400">{k}:</span> {v}
                        </span>
                     ))}
                  </div>
               </td>
               <td className="p-3 text-center text-sm font-medium text-gray-600">-</td>
               <td className="p-3 text-right">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-gray-500 bg-gray-200`}>Ver Global</span>
               </td>
            </tr>
      ))}
    </>
  );
};

// --- WAREHOUSE CARD CONTAINER ---
const WarehouseStockCard: React.FC<{ warehouse: Warehouse; filteredProducts: Product[] }> = ({ warehouse, filteredProducts }) => {
  const [isCardExpanded, setIsCardExpanded] = useState(false);
  const warehouseProducts = filteredProducts.filter(p => p.activeInWarehouses?.includes(warehouse.id));
  const totalValue = warehouseProducts.reduce((acc, p) => acc + ((p.stockBalances?.[warehouse.id] || 0) * (p.cost || 0)), 0);
  const itemCount = warehouseProducts.length;

  return (
    <div className={`bg-white rounded-2xl border transition-all overflow-hidden ${isCardExpanded ? 'shadow-lg border-emerald-300 ring-1 ring-emerald-100' : 'shadow-sm border-gray-200 hover:border-emerald-200'} ${!warehouse.allowPosSale ? 'opacity-70 border-dashed bg-gray-50' : ''}`}>
       <div className="p-6 flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
          <div className="flex items-center gap-4">
             <div className={`p-4 rounded-2xl ${warehouse.allowPosSale ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-200 text-gray-400'}`}>
                <Box size={24} />
             </div>
             <div>
                <div className="flex items-center gap-2">
                   <h3 className="font-bold text-lg text-gray-800">{warehouse.name}</h3>
                   {!warehouse.allowPosSale && <span className="text-[10px] font-bold bg-gray-200 text-gray-500 px-2 py-0.5 rounded">VENTA DESACTIVADA</span>}
                </div>
                <p className="text-sm text-gray-500 flex items-center gap-1 mt-1"><MapPin size={12} /> {warehouse.address}</p>
             </div>
          </div>
          <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-end">
             <div className="text-right">
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Valorizado</p>
                <p className="text-lg font-black text-gray-800">${totalValue.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
             </div>
             <div className="text-right">
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Artículos</p>
                <p className="text-lg font-black text-gray-800">{itemCount}</p>
             </div>
             <button onClick={() => setIsCardExpanded(!isCardExpanded)} className={`p-2 rounded-full border transition-colors ${isCardExpanded ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'}`}>
                <ChevronDown size={20} className={isCardExpanded ? 'rotate-180 transition-transform' : ''} />
             </button>
          </div>
       </div>
       {isCardExpanded && (
          <div className="border-t border-gray-100 bg-gray-50/30 p-6 animate-in slide-in-from-top-2 duration-200">
             <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <table className="w-full text-left text-sm">
                   <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-bold text-xs uppercase">
                      <tr><th className="p-4 w-[40%]">Artículo</th><th className="p-4">Variante / Atributo</th><th className="p-4 text-center">Stock Físico</th><th className="p-4 text-right">Estado</th></tr>
                   </thead>
                   <tbody className="divide-y divide-gray-100">
                      {warehouseProducts.map(product => <StockRow key={product.id} product={product} warehouseId={warehouse.id} />)}
                   </tbody>
                </table>
             </div>
          </div>
       )}
    </div>
  );
};

// --- MAIN CATALOG COMPONENT ---
const CatalogManager: React.FC<CatalogManagerProps> = ({ 
  products, config, warehouses, transactions, onUpdateProducts, onUpdateConfig, onClose 
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('PRODUCTS');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [editingProduct, setEditingProduct] = useState<Product | null | 'NEW'>(null);
  
  // SELECTION & BULK STATE
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);

  // Watchlists State
  const [watchlists, setWatchlists] = useState<Watchlist[]>(() => db.get('watchlists') || []);

  const tariffs = config.tariffs || [];
  const [editingTariff, setEditingTariff] = useState<Tariff | null | 'NEW'>(null);
  const [editingGroup, setEditingGroup] = useState<ProductGroup | null | 'NEW'>(null);
  const [editingSeason, setEditingSeason] = useState<Season | null | 'NEW'>(null);

  const categories = useMemo(() => ['ALL', ...Array.from(new Set(products.map(p => p.category)))], [products]);
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.barcode?.includes(searchTerm);
      const matchesCategory = categoryFilter === 'ALL' || p.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, categoryFilter]);

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleAllSelection = () => {
    if (selectedIds.size === filteredProducts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProducts.map(p => p.id)));
    }
  };

  const handleBulkUpdate = (changes: any) => {
    setShowBulkModal(false);

    const updatedProducts = products.map(p => {
      if (!selectedIds.has(p.id)) return p;
      let newP = { ...p };
      
      if (changes.warehouseActions) {
        let currentActive = new Set(p.activeInWarehouses || []);
        Object.entries(changes.warehouseActions).forEach(([whId, action]) => {
          if (action === 'ENABLE') currentActive.add(whId);
          if (action === 'DISABLE') currentActive.delete(whId);
        });
        newP.activeInWarehouses = Array.from(currentActive);
      }

      if (changes.flags) {
        const newFlags = { ...(p.operationalFlags || {}) };
        Object.entries(changes.flags).forEach(([key, cfg]: [string, any]) => {
          if (cfg.apply) (newFlags as any)[key] = cfg.value;
        });
        newP.operationalFlags = newFlags as any;
      }

      if (changes.classification?.categoryId) newP.category = changes.classification.categoryId;

      return newP;
    });

    onUpdateProducts(updatedProducts);
    setSelectedIds(new Set());
    
    setTimeout(() => {
        alert("Operación masiva completada con éxito.");
    }, 200);
  };

  const handleUpdateWatchlists = (newLists: Watchlist[]) => {
    setWatchlists(newLists);
    db.save('watchlists', newLists);
  };

  if (viewMode === 'VARIANTS') return <VariantManager onClose={() => setViewMode('PRODUCTS')} />;
  if (editingProduct) return <ProductForm initialData={editingProduct === 'NEW' ? null : editingProduct} config={config} warehouses={warehouses} availableTariffs={tariffs} hasHistory={transactions.some(t => t.items.some(item => item.id === (editingProduct as any).id))} onSave={handleSaveProduct} onClose={() => setEditingProduct(null)} />;
  if (editingTariff) return <TariffForm initialData={editingTariff === 'NEW' ? null : editingTariff} products={products} config={config} availableTariffs={tariffs} onSave={handleSaveTariff} onClose={() => setEditingTariff(null)} />;
  if (editingGroup) return <GroupForm initialData={editingGroup === 'NEW' ? null : editingGroup} products={products} onSave={handleSaveGroup} onClose={() => setEditingGroup(null)} />;
  if (editingSeason) return <SeasonForm initialData={editingSeason === 'NEW' ? null : editingSeason} products={products} onSave={handleSaveSeason} onClose={() => setEditingSeason(null)} />;

  function handleSaveProduct(savedProduct: Product) {
    const exists = products.some(p => p.id === savedProduct.id);
    onUpdateProducts(exists ? products.map(p => p.id === savedProduct.id ? savedProduct : p) : [...products, savedProduct]);
    setEditingProduct(null);
  }

  function handleSaveTariff(savedTariff: Tariff) {
    const exists = tariffs.some(t => t.id === savedTariff.id);
    onUpdateConfig({ ...config, tariffs: exists ? tariffs.map(t => t.id === savedTariff.id ? savedTariff : t) : [...tariffs, savedTariff] });
    setEditingTariff(null);
  }

  function handleSaveGroup(savedGroup: ProductGroup) {
    const currentGroups = config.productGroups || [];
    const exists = currentGroups.some(g => g.id === savedGroup.id);
    onUpdateConfig({ ...config, productGroups: exists ? currentGroups.map(g => g.id === savedGroup.id ? savedGroup : g) : [...currentGroups, savedGroup] });
    setEditingGroup(null);
  }

  function handleSaveSeason(savedSeason: Season) {
    const currentSeasons = config.seasons || [];
    const exists = currentSeasons.some(s => s.id === savedSeason.id);
    onUpdateConfig({ ...config, seasons: exists ? currentSeasons.map(s => s.id === savedSeason.id ? savedSeason : s) : [...currentSeasons, savedSeason] });
    setEditingSeason(null);
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300 relative">
      
      {/* BULK ACTION BAR */}
      {selectedIds.size > 0 && viewMode === 'PRODUCTS' && (
         <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300">
            <div className="bg-slate-900 text-white px-8 py-4 rounded-[2rem] shadow-2xl flex items-center gap-8 border border-slate-700 backdrop-blur-md bg-opacity-90">
               <div className="flex items-center gap-3 border-r border-slate-700 pr-8">
                  <div className="bg-blue-600 px-3 py-1 rounded-full text-xs font-black">{selectedIds.size}</div>
                  <span className="text-sm font-bold uppercase tracking-widest text-slate-300">Seleccionados</span>
               </div>
               <div className="flex gap-4">
                  <button 
                     onClick={() => setShowBulkModal(true)}
                     className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center gap-2"
                  >
                     <Settings2 size={16} /> Editar Propiedades
                  </button>
                  <button 
                     onClick={() => setSelectedIds(new Set())}
                     className="px-4 py-2 hover:bg-white/10 rounded-xl font-bold text-xs uppercase tracking-wider text-slate-400 transition-all"
                  >
                     Cancelar
                  </button>
               </div>
            </div>
         </div>
      )}

      {/* Header & Tabs */}
      <div className="bg-white px-8 pt-6 pb-0 border-b border-gray-200 flex justify-between items-start shrink-0">
        <div className="flex flex-col gap-4 w-full">
           <div className="flex justify-between items-center w-full">
              <div className="flex items-center gap-4">
                 <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"><ArrowLeft size={24} /></button>
                 <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2"><Package className="text-blue-600" /> Gestión de Catálogo</h1>
              </div>
              <button onClick={() => { if (viewMode === 'PRODUCTS') setEditingProduct('NEW'); else if (viewMode === 'TARIFFS') setEditingTariff('NEW'); else if (viewMode === 'GROUPS') setEditingGroup('NEW'); else if (viewMode === 'SEASONS') setEditingSeason('NEW'); }} className={`px-6 py-3 text-white rounded-xl font-bold shadow-lg hover:brightness-110 active:scale-95 transition-all flex items-center gap-2 ${['STOCKS', 'BI_MONITOR'].includes(viewMode) ? 'opacity-0 pointer-events-none' : 'bg-blue-600'}`}><Plus size={20} /> {viewMode === 'GROUPS' ? 'Nuevo Grupo' : viewMode === 'TARIFFS' ? 'Nueva Tarifa' : viewMode === 'SEASONS' ? 'Nueva Temporada' : 'Nuevo Artículo'}</button>
           </div>
           <div className="flex gap-8 mt-2 overflow-x-auto no-scrollbar">
              <button onClick={() => setViewMode('PRODUCTS')} className={`pb-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap ${viewMode === 'PRODUCTS' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}><Package size={18} /> Productos</button>
              <button onClick={() => setViewMode('BI_MONITOR')} className={`pb-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap ${viewMode === 'BI_MONITOR' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-400'}`}><Activity size={18} /> Monitor BI</button>
              <button onClick={() => setViewMode('VARIANTS')} className={`pb-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap border-transparent text-gray-400`}><Layers size={18} /> Variantes y Atributos</button>
              <button onClick={() => setViewMode('GROUPS')} className={`pb-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap ${viewMode === 'GROUPS' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400'}`}><Grid size={18} /> Grupos</button>
              <button onClick={() => setViewMode('SEASONS')} className={`pb-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap ${viewMode === 'SEASONS' ? 'border-yellow-500 text-yellow-600' : 'border-transparent text-gray-400'}`}><Sun size={18} /> Temporadas</button>
              <button onClick={() => setViewMode('STOCKS')} className={`pb-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap ${viewMode === 'STOCKS' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-400'}`}><ClipboardList size={18} /> Stocks</button>
              <button onClick={() => setViewMode('TARIFFS')} className={`pb-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap ${viewMode === 'TARIFFS' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-400'}`}><Tag size={18} /> Tarifas</button>
           </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col w-full">
         {viewMode === 'PRODUCTS' && (
            <div className="p-8 max-w-7xl mx-auto w-full flex-1 flex flex-col overflow-hidden">
               <div className="flex gap-4 mb-6">
                  <div 
                    onClick={toggleAllSelection}
                    className={`shrink-0 p-3 rounded-xl border-2 cursor-pointer transition-all flex items-center justify-center ${selectedIds.size === filteredProducts.length && filteredProducts.length > 0 ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white border-gray-200 text-gray-400 hover:border-blue-300'}`}
                  >
                    {selectedIds.size === filteredProducts.length && filteredProducts.length > 0 ? <CheckSquare size={24} strokeWidth={3} /> : <Square size={24} />}
                  </div>
                  <div className="flex-1 relative">
                     <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                     <input type="text" placeholder="Buscar productos..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" />
                  </div>
                  <div className="relative min-w-[200px]">
                     <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-full h-full pl-4 pr-8 bg-white border border-gray-200 rounded-xl outline-none font-medium text-gray-700 shadow-sm">
                        {categories.map(c => <option key={c} value={c}>{c === 'ALL' ? 'Todas las Categorías' : c}</option>)}
                     </select>
                     <Filter className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  </div>
               </div>

               <div className="flex-1 overflow-y-auto">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-32">
                     {filteredProducts.map(product => {
                        const isSelected = selectedIds.has(product.id);
                        return (
                          <div 
                            key={product.id} 
                            onClick={() => selectedIds.size > 0 && toggleSelection(product.id)}
                            className={`bg-white rounded-2xl p-4 shadow-sm border-2 transition-all group flex flex-col h-[280px] relative ${isSelected ? 'border-blue-500 ring-4 ring-blue-50' : 'border-gray-200 hover:shadow-md hover:border-blue-300'}`}
                          >
                             <button 
                               onClick={(e) => { e.stopPropagation(); toggleSelection(product.id); }}
                               className={`absolute top-2 left-2 z-10 p-1.5 rounded-lg transition-all ${isSelected ? 'bg-blue-600 text-white scale-110 shadow-lg' : 'bg-white/90 text-gray-300 opacity-0 group-hover:opacity-100 border border-gray-100'}`}
                             >
                               {isSelected ? <CheckSquare size={16} strokeWidth={3} /> : <Square size={16} />}
                             </button>

                             <div className="h-32 bg-gray-50 rounded-xl mb-4 relative overflow-hidden flex items-center justify-center">
                                {product.image ? <img src={product.image} alt={product.name} className="w-full h-full object-cover" /> : <ImageIcon className="text-gray-300" size={32} />}
                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                   <button onClick={(e) => { e.stopPropagation(); setEditingProduct(product); }} className="p-2 bg-white/90 backdrop-blur rounded-lg shadow-sm hover:text-blue-600"><Edit2 size={16} /></button>
                                </div>
                             </div>
                             <div className="flex-1 flex flex-col">
                                <span className="text-[10px] font-bold uppercase text-blue-600 bg-blue-50 px-2 py-0.5 rounded w-fit mb-1">{product.category}</span>
                                <h3 className="font-bold text-gray-800 leading-tight mb-1 line-clamp-2">{product.name}</h3>
                                <div className="mt-auto pt-3 border-t border-gray-100 flex justify-between items-end">
                                   <span className="text-[10px] text-gray-400 font-mono">{product.barcode || '---'}</span>
                                   <span className="text-lg font-black text-gray-900">{config.currencySymbol}{product.price.toFixed(2)}</span>
                                </div>
                             </div>
                          </div>
                        )
                     })}
                  </div>
               </div>
            </div>
         )}

         {viewMode === 'BI_MONITOR' && (
            <WatchlistMonitor 
               products={products}
               transactions={transactions}
               watchlists={watchlists}
               config={config}
               warehouses={warehouses}
               onUpdateWatchlists={handleUpdateWatchlists}
               onOpenKardex={(p) => setEditingProduct(p)} // Reusar ProductForm para Kardex tab
               onOpenPromo={(p) => { 
                  // Ir a promos (simulado o abrir modal de promo express)
                  alert(`Abriendo diseñador de ofertas para: ${p.name}`);
               }}
            />
         )}

         {viewMode === 'STOCKS' && (
            <div className="p-8 max-w-7xl mx-auto w-full flex-1 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-2">
               <div className="mb-6 flex justify-between items-end">
                  <div><h2 className="text-lg font-bold text-gray-800">Inventario por Almacén</h2><p className="text-sm text-gray-500">Existencias físicas y valorizadas.</p></div>
                  <span className="text-xs bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full font-bold border border-emerald-100 flex items-center gap-1"><CheckCircle2 size={12} /> Tiempo Real</span>
               </div>
               <div className="flex-1 overflow-y-auto pb-20 space-y-4">
                  {warehouses.map(warehouse => <WarehouseStockCard key={warehouse.id} warehouse={warehouse} filteredProducts={filteredProducts} />)}
               </div>
            </div>
         )}

         {viewMode === 'TARIFFS' && <div className="p-8 max-w-7xl mx-auto w-full flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in">{tariffs.map(tariff => (<div key={tariff.id} className="bg-white rounded-3xl p-6 shadow-sm border border-gray-200 hover:shadow-md transition-all relative overflow-hidden group"><div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl ${tariff.active ? 'from-green-50' : 'from-gray-100'} to-transparent rounded-bl-full`}></div><div className="relative z-10"><div className="flex justify-between items-start mb-4"><div className={`p-3 rounded-2xl ${tariff.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}><Tag size={24} /></div><div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => setEditingTariff(tariff)} className="p-2 bg-white border rounded-lg text-gray-500 hover:text-purple-600"><Edit2 size={16} /></button></div></div><h3 className="text-xl font-bold text-gray-800 mb-1">{tariff.name}</h3><div className="flex items-center gap-2 mb-6"><span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${tariff.active ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>{tariff.active ? 'Activa' : 'Inactiva'}</span><span className="text-xs text-gray-400 font-mono uppercase">{tariff.strategy.type}</span></div><div className="space-y-3"><div className="flex items-center gap-3 text-sm text-gray-600"><Calendar size={16} className="text-gray-400" /><span>{tariff.schedule.daysOfWeek.length === 7 ? 'Todos los días' : `${tariff.schedule.daysOfWeek.length} días/sem`}</span></div><div className="flex items-center gap-3 text-sm text-gray-600"><DollarSign size={16} className="text-gray-400" /><span>{tariff.currency} {tariff.strategy.type === 'COST_PLUS' ? `(Margen ${tariff.strategy.factor}%)` : ''}</span></div></div></div></div>))}<button onClick={() => setEditingTariff('NEW')} className="bg-gray-50 rounded-3xl p-6 border-2 border-dashed border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-all flex flex-col items-center justify-center text-gray-400 hover:text-purple-600 gap-4"><div className="p-4 bg-white rounded-full shadow-sm"><Plus size={32} /></div><span className="font-bold">Crear Nueva Lista</span></button></div>}
      </div>

      {showBulkModal && (
        <BulkEditModal 
          config={config} 
          warehouses={warehouses} 
          products={products}
          seasons={config.seasons || []}
          groups={config.productGroups || []}
          selectedCount={selectedIds.size}
          onClose={() => setShowBulkModal(false)} 
          onSave={handleBulkUpdate} 
        />
      )}
    </div>
  );
};

export default CatalogManager;
