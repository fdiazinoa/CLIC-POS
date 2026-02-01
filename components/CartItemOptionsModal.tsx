
import React, { useState, useMemo } from 'react';
import {
  X, Trash2, Save, Minus, Plus, MessageSquare, Percent,
  DollarSign, Tag, User, Package, ChevronRight
} from 'lucide-react';
import { CartItem, BusinessConfig, User as UserType, RoleDefinition } from '../types';

interface CartItemOptionsModalProps {
  item: CartItem;
  config: BusinessConfig;
  users: UserType[];
  roles?: RoleDefinition[];
  onClose: () => void;
  onUpdate: (updatedItem: CartItem | null, cartIdToDelete?: string) => void;
  canApplyDiscount: boolean;
  canVoidItem: boolean;
}

const CartItemOptionsModal: React.FC<CartItemOptionsModalProps> = ({
  item,
  config,
  users,
  roles = [],
  onClose,
  onUpdate,
  canApplyDiscount,
  canVoidItem
}) => {
  const [quantity, setQuantity] = useState(item.quantity);
  const [price, setPrice] = useState(item.price);
  const [note, setNote] = useState(item.note || '');
  const [salespersonId, setSalespersonId] = useState(item.salespersonId || '');

  const [discountType, setDiscountType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [discountValue, setDiscountValue] = useState<string>('');
  const [isDeleting, setIsDeleting] = useState(false);

  const originalPrice = item.originalPrice || item.price;

  const salesUsers = useMemo(() => {
    const vendorRole = roles.find(r => ['vendedor', 'seller', 'sales', 'comercial'].includes(r.name.toLowerCase()));
    if (vendorRole) {
      const filtered = users.filter(u => u.role === vendorRole.id);
      return filtered.length > 0 ? filtered : users;
    }
    return users;
  }, [users, roles]);

  const handleQuantityChange = (delta: number) => {
    const newQty = Math.max(0.001, quantity + delta);
    setQuantity(parseFloat(newQty.toFixed(3)));
  };

  const handleApplyDiscount = () => {
    const val = parseFloat(discountValue);
    if (isNaN(val) || val <= 0) {
      setPrice(originalPrice);
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
      setDiscountValue('');
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
    onUpdate(null, item.cartId);
    onClose();
  };

  const themeClasses = {
    blue: 'bg-blue-600 hover:bg-blue-700',
    orange: 'bg-orange-600 hover:bg-orange-700',
    gray: 'bg-gray-800 hover:bg-gray-900',
  }[config.themeColor] || 'bg-blue-600';

  if (isDeleting) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
        <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl w-full max-w-sm text-center animate-in zoom-in-95 mx-4">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6 text-red-500">
            <Trash2 size={32} />
          </div>
          <h3 className="font-black text-gray-900 text-xl mb-2">¿Eliminar artículo?</h3>
          <p className="text-gray-500 font-medium mb-8">Esta acción quitará "{item.name}" del ticket actual.</p>
          <div className="flex gap-3">
            <button onClick={() => setIsDeleting(false)} className="flex-1 py-4 bg-gray-100 font-bold text-gray-600 rounded-2xl active:scale-95 transition-all">Cancelar</button>
            <button onClick={handleDeleteConfirm} className="flex-1 py-4 bg-red-600 font-bold text-white rounded-2xl shadow-lg shadow-red-200 active:scale-95 transition-all">Eliminar</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white w-full md:w-[500px] md:rounded-[2.5rem] rounded-t-[2.5rem] shadow-2xl flex flex-col max-h-[95vh] overflow-hidden animate-in slide-in-from-bottom-10">

        {/* Header */}
        <div className="p-6 pb-4 flex justify-between items-start">
          <div>
            <h3 className="font-black text-lg text-gray-900 leading-tight mb-0.5">{item.name}</h3>
            <p className="text-sm text-gray-400 font-bold">
              {config.currencySymbol}{originalPrice.toFixed(2)} / unidad
            </p>
          </div>
          <button onClick={onClose} className="p-2.5 bg-gray-50 rounded-full hover:bg-gray-100 text-gray-400 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 pt-2 overflow-y-auto space-y-6 custom-scrollbar">

          {/* 1. QUANTITY STEPPER (Touch Friendly) */}
          <div className="bg-white p-4 rounded-[2rem] border border-gray-100 shadow-sm flex items-center justify-between">
            <button
              onClick={() => handleQuantityChange(-1)}
              className="w-16 h-16 rounded-2xl bg-gray-50 hover:bg-gray-100 text-gray-400 flex items-center justify-center active:scale-90 transition-all"
            >
              <Minus size={28} strokeWidth={3} />
            </button>

            <div className="text-center">
              <span className="block text-4xl font-black text-gray-900 leading-none mb-1">{quantity}</span>
              <span className="text-[10px] uppercase font-black text-gray-300 tracking-[0.2em]">Cantidad</span>
            </div>

            <button
              onClick={() => handleQuantityChange(1)}
              className={`w-16 h-16 rounded-2xl text-white shadow-lg shadow-blue-100 flex items-center justify-center active:scale-90 transition-all ${themeClasses}`}
            >
              <Plus size={28} strokeWidth={3} />
            </button>
          </div>

          {/* 2. STOCK BADGE */}
          <div className="bg-blue-50/50 px-5 py-3.5 rounded-2xl border border-blue-100/50 flex items-center justify-between">
            <div className="flex items-center gap-3 text-blue-600">
              <Package size={20} />
              <span className="text-sm font-black uppercase tracking-wider">Stock Disponible</span>
            </div>
            <span className="text-lg font-black text-blue-700">{item.stock || 0} u.</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 3. PRICE INPUT */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                <DollarSign size={12} /> Precio Unitario
              </label>
              <div className="relative group">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-black text-sm">$</span>
                <input
                  type="number"
                  value={price}
                  onChange={handlePriceManualChange}
                  disabled={!canApplyDiscount}
                  className={`w-full pl-8 pr-4 py-4 rounded-2xl bg-gray-50 border-none font-black text-gray-800 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all ${!canApplyDiscount ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
            </div>

            {/* 4. DISCOUNT INPUT */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                <Tag size={12} /> Descuento
              </label>
              <div className="flex gap-1">
                <div className="relative flex-1">
                  <input
                    type="number"
                    placeholder="0"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    onBlur={handleApplyDiscount}
                    disabled={!canApplyDiscount}
                    className="w-full bg-gray-50 border-none rounded-l-2xl pl-4 pr-2 py-4 font-black text-gray-800 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
                  />
                </div>
                <button
                  onClick={() => { setDiscountType('PERCENT'); setTimeout(handleApplyDiscount, 0); }}
                  className={`px-4 py-4 border-none font-black text-sm transition-all ${discountType === 'PERCENT' ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-400'}`}
                >
                  %
                </button>
                <button
                  onClick={() => { setDiscountType('FIXED'); setTimeout(handleApplyDiscount, 0); }}
                  className={`px-4 py-4 rounded-r-2xl border-none font-black text-sm transition-all ${discountType === 'FIXED' ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-400'}`}
                >
                  $
                </button>
              </div>
            </div>
          </div>

          {/* 5. SELLER SELECT */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
              <User size={12} /> Vendedor (Comisión)
            </label>
            <div className="relative">
              <select
                value={salespersonId}
                onChange={(e) => setSalespersonId(e.target.value)}
                className="w-full p-4 pl-12 bg-gray-50 border-none rounded-2xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 appearance-none font-bold text-gray-700 transition-all"
              >
                <option value="">-- Sin asignar --</option>
                {salesUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 rotate-90" size={18} />
            </div>
          </div>

          {/* 6. NOTES SECTION */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
              <MessageSquare size={12} /> Notas
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej. Producto golpeado..."
              rows={2}
              className="w-full bg-transparent border-b border-gray-100 py-2 text-sm font-medium focus:border-blue-500 outline-none transition-all resize-none"
            />
          </div>

        </div>

        {/* Footer Actions */}
        <div className="p-6 bg-white border-t border-gray-50 flex gap-3">

          {/* DELETE BUTTON */}
          <button
            onClick={() => setIsDeleting(true)}
            disabled={!canVoidItem}
            className={`w-[25%] py-4 rounded-2xl font-black flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${canVoidItem ? 'bg-white border-2 border-red-50 text-red-500 hover:bg-red-50' : 'bg-gray-50 text-gray-300 opacity-50 cursor-not-allowed'}`}
          >
            <Trash2 size={24} />
            <span className="text-[8px] uppercase tracking-tighter">Eliminar</span>
          </button>

          {/* UPDATE BUTTON */}
          <button
            onClick={handleSave}
            className={`flex-1 py-4 text-white rounded-2xl font-black shadow-xl shadow-blue-100 flex items-center justify-center gap-4 active:scale-95 transition-all ${themeClasses}`}
          >
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Save size={20} />
            </div>
            <div className="text-left">
              <span className="block text-lg leading-none mb-0.5">Actualizar Item</span>
              <span className="text-[10px] font-bold opacity-70 uppercase tracking-wider">Total: {config.currencySymbol}{(price * quantity).toFixed(2)}</span>
            </div>
          </button>

        </div>
      </div>
    </div>
  );
};

export default CartItemOptionsModal;
