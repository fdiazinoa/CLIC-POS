import React, { useState, useEffect } from 'react';
import { X, ShoppingCart, Check, AlertCircle } from 'lucide-react';
import { Product } from '../types';

// Extended interfaces for local UI logic
interface VariantOption {
  id: string;
  label: string;
  value: string; // Hex for colors, Text for sizes
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
  product: Product;
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

  // Simulate Variant Data parsing based on Product Category or Mock Data
  // In a real scenario, this would come from the database structure
  useEffect(() => {
    // MOCK DATA GENERATION FOR DEMO PURPOSES
    // This allows the UI to demonstrate the requested functionality
    // regardless of the backend limitations in the current 'types.ts'
    let mockGroups: VariantGroup[] = [];

    if (product.category === 'Ropa' || product.category === 'Calzado' || product.category === 'Camisetas') {
      mockGroups = [
        {
          id: 'size',
          name: 'Talla',
          type: 'SIZE',
          options: [
            { id: 's', label: 'S', value: 'S', stock: 10, priceModifier: 0 },
            { id: 'm', label: 'M', value: 'M', stock: 0, priceModifier: 0 }, // Out of stock demo
            { id: 'l', label: 'L', value: 'L', stock: 5, priceModifier: 0 },
            { id: 'xl', label: 'XL', value: 'XL', stock: 8, priceModifier: 1.00 },
          ]
        },
        {
          id: 'color',
          name: 'Color',
          type: 'COLOR',
          options: [
            { id: 'c1', label: 'Negro', value: '#1F2937', stock: 10, priceModifier: 0 },
            { id: 'c2', label: 'Blanco', value: '#F3F4F6', stock: 10, priceModifier: 0 },
            { id: 'c3', label: 'Azul', value: '#3B82F6', stock: 0, priceModifier: 0 }, // Out of stock
            { id: 'c4', label: 'Rojo', value: '#EF4444', stock: 5, priceModifier: 0 },
          ]
        }
      ];
    } else if (product.category === 'Pizzas' || product.category === 'Platos') {
      // Fallback for restaurant items using existing modifiers if available
      if (product.availableModifiers) {
         mockGroups = [{
            id: 'mods',
            name: 'Opciones',
            type: 'TEXT',
            options: product.availableModifiers.map(m => ({
               id: m.id,
               label: m.name,
               value: m.name,
               stock: 99,
               priceModifier: m.price
            }))
         }];
      }
    }

    setGroups(mockGroups);
  }, [product]);

  const handleSelect = (groupId: string, option: VariantOption) => {
    if (option.stock === 0) return; // Prevent selection of out of stock
    
    setSelections(prev => ({
      ...prev,
      [groupId]: option
    }));
  };

  const calculateTotal = () => {
    const modsPrice = Object.values(selections).reduce((acc, curr) => acc + curr.priceModifier, 0);
    return product.price + modsPrice;
  };

  const isReadyToAdd = groups.length > 0 && groups.every(g => selections[g.id]);

  const handleConfirm = () => {
    if (!isReadyToAdd) return;
    const modifierNames = Object.values(selections).map(s => s.label);
    onConfirm(product, modifierNames, calculateTotal());
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Click outside to close */}
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative bg-white w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-5 duration-300">
        
        {/* Product Header */}
        <div className="relative h-40 bg-gray-100">
           <img 
             src={product.image || "https://picsum.photos/400/200"} 
             alt={product.name} 
             className="w-full h-full object-cover"
           />
           <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent p-6 flex flex-col justify-end">
              <h2 className="text-2xl font-bold text-white shadow-sm leading-tight">{product.name}</h2>
              <p className="text-gray-300 text-sm font-medium">{product.category}</p>
           </div>
           <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-black/20 hover:bg-black/40 text-white rounded-full backdrop-blur-md transition-colors"
           >
             <X size={20} />
           </button>
        </div>

