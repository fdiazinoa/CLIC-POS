import React, { useState, useRef } from 'react';
import { 
  X, Save, Barcode, DollarSign, Box, Plus, Trash2, 
  Info, Layers, RefreshCw, CheckCircle2, Tag, 
  Package, LayoutGrid, FileText, Settings2, Upload,
  Image as ImageIcon, Percent, ShoppingCart, Calculator, Download,
  ShieldAlert, AlertCircle
} from 'lucide-react';
import { 
  Product, ProductAttribute, ProductVariant, BusinessConfig, Tariff, TariffPrice 
} from '../types';

interface ProductFormProps {
  initialData?: Product | null;
  config: BusinessConfig;
  availableTariffs: Tariff[];
  hasHistory?: boolean;
  onSave: (product: Product) => void;
  onClose: () => void;
}

type ProductTab = 'GENERAL' | 'PRICING' | 'VARIANTS';

// Mock Templates available for import
const MOCK_IMPORT_TEMPLATES = [
  { 
    id: 't1', 
    name: 'Tallas Estándar (Adulto)', 
    attributeName: 'Talla Ropa', 
    options: [
      { name: 'Pequeño', code: 'S' },
      { name: 'Mediano', code: 'M' },
      { name: 'Grande', code: 'L' },
      { name: 'Extra Grande', code: 'XL' }
    ]
  },
  { 
    id: 't2', 
    name: 'Colores Corporativos', 
    attributeName: 'Color Base', 
    options: [
      { name: 'Azul Marino', code: 'AZ' },
      { name: 'Negro', code: 'NG' },
      { name: 'Blanco', code: 'BL' }
    ]
  }
];

