
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

  // Simulate Variant Data parsing based on Product Category or Mock Data
  useEffect(() => {
    if (!product) return;

    // MOCK DATA GENERATION FOR DEMO PURPOSES
    let mockGroups: VariantGroup[] = [];

    // Check if product has explicit attributes defined in data (from ProductForm)
    if (product.attributes && product.attributes.length > 0) {
        mockGroups = product.attributes.map(attr => ({
            id: attr.id,
            name: attr.name,
            type: attr.name.toLowerCase().includes('color') ? 'COLOR' : 'TEXT',
            options: attr.options.map(opt => ({
                id: opt.id,
                label: opt.name,
                value: opt.name, // Usually value is same as label for text
                stock: 99, // Mock stock for options if not tracked at matrix level yet
                priceModifier: 0
            }))
        }));
    }
    // Fallback Mock Logic for Ropa/Calzado categories if no attributes
    else if (['Ropa', 'Calzado', 'Camisetas', 'Vestidos', 'Pantalones'].includes(product.category)) {
      mockGroups = [
        {
          id: 'color',
          name: 'Color',
          type: 'COLOR',
          options: [
            { id: 'c1', label: 'Negro', value: '#1F2937', stock: 10, priceModifier: 0 },
            { id: 'c2', label: 'Blanco', value: '#F3F4F6', stock: 10, priceModifier: 0 },
            { id: 'c3', label: 'Azul', value: '#3B82F6', stock: 0, priceModifier: 0 },
            { id: 'c4', label: 'Rojo', value: '#EF4444', stock: 5, priceModifier: 0 },
            { id: 'c5', label: 'Verde', value: '#10B981', stock: 8, priceModifier: 0 },
          ]
        },
        {
          id: 'size',
          name: 'Talla',
          type: 'SIZE',
          options: [
            { id: 's', label: 'S', value: 'S', stock: 10, priceModifier: 0 },
            { id: 'm', label: 'M', value: 'M', stock: 15, priceModifier: 0 },
            { id: 'l', label: 'L', value: 'L', stock: 8, priceModifier: 0 },
            { id: 'xl', label: 'XL', value: 'XL', stock: 5, priceModifier: 2.00 },
          ]
        }
      ];
    }

    setGroups(mockGroups);
    
    // Auto-select first available options if any
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
    if (!allSelected) {
       // Optional: Shake animation or alert
       return;
    }

    const modifiersList = Object.values(selections).map((opt: VariantOption) => opt.label);
    // Passing the original product, list of modifier names (Color, Size), and the calculated final price
    onConfirm(product, modifiersList, calculateTotal());
  };

  if (!product) return null;

  const allGroupsSelected = groups.length > 0 && groups.every(g => selections[g.id]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
           <div>
              <h3 className="font-bold text-lg text-gray-800">Seleccionar Opciones</h3>
              <p className="text-xs text-gray-500">{product.name}</p>
           </div>
           <button onClick={onClose} className="p-2 bg-gray-200 rounded-full hover:bg-gray-300 text-gray-600 transition-colors">
             <X size={20} />
           </button>
        </div>

        {/* Groups */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
           {groups.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                 <AlertCircle size={48} className="mx-auto mb-2 opacity-50" />
                 <p>No hay variantes configuradas.</p>
              </div>
           ) : (
              groups.map(group => (
                 <div key={group.id}>
                    <h4 className="text-sm font-bold text-gray-700 uppercase mb-3 flex justify-between">
                       {group.name}
                       {selections[group.id] && <span className="text-blue-600">{selections[group.id].label}</span>}
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
                                   className={`w-10 h-10 rounded-full border-2 shadow-sm flex items-center justify-center transition-all ${
                                      isSelected 
                                         ? 'border-blue-600 scale-110 ring-2 ring-blue-200' 
                                         : 'border-gray-200 hover:scale-105'
                                   } ${isOutOfStock ? 'opacity-30 cursor-not-allowed' : ''}`}
                                   style={{ backgroundColor: option.value }}
                                   title={option.label}
                                >
                                   {isSelected && <Check size={16} className={['#FFFFFF', '#F3F4F6', '#FFFFFF'].includes(option.value.toUpperCase()) ? 'text-black' : 'text-white'} />}
                                </button>
                             );
                          }

                          return (
                             <button
                                key={option.id}
                                onClick={() => handleSelect(group.id, option)}
                                disabled={isOutOfStock}
                                className={`px-4 py-3 rounded-xl border-2 text-sm font-bold transition-all relative ${
                                   isSelected 
                                      ? 'border-blue-600 bg-blue-50 text-blue-700' 
                                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                                } ${isOutOfStock ? 'opacity-40 cursor-not-allowed bg-gray-50' : ''}`}
                             >
                                {option.label}
                                {option.priceModifier > 0 && <span className="text-[10px] ml-1 opacity-70">+{currencySymbol}{option.priceModifier.toFixed(2)}</span>}
                                {isOutOfStock && <div className="absolute inset-0 flex items-center justify-center"><div className="w-full h-0.5 bg-gray-400 rotate-45"></div></div>}
                             </button>
                          );
                       })}
                    </div>
                 </div>
              ))
           )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 bg-white">
           <div className="flex justify-between items-center mb-4">
              <span className="text-gray-500 font-medium">Precio Total</span>
              <span className="text-2xl font-black text-gray-900">{currencySymbol}{calculateTotal().toFixed(2)}</span>
           </div>
           <button 
             onClick={handleConfirmSelection}
             disabled={!allGroupsSelected}
             className={`w-full py-4 rounded-2xl font-bold text-white shadow-lg flex items-center justify-center gap-2 transition-all active:scale-95 ${
                allGroupsSelected ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-not-allowed'
             }`}
           >
              <ShoppingCart size={20} />
              Agregar al Carrito
           </button>
        </div>

      </div>
    </div>
  );
};

export default ProductVariantSelector;
