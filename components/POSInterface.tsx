
import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, Menu, User, Grid, List, Trash2, Plus, Minus, 
  LogOut, Settings, History, DollarSign, Users, X, 
  UserPlus, CheckCircle, CreditCard, ChevronRight, ShoppingCart,
  Save, FileText, Clock, AlertCircle, Edit2, MoreVertical
} from 'lucide-react';
import { 
  BusinessConfig, User as UserType, RoleDefinition, Customer, 
  Product, Transaction, CartItem, PaymentEntry, SavedTicket
} from '../types';
import PaymentModal from './PaymentModal';
import CartItemOptionsModal from './CartItemOptionsModal';
import TicketOptionsModal from './TicketOptionsModal';
import GlobalDiscountModal from './GlobalDiscountModal';

interface POSInterfaceProps {
  config: BusinessConfig;
  currentUser: UserType;
  roles: RoleDefinition[];
  customers: Customer[];
  products: Product[];
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenCustomers: () => void;
  onOpenHistory: () => void;
  onOpenFinance: () => void;
  onTransactionComplete: (txn: Transaction) => void;
  onAddCustomer: (c: Customer) => void;
  users?: UserType[]; // Added optional prop to receive all users
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
  onTransactionComplete,
  onAddCustomer,
  users = [] // Default empty array if not passed
}) => {
  // --- STATE ---
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  
  // Feature States (Initialized from LocalStorage for persistence)
  const [savedTickets, setSavedTickets] = useState<SavedTicket[]>(() => {
    try {
      const saved = localStorage.getItem('POS_SAVED_TICKETS');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error("Error loading saved tickets", e);
      return [];
    }
  });

  // Sync Saved Tickets to LocalStorage
  useEffect(() => {
    localStorage.setItem('POS_SAVED_TICKETS', JSON.stringify(savedTickets));
  }, [savedTickets]);
  
  // Modal States
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showSavedTicketsModal, setShowSavedTicketsModal] = useState(false);
  const [showSaveTicketNameModal, setShowSaveTicketNameModal] = useState(false);
  const [showTicketOptions, setShowTicketOptions] = useState(false); // NEW
  const [showDiscountModal, setShowDiscountModal] = useState(false); // NEW
  
  const [ticketName, setTicketName] = useState('');
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
  
  // Data States
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  
  // Discount State
  const [globalDiscount, setGlobalDiscount] = useState<{value: number, type: 'PERCENT' | 'FIXED'}>({ value: 0, type: 'PERCENT' });

  // --- DERIVED DATA ---
  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category));
    return ['ALL', ...Array.from(cats)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            p.barcode?.includes(searchQuery);
      const matchesCategory = selectedCategory === 'ALL' || p.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchQuery, selectedCategory]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers.slice(0, 10); // Show recent 10 if empty
    const lower = customerSearch.toLowerCase();
    return customers.filter(c => 
      c.name.toLowerCase().includes(lower) || 
      c.phone?.includes(lower) || 
      c.taxId?.includes(lower)
    );
  }, [customers, customerSearch]);

  // Totals Calculation with Discount
  const subtotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  
  const discountAmount = globalDiscount.type === 'PERCENT' 
      ? subtotal * (globalDiscount.value / 100) 
      : globalDiscount.value;
      
  const taxableAmount = Math.max(0, subtotal - discountAmount);
  const taxAmount = taxableAmount * config.taxRate;
  const finalTotal = taxableAmount + taxAmount;

  // --- HANDLERS ---

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existingIdx = prev.findIndex(item => item.id === product.id);
      if (existingIdx >= 0) {
        const newCart = [...prev];
        newCart[existingIdx] = { 
          ...newCart[existingIdx], 
          quantity: newCart[existingIdx].quantity + 1 
        };
        return newCart;
      }
      return [...prev, { ...product, cartId: Math.random().toString(36).substr(2, 9), quantity: 1 }];
    });
  };

  const updateQuantity = (cartId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.cartId === cartId) {
        return { ...item, quantity: Math.max(0, item.quantity + delta) };
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  const handleUpdateItem = (updatedItem: CartItem | null, cartIdToDelete?: string) => {
    // If cartIdToDelete is explicitly passed, use it. Otherwise rely on editingItem state.
    const targetId = cartIdToDelete || editingItem?.cartId;
    
    if (!targetId) return;

    if (updatedItem === null) {
      setCart(prev => prev.filter(i => i.cartId !== targetId));
    } else {
      setCart(prev => prev.map(i => i.cartId === targetId ? updatedItem : i));
    }
    setEditingItem(null);
  };

  const clearCart = () => {
    if(confirm('¿Vaciar carrito y reiniciar venta?')) {
      setCart([]);
      setSelectedCustomer(null);
      setGlobalDiscount({ value: 0, type: 'PERCENT' });
    }
  };

  // --- Save / Retrieve Logic ---
  
  const handleParkTicketClick = () => {
    if (cart.length === 0) return;
    setTicketName(`Orden ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`);
    setShowSaveTicketNameModal(true);
  };

  const confirmParkTicket = () => {
    if (!ticketName.trim()) return;

    const newTicket: SavedTicket = {
      id: Math.random().toString(36).substr(2, 9),
      alias: ticketName,
      timestamp: new Date().toISOString(),
      items: [...cart],
      customer: selectedCustomer,
      total: finalTotal,
      tableId: null,
      discount: globalDiscount // Save discount
    };

    setSavedTickets(prev => [newTicket, ...prev]);
    setCart([]);
    setSelectedCustomer(null);
    setGlobalDiscount({ value: 0, type: 'PERCENT' }); // Reset
    setShowSaveTicketNameModal(false);
  };

  const handleRestoreTicket = (ticket: SavedTicket) => {
    if (cart.length > 0) {
      if (!confirm("Hay una venta en curso. ¿Sobrescribir con la venta recuperada?")) return;
    }
    setCart(ticket.items);
    setSelectedCustomer(ticket.customer);
    // Restore discount if exists, else reset
    setGlobalDiscount(ticket.discount || { value: 0, type: 'PERCENT' });
    
    setSavedTickets(prev => prev.filter(t => t.id !== ticket.id));
    setShowSavedTicketsModal(false);
  };

  const handleDeleteSavedTicket = (id: string) => {
    if (confirm("¿Eliminar este ticket guardado permanentemente?")) {
      setSavedTickets(prev => prev.filter(t => t.id !== id));
    }
  };

  const handlePaymentConfirm = (payments: PaymentEntry[]) => {
    const transaction: Transaction = {
      id: `T-${Date.now().toString().substr(-6)}`,
      date: new Date().toISOString(),
      items: cart,
      total: finalTotal,
      payments: payments,
      userId: currentUser.id,
      userName: currentUser.name,
      customerId: selectedCustomer?.id,
      customerName: selectedCustomer?.name,
      status: 'COMPLETED',
      globalDiscount: globalDiscount.value > 0 ? globalDiscount : undefined
    };

    onTransactionComplete(transaction);
    setCart([]);
    setSelectedCustomer(null);
    setGlobalDiscount({ value: 0, type: 'PERCENT' });
    setShowPaymentModal(false);
    setIsMobileCartOpen(false);
  };

  const handleLogoutWithConfirm = () => {
    if (cart.length > 0) {
      if(!confirm("Hay productos en el carrito. ¿Seguro que desea salir?")) return;
    }
    onLogout();
  };

  const handleTicketOption = (actionId: string) => {
    setShowTicketOptions(false);
    switch(actionId) {
        case 'DISCOUNT': setShowDiscountModal(true); break;
        case 'ASSIGN_CUSTOMER': setShowCustomerModal(true); break;
        case 'CLEAR_CART': clearCart(); break;
        case 'PARK_SALE': handleParkTicketClick(); break;
    }
  };

  // --- UI PARTS ---

  return (
    <div className="flex flex-col h-screen bg-gray-100 overflow-hidden">
      
      {/* 1. TOP HEADER */}
      <header className="bg-white px-4 py-3 flex items-center justify-between border-b border-gray-200 shadow-sm z-20 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-lg shadow-indigo-200">
             CP
          </div>
          <div className="hidden md:block">
             <h1 className="font-bold text-gray-800 leading-tight">CLIC POS</h1>
             <div className="flex items-center gap-2 text-xs text-gray-500 font-medium">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                <span>{currentUser.name}</span>
                <span className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px] uppercase border border-gray-200">{currentUser.role}</span>
             </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="flex-1 max-w-xl mx-4">
           <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input 
                 type="text" 
                 placeholder="Buscar productos (Nombre, Código)..." 
                 className="w-full pl-10 pr-4 py-2.5 bg-gray-100 border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500 rounded-xl outline-none transition-all"
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 autoFocus
              />
           </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
           <button 
              onClick={() => setShowSavedTicketsModal(true)}
              className={`relative p-2.5 rounded-xl transition-colors mr-2 border group ${
                 savedTickets.length > 0 
                 ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border-indigo-200' 
                 : 'text-gray-400 bg-gray-50 border-transparent hover:bg-gray-100'
              }`}
              title="Recuperar Ticket"
           >
              <FileText size={20} />
              {savedTickets.length > 0 && (
                 <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white animate-in zoom-in">
                    {savedTickets.length}
                 </span>
              )}
           </button>

           <button onClick={onOpenHistory} className="p-2.5 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-indigo-600 transition-colors hidden sm:block" title="Historial">
              <History size={20} />
           </button>
           <button onClick={onOpenCustomers} className="p-2.5 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-indigo-600 transition-colors hidden sm:block" title="Clientes">
              <Users size={20} />
           </button>
           <button onClick={onOpenFinance} className="p-2.5 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-indigo-600 transition-colors hidden sm:block" title="Caja">
              <DollarSign size={20} />
           </button>
           <button onClick={onOpenSettings} className="p-2.5 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-indigo-600 transition-colors" title="Configuración">
              <Settings size={20} />
           </button>
           <div className="h-8 w-px bg-gray-200 mx-1"></div>
           <button onClick={handleLogoutWithConfirm} className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 font-bold text-sm transition-colors">
              <LogOut size={18} />
              <span className="hidden sm:inline">Salir</span>
           </button>
        </div>
      </header>

      {/* 2. MAIN CONTENT AREA */}
      <div className="flex-1 overflow-hidden flex relative">
         
         {/* LEFT: CATALOG */}
         <div className="flex-1 flex flex-col bg-gray-50 h-full overflow-hidden">
            <div className="p-4 overflow-x-auto no-scrollbar">
               <div className="flex gap-2">
                  {categories.map(cat => (
                     <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-5 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all shadow-sm ${
                           selectedCategory === cat 
                              ? 'bg-indigo-600 text-white shadow-indigo-300' 
                              : 'bg-white text-gray-600 hover:bg-gray-100'
                        }`}
                     >
                        {cat === 'ALL' ? 'Todos' : cat}
                     </button>
                  ))}
               </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 pt-0">
               <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-20">
                  {filteredProducts.map(product => (
                     <div 
                        key={product.id}
                        onClick={() => addToCart(product)}
                        className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 cursor-pointer hover:shadow-md hover:border-indigo-200 transition-all active:scale-95 group flex flex-col h-full"
                     >
                        <div className="aspect-square bg-gray-100 rounded-xl mb-3 overflow-hidden relative">
                           {product.image ? (
                              <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                           ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-300">
                                 <Grid size={32} />
                              </div>
                           )}
                           <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors"></div>
                           <div className="absolute bottom-2 right-2 bg-white rounded-full p-1.5 shadow-md opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition-all">
                              <Plus size={16} className="text-indigo-600" />
                           </div>
                        </div>
                        <h3 className="font-bold text-gray-800 text-sm leading-tight mb-1 line-clamp-2 flex-1">{product.name}</h3>
                        <div className="flex justify-between items-center mt-2">
                           <span className="font-black text-indigo-600">{config.currencySymbol}{product.price.toFixed(2)}</span>
                           {product.stock !== undefined && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${product.stock > 5 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                 {product.stock}
                              </span>
                           )}
                        </div>
                     </div>
                  ))}
               </div>
            </div>
         </div>

         {/* RIGHT: CART (Collapsible on Mobile) */}
         <div className={`
            absolute inset-0 bg-white z-30 flex flex-col transition-transform duration-300 transform 
            md:relative md:translate-x-0 md:w-[400px] md:border-l border-gray-200 shadow-xl md:shadow-none
            ${isMobileCartOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}
         `}>
            {/* Mobile Header for Cart */}
            <div className="md:hidden p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
               <h2 className="font-bold text-lg flex items-center gap-2"><ShoppingCart /> Carrito Actual</h2>
               <button onClick={() => setIsMobileCartOpen(false)} className="p-2 bg-white rounded-full shadow-sm"><X size={20}/></button>
            </div>

            {/* Customer Selector */}
            <div className="p-4 border-b border-gray-100">
               {selectedCustomer ? (
                  <div className="flex items-center justify-between p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                     <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-indigo-200 rounded-full flex items-center justify-center text-indigo-700 font-bold">
                           {selectedCustomer.name.charAt(0)}
                        </div>
                        <div>
                           <p className="font-bold text-indigo-900 text-sm leading-tight">{selectedCustomer.name}</p>
                           <p className="text-[10px] text-indigo-600">Cliente Asignado</p>
                        </div>
                     </div>
                     <button onClick={() => setSelectedCustomer(null)} className="p-1.5 text-indigo-400 hover:text-red-500 transition-colors">
                        <X size={16} />
                     </button>
                  </div>
               ) : (
                  <button 
                     onClick={() => setShowCustomerModal(true)}
                     className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 font-bold text-sm flex items-center justify-center gap-2 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
                  >
                     <UserPlus size={18} /> Asignar Cliente
                  </button>
               )}
            </div>

            {/* Cart Items List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
               {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60">
                     <ShoppingCart size={48} className="mb-2" />
                     <p className="font-medium">El carrito está vacío</p>
                  </div>
               ) : (
                  cart.map((item) => (
                     <div 
                        key={item.cartId} 
                        onClick={() => setEditingItem(item)}
                        className="flex gap-3 p-3 bg-white border border-gray-100 rounded-2xl shadow-sm animate-in slide-in-from-left-2 cursor-pointer hover:border-blue-300 hover:shadow-md transition-all group"
                     >
                        <div className="flex flex-col items-center justify-between bg-gray-50 rounded-xl w-10 py-1" onClick={(e) => e.stopPropagation()}>
                           <button onClick={() => updateQuantity(item.cartId, 1)} className="p-1 text-gray-600 hover:text-green-600"><Plus size={14} /></button>
                           <span className="font-bold text-sm">{item.quantity}</span>
                           <button onClick={() => updateQuantity(item.cartId, -1)} className="p-1 text-gray-600 hover:text-red-600"><Minus size={14} /></button>
                        </div>
                        
                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                           <div className="flex justify-between items-start">
                              <h4 className="font-bold text-gray-800 text-sm truncate group-hover:text-blue-600 transition-colors flex-1">{item.name}</h4>
                              <Edit2 size={12} className="text-gray-300 opacity-0 group-hover:opacity-100 ml-1" />
                           </div>
                           <div className="flex items-center gap-2">
                              <p className="text-xs text-gray-500">{config.currencySymbol}{item.price.toFixed(2)}</p>
                              {item.originalPrice && item.price < item.originalPrice && (
                                 <span className="text-[10px] bg-green-100 text-green-700 px-1 rounded font-bold">Desc.</span>
                              )}
                           </div>
                           {item.note && <p className="text-[10px] text-orange-500 italic truncate mt-0.5">"{item.note}"</p>}
                        </div>

                        <div className="text-right flex flex-col justify-center">
                           <span className="font-bold text-gray-900">{config.currencySymbol}{(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                     </div>
                  ))
               )}
            </div>

            {/* Totals & Action */}
            <div className="p-5 bg-white border-t border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] z-10">
               <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-gray-500 text-sm">
                     <span>Subtotal</span>
                     <span>{config.currencySymbol}{subtotal.toFixed(2)}</span>
                  </div>
                  
                  {discountAmount > 0 && (
                     <div className="flex justify-between text-red-500 text-sm font-bold animate-in slide-in-from-right-5">
                        <span>Descuento {globalDiscount.type === 'PERCENT' ? `(${globalDiscount.value}%)` : ''}</span>
                        <span>-{config.currencySymbol}{discountAmount.toFixed(2)}</span>
                     </div>
                  )}

                  <div className="flex justify-between text-gray-500 text-sm">
                     <span>Impuestos ({(config.taxRate * 100).toFixed(0)}%)</span>
                     <span>{config.currencySymbol}{taxAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xl font-black text-gray-900 pt-2 border-t border-gray-100">
                     <span>Total</span>
                     <span>{config.currencySymbol}{finalTotal.toFixed(2)}</span>
                  </div>
               </div>

               <div className="grid grid-cols-4 gap-2">
                  <button 
                     onClick={() => setShowTicketOptions(true)} 
                     disabled={cart.length === 0}
                     className="col-span-1 bg-gray-100 text-gray-600 rounded-xl flex items-center justify-center hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                     title="Opciones"
                  >
                     <MoreVertical size={20} />
                  </button>
                  <button 
                     onClick={handleParkTicketClick}
                     disabled={cart.length === 0}
                     className="col-span-1 bg-orange-50 text-orange-500 rounded-xl flex items-center justify-center hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                     title="Guardar / Aparcar"
                  >
                     <Save size={20} />
                  </button>
                  <button 
                     onClick={() => setShowPaymentModal(true)}
                     disabled={cart.length === 0}
                     className="col-span-2 py-4 bg-indigo-600 text-white rounded-xl font-bold text-lg shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                     <span>Cobrar</span>
                     <ChevronRight size={20} />
                  </button>
               </div>
            </div>
         </div>

      </div>

      {/* MOBILE FLOATING ACTION BUTTON */}
      {!isMobileCartOpen && cart.length > 0 && (
         <div className="md:hidden fixed bottom-6 left-6 right-6 z-40 animate-in slide-in-from-bottom-10 fade-in">
            <button 
               onClick={() => setIsMobileCartOpen(true)}
               className="w-full bg-slate-900 text-white p-4 rounded-2xl shadow-xl flex items-center justify-between active:scale-95 transition-transform"
            >
               <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center font-bold">
                     {cart.reduce((acc, i) => acc + i.quantity, 0)}
                  </div>
                  <span className="font-bold text-lg">Ver Ticket</span>
               </div>
               <span className="font-mono text-xl font-bold">{config.currencySymbol}{finalTotal.toFixed(2)}</span>
            </button>
         </div>
      )}

      {/* --- MODALS --- */}
      
      {showCustomerModal && (
         <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
               <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                  <h3 className="text-lg font-bold text-slate-800">Seleccionar Cliente</h3>
                  <button onClick={() => setShowCustomerModal(false)} className="p-1 hover:bg-gray-200 rounded-full text-slate-500"><X size={20} /></button>
               </div>
               <div className="p-4 border-b border-gray-100 space-y-3">
                  <div className="relative">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                     <input 
                        type="text" 
                        autoFocus
                        placeholder="Buscar cliente..." 
                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                     />
                  </div>
                  <button 
                     onClick={() => {
                        const name = prompt("Nombre del nuevo cliente:");
                        if(name) {
                           const newC = { id: Date.now().toString(), name, createdAt: new Date().toISOString() };
                           onAddCustomer(newC);
                           setSelectedCustomer(newC);
                           setShowCustomerModal(false);
                        }
                     }}
                     className="w-full py-2 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-bold flex items-center justify-center gap-2 hover:bg-indigo-100 transition-colors"
                  >
                     <UserPlus size={16} /> Crear Cliente Rápido
                  </button>
               </div>
               <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {selectedCustomer && (
                     <div className="mb-2 p-3 bg-indigo-50 border border-indigo-100 rounded-xl flex justify-between items-center">
                        <div className="flex items-center gap-3">
                           <div className="w-8 h-8 bg-indigo-200 rounded-full flex items-center justify-center text-indigo-700 font-bold">{selectedCustomer.name.charAt(0)}</div>
                           <div><p className="text-sm font-bold text-indigo-900">{selectedCustomer.name}</p><p className="text-[10px] text-indigo-600">Cliente Asignado</p></div>
                        </div>
                        <button onClick={() => setSelectedCustomer(null)} className="px-3 py-1 bg-white text-xs text-red-500 font-bold rounded-lg border border-red-100 hover:bg-red-50">Desvincular</button>
                     </div>
                  )}
                  {filteredCustomers.map(c => (
                     <div key={c.id} onClick={() => { setSelectedCustomer(c); setShowCustomerModal(false); setCustomerSearch(''); }} className={`p-3 rounded-xl cursor-pointer transition-all flex justify-between items-center group ${selectedCustomer?.id === c.id ? 'bg-gray-100' : 'hover:bg-gray-50'}`}>
                        <div className="flex items-center gap-3"><div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-gray-500 font-bold text-xs">{c.name.charAt(0)}</div><div><p className="font-bold text-slate-700 text-sm">{c.name}</p><p className="text-xs text-slate-400">{c.phone || c.email || 'Sin datos'}</p></div></div>
                        {selectedCustomer?.id === c.id && <CheckCircle size={16} className="text-green-500" />}
                     </div>
                  ))}
               </div>
            </div>
         </div>
      )}

      {showSaveTicketNameModal && (
         <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 animate-in zoom-in-95">
               <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <Save className="text-orange-500" size={20} />
                  Guardar Ticket
               </h3>
               <p className="text-sm text-gray-500 mb-4">
                  Asigna un nombre para identificar esta venta pendiente.
               </p>
               <input 
                  autoFocus
                  type="text" 
                  value={ticketName}
                  onChange={(e) => setTicketName(e.target.value)}
                  placeholder="Ej. Mesa 5, Pedido Juan..."
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl mb-6 focus:ring-2 focus:ring-orange-500 outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && confirmParkTicket()}
               />
               <div className="flex gap-3">
                  <button onClick={() => setShowSaveTicketNameModal(false)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl">Cancelar</button>
                  <button onClick={confirmParkTicket} disabled={!ticketName.trim()} className="flex-1 py-3 bg-orange-500 text-white font-bold rounded-xl shadow-md hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed">Guardar</button>
               </div>
            </div>
         </div>
      )}

      {showSavedTicketsModal && (
         <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
               <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                  <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><FileText size={20} className="text-indigo-600" /> Tickets Guardados</h3>
                  <button onClick={() => setShowSavedTicketsModal(false)} className="p-1 hover:bg-gray-200 rounded-full text-slate-500"><X size={20} /></button>
               </div>
               <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {savedTickets.length === 0 ? (
                     <div className="text-center py-10 text-gray-400 opacity-60"><AlertCircle size={48} className="mx-auto mb-2" /><p className="font-bold">No hay tickets guardados.</p></div>
                  ) : (
                     savedTickets.map(ticket => (
                        <div key={ticket.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all">
                           <div className="flex justify-between items-start mb-2">
                              <div>
                                 <h4 className="font-bold text-gray-800">{ticket.alias}</h4>
                                 <div className="flex items-center gap-2 text-xs text-gray-500 mt-1"><Clock size={12} /><span>{new Date(ticket.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>{ticket.customer && <span>• {ticket.customer.name}</span>}</div>
                              </div>
                              <span className="font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg text-sm">{config.currencySymbol}{ticket.total.toFixed(2)}</span>
                           </div>
                           <div className="flex gap-2 mt-4">
                              <button onClick={() => handleDeleteSavedTicket(ticket.id)} className="p-2 bg-red-50 text-red-500 rounded-xl hover:bg-red-100 transition-colors"><Trash2 size={18} /></button>
                              <button onClick={() => handleRestoreTicket(ticket)} className="flex-1 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2">Recuperar <ChevronRight size={16} /></button>
                           </div>
                        </div>
                     ))
                  )}
               </div>
            </div>
         </div>
      )}

      {editingItem && (
         <CartItemOptionsModal
            item={editingItem}
            config={config}
            onClose={() => setEditingItem(null)}
            onUpdate={handleUpdateItem}
            canApplyDiscount={roles.find(r => r.id === currentUser.role)?.permissions.includes('CAN_APPLY_DISCOUNT') || false}
            canVoidItem={roles.find(r => r.id === currentUser.role)?.permissions.includes('CAN_VOID_ITEM') || false}
            users={users} // Pass users for salesperson selection
         />
      )}

      {showTicketOptions && (
         <TicketOptionsModal 
            onClose={() => setShowTicketOptions(false)}
            onAction={handleTicketOption}
         />
      )}

      {showDiscountModal && (
         <GlobalDiscountModal
            currentSubtotal={subtotal}
            currencySymbol={config.currencySymbol}
            initialValue={globalDiscount.value.toString()}
            initialType={globalDiscount.type}
            onClose={() => setShowDiscountModal(false)}
            onConfirm={(val, type) => {
                setGlobalDiscount({ value: parseFloat(val) || 0, type });
                setShowDiscountModal(false);
            }}
            themeColor={config.themeColor}
         />
      )}

      {showPaymentModal && (
         <PaymentModal 
            total={finalTotal} 
            currencySymbol={config.currencySymbol}
            onClose={() => setShowPaymentModal(false)}
            onConfirm={handlePaymentConfirm}
            themeColor={config.themeColor}
         />
      )}

    </div>
  );
};

export default POSInterface;
