
import React, { useState, useMemo } from 'react';
import {
  X, Trash2, Save, Minus, Plus, MessageSquare, Percent,
  DollarSign, Tag, User, Package, ChevronRight
} from 'lucide-react';
import { CartItem, BusinessConfig, User as UserType, RoleDefinition } from '../types';
import { TerminalSnapshotSeller } from '../utils/terminalSnapshotSellers';
import { canStepCartQuantity } from '../utils/cartQuantity';
import { Capacitor } from '@capacitor/core';
import NumericKeypad from './NumericKeypad';

interface CartItemOptionsModalProps {
  item: CartItem;
  config: BusinessConfig;
  users: UserType[];
  salesUsers?: TerminalSnapshotSeller[];
  roles?: RoleDefinition[];
  onClose: () => void;
  onUpdate: (updatedItem: CartItem | null, cartIdToDelete?: string) => void;
  canApplyDiscount: boolean;
  canOverridePrice: boolean;
  canEditQuantity: boolean;
  canVoidItem: boolean;
}

const CartItemOptionsModal: React.FC<CartItemOptionsModalProps> = ({
  item,
  config,
  users,
  salesUsers: incomingSalesUsers = [],
  roles = [],
  onClose,
  onUpdate,
  canApplyDiscount,
  canOverridePrice,
  canEditQuantity,
  canVoidItem
}) => {
  const EPSILON = 0.01;
  const [quantity, setQuantity] = useState(item.quantity);
  const [price, setPrice] = useState(item.price);
  const [priceInputValue, setPriceInputValue] = useState(String(item.price ?? 0));
  const [note, setNote] = useState(item.note || '');
  const [salespersonId, setSalespersonId] = useState(item.salespersonId || '');

  const [discountType, setDiscountType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [discountValue, setDiscountValue] = useState<string>('');
  const [activeNumericField, setActiveNumericField] = useState<'PRICE' | 'DISCOUNT'>(
    canApplyDiscount ? 'DISCOUNT' : 'PRICE'
  );
  const [replacePriceOnNextKey, setReplacePriceOnNextKey] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const isAndroid = Capacitor.getPlatform() === 'android';

  const originalPrice = item.originalPrice || item.price;
  const adjustmentBasePrice = (item.adjustmentSource === 'PROMOTION' || item.adjustmentSource === 'TARIFF')
    ? item.price
    : originalPrice;

  const salesUsers = useMemo(() => {
    if (incomingSalesUsers.length > 0) {
      return incomingSalesUsers;
    }

    const vendorRole = roles.find(r => ['vendedor', 'seller', 'sales', 'comercial'].includes(r.name.toLowerCase()));
    if (vendorRole) {
      const filtered = users.filter(u => u.role === vendorRole.id);
      return filtered.length > 0 ? filtered : users;
    }
    return users;
  }, [incomingSalesUsers, users, roles]);

  const handleQuantityChange = (delta: number) => {
    if (!canStepCartQuantity(quantity, delta)) return;
    const newQty = quantity + delta;
    setQuantity(parseFloat(newQty.toFixed(3)));
  };

  const applyDiscount = (rawValue: string, type: 'PERCENT' | 'FIXED') => {
    const val = parseFloat(rawValue);
    if (isNaN(val) || val <= 0) {
      setPrice(adjustmentBasePrice);
      setPriceInputValue(String(adjustmentBasePrice));
      return;
    }

    let newPrice = adjustmentBasePrice;
    if (type === 'PERCENT') {
      newPrice = adjustmentBasePrice - (adjustmentBasePrice * (val / 100));
    } else {
      newPrice = Math.max(0, adjustmentBasePrice - val);
    }
    const normalizedPrice = parseFloat(newPrice.toFixed(2));
    setPrice(normalizedPrice);
    setPriceInputValue(String(normalizedPrice));
  };

  const handleDiscountValueChange = (nextValue: string) => {
    setDiscountValue(nextValue);
    applyDiscount(nextValue, discountType);
  };

  const handleDiscountTypeChange = (nextType: 'PERCENT' | 'FIXED') => {
    setDiscountType(nextType);
    applyDiscount(discountValue, nextType);
  };

  const handlePriceValueChange = (rawValue: string) => {
    setPriceInputValue(rawValue);
    setReplacePriceOnNextKey(false);
    const val = parseFloat(rawValue);
    setPrice(!isNaN(val) && val >= 0 ? val : 0);
    setDiscountValue('');
  };

  const activatePriceKeypad = () => {
    setActiveNumericField('PRICE');
    setReplacePriceOnNextKey(true);
  };

  const handleSave = () => {
    const nextQuantity = canEditQuantity ? quantity : item.quantity;
    const nextPrice = canApplyDiscount || canOverridePrice ? price : item.price;
    const nextItem: CartItem = {
      ...item,
      quantity: nextQuantity,
      price: nextPrice,
      note,
      salespersonId
    };

    if (
      Math.abs(nextPrice - item.price) <= EPSILON
      && (item.adjustmentSource === 'MANUAL_DISCOUNT' || item.adjustmentSource === 'MANUAL_PRICE_OVERRIDE')
    ) {
      nextItem.originalPrice = item.originalPrice;
      nextItem.discountAmount = item.discountAmount;
      nextItem.discountRate = item.discountRate;
      nextItem.adjustmentSource = item.adjustmentSource;
    } else if (nextPrice < adjustmentBasePrice - EPSILON) {
      nextItem.originalPrice = adjustmentBasePrice;
      nextItem.discountAmount = Number(((adjustmentBasePrice - nextPrice) * nextQuantity).toFixed(2));
      nextItem.discountRate = adjustmentBasePrice > 0
        ? Number((((adjustmentBasePrice - nextPrice) / adjustmentBasePrice)).toFixed(4))
        : undefined;
      nextItem.adjustmentSource = 'MANUAL_DISCOUNT';
      delete nextItem.appliedPromotionId;
      delete nextItem.appliedPromotionCode;
      delete nextItem.appliedPromotionName;
      delete nextItem.promotionTrace;
    } else if (Math.abs(nextPrice - adjustmentBasePrice) > EPSILON) {
      nextItem.originalPrice = adjustmentBasePrice;
      nextItem.discountAmount = undefined;
      nextItem.discountRate = undefined;
      nextItem.adjustmentSource = 'MANUAL_PRICE_OVERRIDE';
      delete nextItem.appliedPromotionId;
      delete nextItem.appliedPromotionCode;
      delete nextItem.appliedPromotionName;
      delete nextItem.promotionTrace;
    } else if (item.adjustmentSource === 'TARIFF') {
      nextItem.originalPrice = item.originalPrice;
      nextItem.discountAmount = item.discountAmount;
      nextItem.discountRate = item.discountRate;
      nextItem.adjustmentSource = 'TARIFF';
    } else if (item.adjustmentSource === 'PROMOTION') {
      nextItem.originalPrice = item.originalPrice;
      nextItem.discountAmount = item.discountAmount;
      nextItem.discountRate = item.discountRate;
      nextItem.adjustmentSource = 'PROMOTION';
      nextItem.appliedPromotionId = item.appliedPromotionId;
      nextItem.appliedPromotionCode = item.appliedPromotionCode;
      nextItem.appliedPromotionName = item.appliedPromotionName;
      nextItem.promotionTrace = item.promotionTrace;
    } else {
      nextItem.originalPrice = originalPrice;
      nextItem.discountAmount = undefined;
      nextItem.discountRate = undefined;
      nextItem.adjustmentSource = undefined;
      delete nextItem.appliedPromotionId;
      delete nextItem.appliedPromotionCode;
      delete nextItem.appliedPromotionName;
      delete nextItem.promotionTrace;
    }

    onUpdate({
      ...nextItem
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
      <div className="bg-white w-full md:w-[760px] md:rounded-[2.5rem] rounded-t-[2.5rem] shadow-2xl flex flex-col max-h-[95vh] overflow-hidden animate-in slide-in-from-bottom-10">

        {/* Header */}
        <div className="p-6 pb-4 flex justify-between items-start">
          <div>
            <h3 className="font-black text-lg text-gray-900 leading-tight mb-0.5">{item.name}</h3>
            <p className="text-sm text-gray-400 font-bold">
              {config.currencySymbol}{adjustmentBasePrice.toFixed(2)} / unidad
            </p>
          </div>
          <button onClick={onClose} className="p-2.5 bg-gray-50 rounded-full hover:bg-gray-100 text-gray-400 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 pt-2 overflow-y-auto space-y-6 custom-scrollbar">

          {/* 1. QUANTITY STEPPER (Touch Friendly) */}
          {canEditQuantity && (
          <div className="bg-white p-4 rounded-[2rem] border border-gray-100 shadow-sm flex items-center justify-between">
            <button
              onClick={() => handleQuantityChange(-1)}
              disabled={!canStepCartQuantity(quantity, -1)}
              className="w-16 h-16 rounded-2xl bg-gray-50 hover:bg-gray-100 text-gray-400 flex items-center justify-center active:scale-90 transition-all disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Minus size={28} strokeWidth={3} />
            </button>

            <div className="text-center">
              <span className="block text-4xl font-black text-gray-900 leading-none mb-1">{quantity}</span>
              <span className="text-[10px] uppercase font-black text-gray-300 tracking-[0.2em]">Cantidad</span>
            </div>

            <button
              onClick={() => handleQuantityChange(1)}
              disabled={!canStepCartQuantity(quantity, 1)}
              className={`w-16 h-16 rounded-2xl text-white shadow-lg shadow-blue-100 flex items-center justify-center active:scale-90 transition-all disabled:cursor-not-allowed disabled:opacity-40 ${themeClasses}`}
            >
              <Plus size={28} strokeWidth={3} />
            </button>
          </div>
          )}

          {/* 2. STOCK BADGE */}
          {!(!canEditQuantity && !canApplyDiscount && !canOverridePrice && !canVoidItem) && (
          <div className="bg-blue-50/50 px-5 py-3.5 rounded-2xl border border-blue-100/50 flex items-center justify-between">
            <div className="flex items-center gap-3 text-blue-600">
              <Package size={20} />
              <span className="text-sm font-black uppercase tracking-wider">Stock Disponible</span>
            </div>
            <span className="text-lg font-black text-blue-700">{item.stock || 0} u.</span>
          </div>
          )}

          <div className={`grid grid-cols-1 gap-5 items-start ${(canApplyDiscount || canOverridePrice) ? 'md:grid-cols-2' : ''}`} data-layout="restaurant-item-options">
            {(canApplyDiscount || canOverridePrice) && (
            <div className="space-y-4">
            {/* 3. PRICE INPUT */}
            {canOverridePrice && (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                <DollarSign size={12} /> Precio Unitario
              </label>
              <div className="relative group">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-black text-sm">$</span>
                <input
                  type={isAndroid ? 'text' : 'number'}
                  inputMode={isAndroid ? 'none' : 'decimal'}
                  readOnly={isAndroid}
                  data-disable-native-soft-keyboard={isAndroid ? 'true' : undefined}
                  value={priceInputValue}
                  onFocus={activatePriceKeypad}
                  onClick={activatePriceKeypad}
                  onChange={(event) => handlePriceValueChange(event.target.value)}
                  className={`w-full pl-8 pr-4 py-4 rounded-2xl border-none font-black text-gray-800 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all ${activeNumericField === 'PRICE' && isAndroid ? 'bg-blue-50 ring-2 ring-blue-200' : 'bg-gray-50'}`}
                />
              </div>
            </div>
            )}

            {/* 4. DISCOUNT INPUT */}
            {canApplyDiscount && (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                <Tag size={12} /> Descuento
              </label>
              <div className="flex gap-1">
                <div className="relative flex-1">
                  <input
                    type={isAndroid ? 'text' : 'number'}
                    inputMode={isAndroid ? 'none' : 'decimal'}
                    readOnly={isAndroid}
                    data-disable-native-soft-keyboard={isAndroid ? 'true' : undefined}
                    placeholder="0"
                    value={discountValue}
                    onFocus={() => setActiveNumericField('DISCOUNT')}
                    onClick={() => setActiveNumericField('DISCOUNT')}
                    onChange={(e) => handleDiscountValueChange(e.target.value)}
                    className="w-full bg-gray-50 border-none rounded-l-2xl pl-4 pr-2 py-4 font-black text-gray-800 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
                  />
                </div>
                <button
                  onClick={() => {
                    setActiveNumericField('DISCOUNT');
                    handleDiscountTypeChange('PERCENT');
                  }}
                  className={`px-4 py-4 border-none font-black text-sm transition-all ${discountType === 'PERCENT' ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-400'}`}
                >
                  %
                </button>
                <button
                  onClick={() => {
                    setActiveNumericField('DISCOUNT');
                    handleDiscountTypeChange('FIXED');
                  }}
                  className={`px-4 py-4 rounded-r-2xl border-none font-black text-sm transition-all ${discountType === 'FIXED' ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-400'}`}
                >
                  $
                </button>
              </div>
            </div>
            )}
              {isAndroid && (
                <div className="space-y-2">
                  <p className="text-[9px] font-black uppercase tracking-[0.16em] text-blue-500">
                    Digitando: {activeNumericField === 'PRICE' ? 'Precio unitario' : 'Descuento'}
                  </p>
                  <NumericKeypad
                    value={activeNumericField === 'PRICE'
                      ? (replacePriceOnNextKey ? '' : priceInputValue)
                      : discountValue}
                    onChange={activeNumericField === 'PRICE' ? handlePriceValueChange : handleDiscountValueChange}
                    maxValue={activeNumericField === 'DISCOUNT'
                      ? (discountType === 'PERCENT' ? 100 : adjustmentBasePrice)
                      : undefined}
                  />
                </div>
              )}
            </div>
            )}

            <div className="space-y-5">
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
                  <option key={u.id} value={u.id}>{u.roleName ? `${u.name} · ${u.roleName}` : u.name}</option>
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
          </div>

        </div>

        {/* Footer Actions */}
        <div className="p-6 bg-white border-t border-gray-50 flex gap-3">

          {/* DELETE BUTTON */}
          {canVoidItem && <button
            onClick={() => setIsDeleting(true)}
            className="w-[25%] py-4 rounded-2xl font-black flex flex-col items-center justify-center gap-1 transition-all active:scale-95 bg-white border-2 border-red-50 text-red-500 hover:bg-red-50"
          >
            <Trash2 size={24} />
            <span className="text-[8px] uppercase tracking-tighter">Eliminar</span>
          </button>
          }

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
              <span className="text-[10px] font-bold opacity-70 uppercase tracking-wider">Total: {config.currencySymbol}{((canApplyDiscount || canOverridePrice ? price : item.price) * (canEditQuantity ? quantity : item.quantity)).toFixed(2)}</span>
            </div>
          </button>

        </div>
      </div>
    </div>
  );
};

export default CartItemOptionsModal;
