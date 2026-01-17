
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Search, ShoppingCart, Trash2, MoreVertical, 
  CreditCard, User, Tag, Grid, Save,
  Settings, Users, History, Wallet,
  UserPlus, X, Percent, ArrowLeft, ChevronRight,
  Scale as ScaleIcon, PauseCircle, LogOut,
  ArrowRightLeft, Globe, DollarSign,
  ChevronDown, Check, AlertCircle, Layers,
  ShoppingBag, ScanBarcode, ArrowRight, Clock, Camera, AlertTriangle
} from 'lucide-react';
import { Html5Qrcode } from "html5-qrcode";
import { 
  BusinessConfig, User as UserType, RoleDefinition, 
  Customer, Product, CartItem, Transaction, ParkedTicket, Warehouse
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
  users: UserType[]; 
  customers: Customer[];
  products: Product[];
  warehouses: Warehouse[]; 
  cart: CartItem[];
  onUpdateCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  selectedCustomer: Customer | null;
  onSelectCustomer: (customer: Customer | null) => void;
  parkedTickets: ParkedTicket[]; 
  onUpdateParkedTickets: (tickets: ParkedTicket[]) => void; 
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
  roles,
  users,
  customers,
  warehouses,
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
  const defaultSalesWarehouseId = activeTerminalConfig?.inventoryScope?.defaultSalesWarehouseId;

  const allowedTariffs = useMemo(() => {
    const allowedIds = activeTerminalConfig?.pricing?.allowedTariffIds || [];
    return config.tariffs.filter(t => allowedIds.includes(t.id));
  }, [config.tariffs, activeTerminalConfig]);

  const [activeTariffId, setActiveTariffId] = useState<string>(() => {
     return activeTerminalConfig?.pricing?.defaultTariffId || allowedTariffs[0]?.id || config.tariffs[0]?.id || '';
  });

  const [showTariffSelector, setShowTariffSelector] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const activeTariff = useMemo(() => config.tariffs.find(t => t.id === activeTariffId), [config.tariffs, activeTariffId]);

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [mobileView, setMobileView] = useState<'PRODUCTS' | 'TICKET'>('PRODUCTS');
  const [globalDiscount, setGlobalDiscount] = useState<{value: number, type: 'PERCENT' | 'FIXED'}>({value: 0, type: 'PERCENT'});

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showTicketOptions, setShowTicketOptions] = useState(false);
  const [showParkedList, setShowParkedList] = useState(false);
  const [showGlobalDiscount, setShowGlobalDiscount] = useState(false);
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);
  const [showSellerModal, setShowSellerModal] = useState(false);
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<Product | null>(null);
  const [productForScale, setProductForScale] = useState<Product | null>(null);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const canAddItemToCart = (product: Product): boolean => {
    if (!defaultSalesWarehouseId) return true;
    const isEnabled = product.activeInWarehouses?.includes(defaultSalesWarehouseId);
    if (!isEnabled) {
      const whName = warehouses.find(w => w.id === defaultSalesWarehouseId)?.name || 'Almacén Actual';
      setErrorToast(`Artículo no habilitado para la venta en: ${whName}`);
      setTimeout(() => setErrorToast(null), 3500);
      return false;
    }
    return true;
  };

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const isAvailableInWarehouse = defaultSalesWarehouseId 
        ? p.activeInWarehouses?.includes(defaultSalesWarehouseId) ?? true 
        : true;
      const matchSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.barcode?.includes(searchTerm);
      const matchCat = categoryFilter === 'ALL' || p.category === categoryFilter;
      return matchSearch && matchCat && isAvailableInWarehouse;
    });
  }, [products, searchTerm, categoryFilter, activeTariffId, defaultSalesWarehouseId]);

  const categories = useMemo(() => {
    return ['ALL', ...Array.from(new Set(products.map(p => p.category)))];
  }, [products]);

  const getProductPrice = (p: Product) => {
    return p.tariffs.find(t => t.tariffId === activeTariffId)?.price || p.price;
  };

  // --- SCALE BARCODE PARSER ---
  const parseScaleBarcode = (barcode: string) => {
    const scaleConfig = config.scaleLabelConfig;
    if (!scaleConfig || !scaleConfig.isEnabled || barcode.length !== 13) return null;

    const prefix = barcode.substring(0, 2);
    if (!scaleConfig.prefixes.includes(prefix)) return null;

    const plu = barcode.substring(2, 2 + scaleConfig.itemDigits);
    const valueStr = barcode.substring(2 + scaleConfig.itemDigits, 2 + scaleConfig.itemDigits + scaleConfig.valueDigits);
    const divisor = Math.pow(10, scaleConfig.decimals);
    const value = parseFloat(valueStr) / divisor;

    return { plu, value, mode: scaleConfig.mode };
  };

  const handleScanSuccess = (decodedText: string) => {
    playBeep();
    
    // Close scanner UI
    if (scannerRef.current) {
        scannerRef.current.stop().then(() => {
            scannerRef.current?.clear();
            setIsScannerOpen(false);
        });
    } else {
        setIsScannerOpen(false);
    }

    // Check if it is a scale barcode first
    const scaleData = parseScaleBarcode(decodedText);
    if (scaleData) {
      const product = products.find(p => p.barcode === scaleData.plu || p.id === scaleData.plu);
      if (product) {
        if (!canAddItemToCart(product)) return;
        
        let quantity = scaleData.value;
        if (scaleData.mode === 'PRICE') {
           const unitPrice = getProductPrice(product);
           quantity = unitPrice > 0 ? scaleData.value / unitPrice : 0;
        }
        
        addToCart(product, quantity);
        setErrorToast(`Balanza: ${product.name} x ${scaleData.value} ${scaleData.mode === 'WEIGHT' ? 'kg' : '$'}`);
        setTimeout(() => setErrorToast(null), 2500);
        return;
      }
    }

    // Normal barcode logic
    const foundProduct = products.find(p => p.barcode === decodedText);
    if (foundProduct) {
        handleProductClick(foundProduct);
        setSearchTerm('');
    } else {
      setErrorToast("Producto no encontrado.");
      setTimeout(() => setErrorToast(null), 2000);
    }
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

  useEffect(() => {
    if (isScannerOpen) {
      const timer = setTimeout(() => {
        const html5QrCode = new Html5Qrcode("reader");
        scannerRef.current = html5QrCode;
        html5QrCode.start(
          { facingMode: "environment" }, 
          { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
          (decodedText) => handleScanSuccess(decodedText),
          () => {}
        ).catch(() => setScannerError("No se pudo acceder a la cámara. Verifique permisos."));
      }, 100);
      return () => {
        clearTimeout(timer);
        if (scannerRef.current?.isScanning) scannerRef.current.stop();
      };
    }
  }, [isScannerOpen]);

  const playBeep = () => {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContext) {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 1000; osc.type = 'sine';
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start(); osc.stop(ctx.currentTime + 0.1);
    }
  };

  const handleProductClick = (product: Product) => {
    if (!canAddItemToCart(product)) return;
    const isWeighted = product.type === 'SERVICE' || product.name.toLowerCase().includes('(peso)');
    const hasVariants = product.attributes && product.attributes.length > 0;
    if (isWeighted) setProductForScale(product);
    else if (hasVariants) setSelectedProductForVariants(product);
    else addToCart(product);
  };

  const addToCart = (product: Product, quantity: number = 1, priceOverride?: number, modifiers?: string[]) => {
    if (!canAddItemToCart(product)) return;
    const finalPrice = priceOverride || getProductPrice(product);
    onUpdateCart(prev => {
      const modifiersString = modifiers ? modifiers.sort().join('|') : '';
      const existing = prev.find(i => {
        const iMods = i.modifiers ? i.modifiers.sort().join('|') : '';
        return i.id === product.id && iMods === modifiersString && i.price === finalPrice;
      });
      if (existing) return prev.map(i => i.cartId === existing.cartId ? { ...i, quantity: i.quantity + quantity } : i);
      return [...prev, { ...product, cartId: Math.random().toString(36).substr(2, 9), quantity, price: finalPrice, modifiers }];
    });
  };

  const updateCartItem = (updatedItem: CartItem | null, cartIdToDelete?: string) => {
    if (cartIdToDelete || updatedItem === null) onUpdateCart(prev => prev.filter(i => i.cartId !== (cartIdToDelete || editingItem?.cartId)));
    else onUpdateCart(prev => prev.map(i => i.cartId === updatedItem.cartId ? updatedItem : i));
    setEditingItem(null);
  };

  const handlePaymentConfirm = (payments: any[]) => {
    const txn: Transaction = {
      id: `T-${Date.now()}`, date: new Date().toISOString(), items: cart, total: cartTotal, payments: payments,
      userId: currentUser.id, userName: currentUser.name, status: 'COMPLETED',
      customerId: selectedCustomer?.id, customerName: selectedCustomer?.name
    };
    onTransactionComplete(txn); setShowPaymentModal(false); onUpdateCart([]); onSelectCustomer(null);
    setMobileView('PRODUCTS'); setGlobalDiscount({value: 0, type: 'PERCENT'});
  };

  if (!defaultSalesWarehouseId) {
    return (
      <div className="flex h-screen bg-gray-900 items-center justify-center p-6 animate-in fade-in duration-500">
        <div className="bg-white rounded-3xl p-12 max-w-lg text-center shadow-2xl border-4 border-red-500">
          <div className="w-24 h-24 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle size={48} strokeWidth={2} />
          </div>
          <h1 className="text-3xl font-black text-gray-900 mb-4 tracking-tight">Terminal Bloqueada</h1>
          <p className="text-gray-600 text-lg mb-8 leading-relaxed">
            Error de Configuración: Esta terminal no tiene un <strong>almacén de venta</strong> asignado.
          </p>
          <button onClick={onOpenSettings} className="mt-8 px-8 py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-black flex items-center justify-center gap-2 mx-auto"><Settings size={20} /> Ajustes</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden font-sans text-gray-900 relative">
      {errorToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300">
          <div className="bg-red-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-bold border-2 border-red-400">
            <AlertTriangle size={24} className="animate-pulse" />
            <span>{errorToast}</span>
          </div>
        </div>
      )}

      <div className={`flex-1 flex flex-col min-w-0 bg-gray-50 transition-all duration-300 ${mobileView === 'TICKET' ? 'hidden md:flex' : 'flex'}`}>
        <header className="bg-white px-8 py-4 border-b border-gray-200 flex items-center gap-6 shadow-sm z-10">
          <div className="flex-1 flex items-center gap-4">
             <div className="relative flex-1 group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input type="text" placeholder="Buscar producto..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-12 md:pr-4 py-3 bg-gray-100 rounded-2xl border-none outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 text-sm font-medium" />
                <button onClick={() => setIsScannerOpen(true)} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-500 bg-white shadow-sm rounded-xl hover:text-blue-600 hover:bg-blue-50 border border-gray-100"><ScanBarcode size={18} /></button>
             </div>
             <div className="relative shrink-0">
                <button onClick={() => setShowTariffSelector(!showTariffSelector)} className={`flex items-center gap-3 px-5 py-3 rounded-2xl border-2 transition-all ${showTariffSelector ? 'border-purple-500 bg-purple-50' : 'bg-gray-100 border-transparent'}`}>
                   <Tag size={18} className="text-purple-600" />
                   <div className="text-left hidden sm:block">
                      <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest leading-none mb-1">Tarifa Activa</p>
                      <p className="text-xs font-bold text-purple-900 leading-none truncate max-w-[120px]">{activeTariff?.name || 'General'}</p>
                   </div>
                   <ChevronDown size={16} className={`text-purple-400 ${showTariffSelector ? 'rotate-180' : ''}`} />
                </button>
                {showTariffSelector && (
                   <div className="absolute top-full mt-2 left-0 w-64 bg-white rounded-3xl shadow-2xl border border-gray-100 p-2 z-[60]">
                      {allowedTariffs.map(t => (
                         <button key={t.id} onClick={() => { setActiveTariffId(t.id); setShowTariffSelector(false); }} className={`w-full text-left p-3 rounded-2xl flex items-center justify-between transition-all ${activeTariffId === t.id ? 'bg-purple-600 text-white' : 'hover:bg-purple-50 text-gray-700'}`}>
                            <span className="font-bold text-sm">{t.name}</span>
                            {activeTariffId === t.id && <Check size={16} strokeWidth={4} />}
                         </button>
                      ))}
                   </div>
                )}
             </div>
          </div>
        </header>

        <div className="bg-white px-8 py-3 flex gap-2 overflow-x-auto no-scrollbar border-b border-gray-100 shrink-0">
           {categories.map(cat => (
              <button key={cat} onClick={() => setCategoryFilter(cat)} className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider whitespace-nowrap ${categoryFilter === cat ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-500'}`}>{cat === 'ALL' ? 'Todos' : cat}</button>
           ))}
        </div>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
           <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6 pb-32">
             {filteredProducts.map(product => (
               <div key={product.id} onClick={() => handleProductClick(product)} className="bg-white rounded-[2rem] p-4 shadow-sm border border-gray-100 cursor-pointer hover:shadow-xl hover:border-purple-300 hover:-translate-y-1 transition-all active:scale-95 group flex flex-col h-full relative overflow-hidden">
                   <div className="aspect-square bg-gray-50 rounded-[1.5rem] mb-4 overflow-hidden relative">
                     {product.image ? <img src={product.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform" /> : <div className="w-full h-full flex items-center justify-center text-gray-200"><Grid size={48} strokeWidth={1} /></div>}
                   </div>
                   <div className="flex flex-col flex-1">
                     <span className="text-[9px] font-bold text-purple-500 uppercase mb-1 opacity-60">{product.category}</span>
                     <h3 className="font-bold text-gray-800 text-sm leading-tight mb-2 line-clamp-2 flex-1">{product.name}</h3>
                     <div className="mt-auto pt-2 border-t border-gray-50"><span className="font-black text-lg text-gray-900">{baseCurrency.symbol}{getProductPrice(product).toFixed(2)}</span></div>
                   </div>
               </div>
             ))}
           </div>
        </div>
      </div>

      <div className={`w-full md:w-96 bg-white border-l border-gray-200 shadow-2xl flex flex-col z-20 transition-all duration-300 ${mobileView === 'PRODUCTS' ? 'hidden md:flex' : 'flex'}`}>
         <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex flex-col gap-3 shrink-0">
            <div className="flex justify-between items-center">
               <div className="flex items-center gap-2">
                  <button onClick={() => setMobileView('PRODUCTS')} className="md:hidden p-2 -ml-2 text-gray-400"><ArrowLeft size={20} /></button>
                  <h2 className="font-black text-gray-800 uppercase text-xs tracking-widest">Ticket Actual</h2>
               </div>
               <div className="flex gap-2">
                  <button onClick={onOpenSettings} className="p-2 hover:bg-gray-200 rounded-lg text-gray-500"><Settings size={18} /></button>
                  <button onClick={() => setShowTicketOptions(true)} className="p-2 hover:bg-gray-200 rounded-lg text-gray-500"><MoreVertical size={18} /></button>
               </div>
            </div>
            {selectedCustomer ? (
               <div className="flex items-center justify-between bg-blue-50 p-3 rounded-xl border border-blue-100 cursor-pointer" onClick={onOpenCustomers}>
                  <div className="flex items-center gap-3">
                     <div className="w-8 h-8 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center font-bold text-xs">{selectedCustomer.name.charAt(0)}</div>
                     <p className="text-xs font-bold text-blue-900">{selectedCustomer.name}</p>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); onSelectCustomer(null); }} className="p-1 text-blue-400"><X size={14}/></button>
               </div>
            ) : (
               <button onClick={onOpenCustomers} className="w-full flex items-center justify-between p-3 bg-white border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:text-blue-500 group"><div className="flex items-center gap-2"><UserPlus size={18} /><span className="text-xs font-bold uppercase">Asignar Cliente</span></div><ChevronRight size={16} /></button>
            )}
         </div>

         <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {cart.map((item) => (
               <div key={item.cartId} onClick={() => setEditingItem(item)} className="flex gap-3 p-3 hover:bg-gray-50 rounded-xl cursor-pointer group border border-transparent hover:border-gray-100">
                  <div className="flex-1 min-w-0">
                     <div className="flex justify-between items-start">
                        <span className="font-bold text-gray-700 text-sm leading-tight line-clamp-2">{item.name}</span>
                        <span className="font-bold text-gray-900 text-sm">{baseCurrency.symbol}{(item.price * item.quantity).toFixed(2)}</span>
                     </div>
                     <div className="text-xs text-gray-400 font-medium mt-1"><span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-bold">{item.quantity.toFixed(3)}</span> x {baseCurrency.symbol}{item.price.toFixed(2)}</div>
                  </div>
               </div>
            ))}
         </div>

         <div className="bg-white border-t border-gray-200 p-5 space-y-3 shadow-inner">
            <div className="space-y-1">
               <div className="flex justify-between text-gray-500 text-xs font-medium"><span>Subtotal</span><span>{baseCurrency.symbol}{netSubtotal.toFixed(2)}</span></div>
               {taxBreakdown.map((tax, idx) => (<div key={idx} className="flex justify-between text-gray-400 text-[10px]"><span>{tax.name}</span><span>{baseCurrency.symbol}{tax.amount.toFixed(2)}</span></div>))}
            </div>
            <div className="flex justify-between items-end pt-2 border-t border-dashed border-gray-200">
               <div><p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Total a Pagar</p></div>
               <div className="text-3xl font-black text-gray-800 leading-none">{baseCurrency.symbol}{cartTotal.toFixed(2)}</div>
            </div>
            <button onClick={() => { if(cart.length > 0) setShowPaymentModal(true); }} disabled={cart.length === 0} className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black text-lg shadow-xl hover:bg-black active:scale-[0.98] transition-all disabled:opacity-50 flex justify-between px-6 items-center"><span>Cobrar</span><ArrowRight size={24} /></button>
         </div>
      </div>

      {isScannerOpen && (
        <div className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center animate-in fade-in">
           <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start z-20">
              <h2 className="text-white text-lg font-bold flex items-center gap-2"><ScanBarcode className="text-blue-400" /> Escáner Activo</h2>
              <button onClick={() => setIsScannerOpen(false)} className="p-3 bg-white/10 rounded-full text-white"><X size={24} /></button>
           </div>
           <div id="reader" className="w-full max-w-lg overflow-hidden rounded-lg"></div>
        </div>
      )}

      {showPaymentModal && <UnifiedPaymentModal total={cartTotal} currencySymbol={baseCurrency.symbol} config={config} onClose={() => setShowPaymentModal(false)} onConfirm={handlePaymentConfirm} themeColor={config.themeColor} />}
      {showTicketOptions && <TicketOptionsModal onClose={() => setShowTicketOptions(false)} onAction={(a) => { if(a==='ASSIGN_SELLER') setShowSellerModal(true); setShowTicketOptions(false); }} />}
      {editingItem && <CartItemOptionsModal item={editingItem} config={config} users={users} roles={roles} onClose={() => setEditingItem(null)} onUpdate={updateCartItem} canApplyDiscount={true} canVoidItem={true} />}
      {selectedProductForVariants && <ProductVariantSelector product={selectedProductForVariants} currencySymbol={baseCurrency.symbol} onClose={() => setSelectedProductForVariants(null)} onConfirm={(p, m, pr) => { addToCart(p, 1, pr, m); setSelectedProductForVariants(null); }} />}
      {productForScale && <ScaleModal product={productForScale} currencySymbol={baseCurrency.symbol} onClose={() => setProductForScale(null)} onConfirm={(w) => { addToCart(productForScale, w); setProductForScale(null); }} />}
    </div>
  );
};

export default POSInterface;
