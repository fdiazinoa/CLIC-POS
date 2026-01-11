import React, { useState, useEffect, useRef } from 'react';
import { ShoppingCart, Search, Menu, Zap, Trash2, Plus, Minus, CreditCard, User as UserIcon, ScanBarcode, Utensils, CheckCircle, Printer, Percent, DollarSign, X, LayoutGrid, Lock, ChevronLeft, ChevronRight, Save, Download, Filter, Users, UserPlus, Clock, FileText, Edit, MapPin, ChefHat, Send, Sparkles, Loader2, Bot, ChevronDown, MoreHorizontal, ArrowUpRight, History, Wallet, Truck } from 'lucide-react';
import { BusinessConfig, CartItem, Product, VerticalType, User, RoleDefinition, PaymentEntry, Transaction, Customer, SavedTicket, Table, Modifier } from '../types';
import PaymentModal from './PaymentModal';
import ModifierModal from './ModifierModal'; 
import CartItemOptionsModal from './CartItemOptionsModal';
import TicketOptionsModal from './TicketOptionsModal';
import TicketContextMenu from './TicketContextMenu';
import SplitTicketModal from './SplitTicketModal';
import ProductVariantSelector from './ProductVariantSelector';
import { getSmartSuggestions, analyzeSalesContext } from '../services/geminiService';

interface POSInterfaceProps {
  config: BusinessConfig;
  currentUser: User;
  roles: RoleDefinition[];
  customers: Customer[];
  products: Product[]; // Receive from App
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenCustomers: () => void;
  onOpenHistory?: () => void;
  onOpenFinance?: () => void;
  onOpenSupplyChain?: () => void; 
  onTransactionComplete: (transaction: Transaction) => void;
  onAddCustomer: (customer: Customer) => void;
}

