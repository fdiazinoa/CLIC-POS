import React, { useState, useEffect } from 'react';
import { 
  X, Save, Image as ImageIcon, Barcode, ScanBarcode, 
  DollarSign, Package, Layers, AlertCircle, Camera, 
  Tags, Plus, Trash2, CheckSquare, Wand2, Grid, Copy
} from 'lucide-react';
import { Product, BusinessConfig, ProductAttribute, ProductVariant } from '../types';

interface ProductFormProps {
  initialData?: Product | null;
  config: BusinessConfig;
  onSave: (product: Product) => void;
  onClose: () => void;
}

type TabType = 'GENERAL' | 'PRICING' | 'INVENTORY' | 'VARIANTS';

const PRESET_COLORS = [
  { name: 'Negro', value: '#000000' },
  { name: 'Blanco', value: '#FFFFFF' },
  { name: 'Rojo', value: '#EF4444' },
  { name: 'Azul', value: '#3B82F6' },
  { name: 'Verde', value: '#10B981' },
  { name: 'Amarillo', value: '#F59E0B' },
  { name: 'Gris', value: '#6B7280' },
  { name: 'Rosa', value: '#EC4899' },
];

const ProductForm: React.FC<ProductFormProps> = ({ initialData, config, onSave, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('GENERAL');
  
  // Form State
  const [formData, setFormData] = useState<Partial<Product>>({
    name: '',
    category: 'General',
    price: 0,
    cost: 0,
    margin: 30, // Default 30% margin
    stock: 0,
    minStock: 5,
    trackStock: true,
    askPrice: false,
    barcode: '',
    image: '',
    isWeighted: false,
    attributes: [],
    variants: []
  });

  // Local state for adding variant definitions
  const [newAttributeName, setNewAttributeName] = useState('');
  const [tempOptionInputs, setTempOptionInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  // --- LOGIC: Smart Price Calculation ---
  const handleCostChange = (val: number) => {
    const newPrice = val * (1 + (formData.margin || 0) / 100);
    setFormData(prev => ({ ...prev, cost: val, price: parseFloat(newPrice.toFixed(2)) }));
  };

  const handleMarginChange = (val: number) => {
    const newPrice = (formData.cost || 0) * (1 + val / 100);
    setFormData(prev => ({ ...prev, margin: val, price: parseFloat(newPrice.toFixed(2)) }));
  };

  const handlePriceChange = (val: number) => {
    // Reverse calc: if price changes, margin changes (cost stays fixed)
    let newMargin = 0;
    if ((formData.cost || 0) > 0) {
      newMargin = ((val - (formData.cost || 0)) / (formData.cost || 0)) * 100;
    }
    setFormData(prev => ({ ...prev, price: val, margin: parseFloat(newMargin.toFixed(1)) }));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setFormData(prev => ({ ...prev, image: reader.result as string }));
      reader.readAsDataURL(file);
    }
  };

  // --- LOGIC: Attribute Definitions (Step 1) ---
  const addAttributeGroup = () => {
    if (!newAttributeName.trim()) return;
    const newAttr: ProductAttribute = {
      id: Math.random().toString(36).substr(2, 9),
      name: newAttributeName,
      options: []
    };
    setFormData(prev => ({ ...prev, attributes: [...(prev.attributes || []), newAttr] }));
    setNewAttributeName('');
  };

  const removeAttributeGroup = (id: string) => {
    setFormData(prev => ({ ...prev, attributes: prev.attributes?.filter(a => a.id !== id) }));
  };

  const addOptionToGroup = (attrId: string, val: string) => {
    if (!val || !val.trim()) return;
    setFormData(prev => ({
      ...prev,
      attributes: prev.attributes?.map(attr => {
        if (attr.id === attrId) {
           // Prevent duplicates
           if (attr.options.some(opt => opt.name.toLowerCase() === val.toLowerCase())) return attr;
           return {
            ...attr,
            options: [...attr.options, { id: Math.random().toString(36).substr(2, 9), name: val }]
          };
        }
        return attr;
      })
    }));
    setTempOptionInputs(prev => ({ ...prev, [attrId]: '' }));
  };

  const removeOptionFromGroup = (attrId: string, optionId: string) => {
    setFormData(prev => ({
      ...prev,
      attributes: prev.attributes?.map(attr => {
        if (attr.id === attrId) {
          return {
             ...attr,
             options: attr.options.filter(opt => opt.id !== optionId)
          };
        }
        return attr;
      })
    }));
  };

  // --- LOGIC: Matrix Generation (Step 2) ---
  const generateMatrix = () => {
    if (!formData.attributes || formData.attributes.length === 0) return;

    // Helper to generate cartesian product
    const cartesian = (arrays: any[][]) => {
      return arrays.reduce((acc, curr) => {
        return acc.flatMap((x: any) => curr.map((y: any) => [...x, y]));
      }, [[]]);
    };

    // Extract options from each attribute
    const attributeOptions = formData.attributes
      .filter(attr => attr.options.length > 0)
      .map(attr => attr.options.map(opt => ({ attrName: attr.name, optionName: opt.name })));

    if (attributeOptions.length === 0) return;

    const combinations = cartesian(attributeOptions);

    const newVariants: ProductVariant[] = combinations.map((combo: any[]) => {
      const combinationMap: Record<string, string> = {};
      const nameParts: string[] = [];
      
      combo.forEach(c => {
        combinationMap[c.attrName] = c.optionName;
        nameParts.push(c.optionName);
      });

      // Check if variant already exists to preserve data (stock/sku)
      const existing = formData.variants?.find(v => 
        JSON.stringify(v.combination) === JSON.stringify(combinationMap)
      );

      if (existing) return existing;

      return {
        id: Math.random().toString(36).substr(2, 9),
        name: nameParts.join(' / '),
        price: formData.price || 0,
        cost: formData.cost || 0,
        stock: 0,
        sku: `${formData.barcode || 'SKU'}-${nameParts.map(n => n.substring(0,2).toUpperCase()).join('')}`,
        combination: combinationMap
      };
    });

    setFormData(prev => ({ ...prev, variants: newVariants }));
  };

  const updateVariant = (id: string, field: keyof ProductVariant, value: any) => {
    setFormData(prev => ({
      ...prev,
      variants: prev.variants?.map(v => v.id === id ? { ...v, [field]: value } : v)
    }));
  };

  const removeVariant = (id: string) => {
    setFormData(prev => ({
      ...prev,
      variants: prev.variants?.filter(v => v.id !== id)
    }));
  };

  const handleSubmit = () => {
    if (!formData.name || !formData.category) {
      alert("Nombre y Categoría son obligatorios");
      return;
    }
    
    const finalProduct: Product = {
      id: initialData?.id || Math.random().toString(36).substr(2, 9),
      name: formData.name!,
      price: formData.price || 0,
      category: formData.category!,
      image: formData.image,
      stock: formData.variants?.reduce((acc, v) => acc + v.stock, 0) || formData.stock, // Sum stock from variants if exists
      cost: formData.cost,
      margin: formData.margin,
      minStock: formData.minStock,
      trackStock: formData.trackStock,
      askPrice: formData.askPrice,
      barcode: formData.barcode,
      isWeighted: formData.isWeighted,
      hasModifiers: formData.hasModifiers,
      attributes: formData.attributes,
      variants: formData.variants
    };

    onSave(finalProduct);
  };

  // --- UI COMPONENTS ---
  
  const ToggleSwitch: React.FC<{ label: string; checked: boolean; onChange: (val: boolean) => void }> = ({ label, checked, onChange }) => (
    <div onClick={() => onChange(!checked)} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-200">
      <span className="font-medium text-gray-700">{label}</span>
      <div className={`w-12 h-6 rounded-full relative transition-colors duration-300 ${checked ? 'bg-blue-500' : 'bg-gray-300'}`}>
        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${checked ? 'left-7' : 'left-1'}`} />
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col h-[90vh] animate-in slide-in-from-bottom-5">
        
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-white z-10">
          <div>
            <h2 className="text-xl font-black text-gray-800 tracking-tight">{initialData ? 'Editar Producto' : 'Nuevo Producto'}</h2>
            <p className="text-xs text-gray-400 font-medium">{config.subVertical} Manager</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-6 pt-4 gap-6 border-b border-gray-100 bg-white sticky top-0 overflow-x-auto no-scrollbar z-10">
          {[
            { id: 'GENERAL', label: 'General', icon: Package },
            { id: 'PRICING', label: 'Precios', icon: DollarSign },
            { id: 'INVENTORY', label: 'Inventario', icon: Layers },
            { id: 'VARIANTS', label: 'Variantes', icon: Tags },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`pb-4 flex items-center gap-2 text-sm font-bold transition-all relative whitespace-nowrap ${
                activeTab === tab.id ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              <tab.icon size={18} />
              {tab.label}
              {activeTab === tab.id && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-blue-600 rounded-t-full" />}
            </button>
          ))}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-white">
          
          {/* --- TAB: GENERAL --- */}
          {activeTab === 'GENERAL' && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              <div className="flex justify-center">
                 <label className="group relative w-full h-48 rounded-2xl border-2 border-dashed border-gray-300 hover:border-blue-400 bg-gray-50 flex flex-col items-center justify-center cursor-pointer transition-all overflow-hidden">
                    {formData.image ? (
                       <img src={formData.image} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                       <div className="flex flex-col items-center text-gray-400 group-hover:text-blue-500">
                          <ImageIcon size={48} className="mb-2" />
                          <span className="font-bold">Arrastra una imagen aquí</span>
                          <span className="text-xs mt-1">o haz click para subir</span>
                       </div>
                    )}
                    <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                    {formData.image && (
                       <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-white font-bold flex items-center gap-2"><Camera /> Cambiar</span>
                       </div>
                    )}
                 </label>
              </div>

              <div className="grid grid-cols-1 gap-4">
                 <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre del Producto</label>
                    <input 
                      autoFocus
                      type="text" 
                      value={formData.name}
                      onChange={e => setFormData({...formData, name: e.target.value})}
                      className="w-full p-4 bg-gray-50 rounded-xl border-none outline-none focus:ring-2 focus:ring-blue-500/20 text-lg font-semibold placeholder:font-normal"
                      placeholder="Ej. Camiseta Algodón"
                    />
                 </div>
                 
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Categoría</label>
                       <input 
                         type="text" 
                         value={formData.category}
                         onChange={e => setFormData({...formData, category: e.target.value})}
                         className="w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20"
                         placeholder="Ej. Ropa"
                       />
                    </div>
                    <div>
                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-2">
                          <Barcode size={14} /> Código de Barras
                       </label>
                       <div className="relative">
                          <input 
                            type="text" 
                            value={formData.barcode}
                            onChange={e => setFormData({...formData, barcode: e.target.value})}
                            className="w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 pl-10"
                            placeholder="Escanea o escribe"
                          />
                          <button className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-white shadow rounded-lg text-gray-500 hover:text-blue-600">
                             <ScanBarcode size={16} />
                          </button>
                       </div>
                    </div>
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                 <ToggleSwitch label="Pedir Precio al Vender" checked={formData.askPrice || false} onChange={val => setFormData({...formData, askPrice: val})} />
                 <ToggleSwitch label="Producto Pesado (Kg)" checked={formData.isWeighted || false} onChange={val => setFormData({...formData, isWeighted: val})} />
              </div>
            </div>
          )}

          {/* --- TAB: PRICING --- */}
          {activeTab === 'PRICING' && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              
              <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex flex-col items-center justify-center text-center">
                 <h3 className="text-sm font-bold text-blue-800 uppercase tracking-widest mb-2">Precio Final</h3>
                 <div className="relative flex items-center justify-center">
                    <span className="text-3xl text-blue-400 mr-1 font-medium">{config.currencySymbol}</span>
                    <input 
                       type="number"
                       value={formData.price}
                       onChange={e => handlePriceChange(parseFloat(e.target.value))}
                       className="text-5xl font-black text-blue-700 bg-transparent outline-none w-48 text-center"
                       placeholder="0.00"
                    />
                 </div>
                 <p className="text-xs text-blue-400 mt-2">Incluye impuestos si aplican</p>
              </div>

              <div className="grid grid-cols-2 gap-6">
                 <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Costo (Compra)</label>
                    <div className="relative">
                       <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{config.currencySymbol}</span>
                       <input 
                         type="number"
                         value={formData.cost}
                         onChange={e => handleCostChange(parseFloat(e.target.value))}
                         className="w-full pl-8 p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20"
                       />
                    </div>
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Margen %</label>
                    <div className="relative">
                       <input 
                         type="number"
                         value={formData.margin}
                         onChange={e => handleMarginChange(parseFloat(e.target.value))}
                         className="w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 pr-8"
                       />
                       <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">%</span>
                    </div>
                 </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                 <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-bold text-gray-600">Ganancia Estimada</span>
                    <span className="text-green-600 font-bold">
                       {config.currencySymbol}{((formData.price || 0) - (formData.cost || 0)).toFixed(2)}
                    </span>
                 </div>
                 <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                    <div className="bg-green-500 h-full" style={{ width: `${Math.min(100, formData.margin || 0)}%` }}></div>
                 </div>
              </div>
            </div>
          )}

          {/* --- TAB: INVENTORY --- */}
          {activeTab === 'INVENTORY' && (
             <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                <ToggleSwitch label="Controlar Stock" checked={formData.trackStock || false} onChange={val => setFormData({...formData, trackStock: val})} />

                {formData.trackStock && (
                   <div className="grid grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-2">
                      <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200">
                         <label className="flex items-center gap-2 text-sm font-bold text-gray-700 mb-2">
                            <Package size={16} /> Stock Actual
                         </label>
                         <input 
                            type="number"
                            value={formData.stock}
                            onChange={e => setFormData({...formData, stock: parseFloat(e.target.value)})}
                            className="w-full text-3xl font-bold bg-transparent outline-none text-gray-800"
                            placeholder="0"
                            disabled={!!formData.variants && formData.variants.length > 0} 
                         />
                         {!!formData.variants && formData.variants.length > 0 && <p className="text-[10px] text-orange-500 mt-1">Gestionado por variantes</p>}
                      </div>
                      <div className="p-4 bg-red-50 rounded-2xl border border-red-100">
                         <label className="flex items-center gap-2 text-sm font-bold text-red-700 mb-2">
                            <AlertCircle size={16} /> Stock Mínimo
                         </label>
                         <input 
                            type="number"
                            value={formData.minStock}
                            onChange={e => setFormData({...formData, minStock: parseFloat(e.target.value)})}
                            className="w-full text-3xl font-bold bg-transparent outline-none text-red-800"
                         />
                      </div>
                   </div>
                )}
             </div>
          )}

          {/* --- TAB: VARIANTS (MATRIX GENERATOR) --- */}
          {activeTab === 'VARIANTS' && (
             <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 pb-10">
                
                {/* Intro Card */}
                <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl flex items-start gap-3">
                   <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600">
                      <Wand2 size={20} />
                   </div>
                   <div>
                      <h4 className="font-bold text-indigo-800 text-sm">Generador de Matriz</h4>
                      <p className="text-xs text-indigo-600 mt-1 leading-relaxed">
                         1. Define tus atributos (ej: Color, Talla). <br/>
                         2. Genera las combinaciones automáticamente. <br/>
                         3. Ajusta precios y stock en la tabla resultante.
                      </p>
                   </div>
                </div>

                {/* Step 1: Attribute Definitions */}
                <div className="space-y-4">
                   <div className="flex justify-between items-end">
                      <label className="text-xs font-bold text-gray-500 uppercase">1. Definir Atributos</label>
                   </div>
                   
                   {/* Attribute Groups List */}
                   {formData.attributes?.map(attr => (
                      <div key={attr.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm animate-in fade-in slide-in-from-top-2">
                         <div className="bg-gray-50 px-4 py-3 border-b border-gray-100 flex justify-between items-center">
                            <h5 className="font-bold text-gray-700 flex items-center gap-2">
                               <Grid size={16} className="text-indigo-500" />
                               {attr.name}
                            </h5>
                            <button onClick={() => removeAttributeGroup(attr.id)} className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50">
                               <Trash2 size={16} />
                            </button>
                         </div>
                         <div className="p-4">
                            {/* Color Palette Logic if name is 'Color' */}
                            {attr.name.toLowerCase() === 'color' && (
                               <div className="flex flex-wrap gap-2 mb-4 p-2 bg-gray-50 rounded-lg">
                                  {PRESET_COLORS.map(c => (
                                     <button 
                                       key={c.value}
                                       onClick={() => addOptionToGroup(attr.id, c.name)}
                                       className="w-6 h-6 rounded-full border border-gray-300 shadow-sm hover:scale-110 transition-transform"
                                       style={{ backgroundColor: c.value }}
                                       title={c.name}
                                     />
                                  ))}
                               </div>
                            )}

                            {/* Chips */}
                            <div className="flex flex-wrap gap-2 mb-3">
                               {attr.options.map(opt => (
                                  <span key={opt.id} className="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-2 border border-indigo-100 animate-in zoom-in">
                                     {opt.name}
                                     <button onClick={() => removeOptionFromGroup(attr.id, opt.id)} className="hover:text-indigo-900"><X size={14} /></button>
                                  </span>
                               ))}
                            </div>

                            {/* Add Option Input */}
                            <div className="relative">
                               <input 
                                  type="text" 
                                  placeholder={`Escribe opción (ej. ${attr.name === 'Talla' ? 'XL' : 'Rojo'}) + Enter`}
                                  className="w-full p-2 pl-3 pr-10 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-300 transition-all"
                                  value={tempOptionInputs[attr.id] || ''}
                                  onChange={e => setTempOptionInputs(prev => ({...prev, [attr.id]: e.target.value}))}
                                  onKeyDown={e => {
                                     if (e.key === 'Enter') {
                                        e.preventDefault();
                                        addOptionToGroup(attr.id, tempOptionInputs[attr.id]);
                                     }
                                  }}
                               />
                               <button 
                                  onClick={() => addOptionToGroup(attr.id, tempOptionInputs[attr.id])}
                                  className="absolute right-1 top-1 p-1.5 bg-indigo-600 text-white rounded-md shadow-sm hover:bg-indigo-500"
                               >
                                  <Plus size={14} />
                               </button>
                            </div>
                         </div>
                      </div>
                   ))}

                   {/* Add New Group Input */}
                   <div className="flex gap-2 items-center pt-2">
                      <input 
                         type="text" 
                         placeholder="Nuevo Atributo (ej. Talla)" 
                         className="flex-1 p-3 bg-gray-50 rounded-xl border-none outline-none focus:ring-2 focus:ring-indigo-500/20"
                         value={newAttributeName}
                         onChange={e => setNewAttributeName(e.target.value)}
                         onKeyDown={e => e.key === 'Enter' && addAttributeGroup()}
                      />
                      <button 
                         onClick={addAttributeGroup}
                         className="bg-gray-800 text-white px-4 py-3 rounded-xl font-bold hover:bg-gray-700 flex items-center gap-2 whitespace-nowrap"
                      >
                         <Plus size={18} /> Crear Grupo
                      </button>
                   </div>
                </div>

                {/* Step 2: Generate Actions */}
                <div className="border-t border-gray-100 pt-6">
                   <div className="flex justify-between items-center mb-4">
                      <label className="text-xs font-bold text-gray-500 uppercase">2. Matriz de Variantes</label>
                      <button 
                         onClick={generateMatrix}
                         className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-500 hover:shadow-indigo-300 transition-all flex items-center gap-2"
                      >
                         <Wand2 size={16} /> Generar Combinaciones
                      </button>
                   </div>

                   {/* Step 3: Editable Table */}
                   {formData.variants && formData.variants.length > 0 ? (
                      <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                         <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                               <thead className="bg-gray-50 border-b border-gray-200">
                                  <tr>
                                     <th className="p-3 font-bold text-gray-600">Variante</th>
                                     <th className="p-3 font-bold text-gray-600 w-24">Precio</th>
                                     <th className="p-3 font-bold text-gray-600 w-24">Stock</th>
                                     <th className="p-3 font-bold text-gray-600 w-32">SKU</th>
                                     <th className="p-3 font-bold text-gray-600 w-10"></th>
                                  </tr>
                               </thead>
                               <tbody className="divide-y divide-gray-100">
                                  {formData.variants.map((variant) => (
                                     <tr key={variant.id} className="hover:bg-indigo-50/30 group bg-white">
                                        <td className="p-3 font-medium text-gray-800">
                                           {variant.name}
                                           <div className="flex gap-1 mt-1">
                                              {Object.entries(variant.combination).map(([key, val]) => (
                                                 <span key={key} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded border border-gray-200">{val}</span>
                                              ))}
                                           </div>
                                        </td>
                                        <td className="p-3">
                                           <div className="relative">
                                             <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                                             <input 
                                                type="number" 
                                                className="w-full pl-5 py-1.5 border border-gray-200 rounded text-center focus:border-indigo-500 outline-none font-bold"
                                                value={variant.price}
                                                onChange={(e) => updateVariant(variant.id, 'price', parseFloat(e.target.value))}
                                             />
                                           </div>
                                        </td>
                                        <td className="p-3">
                                           <input 
                                              type="number" 
                                              className="w-full py-1.5 border border-gray-200 rounded text-center focus:border-indigo-500 outline-none bg-gray-50 focus:bg-white"
                                              value={variant.stock}
                                              onChange={(e) => updateVariant(variant.id, 'stock', parseFloat(e.target.value))}
                                           />
                                        </td>
                                        <td className="p-3">
                                           <input 
                                              type="text" 
                                              className="w-full py-1.5 border border-gray-200 rounded px-2 text-xs focus:border-indigo-500 outline-none uppercase"
                                              value={variant.sku}
                                              onChange={(e) => updateVariant(variant.id, 'sku', e.target.value)}
                                           />
                                        </td>
                                        <td className="p-3 text-right">
                                           <button 
                                              onClick={() => removeVariant(variant.id)}
                                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                           >
                                              <Trash2 size={16} />
                                           </button>
                                        </td>
                                     </tr>
                                  ))}
                               </tbody>
                            </table>
                         </div>
                         <div className="bg-gray-50 p-2 text-xs text-center text-gray-400 border-t border-gray-200">
                            {formData.variants.length} variantes generadas
                         </div>
                      </div>
                   ) : (
                      <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
                         <Layers className="mx-auto h-10 w-10 text-gray-300 mb-2" />
                         <p className="text-gray-500 font-medium">No hay variantes generadas aún.</p>
                         <p className="text-xs text-gray-400">Agrega atributos arriba y presiona "Generar".</p>
                      </div>
                   )}
                </div>

             </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-5 bg-white border-t border-gray-100 flex justify-end gap-3 z-20">
           <button onClick={onClose} className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-50 transition-colors">
              Cancelar
           </button>
           <button 
             onClick={handleSubmit} 
             className="px-8 py-3 rounded-xl font-bold bg-blue-600 text-white shadow-lg hover:bg-blue-500 hover:shadow-blue-500/30 active:scale-95 transition-all flex items-center gap-2"
           >
              <Save size={20} /> Guardar Producto
           </button>
        </div>

      </div>
    </div>
  );
};

export default ProductForm;