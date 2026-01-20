import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
   Search, ShoppingCart, Trash2, MoreVertical,
   CreditCard, User, Tag, Grid, Save,
   Settings, Users, History, Wallet,
   UserPlus, X, Percent, ArrowLeft, ChevronRight,
   Scale as ScaleIcon, PauseCircle, LogOut,
   ArrowRightLeft, Globe, DollarSign,
   ChevronDown, Check, AlertCircle, Layers,
   ShoppingBag, ScanBarcode, ArrowRight, Clock, Camera, AlertTriangle,
   MessageSquare, PlayCircle, Download, Lock, ArrowUpRight, Landmark,
   UserCheck, StickyNote, Inbox, Printer
} from 'lucide-react';
import { Html5Qrcode } from "html5-qrcode";
import {
   BusinessConfig, User as UserType, RoleDefinition,
   Customer, Product, CartItem, Transaction, ParkedTicket, Warehouse, NCFType
} from '../types';
import UnifiedPaymentModal from './PaymentModal';
import TicketOptionsModal from './TicketOptionsModal';
import CartItemOptionsModal from './CartItemOptionsModal';
import ProductVariantSelector from './ProductVariantSelector';
import ScaleModal from './ScaleModal';
import GlobalDiscountModal from './GlobalDiscountModal';
import { db } from '../utils/db';
import { validateTerminalDocument } from '../utils/validation';
import { isSessionExpired } from '../utils/session';
import { FiscalRangeDGII } from '../types';

interface POSInterfaceProps {
   config: BusinessConfig;
   currentUser: UserType;
   roles: RoleDefinition[];
   users: UserType[];
   customers: Customer[];
   products: Product[];
   warehouses: Warehouse[];
   cart: CartItem[];
   transactions: Transaction[];
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
   transactions,
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

   const activeTerminalConfig = config.terminals?.[0]?.config;
   const terminalId = config.terminals?.[0]?.id || 'T1';
   const defaultSalesWarehouseId = activeTerminalConfig?.inventoryScope?.defaultSalesWarehouseId;
   const uxConfig = activeTerminalConfig?.ux || { showProductImages: true, gridDensity: 'COMFORTABLE', theme: 'LIGHT', quickKeysLayout: 'A' };

   // --- UX EFFECTS ---
   useEffect(() => {
      if (uxConfig.theme === 'DARK') {
         document.documentElement.classList.add('dark');
      } else {
         document.documentElement.classList.remove('dark');
      }
   }, [uxConfig.theme]);

   const gridClass = useMemo(() => {
      if (uxConfig.gridDensity === 'COMPACT') {
         return "grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4 pb-32";
      }
      return "grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6 pb-32";
   }, [uxConfig.gridDensity]);

   const categoryContainerClass = useMemo(() => {
      if (uxConfig.quickKeysLayout === 'B') {
         return "bg-white border-b border-gray-200 px-8 py-3 flex flex-wrap gap-2 shrink-0 max-h-32 overflow-y-auto custom-scrollbar";
      }
      return "bg-white border-b border-gray-200 px-8 py-3 flex gap-2 overflow-x-auto no-scrollbar shrink-0";
   }, [uxConfig.quickKeysLayout]);

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
   const [globalDiscount, setGlobalDiscount] = useState<{ value: number, type: 'PERCENT' | 'FIXED' }>({ value: 0, type: 'PERCENT' });

   const [showPaymentModal, setShowPaymentModal] = useState(false);
   const [showTicketOptions, setShowTicketOptions] = useState(false);
   const [showParkedList, setShowParkedList] = useState(false);
   const [showGlobalDiscount, setShowGlobalDiscount] = useState(false);
   const [editingItem, setEditingItem] = useState<CartItem | null>(null);
   const [selectedProductForVariants, setSelectedProductForVariants] = useState<Product | null>(null);
   const [productForScale, setProductForScale] = useState<Product | null>(null);

   const [isScannerOpen, setIsScannerOpen] = useState(false);
   const scannerRef = useRef<Html5Qrcode | null>(null);

   const [fiscalStatus, setFiscalStatus] = useState<{ type: NCFType, hasNCF: boolean, localBuffer: any, isUsingPool: boolean }>({
      type: 'B02', hasNCF: false, localBuffer: null, isUsingPool: false
   });
   const [status, setStatus] = useState<{ isConnected: boolean, currentNCF: string, remaining: number, expiryDate: string, batteryLevel: number } | null>(null);


