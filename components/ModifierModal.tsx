import React, { useState } from 'react';
import { X, Check, Plus } from 'lucide-react';
import { Product, Modifier } from '../types';

interface ModifierModalProps {
  product: Product;
  currencySymbol: string;
  themeColor: string;
  onClose: () => void;
  onConfirm: (modifiers: string[], finalPrice: number) => void;
}

const ModifierModal: React.FC<ModifierModalProps> = ({ 
  product, 
  currencySymbol, 
  themeColor, 
  onClose, 
  onConfirm 
}) => {
  const [selectedModifiers, setSelectedModifiers] = useState<Modifier[]>([]);

  const toggleModifier = (modifier: Modifier) => {
    setSelectedModifiers(prev => {
      const exists = prev.find(m => m.id === modifier.id);
      if (exists) {
        return prev.filter(m => m.id !== modifier.id);
      }
      return [...prev, modifier];
    });
  };

  const calculateTotal = () => {
    const modifiersCost = selectedModifiers.reduce((acc, curr) => acc + curr.price, 0);
    return product.price + modifiersCost;
  };

  const handleConfirm = () => {
    const modifierNames = selectedModifiers.map(m => m.name);
    const finalPrice = calculateTotal();
    onConfirm(modifierNames, finalPrice);
  };

  const themeBtnClass = {
    blue: 'bg-blue-600 hover:bg-blue-700',
    orange: 'bg-orange-600 hover:bg-orange-700',
    gray: 'bg-gray-800 hover:bg-gray-900',
  }[themeColor] || 'bg-indigo-600 hover:bg-indigo-700';

  const checkboxTheme = {
    blue: 'text-blue-600 focus:ring-blue-500',
    orange: 'text-orange-600 focus:ring-orange-500',
    gray: 'text-gray-800 focus:ring-gray-500',
  }[themeColor] || 'text-indigo-600';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="relative h-32 bg-gray-100">
          <img 
            src={product.image || "https://picsum.photos/400/200"} 
            alt={product.name} 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent flex items-end p-6">
            <h2 className="text-2xl font-bold text-white shadow-sm">{product.name}</h2>
          </div>
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-black/30 hover:bg-black/50 text-white rounded-full transition-colors backdrop-blur-md"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto">
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-4">
            Personaliza tu orden
          </h3>
          
          <div className="space-y-3">
            {product.availableModifiers?.map((mod) => {
              const isSelected = selectedModifiers.some(m => m.id === mod.id);
              return (
                <div 
                  key={mod.id}
                  onClick={() => toggleModifier(mod)}
                  className={`flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer ${
                    isSelected 
                      ? `border-current bg-gray-50 ${checkboxTheme.split(' ')[0]}` 
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                      isSelected 
                        ? `${themeBtnClass} border-transparent text-white` 
                        : 'border-gray-300 bg-white'
                    }`}>
                      {isSelected && <Check size={12} />}
                    </div>
                    <span className={`font-medium ${isSelected ? 'text-gray-900' : 'text-gray-600'}`}>
                      {mod.name}
                    </span>
                  </div>
                  {mod.price > 0 && (
                    <span className="text-sm font-semibold text-gray-900">
                      +{currencySymbol}{mod.price.toFixed(2)}
                    </span>
                  )}
                </div>
              );
            })}
            
            {(!product.availableModifiers || product.availableModifiers.length === 0) && (
              <p className="text-gray-400 text-center py-4">No hay modificadores disponibles para este producto.</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-white border-t border-gray-100 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
           <div className="flex justify-between items-center mb-4 px-2">
             <span className="text-gray-500">Total Item</span>
             <span className="text-xl font-bold text-gray-900">{currencySymbol}{calculateTotal().toFixed(2)}</span>
           </div>
           <button 
             onClick={handleConfirm}
             className={`w-full py-3 rounded-xl font-bold text-white shadow-lg flex items-center justify-center gap-2 transition-transform active:scale-95 ${themeBtnClass}`}
           >
             <Plus size={20} />
             Agregar al Pedido
           </button>
        </div>

      </div>
    </div>
  );
};

export default ModifierModal;