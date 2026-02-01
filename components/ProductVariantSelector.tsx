
import React, { useState, useEffect } from 'react';
import { X, ShoppingCart, Check, AlertCircle, Layers } from 'lucide-react';
import { Product } from '../types';

// Mapeo de colores en español para visualización CSS
const COLOR_MAP: Record<string, string> = {
   'Blanco': '#FFFFFF',
   'Negro': '#000000',
   'Azul': '#3B82F6',
   'Rojo': '#EF4444',
   'Gris': '#9CA3AF',
   'Verde': '#10B981',
   'Amarillo': '#FBBF24',
   'Naranja': '#F59E0B',
   'Rosa': '#EC4899',
   'Morado': '#8B5CF6',
   'Café': '#78350F',
   'Marron': '#78350F',
   'Beige': '#F5F5DC',
   'Celeste': '#0EA5E9',
};

interface VariantOption {
   id: string;
   label: string;
   value: string; // Hex para colores, Texto para talles
   stock: number;
   priceModifier: number;
}

interface VariantGroup {
   id: string;
   name: string; // "Talla", "Color", etc.
   type: 'COLOR' | 'SIZE' | 'TEXT';
   options: VariantOption[];
}

interface ProductVariantSelectorProps {
   product: Product | null;
   currencySymbol: string;
   onClose: () => void;
   onConfirm: (product: Product, selectedModifiers: string[], finalPrice: number) => void;
}

const ProductVariantSelector: React.FC<ProductVariantSelectorProps> = ({
   product,
   currencySymbol,
   onClose,
   onConfirm
}) => {
   const [selections, setSelections] = useState<Record<string, VariantOption>>({});
   const [groups, setGroups] = useState<VariantGroup[]>([]);

   useEffect(() => {
      if (!product) return;

      let mockGroups: VariantGroup[] = [];

      // Mapeo de atributos desde la data del producto
      if (product.attributes && product.attributes.length > 0) {
         mockGroups = product.attributes.map(attr => ({
            id: attr.id,
            name: attr.name,
            type: (attr.name || '').toLowerCase().includes('color') ? 'COLOR' : 'TEXT',
            options: attr.options.map((optName, oIdx) => {
               let colorVal = optName;
               if ((attr.name || '').toLowerCase().includes('color')) {
                  colorVal = COLOR_MAP[optName] || optName;
               }
               return {
                  id: `${attr.id}-opt-${oIdx}`,
                  label: optName,
                  value: colorVal,
                  stock: 99, // Simulado
                  priceModifier: 0
               };
            })
         }));
      }

      setGroups(mockGroups);

      // Auto-seleccionar primera opción disponible para cada grupo
      const initialSelections: Record<string, VariantOption> = {};
      mockGroups.forEach(g => {
         const firstAvailable = g.options.find(o => o.stock > 0);
         if (firstAvailable) initialSelections[g.id] = firstAvailable;
      });
      setSelections(initialSelections);

   }, [product]);

   const handleSelect = (groupId: string, option: VariantOption) => {
      if (option.stock <= 0) return;
      setSelections(prev => ({ ...prev, [groupId]: option }));
   };

   const calculateTotal = () => {
      if (!product) return 0;
      const basePrice = product.price;
      const modifiersPrice = Object.values(selections).reduce((acc: number, opt: VariantOption) => acc + opt.priceModifier, 0);
      return basePrice + modifiersPrice;
   };

   const handleConfirmSelection = () => {
      if (!product) return;
      const allSelected = groups.every(g => selections[g.id]);
      if (!allSelected) return;

      const modifiersList = Object.values(selections).map((opt: VariantOption) => opt.label);
      onConfirm(product, modifiersList, calculateTotal());
   };

   if (!product) return null;

   const allGroupsSelected = groups.length > 0 && groups.every(g => selections[g.id]);

   return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
         <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

            {/* Header */}
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
               <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                     <Layers size={20} />
                  </div>
                  <div>
                     <h3 className="font-bold text-lg text-gray-800">Opciones de Artículo</h3>
                     <p className="text-xs text-gray-500">{product.name}</p>
                  </div>
               </div>
               <button onClick={onClose} className="p-2 bg-gray-200 rounded-full hover:bg-gray-300 text-gray-600 transition-colors">
                  <X size={20} />
               </button>
            </div>

            {/* Groups */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
               {groups.length === 0 ? (
                  <div className="text-center py-10 text-gray-400">
                     <AlertCircle size={48} className="mx-auto mb-2 opacity-50" />
                     <p>No hay variantes configuradas.</p>
                  </div>
               ) : (
                  groups.map(group => (
                     <div key={group.id}>
                        <h4 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4 flex justify-between items-center">
                           {group.name}
                           {selections[group.id] && <span className="text-blue-600 font-bold">{selections[group.id].label}</span>}
                        </h4>

                        <div className="flex flex-wrap gap-3">
                           {group.options.map(option => {
                              const isSelected = selections[group.id]?.id === option.id;
                              const isOutOfStock = option.stock <= 0;

                              if (group.type === 'COLOR') {
                                 return (
                                    <button
                                       key={option.id}
                                       onClick={() => handleSelect(group.id, option)}
                                       disabled={isOutOfStock}
                                       className={`w-12 h-12 rounded-full border-2 shadow-sm flex items-center justify-center transition-all ${isSelected
                                             ? 'border-blue-600 scale-110 ring-4 ring-blue-100'
                                             : 'border-gray-200 hover:scale-105'
                                          } ${isOutOfStock ? 'opacity-30 cursor-not-allowed' : ''}`}
                                       style={{ backgroundColor: option.value }}
                                       title={option.label}
                                    >
                                       {isSelected && (
                                          <Check
                                             size={20}
                                             className={['#FFFFFF', '#F3F4F6', 'white', 'beige'].includes((option.value || '').toLowerCase()) || (option.value || '').toUpperCase() === '#FFFFFF' ? 'text-black' : 'text-white'}
                                          />
                                       )}
                                    </button>
                                 );
                              }

                              return (
                                 <button
                                    key={option.id}
                                    onClick={() => handleSelect(group.id, option)}
                                    disabled={isOutOfStock}
                                    className={`min-w-[60px] px-4 py-3 rounded-2xl border-2 text-sm font-black transition-all relative ${isSelected
                                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                                          : 'border-gray-100 bg-gray-50 text-gray-400 hover:border-gray-300'
                                       } ${isOutOfStock ? 'opacity-40 cursor-not-allowed' : ''}`}
                                 >
                                    {option.label}
                                    {option.priceModifier > 0 && <span className="text-[10px] ml-1 opacity-70">+{currencySymbol}{option.priceModifier.toFixed(2)}</span>}
                                 </button>
                              );
                           })}
                        </div>
                     </div>
                  ))
               )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-100 bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
               <div className="flex justify-between items-center mb-4">
                  <span className="text-gray-500 font-bold uppercase tracking-wider text-xs">Total Artículo</span>
                  <span className="text-3xl font-black text-gray-900">{currencySymbol}{calculateTotal().toFixed(2)}</span>
               </div>
               <button
                  onClick={handleConfirmSelection}
                  disabled={!allGroupsSelected}
                  className={`w-full py-5 rounded-2xl font-black text-white shadow-xl flex items-center justify-center gap-2 transition-all active:scale-95 ${allGroupsSelected ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-not-allowed'
                     }`}
               >
                  <ShoppingCart size={24} />
                  AGREGAR AL TICKET
               </button>
            </div>

         </div>
      </div>
   );
};

export default ProductVariantSelector;