const ProductForm: React.FC<ProductFormProps> = ({ initialData, config, availableTariffs, hasHistory = false, onSave, onClose }) => {
  const [activeTab, setActiveTab] = useState<ProductTab>('GENERAL');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [formData, setFormData] = useState<Product>(initialData || {
    id: `PRD_${Date.now()}`,
    name: '',
    type: 'PRODUCT',
    category: 'General',
    images: [],
    attributes: [],
    variants: [],
    tariffs: [],
    stockBalances: {},
    activeInWarehouses: [],
    price: 0,
    barcode: '',
    trackStock: true,
    purchaseTax: 0,
    salesTax: config.taxRate * 100,
    cost: 0
  });

  const [optionInputs, setOptionInputs] = useState<Record<string, string>>({});
  const [showImportModal, setShowImportModal] = useState(false);

  // Integrity Check: Can we add variants?
  // Only blocked if it has history AND doesn't already have variants defined.
  // (Adding a new dimension to an existing variant product is also risky but usually permitted).
  // The hardest rule is converting a Simple Product to a Variant Product after sales.
  const isVariantCreationBlocked = hasHistory && formData.attributes.length === 0;

  // --- LOGIC: IMAGES ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ 
          ...prev, 
          image: reader.result as string,
          images: prev.images.includes(reader.result as string) ? prev.images : [reader.result as string, ...prev.images]
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const removeGalleryImage = (img: string) => {
    setFormData(prev => ({
      ...prev,
      images: prev.images.filter(i => i !== img),
      image: prev.image === img ? prev.images[1] || undefined : prev.image
    }));
  };

  // --- LOGIC: TARIFFS ---
  const handleToggleTariff = (tariff: Tariff) => {
    const isPresent = formData.tariffs.some(t => t.tariffId === tariff.id);
    if (isPresent) {
      setFormData(prev => ({
        ...prev,
        tariffs: prev.tariffs.filter(t => t.tariffId !== tariff.id)
      }));
    } else {
      const baseCost = formData.cost || 0;
      const taxPct = formData.salesTax || 0;
      const marginPct = 30;
      const newTariffPrice: TariffPrice = {
        tariffId: tariff.id,
        name: tariff.name,
        costBase: baseCost,
        margin: marginPct,
        tax: taxPct,
        finalPrice: baseCost * (1 + marginPct / 100) * (1 + taxPct / 100)
      };
      setFormData(prev => ({
        ...prev,
        tariffs: [...prev.tariffs, newTariffPrice]
      }));
    }
  };

  const updateTariffDetail = (tariffId: string, field: keyof TariffPrice, value: number) => {
    setFormData(prev => {
      const newTariffs = prev.tariffs.map(t => {
        if (t.tariffId === tariffId) {
          const updated = { ...t, [field]: value };
          if (field !== 'finalPrice') {
             updated.finalPrice = updated.costBase * (1 + updated.margin / 100) * (1 + updated.tax / 100);
          } else {
             if (updated.costBase > 0) {
                const netPrice = value / (1 + updated.tax / 100);
                updated.margin = ((netPrice - updated.costBase) / updated.costBase) * 100;
             }
          }
          return updated;
        }
        return t;
      });
      return { ...prev, tariffs: newTariffs };
    });
  };

  // --- LOGIC: ATTRIBUTES & VARIANTS ---
  const addAttribute = () => {
    if (isVariantCreationBlocked) return;
    const newId = Math.random().toString(36).substr(2, 9);
    setFormData(prev => ({
      ...prev,
      attributes: [...prev.attributes, { id: newId, name: '', options: [], optionCodes: [] }]
    }));
  };

  const updateAttributeName = (id: string, name: string) => {
    setFormData(prev => ({
      ...prev,
      attributes: prev.attributes.map(a => a.id === id ? { ...a, name } : a)
    }));
  };

  const addOption = (attrId: string) => {
    const value = optionInputs[attrId]?.trim();
    if (!value) return;

    setFormData(prev => ({
      ...prev,
      attributes: prev.attributes.map(a => {
        if (a.id === attrId && !a.options.includes(value)) {
          const code = value.substring(0, 3).toUpperCase();
          const currentCodes = a.optionCodes || [];
          return { 
            ...a, 
            options: [...a.options, value],
            optionCodes: [...currentCodes, code]
          };
        }
        return a;
      })
    }));
    setOptionInputs(prev => ({ ...prev, [attrId]: '' }));
  };

  const removeOption = (attrId: string, optionValue: string) => {
    setFormData(prev => ({
      ...prev,
      attributes: prev.attributes.map(a => {
        if (a.id === attrId) {
          const idx = a.options.indexOf(optionValue);
          if (idx === -1) return a;
          const newOptions = a.options.filter((_, i) => i !== idx);
          const newCodes = (a.optionCodes || []).filter((_, i) => i !== idx);
          return { ...a, options: newOptions, optionCodes: newCodes };
        }
        return a;
      })
    }));
  };

  const removeAttribute = (id: string) => {
    setFormData(prev => ({
      ...prev,
      attributes: prev.attributes.filter(a => a.id !== id)
    }));
  };

  const handleImportTemplate = (templateId: string) => {
    if (isVariantCreationBlocked) return;
    const template = MOCK_IMPORT_TEMPLATES.find(t => t.id === templateId);
    if (!template) return;
    const newId = Math.random().toString(36).substr(2, 9);
    const newAttr: ProductAttribute = {
      id: newId,
      name: template.attributeName,
      options: template.options.map(o => o.name),
      optionCodes: template.options.map(o => o.code)
    };
    setFormData(prev => ({
      ...prev,
      attributes: [...prev.attributes, newAttr]
    }));
    setShowImportModal(false);
  };

  const generateVariants = () => {
    const attrs = formData.attributes.filter(a => a.name && a.options.length > 0);
    if (attrs.length === 0) return;

    const cartesian = (arrays: any[][]): any[][] => {
      return arrays.reduce((a, b) => a.flatMap(d => b.map(e => [d, e].flat())), [[]] as any[][]);
    };

    const indices = attrs.map(a => a.options.map((_, i) => i));
    const combinations = cartesian(indices);
    
    const newVariants: ProductVariant[] = combinations.map((comboIndices) => {
      const attrValues: Record<string, string> = {};
      const skuParts: string[] = [formData.barcode || 'PRD'];

      attrs.forEach((attr, i) => {
        const optIndex = comboIndices[i];
        attrValues[attr.name] = attr.options[optIndex];
        const code = attr.optionCodes?.[optIndex] || attr.options[optIndex].substring(0, 3).toUpperCase();
        skuParts.push(code);
      });

      const sku = skuParts.join('-');
      return {
        sku: sku,
        barcode: [sku],
        attributeValues: attrValues,
        price: formData.price,
        initialStock: 0
      };
    });
    setFormData(prev => ({ ...prev, variants: newVariants }));
  };

  const updateVariantField = (idx: number, field: string, value: string) => {
    const newVariants = [...formData.variants];
    if (field === 'barcode') {
        newVariants[idx].barcode = [value];
        newVariants[idx].sku = value;
    } else if (field === 'stock') {
        newVariants[idx].initialStock = parseInt(value) || 0;
    }
    setFormData({ ...formData, variants: newVariants });
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-5xl h-[90vh] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* HEADER */}
        <div className="p-6 border-b flex justify-between items-center bg-gray-50/50 shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-600 text-white rounded-2xl shadow-lg">
              <Package size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-gray-800">{initialData ? 'Editar Artículo' : 'Nuevo Artículo'}</h2>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Mantenimiento de Catálogo</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* TABS NAVIGATION */}
        <div className="flex px-6 border-b bg-white shrink-0">
          {[
            { id: 'GENERAL', label: 'Datos Generales', icon: Info },
            { id: 'PRICING', label: 'Tarifas', icon: DollarSign },
            { id: 'VARIANTS', label: 'Variantes', icon: Layers },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as ProductTab)}
              className={`flex items-center gap-2 py-5 px-6 font-bold text-sm transition-all border-b-4 ${
                activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <tab.icon size={18} /> {tab.label}
            </button>
          ))}
        </div>

        {/* CONTENT AREA */}
        <div className="flex-1 overflow-y-auto p-8 bg-gray-50/30 no-scrollbar relative">
          
          {/* TAB: DATOS GENERALES */}
          {activeTab === 'GENERAL' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Image Section */}
                <div className="md:col-span-1 space-y-4">
                  <label className="block text-[10px] font-black text-gray-500 uppercase ml-1">Imagen del Producto</label>
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square bg-white rounded-[2rem] border-4 border-dashed border-gray-200 flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-all"
                  >
                    {formData.image ? (
                      <img src={formData.image} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <>
                        <ImageIcon size={48} className="text-gray-300 mb-2 group-hover:text-blue-400 transition-colors" />
                        <span className="text-xs font-bold text-gray-400 group-hover:text-blue-600">Subir Imagen</span>
                      </>
                    )}
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                  </div>
                  
                  {formData.images.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                       {formData.images.map((img, i) => (
                         <div key={i} className="w-12 h-12 rounded-xl border border-gray-200 overflow-hidden relative group">
                            <img src={img} className="w-full h-full object-cover" />
                            <button 
                              onClick={() => removeGalleryImage(img)}
                              className="absolute inset-0 bg-red-500/80 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                            >
                               <Trash2 size={12} />
                            </button>
                         </div>
                       ))}
                    </div>
                  )}
                </div>

                <div className="md:col-span-2 space-y-6">
                  <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 space-y-6">
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 ml-1">Nombre del Producto</label>
                      <input 
                        type="text" 
                        value={formData.name} 
                        onChange={e => setFormData({ ...formData, name: e.target.value })} 
                        className="w-full p-4 bg-gray-50 border-2 border-transparent rounded-2xl text-xl font-bold text-gray-800 outline-none focus:bg-white focus:border-blue-100 transition-all" 
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 ml-1">Tipo de Artículo</label>
                        <select 
                          value={formData.type} 
                          onChange={e => setFormData({ ...formData, type: e.target.value as any })} 
                          className="w-full p-4 bg-gray-50 border-none rounded-2xl font-bold text-gray-700 shadow-inner outline-none"
                        >
                          <option value="PRODUCT">Producto</option>
                          <option value="SERVICE">Servicio</option>
                          <option value="KIT">Combo / Kit</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 ml-1">Categoría</label>
                        <input 
                          type="text" 
                          value={formData.category} 
                          onChange={e => setFormData({ ...formData, category: e.target.value })} 
                          className="w-full p-4 bg-gray-50 border-none rounded-2xl font-bold text-gray-700 shadow-inner" 
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
                    <h3 className="text-xs font-black text-gray-400 uppercase mb-4 flex items-center gap-2">
                       <Percent size={14} className="text-emerald-500" /> Configuración Fiscal
                    </h3>
                    <div className="grid grid-cols-2 gap-6">
                       <div>
                          <label className="block text-[10px] font-black text-gray-500 uppercase mb-1 ml-1">Impuesto de Compra (%)</label>
                          <input 
                             type="number" 
                             value={formData.purchaseTax}
                             step="any"
                             onChange={e => setFormData({...formData, purchaseTax: parseFloat(e.target.value) || 0})}
                             className="w-full p-3 bg-gray-50 rounded-xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-emerald-100"
                          />
                       </div>
                       <div>
                          <label className="block text-[10px] font-black text-gray-500 uppercase mb-1 ml-1">Impuesto de Venta (%)</label>
                          <input 
                             type="number" 
                             value={formData.salesTax}
                             step="any"
                             onChange={e => setFormData({...formData, salesTax: parseFloat(e.target.value) || 0})}
                             className="w-full p-3 bg-gray-50 rounded-xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-emerald-100"
                          />
                       </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
                 <h3 className="text-xs font-black text-gray-400 uppercase mb-4 flex items-center gap-2">
                    <Barcode size={14} /> Identificación y Control
                 </h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                       <div>
                          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-1">Código de Barras Principal</label>
                          <input 
                             type="text" 
                             value={formData.barcode}
                             onChange={e => setFormData({...formData, barcode: e.target.value})}
                             className="w-full p-3 bg-gray-50 rounded-xl font-mono text-sm outline-none focus:ring-2 focus:ring-blue-100"
                             placeholder="Escanea o escribe..."
                          />
                       </div>
                       <label className="flex items-center gap-3 cursor-pointer group p-2">
                          <div className={`w-10 h-6 rounded-full relative transition-colors ${formData.trackStock ? 'bg-blue-600' : 'bg-gray-300'}`}>
                             <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${formData.trackStock ? 'left-5' : 'left-1'}`} />
                          </div>
                          <span className="text-sm font-bold text-gray-600">Controlar Inventario</span>
                          <input type="checkbox" className="hidden" checked={formData.trackStock} onChange={e => setFormData({...formData, trackStock: e.target.checked})} />
                       </label>
                    </div>
                    <div>
                       <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 ml-1">Descripción Detallada</label>
                       <textarea 
                         value={formData.description}
                         onChange={e => setFormData({...formData, description: e.target.value})}
                         placeholder="Información adicional..."
                         className="w-full p-4 bg-gray-50 border-none rounded-2xl font-medium text-gray-600 shadow-inner h-24 resize-none outline-none focus:ring-2 focus:ring-blue-100"
                       />
                    </div>
                 </div>
              </div>
            </div>
          )}

          {/* TAB: TARIFAS */}
          {activeTab === 'PRICING' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-right-4">
               <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex items-center justify-between">
                  <div className="flex items-center gap-4">
                     <div className="p-3 bg-blue-50 text-blue-600 rounded-xl"><Calculator size={24} /></div>
                     <div>
                        <h4 className="font-black text-gray-800">Costo Base General</h4>
                        <p className="text-xs text-gray-400 uppercase font-bold tracking-widest">Referencia para cálculos de margen</p>
                     </div>
                  </div>
                  <div className="relative">
                     <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                     <input 
                        type="number" 
                        step="any"
                        value={formData.cost} 
                        onChange={(e) => setFormData({...formData, cost: parseFloat(e.target.value) || 0})}
                        className="p-4 pl-10 bg-gray-50 rounded-2xl font-black text-2xl text-gray-800 outline-none w-48 text-right shadow-inner"
                     />
                  </div>
               </div>

               <div className="space-y-4 pb-10">
                  <div className="flex justify-between items-center px-4">
                     <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest">Gestión de Tarifas Específicas</h3>
                  </div>
                  {availableTariffs.map((tariff) => {
                     const activeTariff = formData.tariffs.find(t => t.tariffId === tariff.id);
                     return (
                        <div key={tariff.id} className={`bg-white rounded-[2rem] border-2 transition-all overflow-hidden ${activeTariff ? 'border-blue-500 shadow-md ring-4 ring-blue-50' : 'border-gray-100 opacity-60 hover:opacity-100'}`}>
                           <div className="p-6 flex items-center justify-between gap-6 flex-wrap md:flex-nowrap">
                              <div className="flex-1 min-w-[200px]">
                                 <div className="flex items-center gap-2 mb-1">
                                    <span className="font-black text-gray-800 text-lg leading-tight">{tariff.name}</span>
                                    {activeTariff && <CheckCircle2 size={16} className="text-blue-500 shrink-0" />}
                                 </div>
                                 <p className="text-[10px] text-gray-400 uppercase font-bold tracking-tighter">ID: {tariff.id} • Moneda: {tariff.currency}</p>
                              </div>
                              {!activeTariff ? (
                                 <button 
                                    onClick={() => handleToggleTariff(tariff)}
                                    className="px-8 py-3 bg-gray-900 text-white rounded-2xl font-bold text-sm shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                                 >
                                    <Plus size={16} /> Activar Tarifa
                                 </button>
                              ) : (
                                 <div className="flex items-center gap-4 flex-wrap justify-end">
                                    <div className="flex flex-col items-center">
                                       <label className="text-[10px] font-bold text-gray-400 uppercase mb-1">Margen %</label>
                                       <input 
                                          type="number" 
                                          step="any"
                                          value={activeTariff.margin} 
                                          onChange={e => updateTariffDetail(tariff.id, 'margin', parseFloat(e.target.value) || 0)}
                                          className="w-24 p-3 bg-gray-50 border border-gray-100 rounded-xl text-center font-bold text-gray-700 focus:ring-2 focus:ring-blue-100 outline-none"
                                       />
                                    </div>
                                    <div className="flex flex-col items-center">
                                       <label className="text-[10px] font-bold text-gray-400 uppercase mb-1">IVA %</label>
                                       <input 
                                          type="number" 
                                          step="any"
                                          value={activeTariff.tax} 
                                          onChange={e => updateTariffDetail(tariff.id, 'tax', parseFloat(e.target.value) || 0)}
                                          className="w-24 p-3 bg-gray-50 border border-gray-100 rounded-xl text-center font-bold text-gray-700 focus:ring-2 focus:ring-blue-100 outline-none"
                                       />
                                    </div>
                                    <div className="flex flex-col items-end">
                                       <label className="text-[10px] font-bold text-blue-500 uppercase mb-1">Precio Final</label>
                                       <div className="relative">
                                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-400 font-bold">$</span>
                                          <input 
                                             type="number" 
                                             step="any"
                                             value={activeTariff.finalPrice} 
                                             onChange={e => updateTariffDetail(tariff.id, 'finalPrice', parseFloat(e.target.value) || 0)}
                                             className="p-3 pl-8 bg-blue-50 rounded-xl font-black text-blue-700 outline-none w-40 text-right text-xl focus:ring-2 focus:ring-blue-200"
                                          />
                                       </div>
                                    </div>
                                    <button 
                                       onClick={() => handleToggleTariff(tariff)}
                                       className="p-4 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"
                                       title="Desactivar"
                                    >
                                       <Trash2 size={24} />
                                    </button>
                                 </div>
                              )}
                           </div>
                        </div>
                     );
                  })}
               </div>
            </div>
          )}

          {/* TAB: VARIANTS */}
          {activeTab === 'VARIANTS' && (
            <div className="space-y-8 animate-in slide-in-from-right-4 max-w-4xl mx-auto">
              
              {/* BLOQUEO POR HISTORIAL */}
              {isVariantCreationBlocked && (
                <div className="bg-amber-50 border border-amber-200 rounded-[2rem] p-6 flex items-start gap-4 shadow-sm animate-in zoom-in-95">
                  <div className="p-3 bg-amber-100 text-amber-600 rounded-2xl shrink-0">
                    <ShieldAlert size={32} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-amber-800">Funcionalidad Restringida</h3>
                    <p className="text-sm text-amber-700 font-medium leading-relaxed mt-1">
                      Este producto ya posee <strong>historial de ventas o movimientos</strong> en el sistema. 
                      Para mantener la integridad de los reportes y el stock, no es posible habilitar la propiedad de variantes en un artículo que comenzó como producto simple.
                    </p>
                    <div className="mt-4 flex items-center gap-2 text-[10px] font-black text-amber-600 uppercase tracking-widest bg-amber-100/50 w-fit px-3 py-1 rounded-full">
                       <AlertCircle size={12} /> Integridad de Datos Protegida
                    </div>
                  </div>
                </div>
              )}

              {/* 1. DEFINE DIMENSIONS */}
              <div className={`bg-white border border-gray-100 rounded-[2rem] shadow-sm overflow-hidden transition-opacity ${isVariantCreationBlocked ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg"><Settings2 size={20} /></div>
                    <h3 className="font-black text-gray-800">1. Definir Dimensiones (Talla, Color, etc.)</h3>
                  </div>
                  <div className="flex gap-2">
                     <button 
                        disabled={isVariantCreationBlocked}
                        onClick={() => setShowImportModal(true)} 
                        className="flex items-center gap-2 px-4 py-2 bg-pink-50 text-pink-600 rounded-xl font-bold text-sm hover:bg-pink-100 transition-colors disabled:opacity-50"
                     >
                        <Download size={18} /> Importar Grupo
                     </button>
                     <button 
                        disabled={isVariantCreationBlocked}
                        onClick={addAttribute} 
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-md active:scale-95 transition-all disabled:opacity-50"
                     >
                        <Plus size={18} /> Añadir Atributo
                     </button>
                  </div>
                </div>
                <div className="p-6 space-y-4">
                  {formData.attributes.length === 0 && (
                     <div className="text-center py-10 text-gray-400">
                        <p>{isVariantCreationBlocked ? 'Variantes no permitidas para este artículo.' : 'No hay atributos definidos. Agrega uno o importa un grupo.'}</p>
                     </div>
                  )}
                  {formData.attributes.map((attr) => (
                    <div key={attr.id} className="p-6 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col gap-4">
                      <div className="flex items-center gap-4">
                        <div className="flex-1">
                          <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">Nombre Dimensión</label>
                          <input 
                            type="text" 
                            placeholder="Ej: Talla" 
                            value={attr.name}
                            onChange={(e) => updateAttributeName(attr.id, e.target.value)}
                            className="w-full p-3 bg-white border-none rounded-xl font-bold text-gray-700 shadow-sm focus:ring-2 focus:ring-indigo-500/20"
                          />
                        </div>
                        <button onClick={() => removeAttribute(attr.id)} className="mt-5 p-3 text-red-400 hover:text-red-600 rounded-xl transition-colors"><Trash2 size={20} /></button>
                      </div>
                      <div className="space-y-3">
                         <label className="block text-[10px] font-black text-gray-400 uppercase ml-1">Opciones (Escribe y presiona ENTER)</label>
                         <div className="flex flex-wrap gap-2 p-2 bg-white rounded-xl border border-gray-100 min-h-[50px] shadow-inner">
                            {attr.options.map((opt, i) => (
                              <span key={i} className="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2">
                                {opt}
                                {attr.optionCodes?.[i] && <span className="bg-indigo-200 px-1 rounded text-[9px]">{attr.optionCodes[i]}</span>}
                                <button onClick={() => removeOption(attr.id, opt)} className="hover:text-red-500 transition-colors"><X size={14} /></button>
                              </span>
                            ))}
                            <input 
                               type="text"
                               placeholder="Valor..."
                               value={optionInputs[attr.id] || ''}
                               onChange={(e) => setOptionInputs({...optionInputs, [attr.id]: e.target.value})}
                               onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addOption(attr.id))}
                               className="flex-1 min-w-[150px] border-none outline-none bg-transparent text-sm font-medium"
                            />
                         </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* GENERATE ACTION */}
              {formData.attributes.some(a => a.name && a.options.length > 0) && !isVariantCreationBlocked && (
                <div className="flex justify-center">
                  <button onClick={generateVariants} className="px-10 py-5 bg-slate-900 text-white rounded-[2rem] font-black text-lg shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-3">
                    <RefreshCw size={24} /> GENERAR MATRIZ DE VARIANTES
                  </button>
                </div>
              )}

              {/* 2. THE MATRIX */}
              {formData.variants.length > 0 && (
                <div className="bg-white border border-gray-100 rounded-[2rem] shadow-sm overflow-hidden">
                   <div className="p-6 border-b border-gray-100 bg-gray-50">
                      <h3 className="font-black text-gray-800">2. Matriz de Variantes ({formData.variants.length})</h3>
                   </div>
                   <div className="overflow-x-auto">
                      <table className="w-full text-left">
                         <thead className="bg-white border-b border-gray-100 text-xs text-gray-400 uppercase">
                            <tr>
                               <th className="p-4 font-black">Variante</th>
                               <th className="p-4 font-black">SKU</th>
                               <th className="p-4 font-black w-32">Stock Inicial</th>
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-gray-50">
                            {formData.variants.map((variant, idx) => (
                               <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                                  <td className="p-4">
                                     <div className="flex gap-2">
                                        {Object.entries(variant.attributeValues).map(([key, val]) => (
                                           <span key={key} className="px-2 py-1 bg-gray-100 rounded text-xs font-bold text-gray-600">{val}</span>
                                        ))}
                                     </div>
                                  </td>
                                  <td className="p-4">
                                     <input 
                                        type="text" 
                                        value={variant.sku}
                                        onChange={(e) => updateVariantField(idx, 'barcode', e.target.value)}
                                        className="w-full bg-transparent border-b border-gray-200 focus:border-blue-500 outline-none font-mono text-sm"
                                     />
                                  </td>
                                  <td className="p-4">
                                     <input 
                                        type="number" 
                                        value={variant.initialStock || 0}
                                        onChange={(e) => updateVariantField(idx, 'stock', e.target.value)}
                                        className="w-full bg-gray-50 rounded-lg p-2 text-center font-bold outline-none focus:ring-2 focus:ring-blue-100"
                                     />
                                  </td>
                               </tr>
                            ))}
                         </tbody>
                      </table>
                   </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* FOOTER */}
        <div className="p-6 bg-white border-t border-gray-100 flex justify-end gap-3 shrink-0 z-10">
           <button onClick={onClose} className="px-8 py-4 text-gray-500 font-bold hover:bg-gray-50 rounded-2xl transition-colors">
              Cancelar
           </button>
           <button 
             onClick={() => onSave(formData)} 
             className="px-10 py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-xl shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2"
           >
              <Save size={20} /> Guardar Producto
           </button>
        </div>

        {/* --- IMPORT MODAL --- */}
        {showImportModal && (
           <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-8 animate-in fade-in">
              <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-full">
                 <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                    <h3 className="text-lg font-black text-gray-800">Importar Grupo de Variantes</h3>
                    <button onClick={() => setShowImportModal(false)} className="p-2 hover:bg-gray-200 rounded-full text-gray-500"><X size={20}/></button>
                 </div>
                 <div className="p-6 overflow-y-auto space-y-4">
                    <p className="text-sm text-gray-500 mb-4">Selecciona un grupo predefinido para cargar sus atributos y valores automáticamente.</p>
                    {MOCK_IMPORT_TEMPLATES.map(tpl => (
                       <button 
                          key={tpl.id}
                          onClick={() => handleImportTemplate(tpl.id)}
                          className="w-full text-left p-4 rounded-xl border-2 border-gray-100 hover:border-pink-300 hover:bg-pink-50 transition-all group"
                       >
                          <h4 className="font-bold text-gray-800 group-hover:text-pink-700">{tpl.name}</h4>
                          <div className="flex gap-2 mt-2 flex-wrap">
                             {tpl.options.map((opt, i) => (
                                <span key={i} className="text-[10px] bg-white border border-gray-200 px-2 py-1 rounded text-gray-500 font-mono">
                                   {opt.name} ({opt.code})
                                </span>
                             ))}
                          </div>
                       </button>
                    ))}
                 </div>
              </div>
           </div>
        )}

      </div>
    </div>
  );
};

export default ProductForm;