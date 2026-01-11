import React, { useState, useMemo } from 'react';
import { 
  ArrowLeft, Search, ChevronRight, 
  Store, Users, Package, Printer, CreditCard, 
  History, ToggleLeft, ToggleRight, Building2, UserPlus, Edit2, Trash2, CheckSquare, Square, User as UserIcon, FileText, PlusCircle, Receipt, Truck, Tag, Ticket
} from 'lucide-react';
import { BusinessConfig, User, RoleDefinition, Transaction, VerticalType, SubVertical, Product } from '../types';
import { AVAILABLE_PERMISSIONS, getInitialConfig, RETAIL_PRODUCTS, FOOD_PRODUCTS } from '../constants';
import ProductForm from './ProductForm';
import HardwareSettings from './HardwareSettings';
import ReceiptDesigner from './ReceiptDesigner';
import PromotionBuilder from './PromotionBuilder';

interface SettingsProps {
  config: BusinessConfig;
  users: User[];
  roles: RoleDefinition[];
  transactions: Transaction[];
  onUpdateConfig: (newConfig: BusinessConfig, shouldRestart?: boolean) => void;
  onUpdateUsers: (newUsers: User[]) => void;
  onUpdateRoles: (newRoles: RoleDefinition[]) => void;
  onOpenZReport: () => void;
  onOpenSupplyChain: () => void;
  onClose: () => void;
}

// --- CONFIGURATION GROUPS ---
type SettingsSection = 'HOME' | 'CATALOG' | 'STORE' | 'TEAM' | 'HARDWARE' | 'PAYMENTS' | 'HISTORY' | 'TICKET' | 'SUPPLY' | 'PROMOS';

interface SettingModule {
  id: SettingsSection;
  title: string;
  description: string;
  icon: React.ElementType;
  color: string; // Tailwind bg color class prefix (e.g., 'bg-blue-500')
  keywords: string[];
}

const MODULES: SettingModule[] = [
  {
    id: 'CATALOG',
    title: 'Catálogo',
    description: 'Productos, Stock, Categorías',
    icon: Package,
    color: 'bg-blue-500',
    keywords: ['productos', 'inventario', 'stock', 'precios', 'sku', 'código', 'tallas']
  },
  {
    id: 'PROMOS',
    title: 'Promociones',
    description: 'Ofertas, Descuentos, 2x1',
    icon: Ticket,
    color: 'bg-pink-600',
    keywords: ['ofertas', 'reglas', 'precios', 'hora feliz', 'descuento']
  },
  {
    id: 'SUPPLY',
    title: 'Abastecimiento',
    description: 'Pedidos, Proveedores, Recepción',
    icon: Truck,
    color: 'bg-teal-600',
    keywords: ['compras', 'ordenes', 'proveedores', 'stock', 'recepcion']
  },
  {
    id: 'STORE',
    title: 'Tienda',
    description: 'Datos Fiscales, Vertical',
    icon: Store,
    color: 'bg-indigo-500',
    keywords: ['empresa', 'rnc', 'tax', 'impuestos', 'dirección', 'telefono', 'email']
  },
  {
    id: 'TICKET',
    title: 'Diseño de Ticket',
    description: 'Logo, Cabecera, Mensajes',
    icon: Receipt,
    color: 'bg-purple-500',
    keywords: ['recibo', 'factura', 'logo', 'diseño', 'papel', 'qr']
  },
  {
    id: 'TEAM',
    title: 'Equipo',
    description: 'Usuarios, Roles, Permisos',
    icon: Users,
    color: 'bg-orange-500',
    keywords: ['usuarios', 'empleados', 'pin', 'clave', 'acceso', 'roles', 'permisos', 'seguridad', 'admin']
  },
  {
    id: 'HARDWARE',
    title: 'Hardware & Sistema',
    description: 'Impresoras, Módulos, Pantalla',
    icon: Printer,
    color: 'bg-slate-600',
    keywords: ['impresora', 'cajón', 'scanner', 'mesas', 'cocina', 'tablet', 'tema', 'oscuro']
  },
  {
    id: 'PAYMENTS',
    title: 'Pagos',
    description: 'Métodos, Propinas, Divisas',
    icon: CreditCard,
    color: 'bg-emerald-500',
    keywords: ['tarjeta', 'efectivo', 'qr', 'divisa', 'propina', 'descuento', 'moneda']
  },
  {
    id: 'HISTORY',
    title: 'Historial',
    description: 'Transacciones y Cierres',
    icon: History,
    color: 'bg-cyan-600',
    keywords: ['ventas', 'reportes', 'cierre', 'z', 'ayer', 'transacciones']
  }
];

