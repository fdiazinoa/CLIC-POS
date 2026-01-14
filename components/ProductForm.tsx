
import React, { useState, useRef, useMemo } from 'react';
import {
   X, Save, Barcode, DollarSign, Box, Plus, Trash2,
   Info, Layers, RefreshCw, CheckCircle2, Tag,
   Package, LayoutGrid, FileText, Settings2, Upload,
   Image as ImageIcon, Percent, ShoppingCart, Calculator, Download,
   ShieldAlert, AlertCircle, Check, LayoutTemplate
} from 'lucide-react';
import {
   Product, ProductAttribute, ProductVariant, BusinessConfig, Tariff, TariffPrice, TaxDefinition
} from '../types';

interface ProductFormProps {
   initialData?: Product | null;
   config: BusinessConfig;
   availableTariffs: Tariff[];
   hasHistory?: boolean;
   onSave: (product: Product) => void;
   onClose: () => void;
}

type ProductTab = 'GENERAL' | 'PRICING' | 'VARIANTS' | 'TAXES' | 'STOCK';

// Mock templates simulating data from VariantManager
const PREDEFINED_TEMPLATES = [
   { id: 'tpl_1', name: 'Tallas Ropa (Letras)', attrName: 'Talla', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
   { id: 'tpl_2', name: 'Tallas Calzado (EU)', attrName: 'Talla', options: ['36', '37', '38', '39', '40', '41', '42', '43', '44'] },
   { id: 'tpl_3', name: 'Colores Básicos', attrName: 'Color', options: ['Blanco', 'Negro', 'Azul Marino', 'Rojo', 'Gris'] },
   { id: 'tpl_4', name: 'Colores Pastel', attrName: 'Color', options: ['Rosa Palo', 'Celeste', 'Menta', 'Crema', 'Lila'] },
   { id: 'tpl_5', name: 'Materiales', attrName: 'Material', options: ['Algodón', 'Poliéster', 'Lana', 'Seda', 'Lino'] },
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
      salesTax: 0,
      appliedTaxIds: config.taxes?.[0] ? [config.taxes[0].id] : [],
      cost: 0,
      description: ''
   });

   const [optionInputs, setOptionInputs] = useState<Record<string, string>>({});
   const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);

   const isVariantCreationBlocked = hasHistory && (!formData.attributes || formData.attributes.length === 0);

   // --- LOGIC: TAXES ---
   const toggleTax = (taxId: string) => {
      setFormData(prev => {
         const current = prev.appliedTaxIds || [];
         const isSelected = current.includes(taxId);
         return {
            ...prev,
            appliedTaxIds: isSelected ? current.filter(id => id !== taxId) : [...current, taxId]
         };
      });
   };

   const combinedTaxRate = useMemo(() => {
      const activeTaxes = config.taxes.filter(t => formData.appliedTaxIds?.includes(t.id));
      return activeTaxes.reduce((sum, t) => sum + t.rate, 0);
   }, [formData.appliedTaxIds, config.taxes]);

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
         const taxPct = combinedTaxRate * 100;
         const marginPct = 30;
         const newTariffPrice: TariffPrice = {
            tariffId: tariff.id,
            name: tariff.name,
            costBase: baseCost,
            margin: marginPct,
            tax: taxPct,
            price: baseCost * (1 + marginPct / 100) * (1 + combinedTaxRate)
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
               if (field !== 'price') {
                  updated.price = (updated.costBase || 0) * (1 + (updated.margin || 0) / 100) * (1 + (updated.tax || 0) / 100);
               } else {
                  if (updated.costBase && updated.costBase > 0) {
                     const netPrice = value / (1 + (updated.tax || 0) / 100);
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
      const newId = Math.random().toString(36).substr(2, 9);
      setFormData(prev => ({
         ...prev,
         attributes: [...(prev.attributes || []), { id: newId, name: '', options: [], optionCodes: [] }]
      }));
   };

   const applyTemplate = (template: typeof PREDEFINED_TEMPLATES[0]) => {
      const newId = Math.random().toString(36).substr(2, 9);
      const newAttr: ProductAttribute = {
         id: newId,
         name: template.attrName,
         options: [...template.options],
         optionCodes: template.options.map(o => o.substring(0, 3).toUpperCase())
      };

      setFormData(prev => ({
         ...prev,
         attributes: [...(prev.attributes || []), newAttr]
      }));
      setIsTemplateModalOpen(false);
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

         const generatedCode = skuParts.join('-');
         return {
            sku: formData.barcode || 'PRD',
            barcode: [generatedCode],
            attributeValues: attrValues,
            price: formData.price,
            initialStock: 0
         };
      });
      setFormData(prev => ({ ...prev, variants: newVariants }));
   };

   const updateVariant = (index: number, field: 'sku' | 'barcode' | 'price', value: string) => {
      setFormData(prev => {
         const newVariants = [...prev.variants];
         if (field === 'barcode') {
            newVariants[index] = { ...newVariants[index], barcode: [value] };
         } else if (field === 'sku') {
            newVariants[index] = { ...newVariants[index], sku: value };
         } else if (field === 'price') {
            newVariants[index] = { ...newVariants[index], price: parseFloat(value) || 0 };
         }
         return { ...prev, variants: newVariants };
      });
   };

   const removeVariant = (index: number) => {
      setFormData(prev => ({
         ...prev,
         variants: prev.variants.filter((_, i) => i !== index)
      }));
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
                  { id: 'TAXES', label: 'Impuestos', icon: Percent },
                  { id: 'PRICING', label: 'Tarifas', icon: DollarSign },
                  { id: 'VARIANTS', label: 'Variantes', icon: Layers },
                  { id: 'STOCK', label: 'Stocks', icon: Box },
               ].map(tab => (
                  <button
                     key={tab.id}
                     onClick={() => setActiveTab(tab.id as ProductTab)}
                     className={`flex items-center gap-2 py-5 px-6 font-bold text-sm transition-all border-b-4 ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
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
                              <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                           </div>
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

                              <div className="grid grid-cols-2 gap-4">
                                 <div>
                                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 ml-1">Costo ($)</label>
                                    <input
                                       type="number"
                                       value={formData.cost || 0}
                                       onChange={e => setFormData({ ...formData, cost: parseFloat(e.target.value) })}
                                       className="w-full p-4 bg-white border-2 border-gray-100 rounded-2xl font-bold text-gray-700 outline-none focus:border-blue-200"
                                    />
                                 </div>
                                 <div>
                                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 ml-1">Precio Base ($)</label>
                                    <input
                                       type="number"
                                       value={formData.price}
                                       onChange={e => setFormData({ ...formData, price: parseFloat(e.target.value) })}
                                       className="w-full p-4 bg-white border-2 border-gray-100 rounded-2xl font-bold text-gray-700 outline-none focus:border-blue-200"
                                    />
                                 </div>
                              </div>

                              <div>
                                 <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 ml-1">Código de Barras / SKU</label>
                                 <div className="relative">
                                    <input
                                       type="text"
                                       value={formData.barcode || ''}
                                       onChange={e => setFormData({ ...formData, barcode: e.target.value })}
                                       className="w-full p-4 pl-12 bg-white border-2 border-gray-100 rounded-2xl font-mono text-gray-700 outline-none focus:border-blue-200"
                                    />
                                    <Barcode className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                                 </div>
                              </div>
                           </div>
                        </div>
                     </div>
                  </div>
               )}

               {/* TAB: TAXES */}
               {activeTab === 'TAXES' && (
                  <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-right-4">
                     <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
                        <div className="flex justify-between items-center mb-6">
                           <div>
                              <h3 className="text-xl font-bold text-gray-800">Impuestos Aplicables</h3>
                              <p className="text-sm text-gray-400">Selecciona uno o varios impuestos para este producto.</p>
                           </div>
                           <div className="bg-blue-50 px-4 py-2 rounded-xl text-blue-600 font-black text-lg">
                              Tasa Total: {(combinedTaxRate * 100).toFixed(1)}%
                           </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           {config.taxes.map(tax => {
                              const isSelected = formData.appliedTaxIds?.includes(tax.id);
                              return (
                                 <div
                                    key={tax.id}
                                    onClick={() => toggleTax(tax.id)}
                                    className={`p-5 rounded-2xl border-2 cursor-pointer transition-all flex items-center justify-between ${isSelected ? 'bg-blue-50 border-blue-600 shadow-sm' : 'bg-gray-50 border-transparent hover:border-gray-200'
                                       }`}
                                 >
                                    <div className="flex items-center gap-4">
                                       <div className={`w-6 h-6 rounded flex items-center justify-center border-2 transition-colors ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300'}`}>
                                          {isSelected && <Check size={14} strokeWidth={4} />}
                                       </div>
                                       <div>
                                          <p className={`font-bold ${isSelected ? 'text-blue-900' : 'text-gray-700'}`}>{tax.name}</p>
                                          <p className="text-[10px] text-gray-400 uppercase font-bold tracking-tighter">{tax.type}</p>
                                       </div>
                                    </div>
                                    <span className={`text-lg font-black ${isSelected ? 'text-blue-600' : 'text-gray-400'}`}>
                                       {(tax.rate * 100).toFixed(0)}%
                                    </span>
                                 </div>
                              );
                           })}
                        </div>
                     </div>

                     <div className="bg-amber-50 p-6 rounded-[2rem] border border-amber-100 flex items-start gap-4">
                        <AlertCircle className="text-amber-500 mt-1" size={24} />
                        <p className="text-sm text-amber-800">
                           <strong>Importante:</strong> Los productos de restaurantes usualmente requieren tanto el 18% (ITBIS) como el 10% (Propina Legal). Asegúrate de marcar ambos si aplica.
                        </p>
                     </div>
                  </div>
               )}

               {/* TAB: TARIFAS Y PRECIOS */}
               {activeTab === 'PRICING' && (
                  <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-right-4">
                     {/* Base Cost Reference */}
                     <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                           <div className="p-2 bg-slate-200 rounded-lg text-slate-600"><DollarSign size={20} /></div>
                           <div>
                              <p className="text-xs font-bold text-slate-500 uppercase">Costo Base</p>
                              <p className="text-lg font-black text-slate-800">{config.currencySymbol}{formData.cost?.toFixed(2) || '0.00'}</p>
                           </div>
                        </div>
                        <div className="text-right">
                           <p className="text-xs text-slate-400">Impuestos Globales</p>
                           <p className="font-bold text-slate-600">{(combinedTaxRate * 100).toFixed(1)}%</p>
                        </div>
                     </div>

                     <div className="grid grid-cols-1 gap-4">
                        {availableTariffs.map(tariff => {
                           const tariffDetail = formData.tariffs.find(t => t.tariffId === tariff.id);
                           const isActive = !!tariffDetail;

                           return (
                              <div key={tariff.id} className={`bg-white p-6 rounded-2xl border-2 transition-all ${isActive ? 'border-purple-500 shadow-md' : 'border-gray-100 opacity-75'}`}>
                                 <div className="flex justify-between items-center mb-6">
                                    <div className="flex items-center gap-3">
                                       <div className={`p-2 rounded-lg ${isActive ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-400'}`}>
                                          <Tag size={20} />
                                       </div>
                                       <div>
                                          <h4 className="font-bold text-gray-800">{tariff.name}</h4>
                                          <p className="text-xs text-gray-500">{tariff.strategy.type === 'MANUAL' ? 'Precio Manual' : 'Calculado'}</p>
                                       </div>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                       <input type="checkbox" className="sr-only peer" checked={isActive} onChange={() => handleToggleTariff(tariff)} />
                                       <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                                    </label>
                                 </div>

                                 {isActive && tariffDetail && (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-gray-100">
                                       <div>
                                          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Precio Final (Inc. Imp)</label>
                                          <div className="relative">
                                             <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                                             <input
                                                type="number"
                                                value={tariffDetail.price}
                                                onChange={(e) => updateTariffDetail(tariff.id, 'price', parseFloat(e.target.value))}
                                                className="w-full p-3 pl-8 bg-purple-50 border border-purple-100 rounded-xl font-black text-purple-900 outline-none focus:ring-2 focus:ring-purple-300 text-lg"
                                             />
                                          </div>
                                       </div>
                                       <div>
                                          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Margen (%)</label>
                                          <div className="relative">
                                             <input
                                                type="number"
                                                value={tariffDetail.margin?.toFixed(2)}
                                                onChange={(e) => updateTariffDetail(tariff.id, 'margin', parseFloat(e.target.value))}
                                                className="w-full p-3 bg-white border border-gray-200 rounded-xl font-bold text-gray-700 outline-none focus:border-purple-300"
                                             />
                                             <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">%</span>
                                          </div>
                                       </div>
                                       <div>
                                          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Utilidad Unit.</label>
                                          <div className="p-3 bg-gray-50 rounded-xl font-bold text-green-600 border border-gray-200">
                                             {config.currencySymbol}{((tariffDetail.price / (1 + combinedTaxRate)) - (formData.cost || 0)).toFixed(2)}
                                          </div>
                                       </div>
                                    </div>
                                 )}
                              </div>
                           );
                        })}
                     </div>
                  </div>
               )}

               {/* TAB: VARIANTES */}
               {activeTab === 'VARIANTS' && (
                  <div className="max-w-5xl mx-auto space-y-8 animate-in slide-in-from-right-4">

                     {/* Attribute Definition */}
                     <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-200">
                        <div className="flex justify-between items-center mb-6">
                           <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                              <Layers size={20} className="text-blue-500" /> Definición de Atributos
                           </h3>
                           <div className="flex gap-2">
                              <button
                                 onClick={() => setIsTemplateModalOpen(true)}
                                 className="px-4 py-2 bg-purple-50 text-purple-600 rounded-xl text-sm font-bold hover:bg-purple-100 transition-colors flex items-center gap-2"
                              >
                                 <LayoutTemplate size={16} /> Cargar Plantilla
                              </button>
                              <button onClick={addAttribute} className="px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-sm font-bold hover:bg-blue-100 transition-colors">
                                 + Agregar Atributo
                              </button>
                           </div>
                        </div>

                        <div className="space-y-6">
                           {formData.attributes.map((attr) => (
                              <div key={attr.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-200 relative group">
                                 <button onClick={() => removeAttribute(attr.id)} className="absolute top-2 right-2 p-2 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                    <Trash2 size={16} />
                                 </button>

                                 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div>
                                       <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nombre (Ej. Talla)</label>
                                       <input
                                          type="text"
                                          value={attr.name}
                                          onChange={(e) => updateAttributeName(attr.id, e.target.value)}
                                          placeholder="Color, Talla, Sabor..."
                                          className="w-full p-3 bg-white border border-gray-200 rounded-xl font-bold text-gray-800 outline-none focus:border-blue-400"
                                       />
                                    </div>
                                    <div className="md:col-span-2">
                                       <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Opciones (Enter para agregar)</label>
                                       <div className="flex flex-wrap gap-2 p-2 bg-white border border-gray-200 rounded-xl min-h-[50px] items-center">
                                          {attr.options.map((opt) => (
                                             <span key={opt} className="bg-blue-100 text-blue-700 px-3 py-1 rounded-lg text-sm font-bold flex items-center gap-1">
                                                {opt}
                                                <X size={12} className="cursor-pointer hover:text-blue-900" onClick={() => removeOption(attr.id, opt)} />
                                             </span>
                                          ))}
                                          <input
                                             type="text"
                                             value={optionInputs[attr.id] || ''}
                                             onChange={(e) => setOptionInputs({ ...optionInputs, [attr.id]: e.target.value })}
                                             onKeyDown={(e) => { if (e.key === 'Enter') addOption(attr.id); }}
                                             placeholder="Escribe y presiona Enter..."
                                             className="flex-1 min-w-[120px] bg-transparent outline-none text-sm font-medium p-1"
                                          />
                                       </div>
                                    </div>
                                 </div>
                              </div>
                           ))}
                           {(!formData.attributes || formData.attributes.length === 0) && (
                              <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-2xl">
                                 No hay atributos definidos. Agrega uno para crear variantes.
                              </div>
                           )}
                        </div>
                     </div>

                     {/* Variants Generation */}
                     {formData.attributes && formData.attributes.length > 0 && (
                        <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-200">
                           <div className="flex justify-between items-center mb-6">
                              <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                                 <Barcode size={20} className="text-green-500" /> Lista de Variantes
                              </h3>
                              <button
                                 onClick={generateVariants}
                                 className="px-6 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 shadow-lg flex items-center gap-2"
                              >
                                 <RefreshCw size={16} /> Generar Combinaciones
                              </button>
                           </div>

                           <div className="overflow-x-auto">
                              <table className="w-full text-left text-sm">
                                 <thead className="bg-gray-50 text-gray-500 uppercase font-bold text-xs">
                                    <tr>
                                       <th className="p-3 rounded-l-xl">SKU</th>
                                       <th className="p-3">Código de Barras</th>
                                       <th className="p-3">Combinación</th>
                                       <th className="p-3">Precio</th>
                                       <th className="p-3 text-center rounded-r-xl">Acciones</th>
                                    </tr>
                                 </thead>
                                 <tbody className="divide-y divide-gray-100">
                                    {formData.variants.map((variant, idx) => (
                                       <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                          <td className="p-3">
                                             <input
                                                type="text"
                                                value={variant.sku}
                                                onChange={(e) => updateVariant(idx, 'sku', e.target.value)}
                                                className="w-full bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none font-mono text-gray-700 font-bold transition-all"
                                             />
                                          </td>
                                          <td className="p-3">
                                             <div className="relative group">
                                                <input
                                                   type="text"
                                                   value={variant.barcode?.[0] || ''}
                                                   onChange={(e) => updateVariant(idx, 'barcode', e.target.value)}
                                                   placeholder="Escanear..."
                                                   className="w-full bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none pl-6 text-gray-600 transition-all"
                                                />
                                                <Barcode className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-300 group-hover:text-gray-400" size={14} />
                                             </div>
                                          </td>
                                          <td className="p-3">
                                             <div className="flex gap-2">
                                                {Object.entries(variant.attributeValues).map(([key, val]) => (
                                                   <span key={key} className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs border border-gray-200">
                                                      {val}
                                                   </span>
                                                ))}
                                             </div>
                                          </td>
                                          <td className="p-3 font-bold text-gray-900">
                                             <div className="relative">
                                                <span className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                                                <input
                                                   type="number"
                                                   value={variant.price}
                                                   onChange={(e) => updateVariant(idx, 'price', e.target.value)}
                                                   className="w-24 pl-3 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none"
                                                />
                                             </div>
                                          </td>
                                          <td className="p-3 text-center">
                                             <button onClick={() => removeVariant(idx)} className="text-red-400 hover:text-red-600 transition-colors">
                                                <Trash2 size={16} />
                                             </button>
                                          </td>
                                       </tr>
                                    ))}
                                    {(!formData.variants || formData.variants.length === 0) && (
                                       <tr>
                                          <td colSpan={5} className="p-8 text-center text-gray-400">
                                             Genera las variantes para ver la lista.
                                          </td>
                                       </tr>
                                    )}
                                 </tbody>
                              </table>
                           </div>
                        </div>
                     )}
                  </div>
               )}

               {/* TAB: STOCK */}
               {activeTab === 'STOCK' && (
                  <div className="max-w-6xl mx-auto space-y-8 animate-in slide-in-from-right-4">

                     {/* TOOLBAR */}
                     <div className="flex flex-wrap gap-2 mb-4">
                        <button className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold border border-blue-200 hover:bg-blue-100 flex items-center gap-1">
                           <Plus size={14} /> Añadir
                        </button>
                        <button className="px-3 py-1.5 bg-white text-gray-600 rounded-lg text-xs font-bold border border-gray-200 hover:bg-gray-50 flex items-center gap-1">
                           <Trash2 size={14} /> Quitar
                        </button>
                        <button className="px-3 py-1.5 bg-white text-gray-600 rounded-lg text-xs font-bold border border-gray-200 hover:bg-gray-50">
                           Consumo interno
                        </button>
                        <button className="px-3 py-1.5 bg-white text-gray-600 rounded-lg text-xs font-bold border border-gray-200 hover:bg-gray-50">
                           Eliminar Stocks
                        </button>
                        <button className="px-3 py-1.5 bg-white text-gray-600 rounded-lg text-xs font-bold border border-gray-200 hover:bg-gray-50">
                           Inventario
                        </button>
                        <button className="px-3 py-1.5 bg-white text-gray-600 rounded-lg text-xs font-bold border border-gray-200 hover:bg-gray-50">
                           Merma
                        </button>
                        <button className="px-3 py-1.5 bg-white text-gray-600 rounded-lg text-xs font-bold border border-gray-200 hover:bg-gray-50">
                           Regenerar stock
                        </button>
                     </div>

                     {/* STOCK TABLE */}
                     <div className="bg-white rounded-[1rem] shadow-sm border border-gray-200 overflow-hidden">
                        <div className="overflow-x-auto">
                           <table className="w-full text-left text-xs">
                              <thead className="bg-blue-100/50 text-gray-700 font-bold uppercase border-b border-blue-100">
                                 <tr>
                                    <th className="p-3 whitespace-nowrap">Subartículo</th>
                                    <th className="p-3 whitespace-nowrap">Almacén</th>
                                    <th className="p-3 whitespace-nowrap text-right">Stock</th>
                                    <th className="p-3 whitespace-nowrap text-right">Mínimo</th>
                                    <th className="p-3 whitespace-nowrap text-right">Máximo</th>
                                    <th className="p-3 whitespace-nowrap text-right">A Recibir</th>
                                    <th className="p-3 whitespace-nowrap text-right">A Servir</th>
                                    <th className="p-3 whitespace-nowrap text-right">Depósito</th>
                                    <th className="p-3 whitespace-nowrap text-right">Préstamo</th>
                                    <th className="p-3 whitespace-nowrap text-right">Pdte. Fab.</th>
                                    <th className="p-3 whitespace-nowrap text-right">En Fab.</th>
                                    <th className="p-3 whitespace-nowrap">Ubicación</th>
                                 </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                 {/* CONSOLIDATED STOCK */}
                                 <tr className="bg-blue-50/30 font-bold">
                                    <td className="p-3 text-gray-400 italic">Consolidado</td>
                                    <td className="p-3">W1 - Central</td>
                                    <td className="p-3 text-right">{formData.stock || 0}</td>
                                    <td className="p-3 text-right">{formData.minStock || 0}</td>
                                    <td className="p-3 text-right">1000</td>
                                    <td className="p-3 text-right">0</td>
                                    <td className="p-3 text-right">0</td>
                                    <td className="p-3 text-right">0</td>
                                    <td className="p-3 text-right">0</td>
                                    <td className="p-3 text-right">0</td>
                                    <td className="p-3 text-right">0</td>
                                    <td className="p-3 text-gray-400">A-01-01</td>
                                 </tr>
                                 <tr className="bg-blue-50/30 font-bold">
                                    <td className="p-3 text-gray-400 italic">Consolidado</td>
                                    <td className="p-3">W2 - Tienda</td>
                                    <td className="p-3 text-right">0</td>
                                    <td className="p-3 text-right">0</td>
                                    <td className="p-3 text-right">0</td>
                                    <td className="p-3 text-right">0</td>
                                    <td className="p-3 text-right">0</td>
                                    <td className="p-3 text-right">0</td>
                                    <td className="p-3 text-right">0</td>
                                    <td className="p-3 text-right">0</td>
                                    <td className="p-3 text-right">0</td>
                                    <td className="p-3 text-gray-400">-</td>
                                 </tr>

                                 {/* VARIANTS STOCK */}
                                 {formData.variants?.map((variant, idx) => (
                                    <React.Fragment key={idx}>
                                       <tr className="hover:bg-gray-50">
                                          <td className="p-3 font-medium text-gray-800">
                                             {Object.values(variant.attributeValues).join(' - ')}
                                          </td>
                                          <td className="p-3">W1 - Central</td>
                                          <td className="p-3 text-right font-bold">{variant.initialStock || 0}</td>
                                          <td className="p-3 text-right">5</td>
                                          <td className="p-3 text-right">100</td>
                                          <td className="p-3 text-right">0</td>
                                          <td className="p-3 text-right">0</td>
                                          <td className="p-3 text-right">0</td>
                                          <td className="p-3 text-right">0</td>
                                          <td className="p-3 text-right">0</td>
                                          <td className="p-3 text-right">0</td>
                                          <td className="p-3 text-gray-400">A-01-02</td>
                                       </tr>
                                       <tr className="hover:bg-gray-50 border-b-2 border-gray-50">
                                          <td className="p-3 font-medium text-gray-800">
                                             {Object.values(variant.attributeValues).join(' - ')}
                                          </td>
                                          <td className="p-3">W2 - Tienda</td>
                                          <td className="p-3 text-right font-bold">0</td>
                                          <td className="p-3 text-right">0</td>
                                          <td className="p-3 text-right">0</td>
                                          <td className="p-3 text-right">0</td>
                                          <td className="p-3 text-right">0</td>
                                          <td className="p-3 text-right">0</td>
                                          <td className="p-3 text-right">0</td>
                                          <td className="p-3 text-right">0</td>
                                          <td className="p-3 text-right">0</td>
                                          <td className="p-3 text-gray-400">-</td>
                                       </tr>
                                    </React.Fragment>
                                 ))}
                              </tbody>
                           </table>
                           {(!formData.variants || formData.variants.length === 0) && (
                              <div className="p-8 text-center text-gray-400 text-sm flex flex-col items-center gap-3">
                                 <p>No hay variantes generadas.</p>
                                 {formData.attributes && formData.attributes.length > 0 && (
                                    <button
                                       onClick={() => {
                                          generateVariants();
                                          setActiveTab('VARIANTS');
                                       }}
                                       className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg font-bold hover:bg-blue-100 transition-colors flex items-center gap-2"
                                    >
                                       <RefreshCw size={14} /> Generar Variantes Ahora
                                    </button>
                                 )}
                              </div>
                           )}
                        </div>
                     </div>
                  </div>
               )}

            </div>

            <div className="p-6 bg-white border-t border-gray-100 flex justify-end gap-3 shrink-0 z-10">
               <button onClick={onClose} className="px-8 py-4 text-gray-500 font-bold hover:bg-gray-50 rounded-2xl transition-colors">Cancelar</button>
               <button onClick={() => onSave(formData)} className="px-10 py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-xl shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2">
                  <Save size={20} /> Guardar Producto
               </button>
            </div>

            {/* --- TEMPLATE SELECTION MODAL --- */}
            {
               isTemplateModalOpen && (
                  <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                     <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
                        <div className="p-5 border-b border-gray-100 flex justify-between items-center">
                           <h3 className="font-bold text-lg text-gray-800">Cargar Variantes Predefinidas</h3>
                           <button onClick={() => setIsTemplateModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-500"><X size={20} /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                           {PREDEFINED_TEMPLATES.map(tpl => (
                              <button
                                 key={tpl.id}
                                 onClick={() => applyTemplate(tpl)}
                                 className="w-full text-left p-4 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all group"
                              >
                                 <h4 className="font-bold text-gray-800 group-hover:text-blue-700">{tpl.name}</h4>
                                 <p className="text-xs text-gray-500 mt-1">
                                    {tpl.options.slice(0, 5).join(', ')}{tpl.options.length > 5 ? '...' : ''}
                                 </p>
                              </button>
                           ))}
                        </div>
                     </div>
                  </div>
               )
            }

         </div >
      </div >
   );
};

export default ProductForm;