        {/* Variants Body */}
        <div className="p-6 space-y-6 max-h-[50vh] overflow-y-auto">
           {groups.length === 0 ? (
             <div className="text-center text-gray-400 py-4">
               <AlertCircle size={32} className="mx-auto mb-2 opacity-50" />
               <p>No hay variantes configuradas para este producto.</p>
             </div>
           ) : (
             groups.map(group => (
               <div key={group.id} className="space-y-3">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-gray-800 text-sm uppercase tracking-wide">{group.name}</h3>
                    {selections[group.id] && (
                       <span className="text-xs font-bold text-blue-600 animate-in fade-in">
                          {selections[group.id].label} 
                          {selections[group.id].priceModifier > 0 && ` (+${currencySymbol}${selections[group.id].priceModifier})`}
                       </span>
                    )}
                  </div>

                  {/* COLOR SELECTOR */}
                  {group.type === 'COLOR' && (
                     <div className="flex flex-wrap gap-3">
                        {group.options.map(option => {
                           const isSelected = selections[group.id]?.id === option.id;
                           const isOutOfStock = option.stock === 0;

                           return (
                             <button
                               key={option.id}
                               disabled={isOutOfStock}
                               onClick={() => handleSelect(group.id, option)}
                               className={`
                                 w-12 h-12 rounded-full relative shadow-sm transition-all duration-200 flex items-center justify-center
                                 ${isOutOfStock ? 'opacity-40 cursor-not-allowed scale-90 grayscale' : 'hover:scale-110 active:scale-95'}
                                 ${isSelected ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'ring-1 ring-gray-200'}
                               `}
                               style={{ backgroundColor: option.value }}
                               title={`${option.label} ${isOutOfStock ? '(Agotado)' : ''}`}
                             >
                               {isSelected && (
                                  <Check size={16} className={`drop-shadow-md ${['#FFFFFF', '#F3F4F6'].includes(option.value) ? 'text-black' : 'text-white'}`} />
                               )}
                               {isOutOfStock && !isSelected && (
                                 <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-full h-0.5 bg-gray-400 -rotate-45"></div>
                                 </div>
                               )}
                             </button>
                           )
                        })}
                     </div>
                  )}

                  {/* SIZE / TEXT SELECTOR */}
                  {(group.type === 'SIZE' || group.type === 'TEXT') && (
                     <div className="flex flex-wrap gap-2">
                        {group.options.map(option => {
                           const isSelected = selections[group.id]?.id === option.id;
                           const isOutOfStock = option.stock === 0;
                           
                           return (
                              <button
                                key={option.id}
                                disabled={isOutOfStock}
                                onClick={() => handleSelect(group.id, option)}
                                className={`
                                  min-w-[3.5rem] h-12 px-4 rounded-xl font-bold text-sm border-2 transition-all duration-200 flex flex-col items-center justify-center
                                  ${isOutOfStock 
                                     ? 'bg-gray-50 border-gray-100 text-gray-300 decoration-gray-400 line-through cursor-not-allowed' 
                                     : isSelected 
                                        ? 'bg-gray-900 border-gray-900 text-white shadow-lg scale-105' 
                                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'
                                  }
                                `}
                              >
                                 <span>{option.label}</span>
                              </button>
                           );
                        })}
                     </div>
                  )}
               </div>
             ))
           )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between gap-4">
           <div>
              <p className="text-xs text-gray-500 font-medium uppercase">Total</p>
              <p className="text-2xl font-black text-gray-900">{currencySymbol}{calculateTotal().toFixed(2)}</p>
           </div>
           
           <button
             onClick={handleConfirm}
             disabled={!isReadyToAdd}
             className={`
               flex-1 py-4 px-6 rounded-xl font-bold text-white shadow-lg flex items-center justify-center gap-2 transition-all
               ${!isReadyToAdd 
                  ? 'bg-gray-300 cursor-not-allowed' 
                  : 'bg-blue-600 hover:bg-blue-500 hover:shadow-blue-500/30 active:scale-95'
               }
             `}
           >
              <ShoppingCart size={20} />
              <span>{isReadyToAdd ? 'Agregar al Carrito' : 'Selecciona Opciones'}</span>
           </button>
        </div>

      </div>
    </div>
  );
};

export default ProductVariantSelector;