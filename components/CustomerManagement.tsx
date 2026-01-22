
import React, { useState, useMemo } from 'react';
import {
   ArrowLeft, Users, UserPlus, Search, Phone, Mail, MapPin,
   Edit2, Trash2, Save, X, FileText, Award, Wallet as WalletIcon,
   TrendingUp, TrendingDown, AlertCircle, CreditCard, History, Check,
   MessageCircle, Star, Tag, ChevronRight, ShoppingBag,
   Globe, Calendar, Map, Navigation, CheckSquare, Clock, Landmark, ShieldCheck, Zap, Gift
} from 'lucide-react';
import { Customer, BusinessConfig, CustomerTransaction, CustomerAddress, NCFType, Wallet, LoyaltyCard } from '../types';

interface CustomerManagementProps {
   customers: Customer[];
   config: BusinessConfig;
   onAddCustomer: (customer: Customer) => void;
   onUpdateCustomer: (customer: Customer) => void;
   onDeleteCustomer: (id: string) => void;
   onSelect?: (customer: Customer) => void; // Prop para modo selección
   onClose: () => void;
}

const CustomerManagement: React.FC<CustomerManagementProps> = ({
   customers,
   config,
   onAddCustomer,
   onUpdateCustomer,
   onDeleteCustomer,
   onSelect,
   onClose
}) => {
   const [searchTerm, setSearchTerm] = useState('');
   const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
   const [isEditModalOpen, setIsEditModalOpen] = useState(false);
   const [activeProfileTab, setActiveProfileTab] = useState<'HISTORY' | 'WALLET' | 'LOYALTY'>('HISTORY');
   const [editModalTab, setEditModalTab] = useState<'GENERAL' | 'ADDRESSES'>('GENERAL');

   // Filter State
   const [filterTag, setFilterTag] = useState<string>('ALL');

   // Form State
   const [formData, setFormData] = useState<Partial<Customer>>({});

   // Address Form State (for adding/editing inside modal)
   const [isAddressFormOpen, setIsAddressFormOpen] = useState(false);
   const [editingAddress, setEditingAddress] = useState<Partial<CustomerAddress>>({});

   // Card Linking State
   const [isLinkCardOpen, setIsLinkCardOpen] = useState(false);
   const [cardLinkInput, setCardLinkInput] = useState('');
   const [cardLinkType, setCardLinkType] = useState<'LOYALTY' | 'GIFT'>('LOYALTY');

   const selectedCustomer = useMemo(() =>
      customers.find(c => c.id === selectedCustomerId),
      [customers, selectedCustomerId]);

   const filteredCustomers = useMemo(() => {
      return customers.filter(c => {
         const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.phone?.includes(searchTerm) ||
            c.taxId?.includes(searchTerm);
         const matchesTag = filterTag === 'ALL' || c.tags?.includes(filterTag);
         return matchesSearch && matchesTag;
      });
   }, [customers, searchTerm, filterTag]);

   // --- HANDLERS ---

   const handleCreateClick = () => {
      setSelectedCustomerId(null);
      setFormData({
         name: '',
         phone: '',
         email: '',
         taxId: '',
         address: '',
         notes: '',
         loyaltyPoints: 0,
         creditLimit: 0,
         currentDebt: 0,
         tags: [],
         tier: 'BRONZE',
         requiresFiscalInvoice: false,
         prefersEmail: false,
         isTaxExempt: false,
         applyChainedTax: false,
         addresses: [],
         defaultNcfType: 'B02'
      });
      setEditModalTab('GENERAL');
      setIsEditModalOpen(true);
   };

   const handleEditClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedCustomer) return;
      setFormData({
         ...selectedCustomer,
         addresses: selectedCustomer.addresses || [],
         defaultNcfType: selectedCustomer.defaultNcfType || (selectedCustomer.requiresFiscalInvoice ? 'B01' : 'B02')
      });
      setEditModalTab('GENERAL');
      setIsEditModalOpen(true);
   };

   const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!formData.name) return;

      if (formData.id) {
         onUpdateCustomer({ ...formData } as Customer);
      } else {
         const newCustomer: Customer = {
            ...formData as Customer,
            id: Math.random().toString(36).substr(2, 9),
            createdAt: new Date().toISOString(),
            totalSpent: 0,
            lastVisit: new Date().toISOString()
         };
         onAddCustomer(newCustomer);
         setSelectedCustomerId(newCustomer.id);
      }
      setIsEditModalOpen(false);
   };

   const handleDelete = (id: string) => {
      if (confirm('¿Eliminar cliente permanentemente?')) {
         onDeleteCustomer(id);
         if (selectedCustomerId === id) setSelectedCustomerId(null);
      }
   };

   // --- ADDRESS LOGIC ---
   const handleAddAddress = () => {
      setEditingAddress({
         id: Math.random().toString(36).substr(2, 9),
         type: 'SHIPPING',
         isDefault: false,
         country: 'RD',
         state: '',
         city: '',
         street: '',
         number: '',
         zipCode: ''
      });
      setIsAddressFormOpen(true);
   };

   const handleEditAddress = (addr: CustomerAddress) => {
      setEditingAddress({ ...addr });
      setIsAddressFormOpen(true);
   };

   const handleSaveAddress = () => {
      if (!editingAddress.street || !editingAddress.city) return alert("Calle y Ciudad son obligatorios");

      let updatedAddresses = [...(formData.addresses || [])];

      // Logic: If setting as default, unset others of same type
      if (editingAddress.isDefault) {
         updatedAddresses = updatedAddresses.map(a =>
            a.type === editingAddress.type ? { ...a, isDefault: false } : a
         );
      }

      const existingIndex = updatedAddresses.findIndex(a => a.id === editingAddress.id);
      if (existingIndex >= 0) {
         updatedAddresses[existingIndex] = editingAddress as CustomerAddress;
      } else {
         updatedAddresses.push(editingAddress as CustomerAddress);
      }

      setFormData({ ...formData, addresses: updatedAddresses });
      setIsAddressFormOpen(false);
   };

   const handleDeleteAddress = (id: string) => {
      if (confirm("¿Eliminar dirección?")) {
         setFormData({
            ...formData,
            addresses: formData.addresses?.filter(a => a.id !== id)
         });
      }
   };

   const handleWhatsApp = () => {
      if (!selectedCustomer?.phone) return alert("Sin teléfono registrado");
      window.open(`https://wa.me/${selectedCustomer.phone.replace(/[^0-9]/g, '')}`, '_blank');
   };

   const handleCreateWallet = () => {
      if (!selectedCustomer) return;
      const newWallet: Wallet = {
         id: `w_${Math.random().toString(36).substr(2, 9)}`,
         customerId: selectedCustomer.id,
         balance: 0,
         currency: config.currencies.find(c => c.isBase)?.code || 'DOP',
         status: 'ACTIVE',
         lastActivity: new Date().toISOString(),
         transactions: []
      };
      onUpdateCustomer({ ...selectedCustomer, wallet: newWallet });
   };

   const handleLinkCard = () => {
      if (!selectedCustomer) return;
      setIsLinkCardOpen(true);
      setCardLinkInput('');
      setCardLinkType('LOYALTY');
   };

   const handleUnlinkCard = (cardId: string) => {
      if (!selectedCustomer) return;
      if (confirm('¿Estás seguro de desvincular esta tarjeta?')) {
         const updatedCards = (selectedCustomer.cards || []).filter(c => c.id !== cardId);
         onUpdateCustomer({ ...selectedCustomer, cards: updatedCards });
      }
   };

   const confirmLinkCard = (number: string) => {
      if (!selectedCustomer || !number) return;

      const newCard: LoyaltyCard = {
         id: `lc_${Math.random().toString(36).substr(2, 9)}`,
         customerId: selectedCustomer.id,
         type: cardLinkType,
         cardNumber: number,
         pointsBalance: cardLinkType === 'LOYALTY' ? (selectedCustomer.loyaltyPoints || 0) : 0,
         status: 'ACTIVE',
         issuedAt: new Date().toISOString(),
         history: []
      };

      const currentCards = selectedCustomer.cards || [];
      onUpdateCustomer({ ...selectedCustomer, cards: [...currentCards, newCard] });
      setIsLinkCardOpen(false);
   };

   const generateDigitalCard = () => {
      // Generate a 12-digit number starting with 888
      const randomNum = Math.floor(Math.random() * 1000000000).toString().padStart(9, '0');
      confirmLinkCard(`888${randomNum}`);
   };

   const themeText = {
      blue: 'text-blue-600',
      orange: 'text-orange-600',
      gray: 'text-gray-800',
   }[config.themeColor] || 'text-indigo-600';

   const themeBg = {
      blue: 'bg-blue-600',
      orange: 'bg-orange-600',
      gray: 'bg-gray-800',
   }[config.themeColor] || 'bg-indigo-600';

   // --- UI COMPONENTS ---

   const BooleanField = ({ label, checked, onChange }: { label: string, checked: boolean, onChange: (v: boolean) => void }) => (
      <div
         onClick={() => onChange(!checked)}
         className={`p-3 rounded-xl border-2 cursor-pointer flex items-center justify-between transition-all ${checked ? 'bg-blue-50 border-blue-500' : 'bg-white border-gray-200 hover:border-gray-300'
            }`}
      >
         <span className={`text-sm font-bold ${checked ? 'text-blue-700' : 'text-gray-600'}`}>{label}</span>
         <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${checked ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'}`}>
            {checked && <Check size={14} className="text-white" />}
         </div>
      </div>
   );

   return (
      <div className="h-screen w-full bg-slate-50 flex flex-col overflow-hidden">

         {/* HEADER */}
         <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0 z-20">
            <div className="flex items-center gap-4">
               <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
                  <ArrowLeft size={24} />
               </button>
               <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Users className={themeText} /> Directorio de Clientes
               </h1>
            </div>
            <div className="flex gap-2">
               {onSelect && selectedCustomer && (
                  <button
                     onClick={() => onSelect(selectedCustomer)}
                     className="px-6 py-2.5 rounded-xl font-black bg-emerald-600 text-white shadow-lg animate-in zoom-in"
                  >
                     Asignar al Ticket
                  </button>
               )}
               <button
                  onClick={handleCreateClick}
                  className={`px-4 py-2.5 rounded-xl font-bold text-white shadow-lg shadow-blue-100 flex items-center gap-2 active:scale-95 transition-all ${themeBg}`}
               >
                  <UserPlus size={18} /> Nuevo Cliente
               </button>
            </div>
         </header>

         {/* MAIN CONTENT SPLIT */}
         <div className="flex-1 overflow-hidden flex">

            {/* LEFT: LIST & FILTERS */}
            <div className={`w-full md:w-[400px] bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ${selectedCustomerId ? 'hidden md:flex' : 'flex'}`}>

               {/* Search & Filters */}
               <div className="p-4 border-b border-gray-100 space-y-3">
                  <div className="relative">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                     <input
                        type="text"
                        placeholder="Buscar cliente..."
                        className="w-full pl-10 pr-4 py-2.5 bg-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 transition-all text-sm font-medium"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                     />
                  </div>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                     {['ALL', 'VIP', 'REGULAR', 'WHOLESALE'].map(tag => (
                        <button
                           key={tag}
                           onClick={() => setFilterTag(tag)}
                           className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-colors whitespace-nowrap ${filterTag === tag
                              ? 'bg-slate-800 text-white'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                              }`}
                        >
                           {tag === 'ALL' ? 'Todos' : tag}
                        </button>
                     ))}
                  </div>
               </div>

               {/* List */}
               <div className="flex-1 overflow-y-auto">
                  {filteredCustomers.map(customer => (
                     <div
                        key={customer.id}
                        onClick={() => setSelectedCustomerId(customer.id)}
                        className={`p-4 border-b border-gray-50 cursor-pointer transition-colors hover:bg-blue-50/50 flex items-center gap-3 ${selectedCustomerId === customer.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'
                           }`}
                     >
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center font-bold text-slate-600 text-sm">
                           {customer.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                           <h4 className={`font-bold text-sm truncate ${selectedCustomerId === customer.id ? 'text-blue-700' : 'text-gray-800'}`}>{customer.name}</h4>
                           <div className="flex items-center gap-2">
                              <p className="text-xs text-gray-400 truncate">{customer.phone || 'Sin contacto'}</p>
                              <span className="text-[9px] font-black text-blue-500 bg-blue-50 px-1 rounded">{customer.defaultNcfType || 'B02'}</span>
                           </div>
                        </div>
                        {(customer.currentDebt || 0) > 0 && (
                           <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                              -${customer.currentDebt}
                           </span>
                        )}
                     </div>
                  ))}
                  {filteredCustomers.length === 0 && (
                     <div className="p-8 text-center text-gray-400 text-sm">No se encontraron clientes.</div>
                  )}
               </div>
            </div>

            {/* RIGHT: PROFILE DETAILS */}
            <div className={`flex-1 bg-slate-50 overflow-hidden flex flex-col ${selectedCustomerId ? 'flex' : 'hidden md:flex'}`}>
               {selectedCustomer ? (
                  <div className="flex-1 flex flex-col h-full overflow-hidden">

                     {/* Mobile Back Button */}
                     <div className="md:hidden p-4 bg-white border-b border-gray-200 flex justify-between items-center">
                        <button onClick={() => setSelectedCustomerId(null)} className="flex items-center gap-2 text-sm font-bold text-gray-500">
                           <ArrowLeft size={16} /> Volver a la lista
                        </button>
                        {onSelect && (
                           <button onClick={() => onSelect(selectedCustomer)} className="bg-emerald-600 text-white px-4 py-1.5 rounded-lg text-xs font-black">Asignar</button>
                        )}
                     </div>

                     {/* Profile Header Card */}
                     <div className="p-6 md:p-8 overflow-y-auto">
                        <div className="bg-white rounded-3xl shadow-sm border border-gray-200 p-6 mb-6">
                           <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">

                              {/* Identity */}
                              <div className="flex items-center gap-5">
                                 <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-3xl font-black shadow-lg shadow-blue-200">
                                    {selectedCustomer.name.charAt(0)}
                                 </div>
                                 <div>
                                    <h2 className="text-2xl font-black text-gray-900 leading-tight">{selectedCustomer.name}</h2>
                                    <div className="flex items-center gap-2 mt-1">
                                       <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border ${selectedCustomer.tier === 'GOLD' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                                          selectedCustomer.tier === 'SILVER' ? 'bg-slate-100 text-slate-700 border-slate-200' :
                                             'bg-orange-50 text-orange-700 border-orange-200'
                                          }`}>
                                          {selectedCustomer.tier || 'BRONZE'} MEMBER
                                       </span>
                                       {selectedCustomer.tags?.map(tag => (
                                          <span key={tag} className="text-[10px] font-bold text-gray-400">#{tag}</span>
                                       ))}
                                    </div>
                                    <div className="flex flex-col gap-1 mt-2 text-sm text-gray-500">
                                       {selectedCustomer.phone && <span className="flex items-center gap-1"><Phone size={12} /> {selectedCustomer.phone}</span>}
                                       {selectedCustomer.email && <span className="flex items-center gap-1"><Mail size={12} /> {selectedCustomer.email}</span>}
                                    </div>
                                 </div>
                              </div>

                              {/* Actions */}
                              <div className="flex gap-2 w-full md:w-auto">
                                 {onSelect && (
                                    <button
                                       onClick={() => onSelect(selectedCustomer)}
                                       className="flex-1 md:flex-none py-2 px-6 bg-emerald-600 text-white rounded-xl font-black text-sm shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center justify-center gap-2"
                                    >
                                       <Check size={18} /> Asignar al Ticket
                                    </button>
                                 )}
                                 <button onClick={handleWhatsApp} className="flex-1 md:flex-none py-2 px-4 bg-green-50 text-green-600 rounded-xl font-bold text-sm hover:bg-green-100 transition-colors flex items-center justify-center gap-2">
                                    <MessageCircle size={18} /> <span className="hidden lg:inline">WhatsApp</span>
                                 </button>
                                 <button onClick={handleEditClick} className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-500 transition-colors">
                                    <Edit2 size={18} />
                                 </button>
                                 <button onClick={() => handleDelete(selectedCustomer.id)} className="p-2 border border-red-100 rounded-xl hover:bg-red-50 text-red-500 transition-colors">
                                    <Trash2 size={18} />
                                 </button>
                              </div>
                           </div>

                           {/* FISCAL PREVIEW SECTION (Destacada en la ficha) */}
                           <div className="mt-8 p-4 bg-blue-50/50 rounded-2xl border border-blue-100 grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="flex items-center gap-3">
                                 <div className="p-2 bg-blue-600 text-white rounded-xl shadow-md">
                                    <Landmark size={20} />
                                 </div>
                                 <div>
                                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest leading-none mb-1">Comprobante Fiscal</p>
                                    <p className="text-sm font-black text-blue-900">{selectedCustomer.defaultNcfType || 'Consumo (B02)'}</p>
                                 </div>
                              </div>
                              <div className="flex items-center gap-3 border-l md:border-l border-blue-100 md:pl-6">
                                 <div className="p-2 bg-white text-blue-600 rounded-xl border border-blue-200">
                                    <FileText size={20} />
                                 </div>
                                 <div>
                                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest leading-none mb-1">RNC / Cédula</p>
                                    <p className="text-sm font-mono font-bold text-blue-900">{selectedCustomer.taxId || 'No registrado'}</p>
                                 </div>
                              </div>
                           </div>

                           {/* Mini Stats */}
                           <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-gray-100">
                              <div>
                                 <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">Total Gastado</p>
                                 <p className="text-xl font-black text-gray-800">{config.currencySymbol}{selectedCustomer.totalSpent?.toLocaleString() || '0.00'}</p>
                              </div>
                              <div>
                                 <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">Última Visita</p>
                                 <p className="text-sm font-bold text-gray-700">{selectedCustomer.lastVisit ? new Date(selectedCustomer.lastVisit).toLocaleDateString() : 'N/A'}</p>
                              </div>
                              <div>
                                 <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">Deuda Actual</p>
                                 <p className={`text-xl font-black ${selectedCustomer.currentDebt ? 'text-red-500' : 'text-green-500'}`}>
                                    {config.currencySymbol}{selectedCustomer.currentDebt?.toLocaleString() || '0.00'}
                                 </p>
                              </div>
                              <div>
                                 <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">Puntos</p>
                                 <p className="text-xl font-black text-purple-600">{selectedCustomer.loyaltyPoints || 0}</p>
                              </div>
                           </div>
                        </div>

                        {/* TABS */}
                        <div className="flex gap-6 border-b border-gray-200 mb-6">
                           {[
                              { id: 'HISTORY', label: 'Historial', icon: History },
                              { id: 'WALLET', label: 'Billetera & Crédito', icon: WalletIcon },
                              { id: 'LOYALTY', label: 'Lealtad', icon: Star },
                           ].map(tab => (
                              <button
                                 key={tab.id}
                                 onClick={() => setActiveProfileTab(tab.id as any)}
                                 className={`pb-3 flex items-center gap-2 text-sm font-bold border-b-2 transition-all ${activeProfileTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
                                    }`}
                              >
                                 <tab.icon size={16} /> {tab.label}
                              </button>
                           ))}
                        </div>

                        {/* TAB CONTENT */}
                        <div className="animate-in fade-in">
                           {activeProfileTab === 'HISTORY' && (
                              <div className="space-y-3">
                                 {[1, 2, 3].map(i => (
                                    <div key={i} className="bg-white p-4 rounded-xl border border-gray-100 flex items-center justify-between hover:shadow-sm transition-shadow">
                                       <div className="flex items-center gap-4">
                                          <div className="p-2 bg-gray-50 rounded-lg text-gray-400">
                                             <ShoppingBag size={20} />
                                          </div>
                                          <div>
                                             <p className="font-bold text-gray-800 text-sm">Compra #{1000 + i}</p>
                                             <p className="text-xs text-gray-400">{new Date().toLocaleDateString()} • 3 items</p>
                                          </div>
                                       </div>
                                       <div className="text-right">
                                          <p className="font-bold text-gray-800">{config.currencySymbol}150.00</p>
                                          <span className="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-bold">PAGADO</span>
                                       </div>
                                    </div>
                                 ))}
                              </div>
                           )}

                           {activeProfileTab === 'WALLET' && (
                              <div className="space-y-6">
                                 {/* PREPAID WALLET SECTION */}
                                 <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-white relative overflow-hidden shadow-xl">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-10 -mt-10 blur-xl"></div>
                                    <div className="relative z-10 flex flex-col h-full justify-between min-h-[160px]">
                                       <div className="flex justify-between items-start">
                                          <div>
                                             <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Monedero Virtual</p>
                                             <h3 className="text-4xl font-mono mt-1 font-black tracking-tight">
                                                {config.currencySymbol}{selectedCustomer.wallet?.balance.toLocaleString() || '0.00'}
                                             </h3>
                                          </div>
                                          <WalletIcon size={32} className="text-emerald-400" />
                                       </div>

                                       <div className="mt-6">
                                          {selectedCustomer.wallet ? (
                                             <div className="flex gap-3">
                                                <button className="flex-1 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-bold backdrop-blur-sm transition-colors">
                                                   Recargar
                                                </button>
                                                <button className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-bold shadow-lg shadow-emerald-900/20 transition-colors">
                                                   Pagar
                                                </button>
                                             </div>
                                          ) : (
                                             <button
                                                onClick={handleCreateWallet}
                                                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold shadow-lg shadow-emerald-900/20 transition-colors flex items-center justify-center gap-2"
                                             >
                                                <WalletIcon size={18} /> Activar Wallet
                                             </button>
                                          )}
                                       </div>
                                    </div>
                                 </div>

                                 {/* CREDIT ACCOUNT SECTION */}
                                 <div className="bg-white rounded-2xl p-6 border border-gray-200">
                                    <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                                       <CreditCard size={18} className="text-blue-600" /> Cuenta de Crédito
                                    </h3>
                                    <div className="flex justify-between items-center mb-6 p-4 bg-red-50 rounded-xl border border-red-100">
                                       <span className="text-red-600 text-sm font-bold">Deuda Pendiente</span>
                                       <span className="text-2xl font-black text-red-600">{config.currencySymbol}{selectedCustomer.currentDebt?.toLocaleString() || '0.00'}</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4 text-xs text-gray-500 mb-6">
                                       <div>
                                          <p className="font-bold mb-1">Límite de Crédito</p>
                                          <p>{config.currencySymbol}{selectedCustomer.creditLimit?.toLocaleString() || '0.00'}</p>
                                       </div>
                                       <div>
                                          <p className="font-bold mb-1">Disponible</p>
                                          <p className="text-green-600 font-bold">
                                             {config.currencySymbol}{((selectedCustomer.creditLimit || 0) - (selectedCustomer.currentDebt || 0)).toLocaleString()}
                                          </p>
                                       </div>
                                    </div>
                                    <button className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold shadow-md hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center gap-2">
                                       Registrar Abono
                                    </button>
                                 </div>
                              </div>
                           )}

                           {activeProfileTab === 'LOYALTY' && (
                              <div className="space-y-6">
                                 <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-3xl p-8 text-white text-center relative overflow-hidden shadow-xl">
                                    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
                                    <Award size={48} className="mx-auto mb-4 text-yellow-300 drop-shadow-lg" />
                                    <h3 className="text-5xl font-black mb-1">{selectedCustomer.loyaltyPoints || 0}</h3>
                                    <p className="text-purple-200 font-bold uppercase tracking-widest text-sm mb-6">Puntos Disponibles</p>

                                    <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 max-w-sm mx-auto border border-white/20">
                                       <div className="flex justify-between text-xs font-bold mb-2">
                                          <span>Nivel Actual: {selectedCustomer.tier || 'BRONZE'}</span>
                                          <span>Siguiente: PLATINUM</span>
                                       </div>
                                       <div className="w-full bg-black/20 h-3 rounded-full overflow-hidden">
                                          <div className="bg-yellow-400 h-full shadow-[0_0_10px_rgba(250,204,21,0.5)]" style={{ width: '65%' }}></div>
                                       </div>
                                       <p className="text-xs mt-2 text-purple-200">Faltan 450 puntos para subir de nivel.</p>
                                    </div>
                                 </div>

                                 {/* LOYALTY CARD SECTION */}
                                 {/* LOYALTY CARD SECTION */}
                                 <div className="bg-white rounded-2xl p-6 border border-gray-200">
                                    <div className="flex justify-between items-center mb-4">
                                       <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                          <CreditCard size={18} className="text-purple-600" /> Mis Tarjetas
                                       </h3>
                                       <button
                                          onClick={handleLinkCard}
                                          className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
                                       >
                                          + Agregar Tarjeta
                                       </button>
                                    </div>

                                    <div className="space-y-3">
                                       {(selectedCustomer.cards || []).length > 0 ? (
                                          (selectedCustomer.cards || []).map(card => (
                                             <div key={card.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between group">
                                                <div className="flex items-center gap-3">
                                                   <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${card.type === 'GIFT' ? 'bg-pink-50 border-pink-200 text-pink-500' : 'bg-purple-50 border-purple-200 text-purple-500'}`}>
                                                      {card.type === 'GIFT' ? <Gift size={20} /> : <Award size={20} />}
                                                   </div>
                                                   <div>
                                                      <div className="flex items-center gap-2">
                                                         <p className="text-xs text-gray-400 font-bold uppercase">{card.type === 'GIFT' ? 'Tarjeta Regalo' : 'Fidelización'}</p>
                                                         <span className="text-[9px] font-bold bg-green-50 text-green-600 px-1.5 py-0.5 rounded border border-green-100 uppercase">Activa</span>
                                                      </div>
                                                      <p className="font-mono font-bold text-sm text-gray-700 tracking-wider">
                                                         {card.cardNumber}
                                                      </p>
                                                   </div>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                   {card.type === 'GIFT' && (
                                                      <div className="text-right">
                                                         <p className="text-[10px] text-gray-400 font-bold uppercase">Saldo</p>
                                                         <p className="font-bold text-gray-800">{config.currencySymbol}{card.pointsBalance.toFixed(2)}</p>
                                                      </div>
                                                   )}
                                                   <button onClick={() => handleUnlinkCard(card.id)} className="p-2 hover:bg-red-50 text-gray-300 hover:text-red-500 rounded-lg transition-colors">
                                                      <Trash2 size={16} />
                                                   </button>
                                                </div>
                                             </div>
                                          ))
                                       ) : (
                                          <div className="text-center py-6 text-gray-400 border-2 border-dashed border-gray-100 rounded-xl">
                                             <p className="text-sm">No hay tarjetas vinculadas.</p>
                                          </div>
                                       )}
                                    </div>
                                 </div>
                              </div>
                           )}
                        </div>

                     </div>
                  </div>
               ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                     <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                        <Users size={40} className="opacity-50" />
                     </div>
                     <p className="text-lg font-medium text-gray-500">Selecciona un cliente</p>
                     <p className="text-sm">o crea uno nuevo para ver sus detalles.</p>
                  </div>
               )}
            </div>

         </div>

         {/* EDIT MODAL */}
         {isEditModalOpen && (
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
               <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                  <div className="p-5 border-b border-gray-100 bg-gray-50">
                     <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-lg text-gray-800">{formData.id ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
                        <button onClick={() => setIsEditModalOpen(false)} className="p-2 hover:bg-gray-200 rounded-full text-gray-500"><X size={20} /></button>
                     </div>

                     <div className="flex gap-4">
                        <button
                           onClick={() => setEditModalTab('GENERAL')}
                           className={`pb-2 text-sm font-bold border-b-2 transition-all ${editModalTab === 'GENERAL' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                        >
                           General & Fiscal
                        </button>
                        <button
                           onClick={() => setEditModalTab('ADDRESSES')}
                           className={`pb-2 text-sm font-bold border-b-2 transition-all ${editModalTab === 'ADDRESSES' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                        >
                           Direcciones ({formData.addresses?.length || 0})
                        </button>
                     </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6">
                     {editModalTab === 'GENERAL' ? (
                        <form onSubmit={handleSubmit} className="space-y-6">
                           <div className="space-y-4">
                              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Información Básica</h4>
                              <div>
                                 <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre Completo *</label>
                                 <input required type="text" value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                 <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Teléfono</label>
                                    <input type="tel" value={formData.phone || ''} onChange={e => setFormData({ ...formData, phone: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                                 </div>
                                 <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
                                    <input type="email" value={formData.email || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                                 </div>
                              </div>

                              {/* FISCAL SECTION (Edición destacada) */}
                              <div className="p-6 bg-slate-50 rounded-[2rem] border-2 border-slate-200 space-y-4">
                                 <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                    <Landmark size={14} className="text-blue-500" /> Configuración de Facturación
                                 </h4>
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                       <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 ml-1">RNC / Cédula / Identificación</label>
                                       <input
                                          type="text"
                                          value={formData.taxId || ''}
                                          onChange={e => setFormData({ ...formData, taxId: e.target.value })}
                                          placeholder="101555559"
                                          className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-mono font-bold"
                                       />
                                    </div>
                                    <div>
                                       <label className="block text-[10px] font-black text-slate-500 uppercase mb-1 ml-1">Tipo de Comprobante (NCF)</label>
                                       <select
                                          value={formData.defaultNcfType || 'B02'}
                                          onChange={e => setFormData({ ...formData, defaultNcfType: e.target.value as NCFType })}
                                          className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-black text-sm text-blue-700"
                                       >
                                          <option value="B02">Factura de Consumo (B02)</option>
                                          <option value="B01">Crédito Fiscal (B01)</option>
                                          <option value="B14">Regímenes Especiales (B14)</option>
                                          <option value="B15">Gubernamental (B15)</option>
                                       </select>
                                    </div>
                                 </div>
                              </div>
                           </div>

                           <div className="pt-4 border-t border-gray-100 space-y-4">
                              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Datos Financieros</h4>
                              <div className="grid grid-cols-2 gap-4">
                                 <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Límite Crédito</label>
                                    <input type="number" value={formData.creditLimit || 0} onChange={e => setFormData({ ...formData, creditLimit: parseFloat(e.target.value) })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-mono" />
                                 </div>
                                 <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Días de Crédito</label>
                                    <input type="number" value={formData.creditDays || 0} onChange={e => setFormData({ ...formData, creditDays: parseInt(e.target.value) })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                                 </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                                 <BooleanField label="Enviar Doc. por Email" checked={formData.prefersEmail || false} onChange={v => setFormData({ ...formData, prefersEmail: v })} />
                                 <BooleanField label="Exento de Impuestos" checked={formData.isTaxExempt || false} onChange={v => setFormData({ ...formData, isTaxExempt: v })} />
                              </div>
                           </div>
                        </form>
                     ) : (
                        <div className="space-y-4">
                           <div className="flex justify-between items-center mb-4">
                              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Mis Direcciones</h4>
                              <button onClick={handleAddAddress} className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1">
                                 <MapPin size={12} /> Agregar Dirección
                              </button>
                           </div>

                           {formData.addresses && formData.addresses.length > 0 ? (
                              <div className="grid grid-cols-1 gap-3">
                                 {formData.addresses.map(addr => (
                                    <div key={addr.id} className="p-4 rounded-xl border border-gray-200 hover:border-blue-300 transition-all bg-white relative group">
                                       <div className="flex justify-between items-start mb-2">
                                          <div className="flex gap-2 items-center">
                                             <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${addr.type === 'BILLING' ? 'bg-indigo-50 text-indigo-600' : 'bg-orange-50 text-orange-600'}`}>
                                                {addr.type === 'BILLING' ? 'Facturación' : 'Envío'}
                                             </span>
                                             {addr.isDefault && (
                                                <span className="text-[10px] font-bold bg-green-50 text-green-600 px-2 py-0.5 rounded border border-green-100">
                                                   Principal
                                                </span>
                                             )}
                                          </div>
                                          <div className="flex gap-2">
                                             <button onClick={() => handleEditAddress(addr)} className="text-gray-400 hover:text-blue-500"><Edit2 size={16} /></button>
                                             <button onClick={() => handleDeleteAddress(addr.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={16} /></button>
                                          </div>
                                       </div>
                                       <p className="text-sm font-bold text-gray-800">{addr.street} #{addr.number}</p>
                                       <p className="text-xs text-gray-500">{addr.city}, {addr.state} ({addr.zipCode})</p>
                                       <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                                          <Globe size={10} /> {addr.country}
                                       </p>
                                    </div>
                                 ))}
                              </div>
                           ) : (
                              <div className="text-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-400">
                                 <MapPin size={32} className="mx-auto mb-2 opacity-50" />
                                 <p className="text-sm">No hay direcciones registradas.</p>
                              </div>
                           )}
                        </div>
                     )}
                  </div>

                  <div className="p-5 border-t border-gray-100 flex gap-3 bg-white">
                     <button onClick={() => setIsEditModalOpen(false)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl transition-colors">Cancelar</button>
                     <button onClick={handleSubmit} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-md hover:bg-blue-700 transition-colors">Guardar Cliente</button>
                  </div>
               </div>
            </div>
         )}

         {/* ADDRESS FORM SUB-MODAL */}
         {isAddressFormOpen && (
            <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
               <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                  <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                     <h3 className="font-bold text-gray-800">Detalle de Dirección</h3>
                     <button onClick={() => setIsAddressFormOpen(false)} className="p-1 hover:bg-gray-200 rounded-full text-gray-500"><X size={18} /></button>
                  </div>
                  <div className="p-6 overflow-y-auto space-y-4">
                     <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo</label>
                        <div className="flex gap-2">
                           {['BILLING', 'SHIPPING'].map(t => (
                              <button
                                 key={t}
                                 onClick={() => setEditingAddress({ ...editingAddress, type: t as any })}
                                 className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition-all ${editingAddress.type === t ? 'bg-blue-50 border-blue-500 text-blue-600' : 'bg-white border-gray-200 text-gray-400'}`}
                              >
                                 {t === 'BILLING' ? 'Facturación' : 'Envío'}
                              </button>
                           ))}
                        </div>
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Calle y Número</label>
                        <div className="flex gap-2">
                           <input type="text" placeholder="Calle Principal" value={editingAddress.street || ''} onChange={e => setEditingAddress({ ...editingAddress, street: e.target.value })} className="flex-[3] p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                           <input type="text" placeholder="#" value={editingAddress.number || ''} onChange={e => setEditingAddress({ ...editingAddress, number: e.target.value })} className="flex-1 p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                     </div>
                     <div className="grid grid-cols-2 gap-2">
                        <div>
                           <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Ciudad</label>
                           <input type="text" value={editingAddress.city || ''} onChange={e => setEditingAddress({ ...editingAddress, city: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Provincia</label>
                           <input type="text" value={editingAddress.state || ''} onChange={e => setEditingAddress({ ...editingAddress, state: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                     </div>
                     <div className="grid grid-cols-2 gap-2">
                        <div>
                           <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Código Postal</label>
                           <input type="text" value={editingAddress.zipCode || ''} onChange={e => setEditingAddress({ ...editingAddress, zipCode: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-gray-500 uppercase mb-1">País</label>
                           <input type="text" value={editingAddress.country || 'RD'} onChange={e => setEditingAddress({ ...editingAddress, country: e.target.value })} className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                     </div>
                     <BooleanField label="Dirección Principal" checked={editingAddress.isDefault || false} onChange={v => setEditingAddress({ ...editingAddress, isDefault: v })} />
                  </div>
                  <div className="p-4 bg-gray-50 border-t border-gray-100">
                     <button onClick={handleSaveAddress} className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold shadow-md hover:bg-blue-700 transition-colors">
                        Guardar Dirección
                     </button>
                  </div>
               </div>
            </div>
         )}

         {/* LINK CARD MODAL */}
         {isLinkCardOpen && (
            <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
               <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
                  <div className="p-6 text-center">
                     <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CreditCard size={32} />
                     </div>
                     <h3 className="text-xl font-black text-gray-800 mb-2">Vincular Tarjeta</h3>
                     <p className="text-sm text-gray-500 mb-6">Escanea una tarjeta física o genera una digital.</p>

                     <div className="space-y-4">
                        <div className="flex bg-gray-100 p-1 rounded-xl mb-4">
                           <button
                              onClick={() => setCardLinkType('LOYALTY')}
                              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${cardLinkType === 'LOYALTY' ? 'bg-white shadow text-purple-600' : 'text-gray-500'}`}
                           >
                              Fidelización
                           </button>
                           <button
                              onClick={() => setCardLinkType('GIFT')}
                              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${cardLinkType === 'GIFT' ? 'bg-white shadow text-pink-600' : 'text-gray-500'}`}
                           >
                              Regalo
                           </button>
                        </div>

                        <div>
                           <label className="block text-xs font-bold text-gray-400 uppercase mb-1 text-left">Número de Tarjeta</label>
                           <div className="flex gap-2">
                              <input
                                 type="text"
                                 autoFocus
                                 value={cardLinkInput}
                                 onChange={(e) => setCardLinkInput(e.target.value)}
                                 placeholder="Escanea o escribe..."
                                 className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono font-bold outline-none focus:ring-2 focus:ring-purple-500"
                                 onKeyDown={(e) => {
                                    if (e.key === 'Enter' && cardLinkInput) confirmLinkCard(cardLinkInput);
                                 }}
                              />
                              <button
                                 onClick={() => confirmLinkCard(cardLinkInput)}
                                 disabled={!cardLinkInput}
                                 className="p-3 bg-purple-600 text-white rounded-xl disabled:opacity-50"
                              >
                                 <Check size={20} />
                              </button>
                           </div>
                        </div>

                        <div className="relative flex py-2 items-center">
                           <div className="flex-grow border-t border-gray-100"></div>
                           <span className="flex-shrink-0 mx-4 text-xs text-gray-400 font-bold uppercase">O bien</span>
                           <div className="flex-grow border-t border-gray-100"></div>
                        </div>

                        <button
                           onClick={generateDigitalCard}
                           className="w-full py-3 bg-gray-50 text-gray-600 hover:bg-gray-100 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
                        >
                           <Zap size={18} className="text-yellow-500" /> Generar Tarjeta Digital
                        </button>
                     </div>
                  </div>
                  <div className="p-4 bg-gray-50 border-t border-gray-100 text-center">
                     <button onClick={() => setIsLinkCardOpen(false)} className="text-sm font-bold text-gray-400 hover:text-gray-600">Cancelar</button>
                  </div>
               </div>
            </div>
         )}

      </div>
   );
};

export default CustomerManagement;
