import React, { useState, useMemo } from 'react';
import { 
  Package, Search, Plus, Edit2, Trash2, ArrowLeft, 
  Filter, Tag, Image as ImageIcon, Barcode, DollarSign,
  Calendar, CheckCircle2, XCircle, Layers
} from 'lucide-react';
import { Product, BusinessConfig, Tariff, Transaction } from '../types';
import ProductForm from './ProductForm';
import TariffForm from './TariffForm';
import VariantManager from './VariantManager';

interface CatalogManagerProps {
  products: Product[];
  config: BusinessConfig;
  transactions: Transaction[];
  onUpdateProducts: (products: Product[]) => void;
  onClose: () => void;
}

// Mock Tariffs if not provided (In real app, pass via props)
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

const CatalogManager: React.FC<CatalogManagerProps> = ({ 
  products, config, transactions, onUpdateProducts, onClose 
}) => {
  const [viewMode, setViewMode] = useState<'PRODUCTS' | 'TARIFFS' | 'VARIANTS'>('PRODUCTS');
  
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
                 className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2"
              >
                 <Plus size={20} /> {viewMode === 'PRODUCTS' ? 'Nuevo Artículo' : 'Nueva Tarifa'}
              </button>
           </div>

           {/* Tabs */}
           <div className="flex gap-8 mt-2">
              <button 
                 onClick={() => setViewMode('PRODUCTS')}
                 className={`pb-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 ${viewMode === 'PRODUCTS' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                 <Package size={18} /> Productos
              </button>
              <button 
                 onClick={() => setViewMode('TARIFFS')}
                 className={`pb-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 ${viewMode === 'TARIFFS' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                 <Tag size={18} /> Tarifas y Precios
              </button>
              <button 
                 onClick={() => setViewMode('VARIANTS')}
                 className={`pb-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 ${viewMode === 'VARIANTS' ? 'border-pink-600 text-pink-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                 <Layers size={18} /> Variantes y Atributos
              </button>
           </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col p-8 max-w-7xl mx-auto w-full">
         
         {viewMode === 'PRODUCTS' ? (
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
         ) : (
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