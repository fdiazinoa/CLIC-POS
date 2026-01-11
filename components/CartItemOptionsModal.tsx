import React, { useState } from 'react';
import { X, Trash2, Save, Minus, Plus, MessageSquare, Percent, DollarSign, Tag, AlertTriangle, RotateCcw, ChefHat } from 'lucide-react';
import { CartItem, BusinessConfig, VerticalType } from '../types';

interface CartItemOptionsModalProps {
  item: CartItem;
  config: BusinessConfig;
  onClose: () => void;
  onUpdate: (updatedItem: CartItem | null) => void; // null means delete
  canApplyDiscount: boolean;
  canVoidItem: boolean;
}

const CartItemOptionsModal: React.FC<CartItemOptionsModalProps> = ({ 
  item, 
  config, 
  onClose, 
  onUpdate,
  canApplyDiscount,
  canVoidItem
}) => {
  // Local state for edits
  const [quantity, setQuantity] = useState(item.quantity);
  const [price, setPrice] = useState(item.price);
  const [note, setNote] = useState(item.note || '');
  const [discountType, setDiscountType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [discountValue, setDiscountValue] = useState<string>('');

  const originalPrice = item.originalPrice || item.price;
  const isRestaurant = config.vertical === VerticalType.RESTAURANT;

  // Handlers
  const handleQuantityChange = (delta: number) => {
    const newQty = Math.max(1, quantity + delta);
    setQuantity(newQty);
  };

  const handleApplyDiscount = () => {
    const val = parseFloat(discountValue);
    if (isNaN(val) || val <= 0) {
      setPrice(originalPrice); // Reset
      return;
    }

    let newPrice = originalPrice;
    if (discountType === 'PERCENT') {
      newPrice = originalPrice - (originalPrice * (val / 100));
    } else {
      newPrice = Math.max(0, originalPrice - val);
    }
    setPrice(parseFloat(newPrice.toFixed(2)));
  };

  const handlePriceManualChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val >= 0) {
      setPrice(val);
      setDiscountValue(''); // Clear discount if manual price set
    }
  };

  const handleSave = () => {
    onUpdate({
      ...item,
      quantity,
      price,
      note,
      originalPrice
    });
    onClose();
  };

  const handleMarkAsSent = () => {
    if (confirm("¿Marcar este item como enviado a cocina/barra?")) {
      onUpdate({
        ...item,
        quantity,
        price,
        note,
        originalPrice,
        isSent: true
      });
      onClose();
    }
  };

  const handleDelete = () => {
    if (confirm(isRestaurant ? "¿Confirmar anulación de item?" : "¿Eliminar producto del carrito?")) {
      onUpdate(null);
      onClose();
    }
  };

  const themeClasses = {
    blue: 'bg-blue-600 hover:bg-blue-700',
    orange: 'bg-orange-600 hover:bg-orange-700',
    gray: 'bg-gray-800 hover:bg-gray-900',
  }[config.themeColor] || 'bg-indigo-600';

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full md:w-[500px] md:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in slide-in-from-bottom-10">
        
        {/* Header */}
        <div className="p-4 border-b border-gray-100 flex justify-between items-start bg-gray-50">
           <div>
              <h3 className="font-bold text-lg text-gray-800 leading-tight">{item.name}</h3>
              <p className="text-sm text-gray-500">{config.currencySymbol}{originalPrice.toFixed(2)} / unidad</p>
           </div>
           <button onClick={onClose} className="p-1 bg-gray-200 rounded-full hover:bg-gray-300 text-gray-600">
             <X size={20} />
           </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
           
           {/* 1. Quantity Control */}
           <div className="flex items-center justify-between bg-gray-50 p-3 rounded-xl border border-gray-200">
              <span className="font-bold text-gray-500 uppercase text-xs tracking-wider">Cantidad</span>
              <div className="flex items-center gap-4">
                 <button 
                   onClick={() => handleQuantityChange(-1)}
                   className="w-12 h-12 rounded-xl bg-white shadow-sm border border-gray-200 flex items-center justify-center text-gray-600 active:scale-95"
                 >
                    <Minus size={24} />
                 </button>
                 <span className="text-3xl font-bold text-gray-800 w-12 text-center">{quantity}</span>
                 <button 
                   onClick={() => handleQuantityChange(1)}
                   className="w-12 h-12 rounded-xl bg-blue-600 text-white shadow-sm flex items-center justify-center active:scale-95"
                 >
                    <Plus size={24} />
                 </button>
              </div>
           </div>

           {/* 2. Price / Discount Logic */}
           <div>
              <label className="text-xs font-bold text-gray-500 uppercase mb-2 block flex items-center gap-2">
                 <Tag size={14} /> Precio & Descuento
              </label>
              
              <div className="grid grid-cols-2 gap-4 mb-3">
                 <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">{config.currencySymbol}</span>
                    <input 
                      type="number" 
                      value={price}
                      onChange={handlePriceManualChange}
                      disabled={!canApplyDiscount}
                      className={`w-full pl-8 pr-4 py-3 rounded-xl border font-bold text-lg outline-none ${
                        price !== originalPrice ? 'text-orange-600 border-orange-200 bg-orange-50' : 'text-gray-800 border-gray-200'
                      } ${!canApplyDiscount ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
                    />
                    <span className="text-[10px] text-gray-400 absolute right-2 top-1">Unitario</span>
                 </div>
                 
                 {canApplyDiscount ? (
                   <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
                      <input 
                        type="number"
                        placeholder="Desc."
                        value={discountValue}
                        onChange={(e) => setDiscountValue(e.target.value)}
                        onBlur={handleApplyDiscount}
                        className="w-full bg-white rounded-lg px-2 text-center font-medium outline-none border border-gray-200"
                      />
                      <button 
                        onClick={() => { setDiscountType('PERCENT'); handleApplyDiscount(); }}
                        className={`p-2 rounded-lg transition-colors ${discountType === 'PERCENT' ? 'bg-white shadow text-blue-600' : 'text-gray-400'}`}
                      >
                         <Percent size={18} />
                      </button>
                      <button 
                        onClick={() => { setDiscountType('FIXED'); handleApplyDiscount(); }}
                        className={`p-2 rounded-lg transition-colors ${discountType === 'FIXED' ? 'bg-white shadow text-green-600' : 'text-gray-400'}`}
                      >
                         <DollarSign size={18} />
                      </button>
                   </div>
                 ) : (
                   <div className="flex items-center justify-center bg-gray-100 rounded-xl text-gray-400 text-xs text-center px-2">
                      Sin permisos
                   </div>
                 )}
              </div>
              
              {price !== originalPrice && (
                 <p className="text-xs text-orange-600 text-right font-medium">
                    Precio original: {config.currencySymbol}{originalPrice.toFixed(2)}
                 </p>
              )}
           </div>

           {/* 3. Notes / Comments */}
           <div>
              <label className="text-xs font-bold text-gray-500 uppercase mb-2 block flex items-center gap-2">
                 <MessageSquare size={14} /> Notas / Comentarios
              </label>
              <textarea 
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={isRestaurant ? "Ej. Sin cebolla, extra picante..." : "Ej. Producto con golpe, autorizado..."}
                className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              />
           </div>

        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-white border-t border-gray-100 flex gap-3">
           
           {canVoidItem ? (
             <button 
               onClick={handleDelete}
               className="px-3 py-3 bg-red-50 text-red-600 hover:bg-red-100 rounded-xl font-bold flex flex-col items-center justify-center gap-1 transition-colors min-w-[70px]"
             >
                <Trash2 size={20} />
                <span className="text-[10px] uppercase">Eliminar</span>
             </button>
           ) : (
             <button disabled className="px-3 py-3 bg-gray-100 text-gray-400 rounded-xl font-bold flex flex-col items-center justify-center gap-1 opacity-50 cursor-not-allowed min-w-[70px]">
                <Trash2 size={20} />
                <span className="text-[10px] uppercase">Bloq.</span>
             </button>
           )}

           {isRestaurant && !item.isSent && (
             <button 
               onClick={handleMarkAsSent}
               className="px-3 py-3 bg-orange-50 text-orange-600 hover:bg-orange-100 rounded-xl font-bold flex flex-col items-center justify-center gap-1 transition-colors min-w-[70px]"
             >
                <ChefHat size={20} />
                <span className="text-[10px] uppercase">Enviar</span>
             </button>
           )}

           <button 
             onClick={handleSave}
             className={`flex-1 py-3 text-white rounded-xl font-bold shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-all ${themeClasses}`}
           >
              <Save size={20} />
              <div className="text-left leading-none">
                 <span className="block">Actualizar Item</span>
                 <span className="text-[10px] font-normal opacity-80">Total: {config.currencySymbol}{(price * quantity).toFixed(2)}</span>
              </div>
           </button>

        </div>
      </div>
    </div>
  );
};

export default CartItemOptionsModal;