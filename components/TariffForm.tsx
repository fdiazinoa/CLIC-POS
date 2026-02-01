
import React, { useState, useEffect, useMemo } from 'react';
import {
   X, Save, Calendar, Clock, DollarSign, Calculator,
   Store, List, Check, ArrowRight, Layers, Percent,
   Search, Filter, Wand2, Tag, ChevronDown, CheckCircle2, Plus
} from 'lucide-react';
import { Tariff, Product, PricingStrategyType, RoundingRule, BusinessConfig } from '../types';

interface TariffFormProps {
   initialData?: Tariff | null;
   products: Product[];
   config: BusinessConfig;
   availableTariffs?: Tariff[];
   onSave: (tariff: Tariff) => void;
   onUpdateProducts?: (products: Product[]) => void;
   onClose: () => void;
}

type TabType = 'GENERAL' | 'RULES' | 'ITEMS';

const TariffForm: React.FC<TariffFormProps> = ({
   initialData, products, config, availableTariffs = [], onSave, onUpdateProducts, onClose
}) => {
   const [activeTab, setActiveTab] = useState<TabType>('GENERAL');
   const [formData, setFormData] = useState<Tariff>({
      id: `TRF_${Date.now()}`,
      name: '',
      active: true,
      currency: config.currencies?.find(c => c.isBase)?.code || 'DOP',
      taxIncluded: true,
      strategy: {
         type: 'MANUAL',
         rounding: 'NONE'
      },
      scope: {
         storeIds: ['ALL'],
         priority: 1
      },
      schedule: {
         daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
         timeStart: '00:00',
         timeEnd: '23:59'
      },
      items: {}
   });

   // Items Grid State
   const [itemsSearch, setItemsSearch] = useState('');
   const [itemsCategory, setItemsCategory] = useState('ALL');
   const [bulkAdjustment, setBulkAdjustment] = useState<string>('');

   // Add Items Modal State
   const [isAddModalOpen, setIsAddModalOpen] = useState(false);
   const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
   const [addModalSearch, setAddModalSearch] = useState('');

   useEffect(() => {
      if (initialData) {
         setFormData(JSON.parse(JSON.stringify(initialData)));
      }
   }, [initialData]);

   // --- HELPERS ---
   const filteredProducts = useMemo(() => {
      return products.filter(p => {
         const matchSearch = (p.name || '').toLowerCase().includes(itemsSearch.toLowerCase()) || p.barcode?.includes(itemsSearch);
         const matchCat = itemsCategory === 'ALL' || p.category === itemsCategory;
         return matchSearch && matchCat;
      });
   }, [products, itemsSearch, itemsCategory]);

   const categories = useMemo(() => ['ALL', ...Array.from(new Set(products.map(p => p.category)))], [products]);

   // --- LOGIC ---
   const handleDayToggle = (day: number) => {
      setFormData(prev => {
         const days = prev.schedule.daysOfWeek;
         return {
            ...prev,
            schedule: {
               ...prev.schedule,
               daysOfWeek: days.includes(day) ? days.filter(d => d !== day) : [...days, day]
            }
         };
      });
   };

   const getCalculatedPrice = (product: Product): number => {
      // If specific override exists
      if (formData.items[product.id]) return formData.items[product.id].price;

      // Else calculate
      let rawPrice = product.price;

      if (formData.strategy.type === 'COST_PLUS') {
         const cost = product.cost || 0;
         const margin = formData.strategy.factor || 30;
         rawPrice = cost * (1 + margin / 100);
      } else if (formData.strategy.type === 'DERIVED' && formData.strategy.baseTariffId) {
         // Mock derived logic
         rawPrice = product.price * (1 + (formData.strategy.factor || 0) / 100);
      }

      return parseFloat(rawPrice.toFixed(2));
   };

   const applyBulkAdjustment = () => {
      const val = parseFloat(bulkAdjustment);
      if (!val || val === 0) return;

      const newItems = { ...formData.items };
      const updatedProducts: Product[] = [];

      filteredProducts.forEach(p => {
         // Base logic: If no existing override, use product price. If exists, use it.
         // But usually bulk edit means "Base Price + X%"
         const base = p.price;
         const newPrice = base * (1 + val / 100);

         // Update tariff override price
         newItems[p.id] = {
            productId: p.id,
            price: parseFloat(newPrice.toFixed(2)),
            lockPrice: true
         };

         // Also update base product price
         updatedProducts.push({
            ...p,
            price: parseFloat(newPrice.toFixed(2)),
            updatedAt: new Date().toISOString()
         });
      });

      setFormData(prev => ({ ...prev, items: newItems }));

      // Update base prices if callback provided
      if (onUpdateProducts && updatedProducts.length > 0) {
         // Merge with non-filtered products
         const updatedProductsMap = new Map(updatedProducts.map(p => [p.id, p]));
         const allUpdatedProducts = products.map(p =>
            updatedProductsMap.has(p.id) ? updatedProductsMap.get(p.id)! : p
         );
         onUpdateProducts(allUpdatedProducts);
      }

      alert(`Aplicado ${val > 0 ? '+' : ''}${val}% a ${filteredProducts.length} productos (Precio Base y Tarifa).`);
      setBulkAdjustment('');
   };

   const handleManualPriceChange = (productId: string, val: string) => {
      const price = parseFloat(val);
      if (isNaN(price)) return;
      setFormData(prev => ({
         ...prev,
         items: {
            ...prev.items,
            [productId]: { productId, price, lockPrice: true }
         }
      }));

      // If this is the general tariff, also update the base product price to keep them in sync
      if (formData.id === 'trf-gen' && onUpdateProducts) {
         const updatedProducts = products.map(p =>
            p.id === productId ? { ...p, price, updatedAt: new Date().toISOString() } : p
         );
         onUpdateProducts(updatedProducts);
      }
   };

   // --- ADD ITEMS MODAL LOGIC ---
   const handleToggleSelectToAdd = (productId: string) => {
      const newSet = new Set(selectedToAdd);
      if (newSet.has(productId)) {
         newSet.delete(productId);
      } else {
         newSet.add(productId);
      }
      setSelectedToAdd(newSet);
   };

   const handleConfirmAdd = () => {
      const newItems = { ...formData.items };

      products.forEach(p => {
         if (selectedToAdd.has(p.id)) {
            // Calculate initial price based on current strategy
            const initialPrice = getCalculatedPrice(p);
            newItems[p.id] = {
               productId: p.id,
               price: initialPrice,
               lockPrice: true // Explicitly added items are locked by default
            };
         }
      });

      setFormData(prev => ({ ...prev, items: newItems }));
      setSelectedToAdd(new Set());
      setAddModalSearch('');
      setIsAddModalOpen(false);
   };

   const filteredAddProducts = useMemo(() => {
      return products.filter(p =>
         !formData.items[p.id] && // Only show items NOT already manually in list
         ((p.name || '').toLowerCase().includes(addModalSearch.toLowerCase()) ||
            p.barcode?.includes(addModalSearch))
      );
   }, [products, addModalSearch, formData.items]);


   const handleSubmit = () => {
      if (!formData.name) return alert("El nombre es obligatorio");
      onSave(formData);
   };

   const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

   return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
         <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden relative">

            {/* HEADER */}
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-white z-10 shrink-0">
               <div className="flex items-center gap-4">
                  <div className="p-3 bg-purple-100 text-purple-600 rounded-xl">
                     <Tag size={24} />
                  </div>
                  <div>
                     <h2 className="text-xl font-black text-gray-800">{initialData ? 'Editar Tarifa' : 'Nueva Tarifa'}</h2>
                     <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Gestión de Precios</p>
                  </div>
               </div>
               <div className="flex gap-2">
                  <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1 mr-4">
                     <button
                        onClick={() => setFormData({ ...formData, active: !formData.active })}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${formData.active ? 'bg-green-500 text-white shadow' : 'text-gray-500'}`}
                     >
                        ACTIVA
                     </button>
                     <button
                        onClick={() => setFormData({ ...formData, active: !formData.active })}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${!formData.active ? 'bg-gray-500 text-white shadow' : 'text-gray-500'}`}
                     >
                        INACTIVA
                     </button>
                  </div>
                  <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500">
                     <X size={24} />
                  </button>
               </div>
            </div>

            {/* NAME & TABS */}
            <div className="px-8 pt-6 pb-0 bg-gray-50 border-b border-gray-200">
               <input
                  type="text"
                  placeholder="Nombre de la Lista (Ej. VIP Fin de Semana)"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full text-2xl font-black bg-transparent border-none outline-none placeholder:text-gray-300 text-gray-800 mb-6"
               />
               <div className="flex gap-8">
                  {[
                     { id: 'GENERAL', label: 'Estrategia' },
                     { id: 'RULES', label: 'Reglas y Tiendas' },
                     { id: 'ITEMS', label: 'Artículos' }
                  ].map(tab => (
                     <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as TabType)}
                        className={`pb-4 text-sm font-bold border-b-4 transition-all ${activeTab === tab.id ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                     >
                        {tab.label}
                     </button>
                  ))}
               </div>
            </div>

            {/* CONTENT */}
            <div className="flex-1 overflow-y-auto p-8 bg-gray-50">

               {/* === GENERAL TAB === */}
               {activeTab === 'GENERAL' && (
                  <div className="space-y-8 animate-in slide-in-from-right-4 max-w-4xl mx-auto">

                     {/* Strategy Selection */}
                     <section>
                        <div className="flex justify-between items-center mb-4">
                           <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Estrategia de Precios</h3>
                           <label className="flex items-center gap-2 cursor-pointer bg-white px-3 py-1.5 rounded-lg border border-gray-200 hover:border-purple-300 transition-all shadow-sm">
                              <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${formData.taxIncluded ? 'bg-purple-600 border-purple-600' : 'bg-white border-gray-300'}`}>
                                 {formData.taxIncluded && <Check size={14} className="text-white" />}
                              </div>
                              <input
                                 type="checkbox"
                                 className="hidden"
                                 checked={formData.taxIncluded || false}
                                 onChange={(e) => setFormData(prev => ({ ...prev, taxIncluded: e.target.checked }))}
                              />
                              <span className="text-xs font-bold text-gray-700">Impuestos Incluidos</span>
                           </label>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                           {[
                              { id: 'MANUAL', label: 'Manual / Fija', icon: List, desc: 'Precios individuales.' },
                              { id: 'COST_PLUS', label: 'Costo + Margen', icon: Calculator, desc: 'Automático según costo.' },
                              { id: 'DERIVED', label: 'Derivada', icon: Layers, desc: 'Basada en otra tarifa.' }
                           ].map(s => (
                              <button
                                 key={s.id}
                                 onClick={() => setFormData(prev => ({ ...prev, strategy: { ...prev.strategy, type: s.id as any } }))}
                                 className={`p-6 rounded-2xl border-2 text-left transition-all flex flex-col gap-3 ${formData.strategy.type === s.id
                                    ? 'border-purple-500 bg-white ring-4 ring-purple-50 shadow-xl'
                                    : 'border-gray-200 bg-white hover:border-gray-300'
                                    }`}
                              >
                                 <div className={`w-10 h-10 rounded-full flex items-center justify-center ${formData.strategy.type === s.id ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-400'}`}>
                                    <s.icon size={20} />
                                 </div>
                                 <div>
                                    <span className="font-bold text-gray-800 block">{s.label}</span>
                                    <span className="text-xs text-gray-500">{s.desc}</span>
                                 </div>
                              </button>
                           ))}
                        </div>
                     </section>

                     {/* Strategy Config */}
                     {formData.strategy.type !== 'MANUAL' && (
                        <section className="bg-white p-6 rounded-2xl border border-purple-100 shadow-sm">
                           <h3 className="font-bold text-purple-800 mb-4 flex items-center gap-2">
                              <Wand2 size={18} /> Configuración Automática
                           </h3>
                           <div className="grid grid-cols-2 gap-6">
                              {formData.strategy.type === 'DERIVED' && (
                                 <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tarifa Base</label>
                                    <select className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none">
                                       <option>Tarifa General (Default)</option>
                                       {availableTariffs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                    </select>
                                 </div>
                              )}
                              <div>
                                 <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                    {formData.strategy.type === 'COST_PLUS' ? 'Margen (%)' : 'Ajuste (%)'}
                                 </label>
                                 <input
                                    type="number"
                                    value={formData.strategy.factor || 0}
                                    onChange={(e) => {
                                       const val = parseFloat(e.target.value);
                                       setFormData(prev => ({ ...prev, strategy: { ...prev.strategy, factor: isNaN(val) ? 0 : val } }));
                                    }}
                                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none font-bold text-lg"
                                 />
                              </div>
                           </div>
                        </section>
                     )}

                     {/* Schedule */}
                     <section>
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Programación</h3>
                        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                           <div className="flex justify-between items-center bg-gray-50 p-2 rounded-xl mb-4">
                              {DAYS.map((day, idx) => (
                                 <button
                                    key={day}
                                    onClick={() => handleDayToggle(idx)}
                                    className={`w-10 h-10 rounded-lg text-xs font-bold transition-all ${formData.schedule.daysOfWeek.includes(idx)
                                       ? 'bg-purple-600 text-white shadow-md'
                                       : 'text-gray-400 hover:bg-gray-200'
                                       }`}
                                 >
                                    {day}
                                 </button>
                              ))}
                           </div>
                           <div className="flex items-center gap-4">
                              <div className="flex-1">
                                 <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Inicio</label>
                                 <input
                                    type="time"
                                    value={formData.schedule.timeStart}
                                    onChange={(e) => setFormData(prev => ({ ...prev, schedule: { ...prev.schedule, timeStart: e.target.value } }))}
                                    className="w-full p-3 bg-gray-50 border-none rounded-xl font-mono font-bold"
                                 />
                              </div>
                              <span className="text-gray-300"><ArrowRight /></span>
                              <div className="flex-1">
                                 <label className="text-xs font-bold text-gray-400 uppercase mb-1 block">Fin</label>
                                 <input
                                    type="time"
                                    value={formData.schedule.timeEnd}
                                    onChange={(e) => setFormData(prev => ({ ...prev, schedule: { ...prev.schedule, timeEnd: e.target.value } }))}
                                    className="w-full p-3 bg-gray-50 border-none rounded-xl font-mono font-bold"
                                 />
                              </div>
                           </div>
                        </div>
                     </section>

                  </div>
               )}

               {/* === RULES TAB === */}
               {activeTab === 'RULES' && (
                  <div className="space-y-8 animate-in slide-in-from-right-4 max-w-4xl mx-auto">
                     <section className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                           <Store size={20} className="text-gray-400" /> Disponibilidad en Tiendas
                        </h3>
                        <div className="flex flex-wrap gap-2">
                           {['Todas las Tiendas', 'Sucursal Norte', 'Sucursal Sur', 'Web Store'].map(store => (
                              <button key={store} className={`px-4 py-2 rounded-full border text-sm font-bold ${store === 'Todas las Tiendas' ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-white border-gray-200 text-gray-600'}`}>
                                 {store}
                              </button>
                           ))}
                        </div>
                     </section>

                     <div className="grid grid-cols-2 gap-6">
                        <section className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                           <h3 className="font-bold text-gray-800 mb-4">Prioridad</h3>
                           <input
                              type="number"
                              value={formData.scope.priority}
                              onChange={(e) => setFormData(prev => ({ ...prev, scope: { ...prev.scope, priority: parseInt(e.target.value) } }))}
                              className="w-full p-4 text-3xl font-black bg-gray-50 rounded-xl border-none outline-none"
                           />
                           <p className="text-xs text-gray-400 mt-2">Mayor número gana sobre otras tarifas activas.</p>
                        </section>

                        <section className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                           <h3 className="font-bold text-gray-800 mb-4">Redondeo</h3>
                           <div className="space-y-2">
                              {[
                                 { id: 'NONE', label: 'Exacto (Sin redondeo)' },
                                 { id: 'ENDING_99', label: 'Psicológico (.99)' },
                                 { id: 'CEILING', label: 'Hacia Arriba' }
                              ].map(r => (
                                 <button
                                    key={r.id}
                                    onClick={() => setFormData(prev => ({ ...prev, strategy: { ...prev.strategy, rounding: r.id as RoundingRule } }))}
                                    className={`w-full p-3 text-left rounded-xl text-sm font-medium transition-all ${formData.strategy.rounding === r.id
                                       ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                       : 'hover:bg-gray-50 border border-transparent'
                                       }`}
                                 >
                                    {r.label}
                                 </button>
                              ))}
                           </div>
                        </section>
                     </div>
                  </div>
               )}

               {/* === ITEMS TAB === */}
               {activeTab === 'ITEMS' && (
                  <div className="h-full flex flex-col animate-in slide-in-from-right-4">

                     {/* Filters Bar & ADD Button */}
                     <div className="flex gap-4 mb-4">
                        <div className="flex-1 relative">
                           <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                           <input
                              type="text"
                              placeholder="Buscar producto..."
                              value={itemsSearch}
                              onChange={(e) => setItemsSearch(e.target.value)}
                              className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-purple-200"
                           />
                        </div>
                        <select
                           value={itemsCategory}
                           onChange={(e) => setItemsCategory(e.target.value)}
                           className="px-4 bg-white border border-gray-200 rounded-xl outline-none font-medium text-gray-600"
                        >
                           {categories.map(c => <option key={c} value={c}>{c === 'ALL' ? 'Todas las Categorías' : c}</option>)}
                        </select>

                        {/* ADD PRODUCTS BUTTON */}
                        <button
                           onClick={() => setIsAddModalOpen(true)}
                           className="px-6 py-3 bg-purple-600 text-white rounded-xl font-bold shadow-md hover:bg-purple-700 active:scale-95 transition-all flex items-center gap-2 whitespace-nowrap"
                        >
                           <Plus size={20} /> Agregar Artículos
                        </button>
                     </div>

                     {/* Batch Actions */}
                     <div className="bg-purple-50 p-3 rounded-xl border border-purple-100 flex items-center gap-4 mb-6">
                        <span className="text-xs font-bold text-purple-800 uppercase pl-2">Acción Masiva:</span>
                        <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-1 border border-purple-200">
                           <input
                              type="number"
                              value={bulkAdjustment}
                              onChange={(e) => setBulkAdjustment(e.target.value)}
                              placeholder="0"
                              className="w-16 font-bold text-right outline-none text-purple-700"
                           />
                           <span className="text-purple-400 font-bold">%</span>
                        </div>
                        <button
                           onClick={applyBulkAdjustment}
                           className="px-4 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-bold shadow-sm hover:bg-purple-700 active:scale-95 transition-all"
                        >
                           Aplicar a Filtro
                        </button>
                     </div>

                     {/* Grid */}
                     <div className="flex-1 overflow-y-auto pb-20">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                           {filteredProducts.map(product => {
                              const finalPrice = getCalculatedPrice(product);
                              const isManual = !!formData.items[product.id];
                              const margin = ((finalPrice - (product.cost || 0)) / (product.cost || 1)) * 100;

                              return (
                                 <div key={product.id} className={`bg-white p-4 rounded-xl border transition-all ${isManual ? 'border-purple-300 shadow-md' : 'border-gray-200 shadow-sm'}`}>
                                    <div className="flex justify-between items-start mb-2">
                                       <h4 className="font-bold text-gray-800 text-sm line-clamp-1">{product.name}</h4>
                                       {isManual && <div className="text-[10px] bg-purple-100 text-purple-700 px-1.5 rounded font-bold">MANUAL</div>}
                                    </div>
                                    <div className="flex items-end justify-between">
                                       <div>
                                          <p className="text-[10px] text-gray-400 uppercase">Base / Costo</p>
                                          <p className="text-xs font-mono text-gray-600">${(product.price || 0).toFixed(2)} / ${product.cost?.toFixed(2)}</p>
                                       </div>
                                       <div className="text-right">
                                          <div className="flex items-center justify-end gap-1 mb-1">
                                             <span className="text-lg font-bold text-gray-400">$</span>
                                             <input
                                                type="number"
                                                value={finalPrice}
                                                onChange={(e) => handleManualPriceChange(product.id, e.target.value)}
                                                className={`w-24 text-right font-black text-xl outline-none border-b-2 focus:border-purple-500 bg-transparent ${margin < 0 ? 'text-red-500 border-red-200' : 'text-gray-900 border-transparent'}`}
                                             />
                                          </div>
                                          <p className={`text-[10px] font-bold ${margin >= 30 ? 'text-green-500' : margin > 0 ? 'text-orange-500' : 'text-red-500'}`}>
                                             Margen: {(margin || 0).toFixed(1)}%
                                          </p>
                                       </div>
                                    </div>
                                 </div>
                              );
                           })}
                        </div>
                     </div>

                  </div>
               )}

            </div>

            {/* FOOTER */}
            <div className="p-5 border-t border-gray-100 bg-white flex justify-end gap-3 z-10 shrink-0">
               <button onClick={onClose} className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-50 transition-colors">
                  Cancelar
               </button>
               <button
                  onClick={handleSubmit}
                  className="px-8 py-3 rounded-xl font-bold bg-purple-600 text-white shadow-lg hover:bg-purple-500 active:scale-95 transition-all flex items-center gap-2"
               >
                  <Save size={20} /> Guardar Tarifa
               </button>
            </div>

            {/* --- ADD ITEMS MODAL --- */}
            {isAddModalOpen && (
               <div className="absolute inset-0 z-50 bg-gray-50 flex flex-col animate-in slide-in-from-bottom-5">
                  <div className="bg-white px-6 py-4 border-b border-gray-200 flex items-center justify-between shadow-sm">
                     <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Plus className="text-purple-600" /> Agregar Productos
                     </h3>
                     <div className="flex gap-2">
                        <button onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 text-gray-500 font-bold hover:bg-gray-100 rounded-lg">Cancelar</button>
                        <button
                           onClick={handleConfirmAdd}
                           disabled={selectedToAdd.size === 0}
                           className="px-6 py-2 bg-purple-600 text-white rounded-lg font-bold shadow-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                           Agregar ({selectedToAdd.size})
                        </button>
                     </div>
                  </div>

                  <div className="p-4 border-b border-gray-200 bg-white">
                     <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                           type="text"
                           autoFocus
                           placeholder="Buscar para añadir..."
                           value={addModalSearch}
                           onChange={(e) => setAddModalSearch(e.target.value)}
                           className="w-full pl-10 pr-4 py-3 bg-gray-100 border-none rounded-xl outline-none focus:ring-2 focus:ring-purple-200"
                        />
                     </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4">
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {filteredAddProducts.map(p => {
                           const isSelected = selectedToAdd.has(p.id);
                           return (
                              <div
                                 key={p.id}
                                 onClick={() => handleToggleSelectToAdd(p.id)}
                                 className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-4 ${isSelected
                                    ? 'border-purple-500 bg-purple-50 shadow-md'
                                    : 'border-gray-200 bg-white hover:border-purple-200'
                                    }`}
                              >
                                 <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-purple-600 border-purple-600' : 'border-gray-300 bg-white'
                                    }`}>
                                    {isSelected && <Check size={14} className="text-white" />}
                                 </div>
                                 <div className="flex-1">
                                    <h4 className={`font-bold text-sm ${isSelected ? 'text-purple-900' : 'text-gray-800'}`}>{p.name}</h4>
                                    <p className="text-xs text-gray-500">${(p.price || 0).toFixed(2)}</p>
                                 </div>
                              </div>
                           );
                        })}
                        {filteredAddProducts.length === 0 && (
                           <div className="col-span-full py-10 text-center text-gray-400">
                              <p>No se encontraron productos disponibles para agregar.</p>
                           </div>
                        )}
                     </div>
                  </div>
               </div>
            )}

         </div>
      </div>
   );
};

export default TariffForm;
