
import React, { useState } from 'react';
import { 
  X, Trash2, Save, Minus, Plus, MessageSquare, Percent, 
  DollarSign, Tag, User, Package, AlertTriangle 
} from 'lucide-react';
import { CartItem, BusinessConfig, User as UserType } from '../types';

interface CartItemOptionsModalProps {
  item: CartItem;
  config: BusinessConfig;
  users: UserType[]; // List of users for assignment
  onClose: () => void;
  onUpdate: (updatedItem: CartItem | null, cartIdToDelete?: string) => void;
  canApplyDiscount: boolean;
  canVoidItem: boolean;
}

const CartItemOptionsModal: React.FC<CartItemOptionsModalProps> = ({ 
  item, 
  config, 
  users,
  onClose, 
  onUpdate,
  canApplyDiscount,
  canVoidItem
}) => {
  // Local state for edits
  const [quantity, setQuantity] = useState(item.quantity);
  const [price, setPrice] = useState(item.price);
  const [note, setNote] = useState(item.note || '');
  const [salespersonId, setSalespersonId] = useState(item.salespersonId || '');
  
  // Discount Logic State
  const [discountType, setDiscountType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [discountValue, setDiscountValue] = useState<string>('');
  
  // Delete confirmation state
  const [isDeleting, setIsDeleting] = useState(false);

  const originalPrice = item.originalPrice || item.price;

  // --- LOGIC HANDLERS ---

  const handleQuantityChange = (delta: number) => {
    const newQty = Math.max(1, quantity + delta);
    setQuantity(newQty);
  };

  const handleApplyDiscount = () => {
    const val = parseFloat(discountValue);
    if (isNaN(val) || val <= 0) {
      setPrice(originalPrice); // Reset to original if cleared
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
      setDiscountValue(''); // Clear discount field if manual price set
    }
  };

  const handleSave = () => {
    onUpdate({
      ...item,
      quantity,
      price,
      note,
      originalPrice,
      salespersonId
    });
    onClose();
  };

  const handleDeleteConfirm = () => {
    onUpdate(null, item.cartId); // Pass cartId explicitly
    onClose();
  };

  const themeClasses = {
    blue: 'bg-blue-600 hover:bg-blue-700',
    orange: 'bg-orange-600 hover:bg-orange-700',
    gray: 'bg-gray-800 hover:bg-gray-900',
  }[config.themeColor] || 'bg-indigo-600';

  if (isDeleting) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
        <div className="bg-white p-6 rounded-2xl shadow-xl w-80 text-center animate-in zoom-in-95">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600">
            <Trash2 size={24} />
          </div>
          <h3 className="font-bold text-gray-800 text-lg mb-2">¿Eliminar artículo?</h3>
          <p className="text-gray-500 text-sm mb-6">Esta acción quitará "{item.name}" del ticket actual.</p>
          <div className="flex gap-2">
            <button onClick={() => setIsDeleting(false)} className="flex-1 py-2 bg-gray-100 font-bold text-gray-600 rounded-xl">Cancelar</button>
            <button onClick={handleDeleteConfirm} className="flex-1 py-2 bg-red-600 font-bold text-white rounded-xl shadow-lg shadow-red-200">Eliminar</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full md:w-[500px] md:rounded-3xl rounded-t-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in slide-in-from-bottom-10">
        
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex justify-between items-start bg-gray-50">
           <div>
              <h3 className="font-black text-xl text-gray-800 leading-tight mb-1">{item.name}</h3>
              <p className="text-sm text-gray-500 font-medium">
                {config.currencySymbol}{originalPrice.toFixed(2)} / unidad
              </p>
           </div>
           <button onClick={onClose} className="p-2 bg-white rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 shadow-sm border border-gray-100 transition-colors">
             <X size={20} />
           </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
           
           {/* 1. QUANTITY CONTROL (Fundamental) */}
           <div className="flex items-center justify-between bg-white p-2 rounded-2xl border-2 border-gray-100">
              <button 
                onClick={() => handleQuantityChange(-1)}
                className="w-14 h-14 rounded-xl bg-gray-50 hover:bg-gray-100 text-gray-600 flex items-center justify-center active:scale-90 transition-transform"
              >
                 <Minus size={24} />
              </button>
              <div className="text-center">
                 <span className="block text-3xl font-black text-gray-800">{quantity}</span>
                 <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Cantidad</span>
              </div>
              <button 
                onClick={() => handleQuantityChange(1)}
                className={`w-14 h-14 rounded-xl text-white shadow-md flex items-center justify-center active:scale-90 transition-transform ${themeClasses}`}
              >
                 <Plus size={24} />
              </button>
           </div>

           {/* 2. STOCK INDICATOR (Requested) */}
           <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 flex items-center justify-between">
              <div className="flex items-center gap-2 text-blue-700">
                 <Package size={18} />
                 <span className="text-sm font-bold">Stock Disponible</span>
              </div>
              <span className="text-lg font-black text-blue-800">{item.stock || 0} u.</span>
           </div>

           <div className="grid grid-cols-2 gap-4">
              {/* 3. PRICE CHANGER (Requested) */}
              <div>
                 <label className="text-xs font-bold text-gray-400 uppercase mb-2 block flex items-center gap-1">
                    <DollarSign size={14} /> Precio Unitario
                 </label>
                 <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">{config.currencySymbol}</span>
                    <input 
                      type="number" 
                      value={price}
                      onChange={handlePriceManualChange}
                      disabled={!canApplyDiscount}
                      className={`w-full pl-8 pr-3 py-3 rounded-xl border font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500 ${!canApplyDiscount ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'border-gray-200'}`}
                    />
                 </div>
              </div>

              {/* 4. DISCOUNT APP (Requested) */}
              <div>
                 <label className="text-xs font-bold text-gray-400 uppercase mb-2 block flex items-center gap-1">
                    <Tag size={14} /> Descuento
                 </label>
                 <div className="flex gap-1">
                    <input 
                      type="number"
                      placeholder="0"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      onBlur={handleApplyDiscount}
                      disabled={!canApplyDiscount}
                      className="w-full bg-white border border-gray-200 rounded-l-xl px-3 text-center font-bold outline-none focus:border-indigo-500 disabled:bg-gray-100"
                    />
                    <button 
                      onClick={() => { setDiscountType('PERCENT'); setTimeout(handleApplyDiscount, 0); }}
                      className={`px-2 border-y border-r border-gray-200 ${discountType === 'PERCENT' ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-50 text-gray-400'}`}
                    >
                       <Percent size={14} />
                    </button>
                    <button 
                      onClick={() => { setDiscountType('FIXED'); setTimeout(handleApplyDiscount, 0); }}
                      className={`px-2 rounded-r-xl border-y border-r border-gray-200 ${discountType === 'FIXED' ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-50 text-gray-400'}`}
                    >
                       <DollarSign size={14} />
                    </button>
                 </div>
              </div>
           </div>

           {/* 5. SALESPERSON ASSIGNMENT (Requested) */}
           <div>
              <label className="text-xs font-bold text-gray-400 uppercase mb-2 block flex items-center gap-1">
                 <User size={14} /> Vendedor (Comisión)
              </label>
              <div className="relative">
                 <select 
                    value={salespersonId}
                    onChange={(e) => setSalespersonId(e.target.value)}
                    className="w-full p-3 pl-10 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 appearance-none font-medium text-gray-700"
                 >
                    <option value="">-- Sin asignar --</option>
                    {users.map(u => (
                       <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                 </select>
                 <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              </div>
           </div>

           {/* Notes (Extra utility) */}
           <div className="pt-2">
              <label className="text-xs font-bold text-gray-400 uppercase mb-2 block flex items-center gap-1">
                 <MessageSquare size={14} /> Notas
              </label>
              <input 
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ej. Producto golpeado..."
                className="w-full border-b border-gray-200 py-2 text-sm focus:border-indigo-500 outline-none bg-transparent"
              />
           </div>

        </div>

        {/* Footer Actions */}
        <div className="p-5 bg-white border-t border-gray-100 flex gap-4">
           
           {/* 6. DELETE ITEM (Requested) */}
           {canVoidItem ? (
             <button 
               onClick={() => setIsDeleting(true)}
               className="px-4 py-3 bg-white border-2 border-red-100 text-red-500 hover:bg-red-50 hover:border-red-200 rounded-xl font-bold flex flex-col items-center justify-center gap-1 transition-all min-w-[80px]"
             >
                <Trash2 size={20} />
                <span className="text-[10px] uppercase">Eliminar</span>
             </button>
           ) : (
             <button disabled className="px-4 py-3 bg-gray-100 text-gray-400 rounded-xl font-bold flex flex-col items-center justify-center gap-1 min-w-[80px] opacity-50 cursor-not-allowed">
                <Trash2 size={20} />
                <span className="text-[10px] uppercase">Bloq.</span>
             </button>
           )}

           <button 
             onClick={handleSave}
             className={`flex-1 py-3 text-white rounded-xl font-bold shadow-lg flex items-center justify-center gap-3 active:scale-95 transition-all ${themeClasses}`}
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