const POSInterface: React.FC<POSInterfaceProps> = ({ 
  config, 
  currentUser, 
  roles, 
  customers,
  products,
  onLogout, 
  onOpenSettings, 
  onOpenCustomers,
  onOpenHistory,
  onOpenFinance,
  onOpenSupplyChain,
  onTransactionComplete,
  onAddCustomer
}) => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartCreatedAt, setCartCreatedAt] = useState<Date | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('Todos');
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [activeGuestCount, setActiveGuestCount] = useState<number>(0);
  
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printType, setPrintType] = useState<'PRE' | 'FINAL' | 'KITCHEN'>('FINAL');
  
  // Modals
  const [showTableModal, setShowTableModal] = useState(false);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [tempSelectedTable, setTempSelectedTable] = useState<number | null>(null);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showSaveTicketModal, setShowSaveTicketModal] = useState(false);
  const [showLoadTicketModal, setShowLoadTicketModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showSplitTicketModal, setShowSplitTicketModal] = useState(false);
  
  // Data State
  const [tables, setTables] = useState<Table[]>([]);
  const [savedTickets, setSavedTickets] = useState<SavedTicket[]>([]);
  const [tableSearch, setTableSearch] = useState('');
  const [activeZone, setActiveZone] = useState('Todas');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [ticketAlias, setTicketAlias] = useState('');
  const [renameTicketId, setRenameTicketId] = useState<string | null>(null);
  const [renameTicketValue, setRenameTicketValue] = useState('');
  const [splitSourceItems, setSplitSourceItems] = useState<CartItem[] | null>(null);

  // Menus & Popups
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ticketId: string | null }>({ x: 0, y: 0, ticketId: null });
  const [ticketIdForCustomerSelection, setTicketIdForCustomerSelection] = useState<string | null>(null);
  const [showTicketOptions, setShowTicketOptions] = useState(false);
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
  
  // Logic State
  const [discountValue, setDiscountValue] = useState<string>('');
  const [discountType, setDiscountType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [selectedProductForModifiers, setSelectedProductForModifiers] = useState<Product | null>(null);
  const [editingCartItem, setEditingCartItem] = useState<CartItem | null>(null);
  
  // AI State
  const [aiSuggestion, setAiSuggestion] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [motivationalMessage, setMotivationalMessage] = useState('');

  // NEW: Inline Variant Selection State
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);

  // --- Initializers & Effects ---
  const checkPermission = (permissionKey: string): boolean => {
    const userRole = roles.find(r => r.id === currentUser.role);
    return userRole ? userRole.permissions.includes(permissionKey) : false;
  };

  useEffect(() => {
    const saved = localStorage.getItem('antigravity_pos_multi_tickets');
    if (saved) {
      try {
        setSavedTickets(JSON.parse(saved));
      } catch (e) { console.error(e); }
    }
  }, []);

  useEffect(() => {
    const initialTables = Array.from({ length: 20 }, (_, i) => {
      const id = i + 1;
      let zone = 'Salón Principal';
      if (id > 10 && id <= 15) zone = 'Terraza';
      if (id > 15) zone = 'VIP';
      return { id, name: `Mesa ${id}`, zone, status: 'AVAILABLE' as const, guests: 0, time: null, amount: null };
    });
    const saved = localStorage.getItem('antigravity_pos_multi_tickets');
    let tickets: SavedTicket[] = [];
    if (saved) tickets = JSON.parse(saved);

    const hydratedTables = initialTables.map(t => {
      const activeTicket = tickets.find(ticket => ticket.tableId === t.id);
      if (activeTicket) {
        return { ...t, status: 'OCCUPIED' as const, guests: activeTicket.guestCount || 0, amount: activeTicket.total, time: '12m', ticketId: activeTicket.id };
      }
      return t;
    });
    setTables(hydratedTables);
  }, []);

  useEffect(() => {
    localStorage.setItem('antigravity_pos_multi_tickets', JSON.stringify(savedTickets));
    setTables(prev => prev.map(t => {
      const ticket = savedTickets.find(tk => tk.tableId === t.id);
      if (ticket) {
        return { ...t, status: 'OCCUPIED', amount: ticket.total, guests: ticket.guestCount || 0 };
      } else {
        return { ...t, status: 'AVAILABLE', amount: null, guests: 0, time: null };
      }
    }));
  }, [savedTickets]);

  // --- Products & Filtering ---
  const categories = ['Todos', ...Array.from(new Set(products.map(p => p.category)))];

  const filteredTables = tables.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(tableSearch.toLowerCase()) || t.id.toString().includes(tableSearch);
    const matchesZone = activeZone === 'Todas' || t.zone === activeZone;
    return matchesSearch && matchesZone;
  });
  const zones = ['Todas', ...Array.from(new Set(tables.map(t => t.zone)))];

  const filteredProducts = products.filter(p => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = p.name.toLowerCase().includes(term) || (p.barcode && p.barcode.toLowerCase().includes(term));
    const matchesCategory = activeCategory === 'Todos' || p.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) || c.phone?.includes(customerSearch) || c.taxId?.includes(customerSearch)
  );

  // --- Cart Logic ---
  const addToCart = (product: Product, modifiers?: string[], adjustedPrice?: number) => {
    setAiSuggestion('');
    if (cart.length === 0 && !cartCreatedAt) setCartCreatedAt(new Date());
    
    setCart(prev => {
      const isModified = !!modifiers && modifiers.length > 0;
      const unitPrice = adjustedPrice || product.price;
      const existingIndex = prev.findIndex(item => {
        if (item.id !== product.id) return false;
        if (item.isSent) return false;
        if (Math.abs(item.price - unitPrice) > 0.01) return false;
        const itemMods = item.modifiers || [];
        const newMods = modifiers || [];
        if (itemMods.length !== newMods.length) return false;
        const sortedItemMods = [...itemMods].sort();
        const sortedNewMods = [...newMods].sort();
        return sortedItemMods.every((val, index) => val === sortedNewMods[index]);
      });

      if (existingIndex >= 0) {
         const newCart = [...prev];
         newCart[existingIndex] = { ...newCart[existingIndex], quantity: newCart[existingIndex].quantity + 1 };
         return newCart;
      }
      return [...prev, { 
        ...product, price: unitPrice, originalPrice: unitPrice, quantity: 1, 
        cartId: Math.random().toString(36).substr(2, 9), modifiers: modifiers, isSent: false 
      }];
    });
    // Close variant popup if open
    setActiveVariantId(null);
    setSelectedProductForModifiers(null);
  };

  const handleProductClick = (product: Product) => {
    if (product.variants && product.variants.length > 0) {
       setActiveVariantId(product.id);
    } else if (product.availableModifiers && product.availableModifiers.length > 0) {
       setSelectedProductForModifiers(product);
    } else {
       addToCart(product);
    }
  };

  const handleVariantSelect = (product: Product, modifiers: string[], price: number) => {
    addToCart(product, modifiers, price);
    setActiveVariantId(null);
  };

  const handleModifierConfirm = (modifiers: string[], price: number) => {
     if (selectedProductForModifiers) {
        addToCart(selectedProductForModifiers, modifiers, price);
        setSelectedProductForModifiers(null);
     }
  };

  // --- Key Listener (Barcode) ---
  useEffect(() => {
    if (!config.features.barcodeScanning) return;
    let buffer = '';
    let timeout: ReturnType<typeof setTimeout>;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (showPaymentModal || showTableModal || selectedProductForModifiers || isPrinting || showCustomerModal || showSaveTicketModal || showLoadTicketModal || editingCartItem || showGuestModal || showTicketOptions || showSplitTicketModal) return;

      if (e.key === 'Enter') {
        if (buffer) {
          const product = products.find(p => p.barcode === buffer);
          if (product) {
            handleProductClick(product);
            setLastScanned(product.name);
            setTimeout(() => setLastScanned(null), 2000);
          }
          buffer = '';
        }
        return;
      }
      if (e.key.length === 1) {
        buffer += e.key;
        clearTimeout(timeout);
        timeout = setTimeout(() => { buffer = ''; }, 5000); 
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timeout);
    };
  }, [config.features.barcodeScanning, products, showPaymentModal]);

  // --- Calculations ---
  const subtotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  const discountInputVal = parseFloat(discountValue) || 0;
  let discountAmount = 0;
  if (discountType === 'PERCENT') {
    discountAmount = subtotal * (Math.min(discountInputVal, 100) / 100);
  } else {
    discountAmount = Math.min(discountInputVal, subtotal);
  }
  const taxableAmount = Math.max(0, subtotal - discountAmount);
  const tax = taxableAmount * config.taxRate;
  const finalTotal = taxableAmount + tax;

  // --- Ticket Actions ---
  const TicketMenuLogic = {
    assignCustomer: () => setShowCustomerModal(true),
    splitBill: () => {
      if (cart.length === 0) { alert("Ticket vacío."); return; }
      setSplitSourceItems(cart);
      setTimeout(() => setShowSplitTicketModal(true), 50);
    },
    fractionBill: () => {
      if (cart.length === 0) return;
      const count = parseInt(prompt("¿Número de personas?", "2") || '0');
      if (count > 0) alert(`Total: ${config.currencySymbol}${finalTotal.toFixed(2)}\nPor persona: ${config.currencySymbol}${(finalTotal / count).toFixed(2)}`);
    },
    applyGlobalDiscount: () => {
      if (!checkPermission('CAN_APPLY_DISCOUNT')) { alert("Acceso denegado"); return; }
      const input = prompt("Descuento %:", discountValue);
      if (input !== null) { setDiscountType('PERCENT'); setDiscountValue(input); }
    },
    showWaitTime: () => {
      if (!cartCreatedAt) return;
      const diff = Math.floor((new Date().getTime() - cartCreatedAt.getTime()) / 60000);
      alert(`Tiempo abierto: ${diff} min`);
    },
    parkSale: () => handleSaveClick(),
    clearCart: () => {
       if(confirm("¿Limpiar orden?")) {
         setCart([]); setDiscountValue(''); setAiSuggestion(''); setSelectedTable(null); setActiveGuestCount(0); setCartCreatedAt(null);
       }
    }
  };

  const handleTicketAction = (actionId: string) => {
    setShowTicketOptions(false);
    switch (actionId) {
      case 'ASSIGN_CUSTOMER': TicketMenuLogic.assignCustomer(); break;
      case 'SPLIT_BILL': TicketMenuLogic.splitBill(); break;
      case 'FRACTION': TicketMenuLogic.fractionBill(); break;
      case 'DISCOUNT': TicketMenuLogic.applyGlobalDiscount(); break;
      case 'SHOW_TIME': TicketMenuLogic.showWaitTime(); break;
      case 'PARK_SALE': TicketMenuLogic.parkSale(); break;
      case 'CLEAR_CART': TicketMenuLogic.clearCart(); break;
      case 'CHARGE': if (cart.length > 0 && checkPermission('CAN_FINALIZE_PAYMENT')) setShowPaymentModal(true); break;
    }
  };

  // --- Handlers (Save, Restore, Payment, etc) ---
  const handleSaveClick = () => {
    if (cart.length === 0) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setTicketAlias(selectedCustomer ? `${selectedCustomer.name} (${time})` : `Ticket ${time}`);
    setShowSaveTicketModal(true);
  };

  const confirmSaveTicket = () => {
    if (!ticketAlias.trim()) return;
    setSavedTickets(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      alias: ticketAlias,
      timestamp: cartCreatedAt ? cartCreatedAt.toISOString() : new Date().toISOString(),
      items: cart,
      customer: selectedCustomer,
      total: finalTotal,
      tableId: null
    }]);
    setCart([]); setDiscountValue(''); setAiSuggestion(''); setSelectedCustomer(null); setShowSaveTicketModal(false); setCartCreatedAt(null);
  };

  const confirmRestoreTicket = (ticket: SavedTicket): boolean => {
    if (cart.length > 0 && selectedTable !== ticket.tableId) {
       if(!confirm("¿Reemplazar ticket actual?")) return false;
    }
    setCart(ticket.items);
    setSelectedCustomer(ticket.customer);
    setDiscountValue('');
    setAiSuggestion('');
    setCartCreatedAt(new Date(ticket.timestamp));
    if (ticket.tableId) setSelectedTable(ticket.tableId);
    if (ticket.guestCount) setActiveGuestCount(ticket.guestCount);
    setShowLoadTicketModal(false);
    return true;
  };

  const handlePaymentConfirm = (payments: PaymentEntry[]) => {
    const txn: Transaction = {
      id: Math.random().toString(36).substr(2, 10),
      date: new Date().toISOString(),
      items: [...cart],
      total: finalTotal,
      payments,
      userId: currentUser.id,
      userName: currentUser.name,
      customerId: selectedCustomer?.id,
      customerName: selectedCustomer?.name
    };
    setShowPaymentModal(false);
    
    analyzeSalesContext({ total: finalTotal, itemCount: cart.length }, config).then(setMotivationalMessage);
    setPrintType('FINAL');
    setIsPrinting(true);

    setTimeout(() => {
      setIsPrinting(false);
      setPaymentSuccess(true);
      onTransactionComplete(txn);
      if (selectedTable) setSavedTickets(prev => prev.filter(t => t.tableId !== selectedTable));
      setTimeout(() => {
        setPaymentSuccess(false); setCart([]); setDiscountValue(''); setAiSuggestion(''); setSelectedTable(null); setActiveGuestCount(0); setSelectedCustomer(null); setIsMobileCartOpen(false); setMotivationalMessage(''); setCartCreatedAt(null);
      }, 3500);
    }, 3000);
  };

  const handleSplitConfirm = (remaining: CartItem[], newItems: CartItem[]) => {
    setCart(remaining);
    setSplitSourceItems(null);
    const newSub = newItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
    const newTx = newSub + (newSub * config.taxRate);
    
    setSavedTickets(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      alias: `Split - ${selectedTable ? `Mesa ${selectedTable}` : 'Ticket'}`,
      timestamp: new Date().toISOString(),
      items: newItems,
      customer: selectedCustomer,
      total: newTx,
      tableId: null
    }]);
    setShowSplitTicketModal(false);
  };

  // --- UI Helpers ---
  const themeAccent = config.themeColor === 'orange' ? 'bg-orange-600' : (config.themeColor === 'blue' ? 'bg-blue-600' : 'bg-indigo-600');
  const themeText = config.themeColor === 'orange' ? 'text-orange-600' : (config.themeColor === 'blue' ? 'text-blue-600' : 'text-indigo-600');

  // --- RENDER ---
  return (
    <div className="flex h-screen w-full bg-[#F3F4F6] text-slate-800 font-sans overflow-hidden relative">
      
      {/* Toast Notification */}
      {lastScanned && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 z-[100] bg-emerald-500 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-2 animate-bounce">
          <ScanBarcode size={20} />
          <span className="font-medium">Producto añadido: {lastScanned}</span>
        </div>
      )}

      {/* --- LEFT SIDE: CATALOG --- */}
      <div className="flex-1 flex flex-col p-6 pr-0 gap-6 overflow-hidden">
        
        {/* Header & Search */}
        <header className="flex flex-col gap-4 shrink-0">
           <div className="flex justify-between items-center pr-6">
              <div>
                 <h1 className="text-2xl font-bold tracking-tight text-slate-900">Retail <span className="text-slate-400 font-light">POS</span></h1>
                 <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">{config.subVertical} • {currentUser.name}</p>
              </div>
              <div className="flex gap-2">
                 {checkPermission('CAN_MANAGE_CUSTOMERS') && (
                   <button onClick={onOpenCustomers} className="p-3 bg-white rounded-2xl shadow-sm hover:shadow-md transition-all text-slate-600" title="Clientes">
                      <Users size={20} />
                   </button>
                 )}
                 {checkPermission('CAN_VIEW_REPORTS') && onOpenHistory && (
                   <button onClick={onOpenHistory} className="p-3 bg-white rounded-2xl shadow-sm hover:shadow-md transition-all text-slate-600" title="Historial">
                      <History size={20} />
                   </button>
                 )}
                 {checkPermission('CAN_VIEW_REPORTS') && onOpenFinance && (
                   <button onClick={onOpenFinance} className="p-3 bg-white rounded-2xl shadow-sm hover:shadow-md transition-all text-slate-600" title="Finanzas">
                      <Wallet size={20} />
                   </button>
                 )}
                 {/* Access Settings from Header */}
                 {checkPermission('CAN_ACCESS_SETTINGS') && (
                   <button onClick={onOpenSettings} className="p-3 bg-white rounded-2xl shadow-sm hover:shadow-md transition-all text-slate-600">
                      <Menu size={20} />
                   </button>
                 )}
                 <button onClick={onLogout} className="p-3 bg-white rounded-2xl shadow-sm hover:shadow-md hover:text-red-500 transition-all text-slate-600">
                    <Lock size={20} />
                 </button>
              </div>
           </div>

           {/* Search Bar */}
           <div className="relative w-full max-w-2xl">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                 <Search size={20} className="text-slate-400" />
              </div>
              <input 
                type="text" 
                placeholder="Buscar productos, referencias o código de barras..." 
                className="w-full pl-12 pr-4 py-3.5 bg-white border-none rounded-2xl shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:shadow-md outline-none transition-all text-slate-700 placeholder:text-slate-400"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              <div className="absolute inset-y-0 right-2 flex items-center">
                 <div className="px-2 py-1 bg-slate-100 rounded-lg text-[10px] font-bold text-slate-400 uppercase border border-slate-200">
                    CMD + K
                 </div>
              </div>
           </div>

           {/* Category Pills */}
           <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {categories.map(cat => (
                 <button 
                   key={cat} 
                   onClick={() => setActiveCategory(cat)}
                   className={`px-5 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap transition-all duration-300 ${
                      activeCategory === cat 
                         ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20 scale-105' 
                         : 'bg-white text-slate-500 hover:bg-slate-100 shadow-sm'
                   }`}
                 >
                    {cat}
                 </button>
              ))}
           </div>
        </header>

        {/* Bento Grid */}
        <div className="flex-1 overflow-y-auto pr-2 pb-20">
           <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredProducts.map(product => (
                 <div 
                   key={product.id}
                   className="group relative bg-white rounded-3xl p-3 shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer flex flex-col h-full active:scale-95"
                   onClick={() => handleProductClick(product)}
                 >
                    {/* Image Container */}
                    <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 mb-3">
                       <img 
                         src={product.image} 
                         alt={product.name} 
                         className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" 
                       />
                       
                       {/* Stock Badge */}
                       {config.features.stockTracking && (
                          <div className={`absolute top-2 right-2 px-2 py-1 rounded-full text-[10px] font-bold backdrop-blur-md ${
                             (product.stock || 0) < 10 ? 'bg-red-500/90 text-white' : 'bg-white/80 text-slate-700'
                          }`}>
                             {product.stock} u.
                          </div>
                       )}

                       {/* Variant Indicator */}
                       {product.hasModifiers && (
                          <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 backdrop-blur-sm rounded-lg text-white text-[10px] font-medium flex items-center gap-1">
                             <Plus size={10} />
                             Opciones
                          </div>
                       )}

                       {/* Contextual Menu Overlay */}
                       {activeVariantId === product.id && (
                          <div 
                             className="absolute inset-0 bg-white/95 backdrop-blur-sm z-10 flex flex-col p-2 animate-in fade-in zoom-in-95 duration-200"
                             onClick={(e) => e.stopPropagation()} 
                          >
                             <div className="flex justify-between items-center mb-2 px-1">
                                <span className="text-xs font-bold text-slate-500 uppercase">Selecciona</span>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); setActiveVariantId(null); }}
                                  className="p-1 hover:bg-slate-100 rounded-full"
                                >
                                   <X size={14} className="text-slate-400" />
                                </button>
                             </div>
                             <div className="flex-1 overflow-y-auto space-y-1 no-scrollbar">
                                {product.availableModifiers?.map(mod => (
                                   <button 
                                      key={mod.id}
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        handleVariantSelect(product, [mod.name], product.price + mod.price); 
                                      }}
                                      className="w-full text-left px-3 py-2 rounded-xl bg-slate-50 hover:bg-blue-50 hover:text-blue-600 transition-colors flex justify-between items-center group/mod"
                                   >
                                      <span className="text-sm font-medium text-slate-700 group-hover/mod:text-blue-700">{mod.name}</span>
                                      {mod.price > 0 && <span className="text-xs font-bold text-slate-400 group-hover/mod:text-blue-500">+{mod.price}</span>}
                                   </button>
                                ))}
                             </div>
                          </div>
                       )}
                    </div>

                    {/* Info */}
                    <div className="flex flex-col flex-1 justify-between px-1">
                       <h3 className="font-bold text-slate-800 text-sm leading-snug mb-1 line-clamp-2">{product.name}</h3>
                       <div className="flex items-end justify-between mt-1">
                          <p className="text-xs text-slate-400 font-medium">{product.category}</p>
                          <span className="text-base font-bold text-slate-900">{config.currencySymbol}{product.price.toFixed(2)}</span>
                       </div>
                    </div>
                 </div>
              ))}
           </div>
        </div>
      </div>

      {/* --- RIGHT SIDE: TICKET (Responsive) --- */}
      {/* Changed behavior: `xl:static` means it sits side-by-side only on extra large screens. 
          On `md` and `lg` (Tablets/Laptops), it stays as a drawer to ensure Main Content (Left) has enough space. */}
      <div className={`
         fixed inset-y-0 right-0 w-full md:w-[420px] bg-white shadow-2xl z-40 transform transition-transform duration-300 flex flex-col xl:static xl:w-[450px]
         ${isMobileCartOpen ? 'translate-x-0' : 'translate-x-full xl:translate-x-0'}
      `}>
         
         {/* Cart Header */}
         <div className="p-5 border-b border-slate-100 bg-slate-50/50">
            <div className="flex justify-between items-center mb-4">
               <div className="flex items-center gap-2">
                  <div className="bg-slate-900 text-white p-2 rounded-lg">
                     <ShoppingCart size={20} />
                  </div>
                  <div>
                     <h2 className="font-bold text-slate-800 text-lg leading-none">Orden Actual</h2>
                     <p className="text-xs text-slate-400 font-medium">Ticket #{savedTickets.length + 1}</p>
                  </div>
               </div>
               <div className="flex gap-2">
                  <button onClick={() => setShowLoadTicketModal(true)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors relative">
                     <History size={20} />
                     {savedTickets.length > 0 && (
                        <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
                     )}
                  </button>
                  <button onClick={() => setShowTicketOptions(true)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                     <MoreHorizontal size={20} />
                  </button>
                  {/* Close button visible on Mobile/Tablet when drawer is open, hidden on XL */}
                  <button onClick={() => setIsMobileCartOpen(false)} className="xl:hidden p-2 text-slate-400 hover:text-red-500">
                     <X size={24} />
                  </button>
               </div>
            </div>

            {/* Customer Selector */}
            <button 
               onClick={() => setShowCustomerModal(true)}
               className={`w-full p-3 rounded-xl border-2 border-dashed flex items-center justify-center gap-2 transition-all group ${
                  selectedCustomer 
                     ? 'border-blue-200 bg-blue-50 text-blue-700' 
                     : 'border-slate-200 text-slate-400 hover:border-blue-300 hover:text-blue-500'
               }`}
            >
               {selectedCustomer ? (
                  <>
                     <UserIcon size={16} />
                     <span className="font-bold text-sm">{selectedCustomer.name}</span>
                     <span className="text-xs bg-white/50 px-2 py-0.5 rounded ml-auto">
                        {config.currencySymbol}{selectedCustomer.currentDebt?.toFixed(2)} Deuda
                     </span>
                  </>
               ) : (
                  <>
                     <UserPlus size={16} />
                     <span className="font-bold text-sm">Asignar Cliente</span>
                  </>
               )}
            </button>
         </div>

         {/* Cart Items */}
         <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cart.length === 0 ? (
               <div className="h-full flex flex-col items-center justify-center text-slate-300">
                  <ShoppingCart size={64} className="mb-4 opacity-20" />
                  <p className="font-medium">Carrito vacío</p>
                  <p className="text-xs">Escanea o selecciona productos</p>
               </div>
            ) : (
               cart.map((item) => (
                  <div 
                     key={item.cartId} 
                     onClick={() => setEditingCartItem(item)}
                     className="group bg-white border border-slate-100 rounded-2xl p-3 flex gap-3 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer relative"
                  >
                     <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center font-bold text-slate-600 shrink-0">
                        {item.quantity}x
                     </div>
                     <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                           <h4 className="font-bold text-slate-800 text-sm truncate pr-2">{item.name}</h4>
                           <span className="font-bold text-slate-900 text-sm">
                              {config.currencySymbol}{(item.price * item.quantity).toFixed(2)}
                           </span>
                        </div>
                        <p className="text-xs text-slate-400">
                           {config.currencySymbol}{item.price.toFixed(2)} / un
                           {item.originalPrice && item.price < item.originalPrice && (
                              <span className="ml-2 text-red-500 line-through">{config.currencySymbol}{item.originalPrice.toFixed(2)}</span>
                           )}
                        </p>
                        {item.modifiers && item.modifiers.length > 0 && (
                           <div className="flex flex-wrap gap-1 mt-1">
                              {item.modifiers.map((mod, i) => (
                                 <span key={i} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                                    {mod}
                                 </span>
                              ))}
                           </div>
                        )}
                        {item.note && (
                           <p className="text-[10px] text-amber-600 italic mt-1 bg-amber-50 px-1.5 py-0.5 rounded inline-block">
                              "{item.note}"
                           </p>
                        )}
                     </div>
                  </div>
               ))
            )}
         </div>

         {/* Cart Footer */}
         <div className="p-5 bg-white border-t border-slate-100 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] z-10">
            
            {/* AI Suggestion Area */}
            {cart.length > 0 && (
               <div className="mb-4">
                  {!aiSuggestion ? (
                     <button 
                        onClick={async () => {
                           setIsAiLoading(true);
                           const suggestion = await getSmartSuggestions(cart, config);
                           setAiSuggestion(suggestion);
                           setIsAiLoading(false);
                        }}
                        className="w-full py-2 bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-100 rounded-xl text-violet-600 text-xs font-bold flex items-center justify-center gap-2 hover:brightness-95 transition-all"
                     >
                        {isAiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        Obtener Sugerencia IA
                     </button>
                  ) : (
                     <div className="bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-100 p-3 rounded-xl flex gap-3 animate-in fade-in slide-in-from-bottom-2">
                        <Bot size={20} className="text-violet-600 shrink-0 mt-0.5" />
                        <div className="flex-1">
                           <p className="text-xs font-medium text-violet-800 leading-relaxed italic">"{aiSuggestion}"</p>
                           <button onClick={() => setAiSuggestion('')} className="text-[10px] text-violet-400 font-bold mt-1 hover:text-violet-600">Cerrar</button>
                        </div>
                     </div>
                  )}
               </div>
            )}

            {/* Totals */}
            <div className="space-y-2 mb-4">
               <div className="flex justify-between text-sm text-slate-500">
                  <span>Subtotal</span>
                  <span>{config.currencySymbol}{subtotal.toFixed(2)}</span>
               </div>
               {discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                     <span>Descuento</span>
                     <span>-{config.currencySymbol}{discountAmount.toFixed(2)}</span>
                  </div>
               )}
               <div className="flex justify-between text-sm text-slate-500">
                  <span>Impuestos ({(config.taxRate * 100).toFixed(0)}%)</span>
                  <span>{config.currencySymbol}{tax.toFixed(2)}</span>
               </div>
               <div className="flex justify-between text-xl font-black text-slate-900 pt-2 border-t border-slate-100">
                  <span>Total</span>
                  <span>{config.currencySymbol}{finalTotal.toFixed(2)}</span>
               </div>
            </div>

            {/* Main Actions */}
            <div className="grid grid-cols-4 gap-3">
               <button 
                  onClick={() => handleTicketAction('PARK_SALE')}
                  className="col-span-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl flex items-center justify-center transition-colors"
                  title="Guardar Ticket"
               >
                  <Save size={24} />
               </button>
               <button 
                  onClick={() => handleTicketAction('CHARGE')}
                  disabled={cart.length === 0}
                  className={`col-span-3 py-4 rounded-xl font-bold text-white shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 transition-all active:scale-95 ${
                     cart.length === 0 ? 'bg-slate-300 cursor-not-allowed shadow-none' : `${themeAccent} hover:brightness-110`
                  }`}
               >
                  <span className="text-lg">COBRAR</span>
                  <ArrowUpRight size={20} strokeWidth={3} />
               </button>
            </div>

         </div>
      </div>

      {/* Floating Cart Button (Mobile & Tablet) */}
      {!isMobileCartOpen && cart.length > 0 && (
         <button 
            onClick={() => setIsMobileCartOpen(true)}
            className="xl:hidden fixed bottom-4 right-4 bg-blue-600 text-white p-4 rounded-full shadow-2xl shadow-blue-600/40 z-50 flex items-center gap-2 animate-bounce"
         >
            <ShoppingCart size={24} />
            <span className="font-bold">{cart.length}</span>
         </button>
      )}

      {/* Modals */}
      {showPaymentModal && (
        <PaymentModal 
          total={finalTotal} 
          currencySymbol={config.currencySymbol} 
          onClose={() => setShowPaymentModal(false)}
          onConfirm={handlePaymentConfirm}
          themeColor={config.themeColor}
        />
      )}

      {selectedProductForModifiers && (
        <ModifierModal 
          product={selectedProductForModifiers} 
          currencySymbol={config.currencySymbol}
          themeColor={config.themeColor}
          onClose={() => setSelectedProductForModifiers(null)}
          onConfirm={handleModifierConfirm}
        />
      )}

      {activeVariantId && (
        <ProductVariantSelector
           // Safe finding
           product={products.find(p => p.id === activeVariantId) || products[0]} 
           currencySymbol={config.currencySymbol}
           onClose={() => setActiveVariantId(null)}
           onConfirm={handleVariantSelect}
        />
      )}

      {editingCartItem && (
        <CartItemOptionsModal
           item={editingCartItem}
           config={config}
           onClose={() => setEditingCartItem(null)}
           onUpdate={(updatedItem) => {
              if (updatedItem === null) {
                 setCart(prev => prev.filter(i => i.cartId !== editingCartItem.cartId));
              } else {
                 setCart(prev => prev.map(i => i.cartId === editingCartItem.cartId ? updatedItem : i));
              }
           }}
           canApplyDiscount={checkPermission('CAN_APPLY_DISCOUNT')}
           canVoidItem={checkPermission('CAN_VOID_ITEM')}
        />
      )}

      {showTicketOptions && (
         <TicketOptionsModal 
            onClose={() => setShowTicketOptions(false)}
            onAction={handleTicketAction}
         />
      )}

      {showSplitTicketModal && splitSourceItems && (
         <SplitTicketModal
            originalItems={splitSourceItems}
            currencySymbol={config.currencySymbol}
            onClose={() => setShowSplitTicketModal(false)}
            onConfirm={handleSplitConfirm}
         />
      )}

      {/* Inline Save Ticket Modal */}
      {showSaveTicketModal && (
         <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
               <h3 className="font-bold text-lg mb-4">Guardar Ticket</h3>
               <input 
                  autoFocus
                  type="text" 
                  placeholder="Alias (Opcional)" 
                  value={ticketAlias}
                  onChange={(e) => setTicketAlias(e.target.value)}
                  className="w-full p-3 border rounded-xl mb-4 outline-none focus:border-blue-500"
               />
               <div className="flex gap-3">
                  <button onClick={() => setShowSaveTicketModal(false)} className="flex-1 py-3 bg-gray-100 rounded-xl font-bold text-gray-600">Cancelar</button>
                  <button onClick={confirmSaveTicket} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold">Guardar</button>
               </div>
            </div>
         </div>
      )}

      {/* Inline Load Ticket Modal */}
      {showLoadTicketModal && (
         <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[80vh] flex flex-col">
               <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-lg">Tickets Guardados</h3>
                  <button onClick={() => setShowLoadTicketModal(false)}><X size={20} className="text-gray-400" /></button>
               </div>
               <div className="flex-1 overflow-y-auto space-y-3">
                  {savedTickets.length === 0 ? (
                     <p className="text-center text-gray-400 py-8">No hay tickets guardados.</p>
                  ) : (
                     savedTickets.map(ticket => (
                        <button 
                           key={ticket.id}
                           onClick={() => confirmRestoreTicket(ticket)}
                           className="w-full text-left p-4 rounded-xl border border-gray-100 hover:border-blue-300 hover:bg-blue-50 transition-all group"
                        >
                           <div className="flex justify-between items-start mb-1">
                              <span className="font-bold text-slate-800">{ticket.alias}</span>
                              <span className="font-bold text-slate-900">{config.currencySymbol}{ticket.total.toFixed(2)}</span>
                           </div>
                           <p className="text-xs text-slate-400">
                              {new Date(ticket.timestamp).toLocaleTimeString()} • {ticket.items.length} items
                           </p>
                        </button>
                     ))
                  )}
               </div>
            </div>
         </div>
      )}

      {/* Customer Modal Inline */}
      {showCustomerModal && (
         <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
             <div className="bg-white rounded-2xl p-6 w-full max-w-md h-[80vh] flex flex-col">
                <div className="flex justify-between items-center mb-4">
                   <h3 className="font-bold text-lg">Seleccionar Cliente</h3>
                   <button onClick={() => setShowCustomerModal(false)}><X size={20} /></button>
                </div>
                <input 
                   type="text" 
                   placeholder="Buscar cliente..." 
                   value={customerSearch}
                   onChange={(e) => setCustomerSearch(e.target.value)}
                   className="w-full p-3 bg-gray-50 rounded-xl mb-4 outline-none"
                   autoFocus
                />
                <div className="flex-1 overflow-y-auto space-y-2">
                   {filteredCustomers.map(c => (
                      <button 
                         key={c.id} 
                         onClick={() => { setSelectedCustomer(c); setShowCustomerModal(false); }}
                         className="w-full text-left p-3 hover:bg-gray-50 rounded-xl flex justify-between items-center"
                      >
                         <div>
                            <p className="font-bold text-gray-800">{c.name}</p>
                            <p className="text-xs text-gray-400">{c.phone || c.email || 'Sin contacto'}</p>
                         </div>
                         {c.currentDebt && c.currentDebt > 0 && (
                            <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full font-bold">
                               Deuda: {config.currencySymbol}{c.currentDebt.toFixed(2)}
                            </span>
                         )}
                      </button>
                   ))}
                   {filteredCustomers.length === 0 && (
                      <div className="text-center py-8">
                         <p className="text-gray-400 mb-4">No encontrado.</p>
                         <button 
                            onClick={() => {
                               const name = prompt("Nombre del nuevo cliente:");
                               if (name) onAddCustomer({ id: Math.random().toString(36).substr(2,9), name, createdAt: new Date().toISOString(), loyaltyPoints: 0 });
                            }}
                            className="text-blue-600 font-bold text-sm"
                         >
                            + Crear Nuevo
                         </button>
                      </div>
                   )}
                </div>
             </div>
         </div>
      )}

    </div>
  );
};

export default POSInterface;