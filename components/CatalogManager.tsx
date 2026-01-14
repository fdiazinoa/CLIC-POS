
import React, { useState, useMemo } from 'react';
import { 
  Package, Search, Plus, Edit2, Trash2, ArrowLeft, 
  Filter, Tag, Image as ImageIcon, Barcode, DollarSign,
  Calendar, CheckCircle2, XCircle, Layers, ClipboardList,
  ChevronDown, ChevronRight, Box, AlertCircle, MapPin
} from 'lucide-react';
import { Product, BusinessConfig, Tariff, Transaction, ProductVariant, Warehouse } from '../types';
import ProductForm from './ProductForm';
import TariffForm from './TariffForm';
import VariantManager from './VariantManager';

interface CatalogManagerProps {
  products: Product[];
  config: BusinessConfig;
  warehouses: Warehouse[];
  transactions: Transaction[];
  onUpdateProducts: (products: Product[]) => void;
  onClose: () => void;
}

// Mock Tariffs if not provided
const MOCK_TARIFFS: Tariff[] = [
  { 
    id: 't1', name: 'General (PVP)', active: true, currency: 'DOP', taxIncluded: true, 
    strategy: { type: 'MANUAL', rounding: 'NONE' }, 
    scope: { storeIds: ['ALL'], priority: 0 }, 
    schedule: { daysOfWeek: [0,1,2,3,4,5,6], timeStart: '00:00', timeEnd: '23:59' }, items: {} 
  },
  { 
    id: 't2', name: 'Happy Hour Viernes', active: false, currency: 'DOP', taxIncluded: true, 
    strategy: { type: 'DERIVED', factor: -15, rounding: 'ENDING_99' }, 
    scope: { storeIds: ['ALL'], priority: 10 }, 
    schedule: { daysOfWeek: [5], timeStart: '17:00', timeEnd: '21:00' }, items: {} 
  },
  { 
    id: 't3', name: 'Distribuidor Mayorista', active: true, currency: 'DOP', taxIncluded: false, 
    strategy: { type: 'COST_PLUS', factor: 15, rounding: 'NONE' }, 
    scope: { storeIds: ['ALL'], priority: 5 }, 
    schedule: { daysOfWeek: [0,1,2,3,4,5,6], timeStart: '00:00', timeEnd: '23:59' }, items: {} 
  }
];

