
import React, { useState, useMemo } from 'react';
import { X, Search, Check, Plus, Package, Grid, Tag, ShoppingBag, FolderOpen, ArrowRight } from 'lucide-react';
import { Product, BusinessConfig, ProductGroup } from '../types';

interface WatchlistAddProductsModalProps {
  products: Product[];
  config: BusinessConfig;
  selectedProductIds: string[];
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}

const WatchlistAddProductsModal: React.FC<WatchlistAddProductsModalProps> = ({
  products, config, selectedProductIds, onClose, onConfirm
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'INDIVIDUAL' | 'GROUPS' | 'CATEGORIES'>('INDIVIDUAL');
  const [searchTerm, setSearchTerm] = useState('');
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  // --- FILTERS ---
  const filteredProducts = useMemo(() => {
    return products.filter(p => 
      !selectedProductIds.includes(p.id) &&
      (p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.barcode?.includes(searchTerm))
    );
  }, [products, searchTerm, selectedProductIds]);

  const availableGroups = config.productGroups || [];
  // Fix: Explicitly cast to string[] to resolve 'unknown' type error in map callback
  const availableCategories = Array.from(new Set(products.map(p => p.category))).sort() as string[];

  // --- HANDLERS ---
  const toggleId = (id: string) => {
    const next = new Set(pendingIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPendingIds(next);
  };

  const addFromGroup = (group: ProductGroup) => {
    const next = new Set(pendingIds);
    group.productIds.forEach(id => {
        if (!selectedProductIds.includes(id)) next.add(id);
    });
    setPendingIds(next);
  };

  const addFromCategory = (cat: string) => {
    const next = new Set(pendingIds);
    products.filter(p => p.category === cat).forEach(p => {
        if (!selectedProductIds.includes(p.id)) next.add(p.id);
    });
    setPendingIds(next);
  };

  const handleConfirm = () => {
    onConfirm(Array.from(pendingIds));
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-[2.5rem] w-full max-w-4xl h-[85vh] shadow-2xl overflow-hidden flex flex-col">
        
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
           <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-600 text-white rounded-2xl shadow-lg">
                 <Package size={24} />
              </div>
              <div>
                 <h2 className="text-2xl font-black text-slate-800">Añadir a Seguimiento</h2>
                 <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Sincronizando con Motor BI</p>
              </div>
           </div>
           <button onClick={onClose} className="p-3 hover:bg-slate-200 rounded-full transition-colors"><X size={24}/></button>
        </div>

        <div className="flex px-8 border-b bg-white gap-8 shrink-0">
           {[
              { id: 'INDIVIDUAL', label: 'Individual', icon: ShoppingBag },
              { id: 'GROUPS', label: 'Por Grupo', icon: Grid },
              { id: 'CATEGORIES', label: 'Por Categoría', icon: FolderOpen },
           ].map(tab => (
              <button 
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id as any)}
                className={`py-4 text-sm font-bold border-b-4 flex items-center gap-2 transition-all ${activeSubTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                 <tab.icon size={16} /> {tab.label}
              </button>
           ))}
        </div>

        <div className="flex-1 overflow-hidden flex flex-col bg-slate-50/30">
           {activeSubTab === 'INDIVIDUAL' && (
              <div className="flex-1 flex flex-col overflow-hidden p-6">
                 <div className="relative mb-4">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                       type="text" 
                       value={searchTerm}
                       onChange={e => setSearchTerm(e.target.value)}
                       placeholder="Buscar por nombre o código..."
                       className="w-full pl-12 pr-4 py-4 bg-white rounded-2xl border-none shadow-sm focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                    />
                 </div>
                 <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-3 pb-8">
                    {filteredProducts.map(p => (
                       <div 
                         key={p.id} 
                         onClick={() => toggleId(p.id)}
                         className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center justify-between ${pendingIds.has(p.id) ? 'bg-blue-50 border-blue-500 shadow-sm' : 'bg-white border-transparent hover:border-slate-200'}`}
                       >
                          <div className="flex items-center gap-3">
                             <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden border border-slate-200">
                                {p.image && <img src={p.image} className="w-full h-full object-cover" />}
                             </div>
                             <div>
                                <p className="font-bold text-slate-800 text-sm">{p.name}</p>
                                <p className="text-[10px] text-slate-400 font-mono">{p.barcode}</p>
                             </div>
                          </div>
                          {pendingIds.has(p.id) ? <Check className="text-blue-600" /> : <Plus className="text-slate-300" />}
                       </div>
                    ))}
                 </div>
              </div>
           )}

           {activeSubTab === 'GROUPS' && (
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {availableGroups.map(group => (
                       <div key={group.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center justify-between group">
                          <div className="flex items-center gap-4">
                             <div className={`p-3 rounded-2xl ${group.color || 'bg-slate-800'} text-white shadow-md`}>
                                <Grid size={24} />
                             </div>
                             <div>
                                <h4 className="font-black text-slate-800">{group.name}</h4>
                                <p className="text-xs text-slate-400">{group.productIds.length} artículos definidos</p>
                             </div>
                          </div>
                          <button 
                             onClick={() => addFromGroup(group)}
                             className="px-4 py-2 bg-slate-50 text-slate-600 rounded-xl font-bold text-xs hover:bg-blue-600 hover:text-white transition-all flex items-center gap-2"
                          >
                             Añadir Todo <ArrowRight size={14} />
                          </button>
                       </div>
                    ))}
                 </div>
              </div>
           )}

           {activeSubTab === 'CATEGORIES' && (
              <div className="flex-1 overflow-y-auto p-6 space-y-3">
                 {availableCategories.map(cat => (
                    <div key={cat} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between hover:border-blue-300 transition-all group">
                       <div className="flex items-center gap-4">
                          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Tag size={18} /></div>
                          <span className="font-bold text-slate-800">{cat}</span>
                       </div>
                       <button 
                          onClick={() => addFromCategory(cat)}
                          className="px-4 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-black opacity-0 group-hover:opacity-100 transition-all"
                       >
                          + Añadir Categoría
                       </button>
                    </div>
                 ))}
              </div>
           )}
        </div>

        <div className="p-8 border-t bg-white flex justify-between items-center shadow-[0_-10px_40px_rgba(0,0,0,0.03)]">
           <div className="flex items-center gap-3">
              <div className="bg-slate-100 px-4 py-2 rounded-xl border border-slate-200">
                 <span className="text-sm font-black text-slate-600">{pendingIds.size}</span>
                 <span className="text-xs font-bold text-slate-400 uppercase ml-2">Por Añadir</span>
              </div>
              {pendingIds.size > 0 && (
                <button onClick={() => setPendingIds(new Set())} className="text-xs font-bold text-red-500 hover:underline">Limpiar Selección</button>
              )}
           </div>
           <div className="flex gap-4">
              <button onClick={onClose} className="px-8 py-4 text-slate-400 font-bold uppercase tracking-widest text-xs">Cancelar</button>
              <button 
                onClick={handleConfirm}
                disabled={pendingIds.size === 0}
                className="px-10 py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-500/30 hover:bg-blue-700 disabled:opacity-50 disabled:grayscale transition-all active:scale-95"
              >
                 Confirmar Adición
              </button>
           </div>
        </div>

      </div>
    </div>
  );
};

export default WatchlistAddProductsModal;
