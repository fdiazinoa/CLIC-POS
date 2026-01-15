
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Search, ShoppingCart, Trash2, MoreVertical, 
  CreditCard, User, Tag, Grid, Save,
  Settings, Users, History, Wallet,
  UserPlus, X, Percent, ArrowLeft, ChevronRight,
  Scale as ScaleIcon, PauseCircle, LogOut,
  ArrowRightLeft, Globe, DollarSign,
  ChevronDown, Check, AlertCircle, Layers,
  ShoppingBag, ScanBarcode, ArrowRight, Clock
} from 'lucide-react';
import { 
  BusinessConfig, User as UserType, RoleDefinition, 
  Customer, Product, CartItem, Transaction, CurrencyConfig, Tariff, TaxDefinition, ParkedTicket
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
  parkedTickets: ParkedTicket[]; // Lifted State
  onUpdateParkedTickets: (tickets: ParkedTicket[]) => void; // Lifted State Setter
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
  parkedTickets,
  onUpdateParkedTickets,
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
  // Removed local parkedTickets state to use props instead
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
    const newParked: ParkedTicket = {
      id: `P-${Date.now()}`,
      items: [...cart],
      customer: selectedCustomer,
      total: cartTotal,
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    onUpdateParkedTickets([...parkedTickets, newParked]);
    onUpdateCart([]);
    onSelectCustomer(null); // Explicitly clear customer to start fresh context
    setMobileView('PRODUCTS');
  };

  const handleResumeTicket = (parked: ParkedTicket) => {
    if (cart.length > 0 && !confirm("¿Reemplazar el ticket actual?")) return;
    onUpdateCart(parked.items);
    onSelectCustomer(parked.customer);
    onUpdateParkedTickets(parkedTickets.filter(p => p.id !== parked.id));
    setShowParkedList(false);
    setMobileView('TICKET');
  };

  const openCameraScanner = () => {
    alert("Iniciando escáner de cámara... (Funcionalidad nativa)");
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
                  className="w-full pl-12 pr-12 md:pr-4 py-3 bg-gray-100 rounded-2xl border-none outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all text-sm font-medium"
                />
                <button 
                  onClick={openCameraScanner}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-500 bg-white shadow-sm rounded-xl hover:text-blue-600 hover:bg-blue-50 transition-all md:hidden active:scale-95 border border-gray-100"
                  title="Escanear con Cámara"
                >
                   <ScanBarcode size={18} />
                </button>
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
               {/* ÁREA DE BOTONES DE ACCIÓN RÁPIDA (MODIFICADA) */}
               <div className="flex gap-2">
                  
                  {/* Botón Ajustes */}
                  <button 
                     onClick={onOpenSettings} 
                     className="p-2 hover:bg-gray-200 rounded-lg text-gray-500" 
                     title="Ajustes"
                  >
                     <Settings size={18} />
                  </button>

                  {/* Botón Recuperar Tickets */}
                  <button 
                     onClick={() => setShowParkedList(!showParkedList)} 
                     className={`p-2 rounded-lg relative transition-colors ${parkedTickets.length > 0 ? 'bg-orange-100 text-orange-600 hover:bg-orange-200' : 'hover:bg-gray-200 text-gray-500'}`}
                     title="Recuperar Tickets"
                  >
                     <Clock size={18} />
                     {parkedTickets.length > 0 && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] flex items-center justify-center rounded-full border-2 border-white">{parkedTickets.length}</span>
                     )}
                  </button>

                  {/* Botón Guardar Ticket */}
                  <button 
                     onClick={handleParkTicket}
                     className={`p-2 rounded-lg text-gray-500 transition-colors ${cart.length > 0 ? 'hover:bg-blue-50 hover:text-blue-600' : 'opacity-50 cursor-not-allowed'}`}
                     title="Guardar Ticket"
                     disabled={cart.length === 0}
                  >
                     <Save size={18} />
                  </button>

                  {/* Opciones Adicionales */}
                  <button onClick={() => setShowTicketOptions(true)} className="p-2 hover:bg-gray-200 rounded-lg text-gray-500"><MoreVertical size={18} /></button>
               </div>
            </div>

            {/* CUSTOMER SELECTOR */}
            <div className="relative">
               {selectedCustomer ? (
                  <div className="flex items-center justify-between bg-blue-50 p-3 rounded-xl border border-blue-100 group cursor-pointer" onClick={onOpenCustomers}>
                     <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center font-bold text-xs">
                           {selectedCustomer.name.charAt(0)}
                        </div>
                        <div>
                           <p className="text-xs font-bold text-blue-900">{selectedCustomer.name}</p>
                           <p className="text-[10px] text-blue-600 font-medium">
                              {selectedCustomer.loyaltyPoints > 0 && `Points: ${selectedCustomer.loyaltyPoints}`}
                           </p>
                        </div>
                     </div>
                     <button onClick={(e) => { e.stopPropagation(); onSelectCustomer(null); }} className="p-1 hover:bg-blue-200 rounded-full text-blue-400 hover:text-blue-700"><X size={14}/></button>
                  </div>
               ) : (
                  <button 
                     onClick={onOpenCustomers}
                     className="w-full flex items-center justify-between p-3 bg-white border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-all group"
                  >
                     <div className="flex items-center gap-2">
                        <UserPlus size={18} />
                        <span className="text-xs font-bold uppercase tracking-wide">Asignar Cliente</span>
                     </div>
                     <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
                  </button>
               )}
            </div>
         </div>

         {/* LISTA DE ITEMS */}
         <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {cart.length === 0 ? (
               <div className="h-full flex flex-col items-center justify-center text-gray-300 opacity-60">
                  <ShoppingCart size={48} className="mb-2" />
                  <p className="text-sm font-medium">Ticket Vacío</p>
               </div>
            ) : (
               cart.map((item, index) => {
                  const isImagesEnabled = activeTerminalConfig?.workflow?.inventory?.showProductImagesInReceipt ?? false;
                  return (
                  <div 
                     key={item.cartId} 
                     onClick={() => setEditingItem(item)}
                     className="flex gap-3 p-3 hover:bg-gray-50 rounded-xl cursor-pointer group transition-colors border border-transparent hover:border-gray-100 relative overflow-hidden"
                  >
                     {isImagesEnabled && item.image && (
                       <div className="w-10 h-10 bg-gray-100 rounded-lg overflow-hidden shrink-0">
                          <img src={item.image} className="w-full h-full object-cover" alt="mini" />
                       </div>
                     )}
                     
                     <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                           <span className="font-bold text-gray-700 text-sm leading-tight line-clamp-2">{item.name}</span>
                           <span className="font-bold text-gray-900 text-sm">{baseCurrency.symbol}{(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-end mt-1">
                           <div className="text-xs text-gray-400 font-medium flex items-center gap-1">
                              <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-bold">{item.quantity}</span> 
                              x {baseCurrency.symbol}{item.price.toFixed(2)}
                           </div>
                           {/* Discount Badge if applied */}
                           {item.originalPrice && item.price < item.originalPrice && (
                              <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">
                                 -{Math.round(((item.originalPrice - item.price) / item.originalPrice) * 100)}%
                              </span>
                           )}
                        </div>
                        {item.modifiers && item.modifiers.length > 0 && (
                           <div className="mt-1 flex flex-wrap gap-1">
                              {item.modifiers.map((mod, idx) => (
                                 <span key={idx} className="text-[9px] text-gray-500 bg-gray-100 px-1.5 rounded border border-gray-200">{mod}</span>
                              ))}
                           </div>
                        )}
                        {item.note && <p className="text-[10px] text-orange-500 italic mt-1 truncate">"{item.note}"</p>}
                     </div>
                  </div>
               )})
            )}
            <div ref={cartEndRef} />
         </div>

         {/* FOOTER TOTALS */}
         <div className="bg-white border-t border-gray-200 shadow-[0_-5px_20px_rgba(0,0,0,0.05)] z-20">
            {/* Descuento Global & Info */}
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center text-xs">
               <button 
                  onClick={() => setShowGlobalDiscount(true)}
                  className={`flex items-center gap-1 font-bold transition-colors ${globalDiscount.value > 0 ? 'text-red-500' : 'text-gray-400 hover:text-blue-600'}`}
               >
                  <Tag size={14} /> {globalDiscount.value > 0 ? `Desc. ${globalDiscount.value}${globalDiscount.type === 'PERCENT' ? '%' : ''}` : 'Agregar Descuento'}
               </button>
               {activeTariff && <span className="text-purple-500 font-bold px-2 py-0.5 bg-purple-50 rounded uppercase text-[9px]">{activeTariff.name}</span>}
            </div>

            <div className="p-5 space-y-3">
               <div className="space-y-1">
                  <div className="flex justify-between text-gray-500 text-xs font-medium">
                     <span>Subtotal</span>
                     <span>{baseCurrency.symbol}{netSubtotal.toFixed(2)}</span>
                  </div>
                  {taxBreakdown.map((tax, idx) => (
                     <div key={idx} className="flex justify-between text-gray-400 text-[10px]">
                        <span>{tax.name}</span>
                        <span>{baseCurrency.symbol}{tax.amount.toFixed(2)}</span>
                     </div>
                  ))}
                  {discountAmount > 0 && (
                     <div className="flex justify-between text-red-500 text-xs font-bold">
                        <span>Descuento</span>
                        <span>-{baseCurrency.symbol}{discountAmount.toFixed(2)}</span>
                     </div>
                  )}
               </div>

               <div className="flex justify-between items-end pt-2 border-t border-dashed border-gray-200">
                  <div>
                     <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Total a Pagar</p>
                     
                     {/* Multi-currency display */}
                     <div className="flex gap-2 mt-1">
                        {altCurrencies.map(c => (
                           <span key={c.code} className="text-[10px] text-gray-400 bg-gray-100 px-1.5 rounded font-mono">
                              {c.symbol}{(cartTotal / c.rate).toFixed(2)}
                           </span>
                        ))}
                     </div>
                  </div>
                  <div className="text-3xl font-black text-gray-800 leading-none">
                     {baseCurrency.symbol}{cartTotal.toFixed(2)}
                  </div>
               </div>

               <button 
                  onClick={() => { if(cart.length > 0) setShowPaymentModal(true); }}
                  disabled={cart.length === 0}
                  className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black text-lg shadow-xl shadow-gray-200 hover:bg-black active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex justify-between px-6 items-center group"
               >
                  <span>Cobrar</span>
                  <ArrowRight size={24} className="group-hover:translate-x-1 transition-transform" />
               </button>
            </div>
         </div>
      </div>

      {/* --- MODALES --- */}
      {showPaymentModal && (
        <UnifiedPaymentModal 
          total={cartTotal} 
          currencySymbol={baseCurrency.symbol}
          config={config} 
          onClose={() => setShowPaymentModal(false)}
          onConfirm={handlePaymentConfirm}
          themeColor={config.themeColor}
        />
      )}

      {showTicketOptions && (
         <TicketOptionsModal 
            onClose={() => setShowTicketOptions(false)}
            onAction={(action) => {
               if (action === 'PARK') handleParkTicket();
               setShowTicketOptions(false);
            }}
         />
      )}

      {editingItem && (
         <CartItemOptionsModal 
            item={editingItem} 
            config={config}
            users={[]} // TODO: Pass real users list here if needed for salesperson assignment
            onClose={() => setEditingItem(null)}
            onUpdate={updateCartItem}
            canApplyDiscount={true} // Check permissions
            canVoidItem={true} // Check permissions
         />
      )}

      {selectedProductForVariants && (
         <ProductVariantSelector 
            product={selectedProductForVariants}
            currencySymbol={baseCurrency.symbol}
            onClose={() => setSelectedProductForVariants(null)}
            onConfirm={(prod, mods, price) => {
               addToCart(prod, 1, price, mods);
               setSelectedProductForVariants(null);
            }}
         />
      )}

      {productForScale && (
         <ScaleModal 
            product={productForScale}
            currencySymbol={baseCurrency.symbol}
            onClose={() => setProductForScale(null)}
            onConfirm={(weight) => {
               addToCart(productForScale, weight); // Weight acts as quantity
               setProductForScale(null);
            }}
         />
      )}

      {showGlobalDiscount && (
         <GlobalDiscountModal 
            currentSubtotal={cartSubtotal}
            currencySymbol={baseCurrency.symbol}
            initialValue={globalDiscount.value.toString()}
            initialType={globalDiscount.type}
            themeColor={config.themeColor}
            onClose={() => setShowGlobalDiscount(false)}
            onConfirm={(val, type) => {
               setGlobalDiscount({ value: parseFloat(val) || 0, type });
               setShowGlobalDiscount(false);
            }}
         />
      )}

      {showParkedList && parkedTickets.length > 0 && (
         <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl">
               <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-lg">Tickets en Espera</h3>
                  <button onClick={() => setShowParkedList(false)}><X size={20} className="text-gray-400" /></button>
               </div>
               <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {parkedTickets.map(pt => (
                     <div key={pt.id} onClick={() => handleResumeTicket(pt)} className="p-4 rounded-2xl bg-gray-50 border border-gray-100 hover:bg-blue-50 hover:border-blue-200 cursor-pointer transition-all flex justify-between items-center group">
                        <div>
                           <div className="font-bold text-gray-800 flex items-center gap-2">
                              {pt.customer ? pt.customer.name : 'Cliente General'}
                              <span className="text-[10px] bg-white border px-1.5 rounded text-gray-400 font-mono">{pt.date}</span>
                           </div>
                           <p className="text-xs text-gray-500">{pt.items.length} items</p>
                        </div>
                        <div className="text-right">
                           <p className="font-black text-lg text-gray-800">{baseCurrency.symbol}{pt.total.toFixed(2)}</p>
                           <span className="text-xs text-blue-600 font-bold opacity-0 group-hover:opacity-100 transition-opacity">Retomar</span>
                        </div>
                     </div>
                  ))}
               </div>
            </div>
         </div>
      )}

      {showCurrencyModal && (
         <CurrencySettings 
            config={config} 
            onUpdateConfig={onUpdateConfig} 
            onClose={() => setShowCurrencyModal(false)} 
         />
      )}

      {/* MOBILE FOOTER NAV (Visible only on mobile/tablet when in PRODUCTS view) */}
      <div className={`md:hidden fixed bottom-0 left-0 w-full bg-white border-t border-gray-200 p-2 flex justify-around items-center z-30 ${mobileView === 'TICKET' ? 'hidden' : 'flex'}`}>
         <button onClick={onOpenSettings} className="p-3 text-gray-400 hover:text-gray-600 flex flex-col items-center gap-1">
            <Settings size={20} />
            <span className="text-[10px] font-bold">Menú</span>
         </button>
         <button onClick={onOpenHistory} className="p-3 text-gray-400 hover:text-gray-600 flex flex-col items-center gap-1">
            <History size={20} />
            <span className="text-[10px] font-bold">Historial</span>
         </button>
         
         {/* FLOATING ACTION BUTTON FOR CART */}
         <div className="relative -top-6">
            <button 
               onClick={() => setMobileView('TICKET')}
               className="w-16 h-16 rounded-full bg-blue-600 text-white shadow-lg shadow-blue-500/40 flex items-center justify-center relative active:scale-90 transition-transform"
            >
               <ShoppingCart size={24} />
               {cart.length > 0 && (
                  <span className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center border-2 border-white">
                     {cart.reduce((acc, i) => acc + i.quantity, 0)}
                  </span>
               )}
            </button>
         </div>

         <button onClick={onOpenFinance} className="p-3 text-gray-400 hover:text-gray-600 flex flex-col items-center gap-1">
            <Wallet size={20} />
            <span className="text-[10px] font-bold">Caja</span>
         </button>
         <button onClick={onLogout} className="p-3 text-gray-400 hover:text-red-500 flex flex-col items-center gap-1">
            <LogOut size={20} />
            <span className="text-[10px] font-bold">Salir</span>
         </button>
      </div>

    </div>
  );
};

export default POSInterface;
