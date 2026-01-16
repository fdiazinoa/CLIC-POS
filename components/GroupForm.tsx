
import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, Save, Grid, Info, Box, Search, 
  Check, Plus, Trash2 
} from 'lucide-react';
import { ProductGroup, Product } from '../types';

interface GroupFormProps {
  initialData?: ProductGroup | null;
  products: Product[];
  onSave: (group: ProductGroup) => void;
  onClose: () => void;
}

type TabType = 'GENERAL' | 'ITEMS';

const PRESET_COLORS = [
  'bg-blue-500', 'bg-red-500', 'bg-green-500', 'bg-yellow-500', 
  'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-orange-500', 
  'bg-gray-500', 'bg-teal-500'
];

const GroupForm: React.FC<GroupFormProps> = ({ 
  initialData, products, onSave, onClose 
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('GENERAL');
  
  const [formData, setFormData] = useState<ProductGroup>({
    id: `GRP_${Date.now()}`,
    name: '',
    code: '',
    color: 'bg-blue-500',
    description: '',
    productIds: []
  });

  // Items Selection State
  const [itemsSearch, setItemsSearch] = useState('');
  const [itemsCategory, setItemsCategory] = useState('ALL');
  const [selectAllFiltered, setSelectAllFiltered] = useState(false);

  useEffect(() => {
    if (initialData) {
      setFormData({
        ...JSON.parse(JSON.stringify(initialData)),
        productIds: initialData.productIds || [] // Ensure array safety
      });
    }
  }, [initialData]);

  // --- HELPERS ---
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchSearch = p.name.toLowerCase().includes(itemsSearch.toLowerCase()) || p.barcode?.includes(itemsSearch);
      const matchCat = itemsCategory === 'ALL' || p.category === itemsCategory;
      return matchSearch && matchCat;
    });
  }, [products, itemsSearch, itemsCategory]);

  const categories = useMemo(() => ['ALL', ...Array.from(new Set(products.map(p => p.category)))], [products]);

  // --- LOGIC ---
  
  const toggleProductSelection = (productId: string) => {
    setFormData(prev => {
      const currentIds = new Set(prev.productIds);
      if (currentIds.has(productId)) {
        currentIds.delete(productId);
      } else {
        currentIds.add(productId);
      }
      return { ...prev, productIds: Array.from(currentIds) };
    });
  };

  const handleSelectAll = () => {
    if (selectAllFiltered) {
        // Deselect all visible
        setFormData(prev => ({
            ...prev,
            productIds: prev.productIds.filter(id => !filteredProducts.find(p => p.id === id))
        }));
    } else {
        // Select all visible
        const visibleIds = filteredProducts.map(p => p.id);
        setFormData(prev => ({
            ...prev,
            productIds: Array.from(new Set([...prev.productIds, ...visibleIds]))
        }));
    }
    setSelectAllFiltered(!selectAllFiltered);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault(); 
    e.stopPropagation();
    
    if (!formData.name.trim()) return alert("El nombre es obligatorio");
    if (!formData.code.trim()) return alert("El código es obligatorio");
    
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={(e) => e.stopPropagation()}>
      <form 
        onSubmit={handleFormSubmit}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* HEADER */}
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-white z-20 shrink-0">
          <div className="flex items-center gap-4">
             <div className="p-3 bg-orange-100 text-orange-600 rounded-xl">
                <Grid size={24} />
             </div>
             <div>
               <h2 className="text-xl font-black text-gray-800">{initialData ? 'Editar Grupo' : 'Nuevo Grupo'}</h2>
               <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Agrupación de Productos</p>
             </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
             <X size={24} />
          </button>
        </div>

        {/* NAME & TABS */}
        <div className="px-8 pt-6 pb-0 bg-gray-50 border-b border-gray-200 z-10 shrink-0">
           <input 
              type="text" 
              placeholder="Nombre del Grupo (Ej. Liquidación Verano)"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              className="w-full text-2xl font-black bg-transparent border-none outline-none placeholder:text-gray-300 text-gray-800 mb-6"
              required
           />
           <div className="flex gap-8">
              {[
                 { id: 'GENERAL', label: 'General', icon: Info },
                 { id: 'ITEMS', label: 'Artículos Vinculados', icon: Box }
              ].map(tab => (
                 <button 
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id as TabType)}
                    className={`pb-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 ${activeTab === tab.id ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                 >
                    <tab.icon size={16} /> {tab.label}
                 </button>
              ))}
           </div>
        </div>

        {/* CONTENT */}
        <div className="flex-1 overflow-y-auto p-8 bg-gray-50 relative z-0">
           
           {/* === GENERAL TAB === */}
           {activeTab === 'GENERAL' && (
              <div className="space-y-8 animate-in slide-in-from-right-4 max-w-3xl mx-auto">
                 <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6">
                    <div>
                       <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Código / Alias (Interno)</label>
                       <input 
                          type="text" 
                          value={formData.code}
                          onChange={(e) => setFormData({...formData, code: e.target.value.toUpperCase()})}
                          placeholder="Ej. LIQ-SUM-24"
                          className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 outline-none focus:ring-2 focus:ring-orange-200 uppercase"
                          required
                       />
                    </div>

                    <div>
                       <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Color Identificador</label>
                       <div className="flex gap-3 flex-wrap">
                          {PRESET_COLORS.map(color => (
                             <button
                                key={color}
                                type="button"
                                onClick={() => setFormData({...formData, color})}
                                className={`w-10 h-10 rounded-full ${color} transition-transform ${formData.color === color ? 'scale-110 ring-4 ring-offset-2 ring-gray-200' : 'hover:scale-105'}`}
                             />
                          ))}
                       </div>
                    </div>

                    <div>
                       <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Descripción (Opcional)</label>
                       <textarea 
                          value={formData.description || ''}
                          onChange={(e) => setFormData({...formData, description: e.target.value})}
                          rows={3}
                          className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-700 outline-none focus:ring-2 focus:ring-orange-200 resize-none"
                          placeholder="Notas internas sobre este grupo..."
                       />
                    </div>
                 </div>
              </div>
           )}

           {/* === ITEMS TAB === */}
           {activeTab === 'ITEMS' && (
              <div className="h-full flex flex-col animate-in slide-in-from-right-4">
                 
                 {/* Filters Bar */}
                 <div className="flex gap-4 mb-6">
                    <div className="flex-1 relative">
                       <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                       <input 
                          type="text" 
                          placeholder="Buscar productos para agregar..." 
                          value={itemsSearch}
                          onChange={(e) => setItemsSearch(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-200"
                       />
                    </div>
                    <select 
                       value={itemsCategory}
                       onChange={(e) => setItemsCategory(e.target.value)}
                       className="px-4 bg-white border border-gray-200 rounded-xl outline-none font-medium text-gray-600"
                    >
                       {categories.map(c => <option key={c} value={c}>{c === 'ALL' ? 'Todas las Categorías' : c}</option>)}
                    </select>
                 </div>

                 {/* Selection Summary Bar */}
                 <div className="flex justify-between items-center mb-4 px-2">
                    <div className="flex gap-4 items-center">
                        <label className="flex items-center gap-2 cursor-pointer bg-white px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                            <input 
                                type="checkbox" 
                                checked={selectAllFiltered} 
                                onChange={handleSelectAll}
                                className="w-4 h-4 rounded text-orange-600 focus:ring-orange-500"
                            />
                            <span className="text-sm font-bold text-gray-700">Seleccionar Todo ({filteredProducts.length})</span>
                        </label>
                        <span className="text-sm text-gray-500">
                            <strong>{formData.productIds.length}</strong> productos en este grupo.
                        </span>
                    </div>
                 </div>

                 {/* Items Grid */}
                 <div className="flex-1 overflow-y-auto pb-20">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                       {filteredProducts.map(product => {
                          const isSelected = formData.productIds.includes(product.id);
                          return (
                             <div 
                                key={product.id}
                                onClick={() => toggleProductSelection(product.id)}
                                className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center justify-between ${
                                   isSelected 
                                      ? 'bg-orange-50 border-orange-500 shadow-sm' 
                                      : 'bg-white border-gray-200 hover:border-orange-200'
                                }`}
                             >
                                <div>
                                   <h4 className={`font-bold text-sm mb-1 ${isSelected ? 'text-orange-900' : 'text-gray-800'}`}>
                                      {product.name}
                                   </h4>
                                   <div className="flex gap-2 text-xs opacity-70">
                                      <span className="font-mono bg-white px-1.5 rounded border border-gray-100">{product.barcode || '---'}</span>
                                      <span>{product.category}</span>
                                   </div>
                                </div>
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                                   isSelected ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-gray-300'
                                }`}>
                                   {isSelected && <Check size={14} strokeWidth={3} />}
                                </div>
                             </div>
                          );
                       })}
                       {filteredProducts.length === 0 && (
                          <div className="col-span-full py-12 text-center text-gray-400">
                             No se encontraron productos con los filtros actuales.
                          </div>
                       )}
                    </div>
                 </div>

              </div>
           )}

        </div>

        {/* FOOTER */}
        <div className="p-5 border-t border-gray-100 bg-white flex justify-end gap-3 z-30 shrink-0">
           <button 
             type="button" 
             onClick={onClose} 
             className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-50 transition-colors"
           >
              Cancelar
           </button>
           <button 
             type="submit"
             className="px-8 py-3 rounded-xl font-bold bg-orange-500 text-white shadow-lg hover:bg-orange-600 active:scale-95 transition-all flex items-center gap-2"
           >
              <Save size={20} /> Guardar Grupo
           </button>
        </div>

      </form>
    </div>
  );
};

export default GroupForm;
