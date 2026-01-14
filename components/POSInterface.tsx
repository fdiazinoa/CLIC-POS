
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Search, ShoppingCart, Trash2, MoreVertical, 
  CreditCard, User, Tag, Grid, Save,
  Settings, Users, History, Wallet,
  UserPlus, X, Percent, ArrowLeft, ChevronRight,
  Scale as ScaleIcon, PauseCircle, LogOut,
  ArrowRightLeft, Globe, DollarSign,
  ChevronDown, Check, AlertCircle, Layers
} from 'lucide-react';
import { 
  BusinessConfig, User as UserType, RoleDefinition, 
  Customer, Product, CartItem, Transaction, CurrencyConfig, Tariff, TaxDefinition
} from '../types';
import UnifiedPaymentModal from './PaymentModal';
import TicketOptionsModal from './TicketOptionsModal';
import CartItemOptionsModal from './CartItemOptionsModal';
import ProductVariantSelector from './ProductVariantSelector';
import ScaleModal from './ScaleModal';
import GlobalDiscountModal from './GlobalDiscountModal';
import CurrencySettings from './CurrencySettings';

interface POSInterfaceProps {
  config: BusinessConfig;
  currentUser: UserType;
  roles: RoleDefinition[];
  customers: Customer[];
  products: Product[];
  cart: CartItem[];
  onUpdateCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  selectedCustomer: Customer | null;
  onSelectCustomer: (customer: Customer | null) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenCustomers: () => void;
  onOpenHistory: () => void;
  onOpenFinance: () => void;
  onTransactionComplete: (txn: Transaction) => void;
  onAddCustomer: (customer: Customer) => void;
  onUpdateConfig: (newConfig: BusinessConfig) => void;
}