const SUB_VERTICAL_OPTIONS: Record<string, { value: SubVertical; label: string }[]> = {
  RETAIL_GROUP: [
    { value: SubVertical.SUPERMARKET, label: 'Supermercado / Colmado' },
    { value: SubVertical.CLOTHING, label: 'Tienda de Ropa / Boutique' },
    { value: SubVertical.PHARMACY, label: 'Farmacia' },
    { value: SubVertical.SERVICES, label: 'Servicios Profesionales' },
  ],
  RESTAURANT_GROUP: [
    { value: SubVertical.RESTAURANT, label: 'Restaurante (Mesas)' },
    { value: SubVertical.FAST_FOOD, label: 'Comida Rápida' },
    { value: SubVertical.BAR, label: 'Bar / Discoteca' },
  ]
};

const Settings: React.FC<SettingsProps> = ({ config, users, roles, transactions, onUpdateConfig, onUpdateUsers, onUpdateRoles, onOpenZReport, onOpenSupplyChain, onClose }) => {
  const [currentView, setCurrentView] = useState<SettingsSection>('HOME');
  const [searchQuery, setSearchQuery] = useState('');

  // Sub-states for specific modals
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [userFormData, setUserFormData] = useState<Partial<User>>({ name: '', pin: '', role: 'CASHIER', photo: '' });
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [roleFormData, setRoleFormData] = useState<Partial<RoleDefinition>>({ name: '', permissions: [] });

  // Product State
  const initialProducts = config.vertical === VerticalType.RESTAURANT ? FOOD_PRODUCTS : RETAIL_PRODUCTS;
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // --- SEARCH LOGIC ---
  const filteredModules = useMemo(() => {
    if (!searchQuery) return MODULES;
    const lowerQuery = searchQuery.toLowerCase();
    return MODULES.filter(m => 
      m.title.toLowerCase().includes(lowerQuery) || 
      m.description.toLowerCase().includes(lowerQuery) ||
      m.keywords.some(k => k.includes(lowerQuery))
    );
  }, [searchQuery]);

  // --- HANDLERS ---
  const handleBack = () => {
    if (currentView !== 'HOME') {
      setCurrentView('HOME');
      setSearchQuery('');
    } else {
      onClose();
    }
  };

  const toggleFeature = (key: keyof typeof config.features) => {
    onUpdateConfig({
      ...config,
      features: {
        ...config.features,
        [key]: !config.features[key]
      }
    });
  };

  /* --- User Logic Handlers --- */
  const handleEditUser = (user: User) => { setEditingUser(user); setUserFormData(user); setIsUserModalOpen(true); };
  const handleCreateUser = () => { setEditingUser(null); setUserFormData({ name: '', pin: '', role: roles[0]?.id || 'CASHIER', photo: '' }); setIsUserModalOpen(true); };
  const handleDeleteUser = (id: string) => {
     if(confirm('¿Eliminar usuario?')) onUpdateUsers(users.filter(u => u.id !== id));
  };
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setUserFormData(prev => ({ ...prev, photo: reader.result as string }));
      reader.readAsDataURL(file);
    }
  };
  const handleSaveUser = () => {
    if (!userFormData.name || !userFormData.pin || !userFormData.role) return;
    if (editingUser) {
      onUpdateUsers(users.map(u => u.id === editingUser.id ? { ...u, ...userFormData } as User : u));
    } else {
      onUpdateUsers([...users, { ...userFormData, id: Math.random().toString(36).substr(2, 9) } as User]);
    }
    setIsUserModalOpen(false);
  };

  /* --- Role Logic Handlers --- */
  const handleEditRole = (role: RoleDefinition) => { setEditingRole(role); setRoleFormData(role); setIsRoleModalOpen(true); };
  const handleCreateRole = () => { setEditingRole(null); setRoleFormData({ name: '', permissions: [] }); setIsRoleModalOpen(true); };
  const handleDeleteRole = (id: string) => { if(confirm('¿Eliminar rol?')) onUpdateRoles(roles.filter(r => r.id !== id)); };
  const togglePermission = (key: string) => {
    setRoleFormData(prev => {
      const perms = prev.permissions || [];
      return perms.includes(key) ? { ...prev, permissions: perms.filter(p => p !== key) } : { ...prev, permissions: [...perms, key] };
    });
  };
  const handleSaveRole = () => {
    if (!roleFormData.name) return;
    if (editingRole) {
       onUpdateRoles(roles.map(r => r.id === editingRole.id ? { ...r, ...roleFormData } as RoleDefinition : r));
    } else {
      onUpdateRoles([...roles, { ...roleFormData, id: Math.random().toString(36).substr(2, 9), isSystem: false } as RoleDefinition]);
    }
    setIsRoleModalOpen(false);
  };

  /* --- Product Logic Handlers --- */
  const handleEditProduct = (p: Product) => { setEditingProduct(p); setIsProductModalOpen(true); };
  const handleCreateProduct = () => { setEditingProduct(null); setIsProductModalOpen(true); };
  const handleSaveProduct = (p: Product) => {
     if (editingProduct) {
        setProducts(prev => prev.map(prod => prod.id === p.id ? p : prod));
     } else {
        setProducts(prev => [...prev, p]);
     }
     setIsProductModalOpen(false);
  };
  const handleDeleteProduct = (id: string) => {
     if(confirm("¿Eliminar producto del catálogo?")) setProducts(prev => prev.filter(p => p.id !== id));
  };

  /* --- Company Logic Handlers --- */
  const handleUpdateCompany = (field: keyof typeof config.companyInfo, value: string) => {
    onUpdateConfig({ ...config, companyInfo: { ...config.companyInfo, [field]: value } });
  };
  const handleUpdateVertical = (subVertical: string) => {
    if(!confirm("Cambiar el tipo de negocio reiniciará el sistema. ¿Continuar?")) return;
    const newSub = subVertical as SubVertical;
    const defaults = getInitialConfig(newSub);
    onUpdateConfig({ ...config, subVertical: newSub, vertical: defaults.vertical, features: defaults.features, themeColor: defaults.themeColor, taxRate: defaults.taxRate }, true);
  };

  // --- RENDER CONTENT BASED ON VIEW ---
  const renderContent = () => {
    switch(currentView) {
      case 'HOME':
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
             {filteredModules.map((mod) => (
                <button
                   key={mod.id}
                   onClick={() => {
                      if (mod.id === 'SUPPLY') {
                         onOpenSupplyChain();
                      } else {
                         setCurrentView(mod.id);
                      }
                   }}
                   className="group bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-xl hover:border-blue-200 transition-all text-left flex items-start gap-4 relative overflow-hidden"
                >
                   <div className={`p-4 rounded-xl text-white shadow-lg ${mod.color} group-hover:scale-110 transition-transform`}>
                      <mod.icon size={28} />
                   </div>
                   <div className="flex-1 z-10">
                      <h3 className="text-lg font-bold text-gray-800 mb-1 group-hover:text-blue-600 transition-colors">{mod.title}</h3>
                      <p className="text-sm text-gray-500 font-medium leading-relaxed">{mod.description}</p>
                   </div>
                   <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity transform translate-x-4 group-hover:translate-x-0">
                      <ChevronRight className="text-blue-400" />
                   </div>
                </button>
             ))}
          </div>
        );

      case 'TEAM':
        return (
          <div className="animate-in slide-in-from-right-10 duration-300 space-y-8 max-w-5xl mx-auto">
             <section>
                <div className="flex justify-between items-center mb-4">
                   <h2 className="text-xl font-bold text-gray-800">Usuarios</h2>
                   <button onClick={handleCreateUser} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 shadow-sm">
                      <UserPlus size={18} /> Nuevo
                   </button>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                   <div className="divide-y divide-gray-100">
                      {users.map(user => (
                         <div key={user.id} className="p-4 flex items-center justify-between hover:bg-orange-50/50 transition-colors">
                            <div className="flex items-center gap-3">
                               {user.photo ? (
                                  <img src={user.photo} alt={user.name} className="w-10 h-10 rounded-full object-cover" />
                               ) : (
                                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500"><UserIcon size={20} /></div>
                               )}
                               <div>
                                  <p className="font-bold text-gray-800">{user.name}</p>
                                  <span className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-500">{roles.find(r => r.id === user.role)?.name}</span>
                               </div>
                            </div>
                            <div className="flex gap-2">
                               <button onClick={() => handleEditUser(user)} className="p-2 text-gray-400 hover:text-orange-500"><Edit2 size={18} /></button>
                               <button onClick={() => handleDeleteUser(user.id)} className="p-2 text-gray-400 hover:text-red-500"><Trash2 size={18} /></button>
                            </div>
                         </div>
                      ))}
                   </div>
                </div>
             </section>
          </div>
        );

      case 'STORE':
        return (
          <div className="animate-in slide-in-from-right-10 duration-300 space-y-6 max-w-4xl mx-auto">
             <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                   <Store className="text-indigo-500" size={20} /> Datos de Empresa
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   {['name', 'rnc', 'address', 'phone', 'email'].map((field) => (
                      <div key={field} className={field === 'address' ? 'md:col-span-2' : ''}>
                         <label className="block text-xs font-bold text-gray-400 uppercase mb-1">
                            {{name: 'Nombre Comercial', rnc: 'RNC / Tax ID', address: 'Dirección', phone: 'Teléfono', email: 'Email'}[field]}
                         </label>
                         <input 
                            type="text"
                            value={(config.companyInfo as any)[field] || ''}
                            onChange={(e) => handleUpdateCompany(field as any, e.target.value)}
                            className="w-full p-3 bg-gray-50 border-transparent rounded-lg focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                         />
                      </div>
                   ))}
                </div>
             </div>
             <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-bold text-gray-800 mb-4">Vertical de Negocio</h2>
                <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-100 mb-4 flex items-start gap-3">
                   <div className="p-2 bg-indigo-100 rounded text-indigo-600"><Building2 size={20} /></div>
                   <div>
                      <p className="text-sm font-bold text-indigo-900">Configuración Actual: {config.subVertical}</p>
                      <p className="text-xs text-indigo-700 mt-1">Cambiar la vertical reiniciará la aplicación para cargar los módulos correctos.</p>
                   </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   {Object.keys(SUB_VERTICAL_OPTIONS).map(groupKey => (
                      <div key={groupKey}>
                         <label className="text-xs font-bold text-gray-400 uppercase mb-2 block">{groupKey === 'RETAIL_GROUP' ? 'Retail' : 'Restaurantes'}</label>
                         <div className="space-y-2">
                            {SUB_VERTICAL_OPTIONS[groupKey].map(opt => (
                               <button 
                                  key={opt.value}
                                  onClick={() => handleUpdateVertical(opt.value)}
                                  className={`w-full text-left p-3 rounded-lg text-sm font-medium border transition-all ${config.subVertical === opt.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 hover:border-indigo-300'}`}
                               >
                                  {opt.label}
                               </button>
                            ))}
                         </div>
                      </div>
                   ))}
                </div>
             </div>
          </div>
        );

      case 'HARDWARE':
        return <HardwareSettings />;

      case 'TICKET':
        return <ReceiptDesigner config={config} onUpdateConfig={onUpdateConfig} />;
        
      case 'PROMOS':
        return <PromotionBuilder products={products} config={config} onClose={() => setCurrentView('HOME')} />;

      case 'CATALOG':
         return (
            <div className="animate-in slide-in-from-right-10 duration-300 max-w-6xl mx-auto space-y-6">
               <div className="flex justify-between items-center">
                  <h2 className="text-xl font-bold text-gray-800">Catálogo de Productos</h2>
                  <button 
                     onClick={handleCreateProduct}
                     className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center gap-2 shadow-lg"
                  >
                     <PlusCircle size={20} /> Agregar Producto
                  </button>
               </div>

               <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                     <table className="w-full text-left">
                        <thead className="bg-gray-50 border-b border-gray-100">
                           <tr>
                              <th className="p-4 text-xs font-bold text-gray-500 uppercase">Imagen</th>
                              <th className="p-4 text-xs font-bold text-gray-500 uppercase">Nombre</th>
                              <th className="p-4 text-xs font-bold text-gray-500 uppercase">Categoría</th>
                              <th className="p-4 text-xs font-bold text-gray-500 uppercase text-right">Precio</th>
                              <th className="p-4 text-xs font-bold text-gray-500 uppercase text-center">Stock</th>
                              <th className="p-4 text-xs font-bold text-gray-500 uppercase text-right">Acciones</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                           {products.map(p => (
                              <tr key={p.id} className="hover:bg-gray-50 group">
                                 <td className="p-3">
                                    <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden">
                                       <img src={p.image || "https://picsum.photos/100"} alt={p.name} className="w-full h-full object-cover" />
                                    </div>
                                 </td>
                                 <td className="p-3 font-medium text-gray-800">{p.name}</td>
                                 <td className="p-3">
                                    <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-bold">{p.category}</span>
                                 </td>
                                 <td className="p-3 text-right font-bold text-gray-900">{config.currencySymbol}{p.price.toFixed(2)}</td>
                                 <td className="p-3 text-center">
                                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                                       (p.stock || 0) < (p.minStock || 5) ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'
                                    }`}>
                                       {p.stock} u.
                                    </span>
                                 </td>
                                 <td className="p-3 text-right">
                                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                       <button onClick={() => handleEditProduct(p)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                          <Edit2 size={16} />
                                       </button>
                                       <button onClick={() => handleDeleteProduct(p.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                          <Trash2 size={16} />
                                       </button>
                                    </div>
                                 </td>
                              </tr>
                           ))}
                           {products.length === 0 && (
                              <tr><td colSpan={6} className="p-8 text-center text-gray-400 italic">No hay productos en el inventario.</td></tr>
                           )}
                        </tbody>
                     </table>
                  </div>
               </div>
            </div>
         );

      case 'HISTORY':
         return (
            <div className="animate-in slide-in-from-right-10 max-w-5xl mx-auto space-y-6">
               <div onClick={onOpenZReport} className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-6 text-white shadow-lg cursor-pointer hover:scale-[1.01] transition-transform flex items-center justify-between">
                  <div>
                    <h3 className="text-2xl font-bold mb-1">Cierre de Caja (Z-Report)</h3>
                    <p className="text-indigo-100">Realizar corte del día, contar efectivo y generar reporte.</p>
                  </div>
                  <div className="bg-white/20 p-3 rounded-xl">
                    <FileText size={32} />
                  </div>
               </div>

               <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <table className="w-full text-left">
                     <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                           <th className="p-4 text-xs font-bold text-gray-500 uppercase">Fecha</th>
                           <th className="p-4 text-xs font-bold text-gray-500 uppercase">ID</th>
                           <th className="p-4 text-xs font-bold text-gray-500 uppercase">Total</th>
                           <th className="p-4 text-xs font-bold text-gray-500 uppercase">Vendedor</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-100">
                        {transactions.slice().reverse().map(txn => (
                           <tr key={txn.id} className="hover:bg-gray-50">
                              <td className="p-4 text-sm text-gray-600">{new Date(txn.date).toLocaleString()}</td>
                              <td className="p-4 font-mono text-xs text-gray-500">#{txn.id}</td>
                              <td className="p-4 font-bold text-gray-900">{config.currencySymbol}{txn.total.toFixed(2)}</td>
                              <td className="p-4 text-sm text-gray-600">{txn.userName}</td>
                           </tr>
                        ))}
                        {transactions.length === 0 && (
                           <tr><td colSpan={4} className="p-8 text-center text-gray-400">Sin movimientos recientes</td></tr>
                        )}
                     </tbody>
                  </table>
               </div>
            </div>
         );

      default:
         return <div className="p-10 text-center">Sección en construcción</div>;
    }
  };

  return (
    <div className="h-screen w-full bg-gray-50 flex flex-col overflow-hidden relative">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4 shadow-sm z-20">
        <button onClick={handleBack} className="p-2 -ml-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors">
          <ArrowLeft size={24} />
        </button>
        {currentView === 'HOME' ? (
           <div className="flex-1 max-w-xl relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input 
                 type="text" 
                 placeholder="Buscar ajustes (ej. 'Impresora', 'Usuarios')..." 
                 className="w-full pl-10 pr-4 py-2.5 bg-gray-100 border-none rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:shadow-sm outline-none transition-all"
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 autoFocus
              />
           </div>
        ) : (
           <div className="flex items-center gap-2">
              <span className="text-gray-400 font-medium cursor-pointer hover:text-gray-600" onClick={() => setCurrentView('HOME')}>Ajustes</span>
              <ChevronRight size={16} className="text-gray-300" />
              <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                 {MODULES.find(m => m.id === currentView)?.title}
              </h1>
           </div>
        )}
      </header>
      <main className="flex-1 overflow-y-auto p-4 md:p-8 relative">
         {renderContent()}
      </main>

      {/* MODALS */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
           <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
              <h3 className="font-bold text-lg mb-4">{editingUser ? 'Editar' : 'Nuevo'} Usuario</h3>
              <div className="space-y-4">
                 <div className="flex justify-center"><label className="cursor-pointer relative group"><div className="w-20 h-20 rounded-full bg-gray-200 overflow-hidden"><img src={userFormData.photo || ''} className="w-full h-full object-cover" /></div><input type="file" className="hidden" onChange={handlePhotoUpload} /></label></div>
                 <input className="w-full p-2 border rounded" placeholder="Nombre" value={userFormData.name} onChange={e => setUserFormData({...userFormData, name: e.target.value})} />
                 <input className="w-full p-2 border rounded" placeholder="PIN (4 dígitos)" maxLength={4} value={userFormData.pin} onChange={e => setUserFormData({...userFormData, pin: e.target.value})} />
                 <select className="w-full p-2 border rounded" value={userFormData.role} onChange={e => setUserFormData({...userFormData, role: e.target.value})}>
                    {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                 </select>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                 <button onClick={() => setIsUserModalOpen(false)} className="px-4 py-2 text-gray-600">Cancelar</button>
                 <button onClick={handleSaveUser} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Guardar</button>
              </div>
           </div>
        </div>
      )}

      {isProductModalOpen && (
         <ProductForm 
            initialData={editingProduct} 
            config={config} 
            onSave={handleSaveProduct} 
            onClose={() => setIsProductModalOpen(false)} 
         />
      )}

    </div>
  );
};

export default Settings;