// --- SUB-COMPONENT: STOCK ROW (Handles Expansion) ---
const StockRow: React.FC<{ product: Product }> = ({ product }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasVariants = product.variants && product.variants.length > 0;

  // Si tiene variantes, sumamos el stock de todas para el padre
  // Si no, usamos el stock directo del producto
  // Nota: Usamos Math.random() para simular stock variante ya que RETAIL_PRODUCTS mock no tiene stock definido en variantes
  const totalStock = hasVariants 
    ? product.variants.reduce((acc, v) => acc + (v.initialStock || Math.floor(Math.random() * 20)), 0)
    : product.stock || 0;

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
      {/* PARENT ROW */}
      <tr 
        onClick={toggleExpand}
        className={`group border-b border-gray-100 transition-colors ${hasVariants ? 'cursor-pointer hover:bg-gray-50' : ''}`}
      >
        <td className="p-4">
          <div className="flex items-center gap-3">
            {/* Expansion Indicator */}
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
           {totalStock}
        </td>
        <td className="p-4 text-right">
           {getStatusBadge(totalStock)}
        </td>
      </tr>

      {/* CHILD ROWS (VARIANTS) */}
      {hasVariants && isExpanded && product.variants.map((variant, idx) => {
         // Simulating stock for display
         const variantStock = variant.initialStock || Math.floor(Math.random() * 20); 
         
         return (
            <tr key={`${product.id}-var-${idx}`} className="bg-slate-50/80 border-b border-gray-100 animate-in slide-in-from-top-1">
               <td className="p-3 pl-16"> {/* Indented */}
                  <div className="flex items-center gap-2 relative">
                     {/* L-shaped connector line visual (optional, kept simple for now) */}
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
               <td className="p-3 text-center text-sm font-medium text-gray-600">
                  {variantStock}
               </td>
               <td className="p-3 text-right">
                  {/* Smaller badge for children */}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${variantStock > 0 ? 'text-emerald-600 bg-emerald-100/50' : 'text-red-600 bg-red-100/50'}`}>
                     {variantStock > 0 ? 'En Stock' : 'Sin Stock'}
                  </span>
               </td>
            </tr>
         );
      })}
    </>
  );
};

// --- WAREHOUSE CARD CONTAINER ---
const WarehouseStockCard: React.FC<{ warehouse: Warehouse; filteredProducts: Product[] }> = ({ warehouse, filteredProducts }) => {
  const [isCardExpanded, setIsCardExpanded] = useState(false);

  // Logic to simulate distinct inventory per warehouse
  // In a real app, this would use product.stockBalances[warehouse.id]
  const warehouseProducts = filteredProducts.filter((_, idx) => {
     if (warehouse.id === 'wh_1') return true; 
     if (warehouse.id === 'wh_2') return idx % 2 === 0;
     return false; 
  });

  // Mock Total Value/Item Count for display
  const totalValue = 154200; 
  const itemCount = warehouseProducts.length;

  return (
    <div className={`bg-white rounded-2xl border transition-all overflow-hidden ${isCardExpanded ? 'shadow-lg border-emerald-300 ring-1 ring-emerald-100' : 'shadow-sm border-gray-200 hover:border-emerald-200'} ${!warehouse.allowPosSale ? 'opacity-70 border-dashed bg-gray-50' : ''}`}>
       
       {/* HEADER CARD */}
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
                <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                   <MapPin size={12} /> {warehouse.address}
                </p>
             </div>
          </div>

          <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-end">
             <div className="text-right">
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Valorizado</p>
                <p className="text-lg font-black text-gray-800">${totalValue.toLocaleString()}</p>
             </div>
             <div className="text-right">
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Artículos</p>
                <p className="text-lg font-black text-gray-800">{itemCount}</p>
             </div>
             
             <button 
                onClick={() => setIsCardExpanded(!isCardExpanded)}
                className={`p-2 rounded-full border transition-colors ${isCardExpanded ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'}`}
             >
                {isCardExpanded ? <ChevronDown size={20} className="rotate-180 transition-transform" /> : <ChevronDown size={20} />}
             </button>
          </div>
       </div>

       {/* EXPANDABLE TABLE */}
       {isCardExpanded && (
          <div className="border-t border-gray-100 bg-gray-50/30 p-6 animate-in slide-in-from-top-2 duration-200">
             <div className="flex justify-between items-center mb-4">
                <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                   <ClipboardList size={16} /> Desglose de Existencias
                </h4>
                <div className="text-xs text-gray-400 italic">Vista de auditoría (Solo lectura)</div>
             </div>

             <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <table className="w-full text-left text-sm">
                   <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-bold text-xs uppercase">
                      <tr>
                         <th className="p-4 w-[40%]">Artículo</th>
                         <th className="p-4">Variante / Atributo</th>
                         <th className="p-4 text-center">Stock Físico</th>
                         <th className="p-4 text-right">Estado</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-gray-100">
                      {warehouseProducts.map(product => (
                         <StockRow key={product.id} product={product} />
                      ))}
                   </tbody>
                </table>
                {warehouseProducts.length === 0 && (
                   <div className="p-8 text-center text-gray-400 italic">No hay productos en este almacén.</div>
                )}
             </div>
          </div>
       )}
    </div>
  );
};

// --- MAIN CATALOG COMPONENT ---
const CatalogManager: React.FC<CatalogManagerProps> = ({ 
  products, config, warehouses, transactions, onUpdateProducts, onClose 
}) => {
  const [viewMode, setViewMode] = useState<'PRODUCTS' | 'TARIFFS' | 'VARIANTS' | 'STOCKS'>('PRODUCTS');
  
  // Product State
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [editingProduct, setEditingProduct] = useState<Product | null | 'NEW'>(null);

  // Tariff State
  const [tariffs, setTariffs] = useState<Tariff[]>(MOCK_TARIFFS);
  const [editingTariff, setEditingTariff] = useState<Tariff | null | 'NEW'>(null);

  // Derived Products
  const categories = useMemo(() => ['ALL', ...Array.from(new Set(products.map(p => p.category)))], [products]);
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.barcode?.includes(searchTerm);
      const matchesCategory = categoryFilter === 'ALL' || p.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchTerm, categoryFilter]);

  // Handlers
  const handleSaveProduct = (savedProduct: Product) => {
    const exists = products.some(p => p.id === savedProduct.id);
    const newProducts = exists ? products.map(p => p.id === savedProduct.id ? savedProduct : p) : [...products, savedProduct];
    onUpdateProducts(newProducts);
    setEditingProduct(null);
  };

  const handleSaveTariff = (savedTariff: Tariff) => {
    const exists = tariffs.some(t => t.id === savedTariff.id);
    const newTariffs = exists ? tariffs.map(t => t.id === savedTariff.id ? savedTariff : t) : [...tariffs, savedTariff];
    setTariffs(newTariffs);
    setEditingTariff(null);
  };

  // Integrity Check: See if product has transactions
  const checkHasHistory = (product: Product | 'NEW' | null): boolean => {
    if (!product || product === 'NEW') return false;
    return transactions.some(t => t.items.some(item => item.id === product.id));
  };

  // --- RENDERS ---

  if (viewMode === 'VARIANTS') {
    return <VariantManager onClose={() => setViewMode('PRODUCTS')} />;
  }

  if (editingProduct) {
    return (
      <ProductForm 
        initialData={editingProduct === 'NEW' ? null : editingProduct} 
        config={config} 
        warehouses={warehouses}
        availableTariffs={tariffs} 
        hasHistory={checkHasHistory(editingProduct)}
        onSave={handleSaveProduct} 
        onClose={() => setEditingProduct(null)} 
      />
    );
  }

  if (editingTariff) {
    return (
      <TariffForm 
        initialData={editingTariff === 'NEW' ? null : editingTariff} 
        products={products} 
        config={config} 
        availableTariffs={tariffs} 
        onSave={handleSaveTariff} 
        onClose={() => setEditingTariff(null)} 
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300">
      
      {/* Header & Tabs */}
      <div className="bg-white px-8 pt-6 pb-0 border-b border-gray-200 flex justify-between items-start shrink-0">
        <div className="flex flex-col gap-4 w-full">
           <div className="flex justify-between items-center w-full">
              <div className="flex items-center gap-4">
                 <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
                    <ArrowLeft size={24} />
                 </button>
                 <div>
                    <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                       <Package className="text-blue-600" /> Gestión de Catálogo
                    </h1>
                 </div>
              </div>
              <button 
                 onClick={() => viewMode === 'PRODUCTS' ? setEditingProduct('NEW') : setEditingTariff('NEW')}
                 className={`px-6 py-3 text-white rounded-xl font-bold shadow-lg hover:brightness-110 active:scale-95 transition-all flex items-center gap-2 ${viewMode === 'STOCKS' ? 'opacity-0 pointer-events-none' : 'bg-blue-600'}`}
              >
                 <Plus size={20} /> {viewMode === 'PRODUCTS' ? 'Nuevo Artículo' : 'Nueva Tarifa'}
              </button>
           </div>

           {/* Tabs */}
           <div className="flex gap-8 mt-2 overflow-x-auto no-scrollbar">
              <button 
                 onClick={() => setViewMode('PRODUCTS')}
                 className={`pb-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap ${viewMode === 'PRODUCTS' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                 <Package size={18} /> Productos
              </button>
              <button 
                 onClick={() => setViewMode('VARIANTS')}
                 className={`pb-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap ${viewMode === 'VARIANTS' ? 'border-pink-600 text-pink-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                 <Layers size={18} /> Variantes y Atributos
              </button>
              <button 
                 onClick={() => setViewMode('STOCKS')}
                 className={`pb-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap ${viewMode === 'STOCKS' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                 <ClipboardList size={18} /> Stocks
              </button>
              <button 
                 onClick={() => setViewMode('TARIFFS')}
                 className={`pb-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 whitespace-nowrap ${viewMode === 'TARIFFS' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                 <Tag size={18} /> Tarifas y Precios
              </button>
           </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col p-8 max-w-7xl mx-auto w-full">
         
         {viewMode === 'PRODUCTS' && (
            <>
               <div className="flex gap-4 mb-6">
                  <div className="flex-1 relative">
                     <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                     <input 
                        type="text" 
                        placeholder="Buscar..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                     />
                  </div>
                  <div className="relative min-w-[200px]">
                     <select 
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="w-full h-full pl-4 pr-8 bg-white border border-gray-200 rounded-xl outline-none font-medium text-gray-700 shadow-sm"
                     >
                        {categories.map(c => <option key={c} value={c}>{c === 'ALL' ? 'Todas las Categorías' : c}</option>)}
                     </select>
                     <Filter className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  </div>
               </div>

               <div className="flex-1 overflow-y-auto">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-20">
                     {filteredProducts.map(product => (
                        <div key={product.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-200 hover:shadow-md hover:border-blue-300 transition-all group flex flex-col h-[280px]">
                           <div className="h-32 bg-gray-50 rounded-xl mb-4 relative overflow-hidden flex items-center justify-center">
                              {product.image ? <img src={product.image} alt={product.name} className="w-full h-full object-cover" /> : <ImageIcon className="text-gray-300" size={32} />}
                              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                 <button onClick={(e) => { e.stopPropagation(); setEditingProduct(product); }} className="p-2 bg-white/90 backdrop-blur rounded-lg shadow-sm hover:text-blue-600"><Edit2 size={16} /></button>
                                 <button onClick={(e) => { e.stopPropagation(); if(confirm('¿Eliminar?')) onUpdateProducts(products.filter(p=>p.id!==product.id)); }} className="p-2 bg-white/90 backdrop-blur rounded-lg shadow-sm hover:text-red-600"><Trash2 size={16} /></button>
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
                     ))}
                  </div>
               </div>
            </>
         )}

         {viewMode === 'STOCKS' && (
            <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-2">
               <div className="mb-6 flex justify-between items-end">
                  <div>
                     <h2 className="text-lg font-bold text-gray-800">Resumen de Inventario por Almacén</h2>
                     <p className="text-sm text-gray-500">Consulta de existencias físicas y valorizadas.</p>
                  </div>
                  <div className="flex gap-2">
                     <span className="text-xs bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full font-bold border border-emerald-100 flex items-center gap-1">
                        <CheckCircle2 size={12} /> Tiempo Real
                     </span>
                  </div>
               </div>

               <div className="flex-1 overflow-y-auto pb-20 space-y-4">
                  {warehouses.map(warehouse => (
                     <WarehouseStockCard key={warehouse.id} warehouse={warehouse} filteredProducts={filteredProducts} />
                  ))}
               </div>
            </div>
         )}

         {viewMode === 'TARIFFS' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in">
               {tariffs.map(tariff => (
                  <div key={tariff.id} className="bg-white rounded-3xl p-6 shadow-sm border border-gray-200 hover:shadow-md transition-all relative overflow-hidden group">
                     <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl ${tariff.active ? 'from-green-50' : 'from-gray-100'} to-transparent rounded-bl-full`}></div>
                     
                     <div className="relative z-10">
                        <div className="flex justify-between items-start mb-4">
                           <div className={`p-3 rounded-2xl ${tariff.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              <Tag size={24} />
                           </div>
                           <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => setEditingTariff(tariff)} className="p-2 bg-white border rounded-lg text-gray-500 hover:text-purple-600"><Edit2 size={16} /></button>
                           </div>
                        </div>
                        
                        <h3 className="text-xl font-bold text-gray-800 mb-1">{tariff.name}</h3>
                        <div className="flex items-center gap-2 mb-6">
                           <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${tariff.active ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                              {tariff.active ? 'Activa' : 'Inactiva'}
                           </span>
                           <span className="text-xs text-gray-400 font-mono uppercase">{tariff.strategy.type}</span>
                        </div>

                        <div className="space-y-3">
                           <div className="flex items-center gap-3 text-sm text-gray-600">
                              <Calendar size={16} className="text-gray-400" />
                              <span>{tariff.schedule.daysOfWeek.length === 7 ? 'Todos los días' : `${tariff.schedule.daysOfWeek.length} días/sem`}</span>
                           </div>
                           <div className="flex items-center gap-3 text-sm text-gray-600">
                              <DollarSign size={16} className="text-gray-400" />
                              <span>{tariff.currency} {tariff.strategy.type === 'COST_PLUS' ? `(Margen ${tariff.strategy.factor}%)` : ''}</span>
                           </div>
                        </div>
                     </div>
                  </div>
               ))}
               
               {/* Add New Card */}
               <button 
                  onClick={() => setEditingTariff('NEW')}
                  className="bg-gray-50 rounded-3xl p-6 border-2 border-dashed border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-all flex flex-col items-center justify-center text-gray-400 hover:text-purple-600 gap-4"
               >
                  <div className="p-4 bg-white rounded-full shadow-sm"><Plus size={32} /></div>
                  <span className="font-bold">Crear Nueva Lista</span>
               </button>
            </div>
         )}

      </div>
    </div>
  );
};

export default CatalogManager;