const POSInterface: React.FC<POSInterfaceProps> = ({
  config,
  currentUser,
  products,
  customers,
  cart,
  onUpdateCart,
  selectedCustomer,
  onSelectCustomer,
  onLogout,
  onOpenSettings,
  onOpenCustomers,
  onOpenHistory,
  onOpenFinance,
  onTransactionComplete,
  onUpdateConfig
}) => {
  const cartEndRef = useRef<HTMLDivElement>(null);

  const activeTerminalConfig = useMemo(() => config.terminals?.[0]?.config || config.terminals?.[0]?.config, [config]);
  const [activeTariffId, setActiveTariffId] = useState<string>(activeTerminalConfig?.pricing?.defaultTariffId || config.tariffs?.[0]?.id || '');
  const [showTariffSelector, setShowTariffSelector] = useState(false);

  const allowedTariffs = useMemo(() => {
    const ids = activeTerminalConfig?.pricing?.allowedTariffIds || [];
    return config.tariffs.filter(t => ids.includes(t.id));
  }, [config.tariffs, activeTerminalConfig]);

  const activeTariff = useMemo(() => config.tariffs.find(t => t.id === activeTariffId), [config.tariffs, activeTariffId]);

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [parkedTickets, setParkedTickets] = useState<{id: string, items: CartItem[], customer: Customer | null, total: number, date: string}[]>([]);
  const [mobileView, setMobileView] = useState<'PRODUCTS' | 'TICKET'>('PRODUCTS');
  
  const [globalDiscount, setGlobalDiscount] = useState<{value: number, type: 'PERCENT' | 'FIXED'}>({value: 0, type: 'PERCENT'});

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showTicketOptions, setShowTicketOptions] = useState(false);
  const [showParkedList, setShowParkedList] = useState(false);
  const [showGlobalDiscount, setShowGlobalDiscount] = useState(false);
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<Product | null>(null);
  const [productForScale, setProductForScale] = useState<Product | null>(null);

  const showImagesInTicket = activeTerminalConfig?.workflow?.inventory?.showProductImagesInReceipt ?? false;

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const tariffPrice = p.tariffs.find(t => t.tariffId === activeTariffId);
      if (!tariffPrice) return false;
      const matchSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.barcode?.includes(searchTerm);
      const matchCat = categoryFilter === 'ALL' || p.category === categoryFilter;
      return matchSearch && matchCat;
    });
  }, [products, searchTerm, categoryFilter, activeTariffId]);

  const categories = useMemo(() => {
    const visibleProducts = products.filter(p => p.tariffs.some(t => t.tariffId === activeTariffId));
    return ['ALL', ...Array.from(new Set(visibleProducts.map(p => p.category)))];
  }, [products, activeTariffId]);

  const getProductPrice = (p: Product) => {
    return p.tariffs.find(t => t.tariffId === activeTariffId)?.price || p.price;
  };

  const cartSubtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  const discountAmount = useMemo(() => {
    if (globalDiscount.type === 'PERCENT') {
      return cartSubtotal * (globalDiscount.value / 100);
    }
    return Math.min(globalDiscount.value, cartSubtotal);
  }, [cartSubtotal, globalDiscount]);

  const netSubtotal = cartSubtotal - discountAmount;

  const taxBreakdown = useMemo(() => {
    const breakdown: Record<string, { name: string, amount: number }> = {};
    
    cart.forEach(item => {
      const itemNet = (item.price * item.quantity) * (netSubtotal / cartSubtotal || 1);
      const itemTaxIds = item.appliedTaxIds || [];
      
      itemTaxIds.forEach(taxId => {
        const taxDef = config.taxes.find(t => t.id === taxId);
        if (taxDef) {
          if (!breakdown[taxId]) breakdown[taxId] = { name: taxDef.name, amount: 0 };
          breakdown[taxId].amount += itemNet * taxDef.rate;
        }
      });
    });

    return Object.values(breakdown);
  }, [cart, netSubtotal, cartSubtotal, config.taxes]);

  const cartTax = taxBreakdown.reduce((sum, t) => sum + t.amount, 0);
  const cartTotal = netSubtotal + cartTax;

  const baseCurrency = useMemo(() => config.currencies.find(c => c.isBase) || config.currencies[0], [config.currencies]);
  const altCurrencies = useMemo(() => config.currencies.filter(c => !c.isBase && c.isEnabled), [config.currencies]);

  useEffect(() => {
    if (cart.length === 0) {
      setMobileView('PRODUCTS');
      setGlobalDiscount({value: 0, type: 'PERCENT'});
    } else {
      cartEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [cart.length]);

  const handleProductClick = (product: Product) => {
    const isWeighted = product.type === 'SERVICE' || product.name.toLowerCase().includes('(peso)');
    const hasVariants = product.attributes && product.attributes.length > 0;

    if (isWeighted) {
      setProductForScale(product);
    } else if (hasVariants) {
      setSelectedProductForVariants(product);
    } else {
      addToCart(product);
    }
  };

  const addToCart = (product: Product, quantity: number = 1, priceOverride?: number, modifiers?: string[]) => {
    const finalPrice = priceOverride || getProductPrice(product);
    onUpdateCart(prev => {
      const modifiersString = modifiers ? modifiers.sort().join('|') : '';
      const existing = prev.find(i => {
        const iMods = i.modifiers ? i.modifiers.sort().join('|') : '';
        return i.id === product.id && iMods === modifiersString && i.price === finalPrice;
      });

      if (existing) {
        return prev.map(i => i.cartId === existing.cartId ? { ...i, quantity: i.quantity + quantity } : i);
      }
      return [...prev, { 
        ...product, 
        cartId: Math.random().toString(36).substr(2, 9), 
        quantity, 
        price: finalPrice,
        modifiers 
      }];
    });
  };

  const updateCartItem = (updatedItem: CartItem | null, cartIdToDelete?: string) => {
    if (cartIdToDelete || updatedItem === null) {
      onUpdateCart(prev => prev.filter(i => i.cartId !== (cartIdToDelete || editingItem?.cartId)));
    } else {
      onUpdateCart(prev => prev.map(i => i.cartId === updatedItem.cartId ? updatedItem : i));
    }
    setEditingItem(null);
  };

  const handlePaymentConfirm = (payments: any[]) => {
    const txn: Transaction = {
      id: `T-${Date.now()}`,
      date: new Date().toISOString(),
      items: cart,
      total: cartTotal,
      payments: payments,
      userId: currentUser.id,
      userName: currentUser.name,
      status: 'COMPLETED',
      customerId: selectedCustomer?.id,
      customerName: selectedCustomer?.name
    };
    onTransactionComplete(txn);
    setShowPaymentModal(false);
    onUpdateCart([]);
    onSelectCustomer(null);
    setMobileView('PRODUCTS');
    setGlobalDiscount({value: 0, type: 'PERCENT'});
  };

  const handleParkTicket = () => {
    if (cart.length === 0) return;
    const newParked = {
      id: `P-${Date.now()}`,
      items: [...cart],
      customer: selectedCustomer,
      total: cartTotal,
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setParkedTickets([...parkedTickets, newParked]);
    onUpdateCart([]);
    onSelectCustomer(null);
    setMobileView('PRODUCTS');
  };

  const handleResumeTicket = (parked: any) => {
    if (cart.length > 0 && !confirm("¿Reemplazar el ticket actual?")) return;
    onUpdateCart(parked.items);
    onSelectCustomer(parked.customer);
    setParkedTickets(parkedTickets.filter(p => p.id !== parked.id));
    setShowParkedList(false);
    setMobileView('TICKET');
  };

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden font-sans text-gray-900 relative">
      
      {/* AREA CENTRAL: CATÁLOGO */}
      <div className={`flex-1 flex flex-col min-w-0 bg-gray-50 transition-all duration-300 ${mobileView === 'TICKET' ? 'hidden md:flex' : 'flex'}`}>
        <header className="bg-white px-8 py-4 border-b border-gray-200 flex items-center gap-6 shadow-sm z-10">
          <div className="flex-1 flex items-center gap-4">
             <div className="relative flex-1 group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={20} />
                <input 
                  type="text" 
                  placeholder="Buscar producto..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-gray-100 rounded-2xl border-none outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all text-sm font-medium"
                />
             </div>

             <div className="relative shrink-0">
                <button 
                  onClick={() => setShowTariffSelector(!showTariffSelector)}
                  className={`flex items-center gap-3 px-5 py-3 rounded-2xl border-2 transition-all ${showTariffSelector ? 'border-purple-500 bg-purple-50' : 'bg-gray-100 border-transparent hover:border-purple-200'}`}
                >
                   <Tag size={18} className="text-purple-600" />
                   <div className="text-left hidden sm:block">
                      <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest leading-none mb-1">Tarifa Activa</p>
                      <p className="text-xs font-bold text-purple-900 leading-none truncate max-w-[120px]">{activeTariff?.name || 'General'}</p>
                   </div>
                   <ChevronDown size={16} className={`text-purple-400 transition-transform ${showTariffSelector ? 'rotate-180' : ''}`} />
                </button>

                {showTariffSelector && (
                   <div className="absolute top-full mt-2 left-0 w-64 bg-white rounded-3xl shadow-2xl border border-gray-100 p-2 z-[60] animate-in fade-in slide-in-from-top-2">
                      <div className="space-y-1">
                         {allowedTariffs.map(t => (
                            <button 
                               key={t.id} 
                               onClick={() => { setActiveTariffId(t.id); setShowTariffSelector(false); }}
                               className={`w-full text-left p-3 rounded-2xl flex items-center justify-between transition-all ${activeTariffId === t.id ? 'bg-purple-600 text-white shadow-lg' : 'hover:bg-purple-50 text-gray-700'}`}
                            >
                               <span className="font-bold text-sm">{t.name}</span>
                               {activeTariffId === t.id && <Check size={16} strokeWidth={4} />}
                            </button>
                         ))}
                      </div>
                   </div>
                )}
             </div>
          </div>
        </header>

        <div className="bg-white px-8 py-3 flex gap-2 overflow-x-auto no-scrollbar border-b border-gray-100 shrink-0">
           {categories.map(cat => (
              <button 
                 key={cat} 
                 onClick={() => setCategoryFilter(cat)}
                 className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-all ${
                    categoryFilter === cat ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                 }`}
              >
                 {cat === 'ALL' ? 'Todos' : cat}
              </button>
           ))}
        </div>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar relative">
           {filteredProducts.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-300">
                 <AlertCircle size={64} strokeWidth={1} className="mb-4" />
                 <p className="text-lg font-bold">Sin resultados</p>
              </div>
           ) : (
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6 pb-32">
                {filteredProducts.map(product => {
                  const currentPrice = getProductPrice(product);
                  const isWeighted = product.type === 'SERVICE' || product.name.toLowerCase().includes('(peso)');
                  const hasVariants = product.attributes && product.attributes.length > 0;

                  return (
                    <div 
                        key={product.id}
                        onClick={() => handleProductClick(product)}
                        className="bg-white rounded-[2rem] p-4 shadow-sm border border-gray-100 cursor-pointer hover:shadow-xl hover:border-purple-300 hover:-translate-y-1 transition-all active:scale-95 group flex flex-col h-full relative overflow-hidden"
                    >
                        <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
                           {isWeighted && (
                              <div className="bg-orange-500 text-white p-1.5 rounded-lg shadow-lg animate-in zoom-in">
                                 <ScaleIcon size={14} strokeWidth={3} />
                              </div>
                           )}
                           {hasVariants && (
                              <div className="bg-blue-500 text-white p-1.5 rounded-lg shadow-lg animate-in zoom-in">
                                 <Layers size={14} strokeWidth={3} />
                              </div>
                           )}
                        </div>

                        <div className="aspect-square bg-gray-50 rounded-[1.5rem] mb-4 overflow-hidden relative">
                          {product.image ? (
                              <img src={product.image} alt={product.name} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                          ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-200">
                                <Grid size={48} strokeWidth={1} />
                              </div>
                          )}
                        </div>
                        <div className="flex flex-col flex-1">
                          <span className="text-[9px] font-bold text-purple-500 uppercase mb-1 opacity-60">{product.category}</span>
                          <h3 className="font-bold text-gray-800 text-sm leading-tight mb-2 line-clamp-2 flex-1">{product.name}</h3>
                          <div className="flex justify-between items-center mt-auto pt-2 border-t border-gray-50">
                              <span className="font-black text-lg text-gray-900">
                                 {baseCurrency.symbol}{currentPrice.toFixed(2)}{isWeighted ? '/kg' : ''}
                              </span>
                          </div>
                        </div>
                    </div>
                  );
                })}
              </div>
           )}
        </div>
      </div>

      {/* PANEL DERECHO: TICKET */}
      <div className={`w-full md:w-96 bg-white border-l border-gray-200 shadow-2xl flex flex-col z-20 transition-all duration-300 ${mobileView === 'PRODUCTS' ? 'hidden md:flex' : 'flex'}`}>
         
         <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex flex-col gap-3 shrink-0">
            <div className="flex justify-between items-center">
               <div className="flex items-center gap-2">
                  <button onClick={() => setMobileView('PRODUCTS')} className="md:hidden p-2 -ml-2 text-gray-400 hover:text-blue-600"><ArrowLeft size={20} /></button>
                  <h2 className="font-black text-gray-800 flex items-center gap-2 uppercase text-xs tracking-widest">Ticket Actual</h2>
               </div>
               {/* ÁREA DE BOTONES DE ACCIÓN RESTAURADA - Se quitaron % y Salir de aquí */}
               <div className="flex items-center gap-1">
                  <button onClick={handleParkTicket} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Suspender Venta"><Save size={18} /></button>
                  <button onClick={() => setShowParkedList(true)} className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg relative" title="Ventas Suspendidas">
                     <PauseCircle size={18} />
                     {parkedTickets.length > 0 && <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-orange-500 rounded-full border border-white"></span>}
                  </button>
                  <button onClick={onOpenHistory} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg" title="Historial"><History size={18} /></button>
                  <button onClick={() => setShowCurrencyModal(true)} className="p-2 text-amber-500 hover:bg-amber-100 rounded-lg" title="Divisas"><ArrowRightLeft size={18} strokeWidth={2.5} /></button>
                  <button onClick={onOpenSettings} className="p-2 text-gray-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg" title="Ajustes"><Settings size={18} /></button>
                  <button onClick={() => setShowTicketOptions(true)} className="p-2 text-gray-400 hover:text-blue-600 rounded-lg" title="Opciones"><MoreVertical size={20} /></button>
               </div>
            </div>
            
            <button 
              onClick={onOpenCustomers}
              className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${selectedCustomer ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200 hover:border-blue-300'}`}
            >
               <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${selectedCustomer ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-100 text-gray-400'}`}><UserPlus size={20} /></div>
               <div className="text-left flex-1 truncate">
                  <p className="font-bold text-sm text-gray-800 truncate">{selectedCustomer?.name || 'Cliente General'}</p>
               </div>
               {selectedCustomer && <X size={16} className="text-gray-400 hover:text-red-500" onClick={(e) => { e.stopPropagation(); onSelectCustomer(null); }} />}
            </button>
         </div>

         <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 no-scrollbar">
            {cart.length === 0 ? (
               <div className="h-full flex flex-col items-center justify-center opacity-30 gap-4"><ShoppingCart size={64} strokeWidth={1.5} className="text-gray-400" /><p className="font-bold text-gray-500 text-sm uppercase tracking-widest">Vacio</p></div>
            ) : (
               cart.map((item) => (
                  <div key={item.cartId} onClick={() => setEditingItem(item)} className="flex gap-4 p-3 bg-white rounded-2xl border border-gray-100 hover:border-blue-300 cursor-pointer relative animate-in fade-in slide-in-from-right-2">
                      {showImagesInTicket && (
                        <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center shrink-0 border border-gray-100">
                          {item.image ? <img src={item.image} className="w-full h-full object-cover rounded-lg" /> : <Grid size={16} className="text-gray-300" />}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                            <h4 className="font-bold text-gray-800 text-xs leading-tight truncate pr-2">{item.name}</h4>
                            <span className="font-black text-sm text-gray-900 shrink-0">{baseCurrency.symbol}{(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            <div className={`px-1.5 py-0.5 rounded text-[10px] font-black border bg-blue-50 text-blue-700 border-blue-50`}>
                                {item.type === 'SERVICE' && item.name.toLowerCase().includes('peso') ? `${item.quantity.toFixed(3)} kg` : `x${item.quantity}`}
                            </div>
                            <span className="text-[10px] text-gray-400 font-bold">@ {baseCurrency.symbol}{item.price.toFixed(2)}</span>
                        </div>
                      </div>
                  </div>
               ))
            )}
            <div ref={cartEndRef} />
         </div>

         <div className="p-6 bg-white border-t border-gray-100 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] shrink-0">
            <div className="space-y-1 mb-4">
               <div className="flex justify-between text-xs text-gray-500 font-medium"><span>Neto</span><span>{baseCurrency.symbol}{netSubtotal.toFixed(2)}</span></div>
               
               {taxBreakdown.map((t, i) => (
                  <div key={i} className="flex justify-between text-xs text-gray-400 italic">
                     <span>{t.name}</span>
                     <span>{baseCurrency.symbol}{t.amount.toFixed(2)}</span>
                  </div>
               ))}

               <div className="flex justify-between items-start pt-2 mt-2 border-t border-gray-100">
                  <span className="font-bold text-gray-800 uppercase tracking-widest text-xs">Total</span>
                  <div className="text-right">
                    <span className="font-black text-3xl text-gray-900 tracking-tighter block">{baseCurrency.symbol}{cartTotal.toFixed(2)}</span>
                  </div>
               </div>
            </div>

            {/* BOTONES ADICIONALES: % Y SALIR */}
            <div className="grid grid-cols-2 gap-3 mb-4">
               <button 
                 onClick={() => setShowGlobalDiscount(true)} 
                 className="flex items-center justify-center gap-2 py-3 bg-rose-50 text-rose-600 rounded-2xl font-bold hover:bg-rose-100 transition-all border border-rose-100"
               >
                 <Percent size={18} strokeWidth={2.5} />
                 <span>Descuento</span>
               </button>
               <button 
                 onClick={onLogout} 
                 className="flex items-center justify-center gap-2 py-3 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all border border-gray-200"
               >
                 <LogOut size={18} strokeWidth={2.5} />
                 <span>Salir</span>
               </button>
            </div>

            <button onClick={() => setShowPaymentModal(true)} disabled={cart.length === 0} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-lg shadow-xl shadow-blue-500/30 hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-3"><CreditCard size={24} />PAGAR</button>
         </div>
      </div>

      {/* --- MODALES --- */}
      {showPaymentModal && <UnifiedPaymentModal total={cartTotal} currencySymbol={baseCurrency.symbol} config={config} onClose={() => setShowPaymentModal(false)} onConfirm={handlePaymentConfirm} themeColor={config.themeColor} />}
      
      {showParkedList && (
         <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
               <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                  <h3 className="font-bold text-xl text-gray-800 flex items-center gap-2"><PauseCircle className="text-orange-500" /> Ventas Suspendidas</h3>
                  <button onClick={() => setShowParkedList(false)} className="p-2 hover:bg-gray-200 rounded-full text-gray-500"><X size={24} /></button>
               </div>
               <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/50">
                  {parkedTickets.length === 0 ? <div className="h-40 flex items-center justify-center text-gray-400 italic">No hay tickets suspendidos.</div> : 
                     parkedTickets.map(pt => (
                        <div key={pt.id} className="bg-white p-5 rounded-2xl border border-gray-200 flex justify-between items-center group hover:border-orange-300 transition-all">
                           <div className="flex-1">
                              <h4 className="font-bold text-gray-800">#{pt.id.split('-')[1]} • {pt.date}</h4>
                              <p className="text-sm text-gray-500">{pt.customer?.name || 'Cliente General'} • {pt.items.length} items</p>
                              <p className="text-lg font-black text-orange-600 mt-1">{baseCurrency.symbol}{pt.total.toFixed(2)}</p>
                           </div>
                           <button onClick={() => handleResumeTicket(pt)} className="px-5 py-3 bg-orange-500 text-white rounded-xl font-bold text-sm shadow-md hover:bg-orange-600">Recuperar</button>
                        </div>
                     ))
                  }
               </div>
            </div>
         </div>
      )}

      {showCurrencyModal && (
         <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in">
           <div className="w-full max-w-4xl h-[80vh] bg-white rounded-[2.5rem] overflow-hidden shadow-2xl flex flex-col">
              <CurrencySettings config={config} onUpdateConfig={onUpdateConfig} onClose={() => setShowCurrencyModal(false)} />
           </div>
         </div>
      )}

      {showTicketOptions && <TicketOptionsModal onClose={() => setShowTicketOptions(false)} onAction={(id) => { 
         setShowTicketOptions(false); 
         if (id === 'CLEAR_CART') onUpdateCart([]); 
         if (id === 'DISCOUNT') setShowGlobalDiscount(true);
         if (id === 'FINANCE') onOpenFinance();
      }} />}
      
      {editingItem && <CartItemOptionsModal item={editingItem} config={config} users={[]} onClose={() => setEditingItem(null)} onUpdate={updateCartItem} canApplyDiscount={true} canVoidItem={true} />}
      {selectedProductForVariants && <ProductVariantSelector product={selectedProductForVariants} currencySymbol={baseCurrency.symbol} onClose={() => setSelectedProductForVariants(null)} onConfirm={(p, mods, price) => { addToCart(p, 1, price, mods); setSelectedProductForVariants(null); }} />}
      {productForScale && <ScaleModal product={productForScale} currencySymbol={baseCurrency.symbol} onClose={() => setProductForScale(null)} onConfirm={(weight) => { addToCart(productForScale, weight); setProductForScale(null); }} />}
      {showGlobalDiscount && <GlobalDiscountModal currentSubtotal={cartSubtotal} currencySymbol={baseCurrency.symbol} initialValue={globalDiscount.value.toString()} initialType={globalDiscount.type} themeColor={config.themeColor} onClose={() => setShowGlobalDiscount(false)} onConfirm={(val, type) => { setGlobalDiscount({ value: parseFloat(val) || 0, type }); setShowGlobalDiscount(false); }} />}
    </div>
  );
};

export default POSInterface;