   useEffect(() => {
      const checkFiscalStatus = async () => {
         const type: NCFType = selectedCustomer?.defaultNcfType || (selectedCustomer?.requiresFiscalInvoice ? 'B01' : 'B02');
         const buffers = await db.get('localFiscalBuffer') || [];
         const localBuffer = buffers.find((b: any) => b.type === type && b.isActive) as FiscalRangeDGII | undefined;

         if (localBuffer) {
            const current = localBuffer.currentGlobal || localBuffer.startNumber;
            const total = localBuffer.endNumber - localBuffer.startNumber + 1;
            const used = current - localBuffer.startNumber;
            const remaining = localBuffer.endNumber - current;

            setStatus({
               isConnected: true,
               currentNCF: `${localBuffer.prefix}${current.toString().padStart(8, '0')}`,
               remaining,
               expiryDate: localBuffer.expiryDate,
               batteryLevel: 100
            });
         }
         const hasLocal = localBuffer && localBuffer.currentGlobal <= localBuffer.endNumber;
         const canRequest = await db.canRequestMoreNCF(type);
         const hasNCF = hasLocal || canRequest;
         setFiscalStatus({ type, hasNCF, localBuffer, isUsingPool: !hasLocal && canRequest });
      };
      checkFiscalStatus();
   }, [selectedCustomer, cart]);

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
         const isAvailableInWarehouse = defaultSalesWarehouseId ? p.activeInWarehouses?.includes(defaultSalesWarehouseId) ?? true : true;
         const matchSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.barcode?.includes(searchTerm);
         const matchCat = categoryFilter === 'ALL' || p.category === categoryFilter;
         return matchSearch && matchCat && isAvailableInWarehouse;
      });
   }, [products, searchTerm, categoryFilter, defaultSalesWarehouseId]);

   const categories = useMemo(() => ['ALL', ...Array.from(new Set(products.map(p => p.category)))], [products]);

   const getProductPrice = (p: Product) => p.tariffs.find(t => t.tariffId === activeTariffId)?.price || p.price;

   const cartSubtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
   const discountAmount = globalDiscount.type === 'PERCENT' ? cartSubtotal * (globalDiscount.value / 100) : Math.min(globalDiscount.value, cartSubtotal);
   const netSubtotal = cartSubtotal - discountAmount;

   const taxBreakdown = useMemo(() => {
      const breakdown: Record<string, { name: string, amount: number }> = {};
      cart.forEach(item => {
         const itemRatio = (item.price * item.quantity) / (cartSubtotal || 1);
         const itemNet = (item.price * item.quantity) - (discountAmount * itemRatio);

         (item.appliedTaxIds || []).forEach(taxId => {
            const taxDef = config.taxes.find(t => t.id === taxId);
            if (taxDef) {
               if (!breakdown[taxId]) breakdown[taxId] = { name: taxDef.name, amount: 0 };
               breakdown[taxId].amount += itemNet * taxDef.rate;
            }
         });
      });
      return Object.values(breakdown);
   }, [cart, netSubtotal, cartSubtotal, config.taxes, discountAmount]);

   const cartTax = taxBreakdown.reduce((sum, t) => sum + t.amount, 0);
   const cartTotal = netSubtotal + cartTax;
   const baseCurrency = config.currencies.find(c => c.isBase) || config.currencies[0];

   useEffect(() => {
      if (cart.length === 0) setMobileView('PRODUCTS');
      else cartEndRef.current?.scrollIntoView({ behavior: 'smooth' });
   }, [cart.length]);

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
         return [...prev, { ...product, cartId: Math.random().toString(36).substr(2, 9), quantity, price: finalPrice, modifiers, originalPrice: getProductPrice(product) }];
      });
   };

   const updateCartItem = (updatedItem: CartItem | null, cartIdToDelete?: string) => {
      if (cartIdToDelete || updatedItem === null) onUpdateCart(prev => prev.filter(i => i.cartId !== (cartIdToDelete || editingItem?.cartId)));
      else onUpdateCart(prev => prev.map(i => i.cartId === updatedItem.cartId ? updatedItem : i));
      setEditingItem(null);
   };

   const handlePaymentConfirm = async (payments: any[]) => {
      const finalNcf = await db.getNextNCF(fiscalStatus.type, terminalId, activeTerminalConfig?.fiscal?.typeConfigs?.[fiscalStatus.type]?.batchSize || 100);

      if (!finalNcf) {
         alert(`CRÍTICO: No hay NCF de ${fiscalStatus.type === 'B01' ? 'Crédito Fiscal' : 'Consumo'} disponible. Pool DGII agotado.`);
         return;
      }

      const txn: Transaction = {
         id: `T-${Date.now()}`,
         date: new Date().toISOString(),
         items: cart,
         total: cartTotal,
         payments: payments,
         userId: currentUser.id,
         userName: currentUser.name,
         terminalId: terminalId,
         status: 'COMPLETED',
         customerId: selectedCustomer?.id,
         customerName: selectedCustomer?.name,
         ncf: finalNcf,
         ncfType: fiscalStatus.type
      };
      onTransactionComplete(txn); setShowPaymentModal(false); onUpdateCart([]); onSelectCustomer(null);
      setMobileView('PRODUCTS'); setGlobalDiscount({ value: 0, type: 'PERCENT' });
   };

   const handleParkCurrentTicket = () => {
      if (cart.length === 0) return;
      const newParked: ParkedTicket = {
         id: `P-${Date.now()}`,
         name: selectedCustomer ? selectedCustomer.name : `Ticket #${parkedTickets.length + 1}`,
         items: [...cart],
         customerId: selectedCustomer?.id,
         customerName: selectedCustomer?.name,
         timestamp: new Date().toISOString()
      };
      onUpdateParkedTickets([...parkedTickets, newParked]);
      onUpdateCart([]); onSelectCustomer(null);
      setErrorToast("Ticket Guardado");
      setTimeout(() => setErrorToast(null), 2000);
   };

   const handleRestoreTicket = (parked: ParkedTicket) => {
      onUpdateCart([...parked.items]);
      if (parked.customerId) {
         const found = customers.find(c => c.id === parked.customerId);
         if (found) onSelectCustomer(found);
      }
      onUpdateParkedTickets(parkedTickets.filter(p => p.id !== parked.id));
      setShowParkedList(false);
      setMobileView('TICKET');
   };

   return (
      <div className="flex h-screen bg-gray-100 overflow-hidden font-sans text-gray-900 relative">
         {errorToast && (
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300">
               <div className="bg-red-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-bold border-2 border-red-400">
                  <AlertTriangle size={24} className="animate-pulse" />
                  <span>{errorToast}</span>
               </div>
            </div>
         )}

         {/* --- BOTÓN FLOTANTE MÓVIL (IR AL TICKET) --- */}
         {mobileView === 'PRODUCTS' && cart.length > 0 && (
            <button
               onClick={() => setMobileView('TICKET')}
               className="md:hidden fixed bottom-6 right-6 z-50 bg-blue-600 text-white p-5 rounded-full shadow-[0_15px_40px_rgba(37,99,235,0.4)] flex items-center justify-center animate-in zoom-in-50"
            >
               <div className="relative">
                  <ShoppingCart size={28} />
                  <span className="absolute -top-3 -right-3 bg-red-500 text-white text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                     {cart.reduce((acc, i) => acc + i.quantity, 0)}
                  </span>
               </div>
            </button>
         )}

         {/* LEFT AREA: PRODUCTS */}
         <div className={`flex-1 flex flex-col min-w-0 bg-gray-50 transition-all duration-300 ${mobileView === 'TICKET' ? 'hidden md:flex' : 'flex'}`}>
            <header className="bg-white px-8 py-4 border-b border-gray-200 flex items-center gap-6 shadow-sm z-10 shrink-0">
               <div className="flex items-center gap-3 pr-4 border-r border-gray-100">
                  <div className="w-10 h-10 rounded-full bg-gray-50 overflow-hidden border border-gray-200 shadow-inner shrink-0">
                     {currentUser.photo ? <img src={currentUser.photo} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-blue-50 text-blue-600 font-bold">{currentUser.name.charAt(0)}</div>}
                  </div>
                  <div className="hidden lg:block leading-tight">
                     <p className="text-sm font-black text-gray-800 truncate max-w-[120px]">{currentUser.name}</p>
                     <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Cajero</p>
                  </div>
               </div>

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
                  </div>
               </div>
            </header>

            {/* --- CATEGORY SELECTOR BAR --- */}
            <div className={categoryContainerClass}>
               {categories.map((cat) => (
                  <button
                     key={cat}
                     onClick={() => setCategoryFilter(cat)}
                     className={`px-6 py-2.5 rounded-full text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap shadow-sm border ${categoryFilter === cat
                        ? 'bg-blue-600 border-blue-500 text-white shadow-blue-200 scale-105'
                        : 'bg-white border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-600'
                        }`}
                  >
                     {cat === 'ALL' ? 'Todas' : cat}
                  </button>
               ))}
            </div>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar dark:bg-slate-900">
               <div className={gridClass}>
                  {filteredProducts.map(product => {
                     const isWeighted = product.type === 'SERVICE' || product.name.toLowerCase().includes('(peso)');
                     const hasVariants = product.attributes && product.attributes.length > 0;

                     return (

                        <div key={product.id} onClick={() => handleProductClick(product)} className="bg-white dark:bg-slate-800 dark:border-slate-700 rounded-[2rem] p-4 shadow-sm border border-gray-100 cursor-pointer hover:shadow-xl hover:border-purple-300 hover:-translate-y-1 transition-all active:scale-95 group flex flex-col h-full relative overflow-hidden">
                           {uxConfig.showProductImages && (
                              <div className="aspect-square bg-gray-50 dark:bg-slate-800 rounded-[1.5rem] mb-4 overflow-hidden relative">
                                 {product.image ? <img src={product.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform" /> : <div className="w-full h-full flex items-center justify-center text-gray-200 dark:text-slate-700"><Grid size={48} strokeWidth={1} /></div>}

                                 {/* BADGES DE TIPO DE ARTÍCULO */}
                                 {isWeighted && (
                                    <div className="absolute top-2 left-2 bg-emerald-500 text-white p-1.5 rounded-lg shadow-lg z-10 animate-in zoom-in-50" title="Requiere Balanza">
                                       <ScaleIcon size={14} strokeWidth={3} />
                                    </div>
                                 )}
                                 {!isWeighted && hasVariants && (
                                    <div className="absolute top-2 left-2 bg-blue-600 text-white p-1.5 rounded-lg shadow-lg z-10 animate-in zoom-in-50" title="Tiene Variantes">
                                       <Layers size={14} strokeWidth={3} />
                                    </div>
                                 )}
                              </div>
                           )}
                           <div className="flex flex-col flex-1">
                              <span className="text-[9px] font-bold text-purple-500 uppercase mb-1 opacity-60">{product.category}</span>
                              <h3 className="font-bold text-gray-800 dark:text-white text-sm leading-tight mb-2 line-clamp-2 flex-1">{product.name}</h3>
                              <div className="mt-auto pt-2 border-t border-gray-50 dark:border-slate-700"><span className="font-black text-lg text-gray-900 dark:text-white">{baseCurrency.symbol}{getProductPrice(product).toFixed(2)}</span></div>
                           </div>
                        </div>
                     );
                  })}
               </div>
            </div>
         </div>

         {/* RIGHT SIDEBAR: CURRENT TICKET */}
         <div className={`w-full md:w-96 bg-white border-l border-gray-200 shadow-2xl flex flex-col z-20 transition-all duration-300 ${mobileView === 'PRODUCTS' ? 'hidden md:flex' : 'flex'}`}>

            <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex flex-col gap-3 shrink-0">
               {/* Header con Navegación para volver a productos */}
               <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                     <button onClick={() => setMobileView('PRODUCTS')} className="md:hidden p-2 -ml-2 text-gray-400 hover:text-blue-600 transition-colors">
                        <ArrowLeft size={20} />
                     </button>
                     <h2 className="font-black text-gray-800 uppercase text-xs tracking-widest">Ticket Actual</h2>
                  </div>
                  <div className="flex gap-1">
                     <button onClick={handleParkCurrentTicket} title="Guardar Ticket" className="p-2 hover:bg-blue-50 rounded-lg text-gray-400 hover:text-blue-600 transition-colors"><Save size={18} /></button>
                     <button onClick={() => setShowParkedList(!showParkedList)} title="Recuperar Ticket" className="p-2 hover:bg-orange-50 rounded-lg text-gray-400 hover:text-orange-600 transition-colors relative">
                        <Inbox size={18} />
                        {parkedTickets.length > 0 && <span className="absolute top-0 right-0 w-3 h-3 bg-orange-500 rounded-full border-2 border-white"></span>}
                     </button>
                     <button onClick={onOpenHistory} title="Historial" className="p-2 hover:bg-gray-200 rounded-lg text-gray-400 hover:text-blue-600 transition-colors"><History size={18} /></button>
                     <button onClick={onOpenSettings} title="Configuración" className="p-2 hover:bg-gray-200 rounded-lg text-gray-400 hover:text-blue-600 transition-colors"><Settings size={18} /></button>
                  </div>
               </div>

               {selectedCustomer ? (
                  <div className="flex items-center justify-between bg-blue-50 p-3 rounded-xl border border-blue-100 cursor-pointer" onClick={onOpenCustomers}>
                     <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center font-bold text-xs">{selectedCustomer.name.charAt(0)}</div>
                        <div>
                           <p className="text-xs font-bold text-blue-900 leading-none">{selectedCustomer.name}</p>
                           <span className="text-[9px] font-black text-blue-500 uppercase tracking-tighter">
                              {selectedCustomer.defaultNcfType || (selectedCustomer.requiresFiscalInvoice ? 'B01' : 'B02')}
                           </span>
                        </div>
                     </div>
                     <button onClick={(e) => { e.stopPropagation(); onSelectCustomer(null); }} className="p-1 text-blue-400"><X size={14} /></button>
                  </div>
               ) : (
                  <button onClick={onOpenCustomers} className="w-full flex items-center justify-between p-3 bg-white border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:text-blue-500 group"><div className="flex items-center gap-2"><UserPlus size={18} /><span className="text-xs font-bold uppercase">Asignar Cliente</span></div><ChevronRight size={16} /></button>
               )}

               <div className={`mt-1 flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase ${fiscalStatus.hasNCF ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100 animate-pulse'}`}>
                  <Landmark size={12} />
                  <span>Status Fiscal: {fiscalStatus.type} {fiscalStatus.hasNCF ? (fiscalStatus.isUsingPool ? 'Reservado en Pool' : 'Lote Activo') : 'Agotado'}</span>
                  {fiscalStatus.localBuffer && !fiscalStatus.isUsingPool && (
                     <span className="ml-auto opacity-60">Quedan: {fiscalStatus.localBuffer.endNumber - fiscalStatus.localBuffer.currentNumber + 1}</span>
                  )}
               </div>
            </div>

            {/* --- CART ITEMS LIST (DETALLE DE LÍNEA) --- */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar bg-slate-50/30">
               {cart.map((item) => {
                  const hasDiscount = item.originalPrice && item.price < item.originalPrice;
                  const discountPct = hasDiscount ? Math.round((1 - item.price / item.originalPrice!) * 100) : 0;

                  const lineNet = item.price * item.quantity;
                  const lineTax = (item.appliedTaxIds || []).reduce((acc, taxId) => {
                     const taxDef = config.taxes.find(t => t.id === taxId);
                     return acc + (lineNet * (taxDef?.rate || 0));
                  }, 0);

                  return (
                     <div key={item.cartId} onClick={() => setEditingItem(item)} className="flex flex-col gap-1 px-3 py-3 transition-all hover:bg-white rounded-xl cursor-pointer group border border-transparent hover:border-gray-200 hover:shadow-sm animate-in slide-in-from-right-2">
                        <div className="flex justify-between items-start">
                           <div className="flex-1 min-w-0 pr-2">
                              <span className="font-bold text-gray-700 leading-tight text-sm line-clamp-2">{item.name}</span>
                           </div>
                           <span className="font-black text-gray-900 text-sm shrink-0">{baseCurrency.symbol}{(lineNet).toFixed(2)}</span>
                        </div>

                        {/* 1. Cantidad x Precio + Descuento (En la misma línea) */}
                        <div className="flex items-center gap-2 mt-1">
                           <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-black text-[9px] uppercase tracking-tighter">
                              {item.quantity.toFixed(item.type === 'SERVICE' ? 3 : 0)}x {baseCurrency.symbol}{item.price.toFixed(2)}
                           </span>
                           {hasDiscount && (
                              <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded text-[9px] font-black border border-red-100">-{discountPct}% DESC.</span>
                           )}
                        </div>

                        {/* 2. Impuesto de la línea */}
                        <div className="text-[10px] text-slate-400 font-bold flex items-center gap-1">
                           <span>Impuestos: {baseCurrency.symbol}{lineTax.toFixed(2)}</span>
                        </div>

                        {/* 3. Variantes / Modificadores */}
                        {item.modifiers && item.modifiers.length > 0 && (
                           <div className="flex flex-wrap gap-1 mt-1">
                              {item.modifiers.map((m, mi) => (
                                 <span key={mi} className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-[9px] font-bold border border-blue-100 uppercase">{m}</span>
                              ))}
                           </div>
                        )}

                        {/* 4. Vendedor */}
                        {item.salespersonId && (
                           <div className="mt-1">
                              <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 border border-indigo-100 w-fit">
                                 <UserCheck size={10} /> Vendedor: {users.find(u => u.id === item.salespersonId)?.name.split(' ')[0]}
                              </span>
                           </div>
                        )}

                        {/* 5. Nota */}
                        {item.note && (
                           <div className="mt-1.5 flex items-start gap-1 text-[10px] text-orange-600 font-medium bg-orange-50/50 p-1.5 rounded-lg border border-orange-100/50">
                              <StickyNote size={10} className="mt-0.5 shrink-0" />
                              <span className="italic">{item.note}</span>
                           </div>
                        )}
                     </div>
                  )
               })}
               <div ref={cartEndRef} />
            </div>

            {/* Sidebar Footer */}
            <div className="bg-white border-t border-gray-200 p-4 space-y-3 shadow-inner shrink-0">

               {/* --- BOTONES DE ACCIÓN --- */}
               <div className="grid grid-cols-3 gap-2">
                  <button
                     onClick={() => setShowGlobalDiscount(true)}
                     className={`flex flex-col items-center justify-center py-2 rounded-xl border-2 transition-all ${globalDiscount.value > 0 ? 'bg-red-50 border-red-200 text-red-600' : 'bg-white border-gray-100 text-gray-400 hover:border-gray-200'}`}
                  >
                     <Percent size={16} />
                     <span className="text-[9px] font-black uppercase mt-1">Descuento</span>
                  </button>
                  <button
                     onClick={onOpenFinance}
                     className="flex flex-col items-center justify-center py-2 rounded-xl border-2 bg-white border-gray-100 text-gray-400 hover:border-gray-200 transition-all"
                  >
                     <Lock size={16} />
                     <span className="text-[9px] font-black uppercase mt-1">Cierre Z</span>
                  </button>
                  <button
                     onClick={onLogout}
                     className="flex flex-col items-center justify-center py-2 rounded-xl border-2 bg-white border-gray-100 text-gray-400 hover:border-red-100 hover:text-red-500 transition-all"
                  >
                     <LogOut size={16} />
                     <span className="text-[9px] font-black uppercase mt-1">Salir</span>
                  </button>
               </div>

               {/* --- BLOQUE DE TOTALES --- */}
               <div className="space-y-1.5 pt-1 border-t border-dashed border-gray-200">
                  <div className="flex justify-between items-center text-xs font-bold text-gray-500">
                     <span>SUBTOTAL</span>
                     <span>{baseCurrency.symbol}{cartSubtotal.toFixed(2)}</span>
                  </div>
                  {discountAmount > 0 && (
                     <div className="flex justify-between items-center text-xs font-black text-red-500">
                        <span>DESCUENTO</span>
                        <span>-{baseCurrency.symbol}{discountAmount.toFixed(2)}</span>
                     </div>
                  )}
                  <div className="flex justify-between items-center text-xs font-bold text-gray-500">
                     <span>IMPUESTOS</span>
                     <span>{baseCurrency.symbol}{cartTax.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between items-end pt-2">
                     <div className="text-4xl font-black text-slate-900 leading-none tracking-tighter">
                        {baseCurrency.symbol}{cartTotal.toFixed(2)}
                     </div>
                     <div className="text-right">
                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Total General</p>
                     </div>
                  </div>
               </div>

               {/* Checkout Button */}
               <button
                  onClick={() => {
                     if (cart.length > 0 && fiscalStatus.hasNCF) {
                        // 1. Validate Document Series
                        const validation = validateTerminalDocument(config, terminalId, 'TICKET');
                        if (!validation.isValid) {
                           alert(validation.error);
                           return;
                        }

                        // 2. Validate Session Expiration (Force Z)
                        if (transactions.length > 0 && activeTerminalConfig) {
                           // Assuming transactions are ordered chronologically, the first one is the start of the session
                           const sessionStartDate = transactions[0].date;
                           if (isSessionExpired(sessionStartDate, activeTerminalConfig)) {
                              alert("⚠️ CIERRE Z REQUERIDO\n\nLa jornada operativa ha cambiado. Debe realizar el Cierre Z antes de continuar facturando.");
                              return;
                           }
                        }

                        setShowPaymentModal(true);
                     } else if (!fiscalStatus.hasNCF) {
                        alert("No hay secuencias fiscales disponibles.");
                     }
                  }}
                  disabled={cart.length === 0 || !fiscalStatus.hasNCF}
                  className={`w-full py-5 rounded-2xl font-black text-xl shadow-xl active:scale-[0.98] transition-all flex justify-between px-8 items-center ${!fiscalStatus.hasNCF ? 'bg-red-100 text-red-500 cursor-not-allowed border-2 border-red-200' : 'bg-slate-900 text-white hover:bg-black'}`}
               >
                  <span>{!fiscalStatus.hasNCF ? 'Sin Secuencia' : 'Cobrar'}</span>
                  <ArrowRight size={24} />
               </button>
            </div>
         </div>

         {/* Modals & Overlays */}
         {showPaymentModal && <UnifiedPaymentModal total={cartTotal} currencySymbol={baseCurrency.symbol} config={config} onClose={() => setShowPaymentModal(false)} onConfirm={handlePaymentConfirm} themeColor={config.themeColor} />}
         {editingItem && <CartItemOptionsModal item={editingItem} config={config} users={users} roles={roles} onClose={() => setEditingItem(null)} onUpdate={updateCartItem} canApplyDiscount={true} canVoidItem={true} />}
         {selectedProductForVariants && <ProductVariantSelector product={selectedProductForVariants} currencySymbol={baseCurrency.symbol} onClose={() => setSelectedProductForVariants(null)} onConfirm={(p, m, pr) => { addToCart(p, 1, pr, m); setSelectedProductForVariants(null); }} />}
         {productForScale && <ScaleModal product={productForScale} currencySymbol={baseCurrency.symbol} onClose={() => setProductForScale(null)} onConfirm={(w) => { addToCart(productForScale, w); setProductForScale(null); }} />}
         {showGlobalDiscount && <GlobalDiscountModal currentSubtotal={cartSubtotal} currencySymbol={baseCurrency.symbol} initialValue={globalDiscount.value.toString()} initialType={globalDiscount.type} themeColor={config.themeColor} onClose={() => setShowGlobalDiscount(false)} onConfirm={(val, type) => { setGlobalDiscount({ value: parseFloat(val) || 0, type }); setShowGlobalDiscount(false); }} />}

         {/* List of Parked Tickets */}
         {showParkedList && (
            <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in zoom-in-95">
               <div className="bg-white rounded-[2.5rem] w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95">
                  <div className="p-6 border-b bg-gray-50 flex justify-between items-center">
                     <h3 className="font-black text-xl text-gray-800">Tickets en Espera</h3>
                     <button onClick={() => setShowParkedList(false)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} /></button>
                  </div>
                  <div className="p-4 overflow-y-auto max-h-[60vh] space-y-3">
                     {parkedTickets.map(pt => (
                        <div key={pt.id} onClick={() => handleRestoreTicket(pt)} className="p-4 bg-white border border-gray-100 rounded-2xl hover:border-orange-400 hover:bg-orange-50 cursor-pointer group transition-all">
                           <div className="flex justify-between items-start mb-2">
                              <span className="font-bold text-gray-800">{pt.name}</span>
                              <span className="text-[10px] font-bold text-gray-400 uppercase">{new Date(pt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                           </div>
                           <div className="flex justify-between items-center">
                              <span className="text-xs text-gray-500">{pt.items.length} productos</span>
                              <ArrowRight size={16} className="text-orange-300 group-hover:text-orange-500 transition-colors" />
                           </div>
                        </div>
                     ))}
                     {parkedTickets.length === 0 && <div className="py-10 text-center text-gray-400 italic">No hay tickets guardados</div>}
                  </div>
               </div>
            </div>
         )}
      </div>
   );
};

export default POSInterface;
