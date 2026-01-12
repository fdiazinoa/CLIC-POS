
import React, { useState, useMemo } from 'react';
import { 
  ArrowLeft, Search, ChevronRight, 
  Store, Users, Package, Printer, CreditCard, 
  History, ToggleLeft, ToggleRight, Building2, UserPlus, Edit2, Trash2, CheckSquare, Square, User as UserIcon, FileText, PlusCircle, Receipt, Truck, Tag, Ticket,
  ScanBarcode, Coins, Globe, Database, AlertOctagon, Files, ArrowRightLeft, Cpu, Cloud, Mail
} from 'lucide-react';
import { BusinessConfig, User, RoleDefinition, Transaction, VerticalType, SubVertical, Product } from '../types';
import { AVAILABLE_PERMISSIONS, getInitialConfig, RETAIL_PRODUCTS, FOOD_PRODUCTS } from '../constants';
import ProductForm from './ProductForm';
import HardwareSettings from './HardwareSettings';
import ReceiptDesigner from './ReceiptDesigner';
import EmailSettings from './EmailSettings';
import PromotionBuilder from './PromotionBuilder';
import TeamHub from './TeamHub';
import PaymentSettings from './PaymentSettings';
import LabelDesigner from './LabelDesigner';
import TipsSettings from './TipsSettings';
import DataSecurityHub from './DataSecurityHub';
import ActivityLog from './ActivityLog';
import DocumentSettings from './DocumentSettings';
import CurrencySettings from './CurrencySettings';
import BehaviorSettings from './BehaviorSettings';
import SyncStatusHub from './SyncStatusHub';

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
  onOpenFranchise: () => void;
  onClose: () => void;
}

// --- CONFIGURATION GROUPS ---
type SettingsSection = 'HOME' | 'CATALOG' | 'STORE' | 'TEAM' | 'HARDWARE' | 'PAYMENTS' | 'HISTORY' | 'TICKET' | 'EMAIL' | 'SUPPLY' | 'PROMOS' | 'LABELS' | 'TIPS' | 'FRANCHISE' | 'DATA_SECURITY' | 'AUDIT' | 'DOCUMENTS' | 'EXCHANGE' | 'BEHAVIOR' | 'SYNC';

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
    id: 'SYNC',
    title: 'Sincronización',
    description: 'Estado de Red, Nube y Offline',
    icon: Cloud,
    color: 'bg-sky-500',
    keywords: ['internet', 'nube', 'offline', 'backup', 'datos', 'subir']
  },
  {
    id: 'DOCUMENTS',
    title: 'Documentos & Series',
    description: 'Facturas, NCF, Prefijos',
    icon: Files,
    color: 'bg-cyan-500',
    keywords: ['factura', 'ncf', 'fiscal', 'serie', 'numeracion', 'contador', 'ticket']
  },
  {
    id: 'BEHAVIOR',
    title: 'Comportamiento',
    description: 'Reglas Técnicas, Stock Negativo',
    icon: Cpu,
    color: 'bg-indigo-600',
    keywords: ['reglas', 'stock', 'negativo', 'logout', 'seguridad', 'z', 'cierre']
  },
  {
    id: 'EXCHANGE',
    title: 'Divisas & Cambio',
    description: 'Tasas, Monedas Extranjeras',
    icon: ArrowRightLeft,
    color: 'bg-emerald-600',
    keywords: ['dolar', 'euro', 'tasa', 'cambio', 'moneda', 'divisa']
  },
  {
    id: 'TIPS',
    title: 'Propinas',
    description: 'Sugerencias y Auto-Cargo',
    icon: Coins,
    color: 'bg-amber-500',
    keywords: ['propina', 'servicio', 'service charge', 'gratuity', 'mesero']
  },
  {
    id: 'LABELS',
    title: 'Diseñador Etiquetas',
    description: 'Códigos de Barras, Precios',
    icon: ScanBarcode,
    color: 'bg-rose-500',
    keywords: ['impresora', 'etiqueta', 'barcode', 'qr', 'diseño']
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
    id: 'EMAIL',
    title: 'Plantillas Email',
    description: 'Diseño de recibos digitales',
    icon: Mail,
    color: 'bg-fuchsia-500',
    keywords: ['correo', 'email', 'plantilla', 'marketing', 'digital', 'recibo']
  },
  {
    id: 'TEAM',
    title: 'Equipo & Turnos',
    description: 'Usuarios, Roles, Fichaje',
    icon: Users,
    color: 'bg-orange-500',
    keywords: ['usuarios', 'empleados', 'pin', 'clave', 'acceso', 'roles', 'permisos', 'seguridad', 'admin', 'fichaje', 'horarios']
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
    id: 'AUDIT',
    title: 'Auditoría',
    description: 'Logs, Traza y Seguridad',
    icon: AlertOctagon,
    color: 'bg-red-500',
    keywords: ['logs', 'seguridad', 'robo', 'historial', 'traza', 'acciones']
  },
  {
    id: 'DATA_SECURITY',
    title: 'Datos y Backup',
    description: 'Exportación, Bloqueo Kiosco',
    icon: Database,
    color: 'bg-slate-500',
    keywords: ['exportar', 'csv', 'excel', 'kiosco', 'pin', 'bloqueo', 'seguridad', 'backup']
  },
  {
    id: 'HISTORY',
    title: 'Historial',
    description: 'Transacciones y Cierres',
    icon: History,
    color: 'bg-cyan-600',
    keywords: ['ventas', 'reportes', 'cierre', 'z', 'ayer', 'transacciones']
  },
  {
    id: 'FRANCHISE',
    title: 'Panel Franquicia',
    description: 'Gestión Multitienda y Red',
    icon: Globe,
    color: 'bg-slate-900',
    keywords: ['red', 'tiendas', 'global', 'admin', 'hq']
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

const Settings: React.FC<SettingsProps> = ({ config, users, roles, transactions, onUpdateConfig, onUpdateUsers, onUpdateRoles, onOpenZReport, onOpenSupplyChain, onOpenFranchise, onClose }) => {
  const [currentView, setCurrentView] = useState<SettingsSection>('HOME');
  const [searchQuery, setSearchQuery] = useState('');

  // Sub-states for specific modals (Legacy User Modal removed as TeamHub handles it, but keeping refs for Product)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);

  // Product State
  const initialProducts = config.vertical === VerticalType.RESTAURANT ? FOOD_PRODUCTS : RETAIL_PRODUCTS;
  const [products, setProducts] = useState<Product[]>(initialProducts);

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
                      } else if (mod.id === 'FRANCHISE') {
                         onOpenFranchise();
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

      case 'DOCUMENTS':
        return (
          <DocumentSettings onClose={() => setCurrentView('HOME')} />
        );

      case 'BEHAVIOR':
        return (
          <BehaviorSettings onClose={() => setCurrentView('HOME')} />
        );

      case 'EXCHANGE':
        return (
          <CurrencySettings onClose={() => setCurrentView('HOME')} />
        );

      case 'SYNC':
        return (
          <SyncStatusHub onClose={() => setCurrentView('HOME')} />
        );

      case 'PAYMENTS':
        return (
          <PaymentSettings 
            config={config} 
            onUpdateConfig={onUpdateConfig} 
            onClose={() => setCurrentView('HOME')} 
          />
        );

      case 'TIPS':
        return (
          <TipsSettings 
            config={config} 
            onUpdateConfig={onUpdateConfig} 
            onClose={() => setCurrentView('HOME')} 
          />
        );

      case 'TEAM':
        return (
          <TeamHub 
            users={users} 
            roles={roles} 
            onUpdateUsers={onUpdateUsers} 
            onUpdateRoles={onUpdateRoles} 
            onClose={() => setCurrentView('HOME')} 
          />
        );
      
      case 'DATA_SECURITY':
        return (
          <DataSecurityHub onClose={() => setCurrentView('HOME')} />
        );

      case 'AUDIT':
        return (
          <ActivityLog onClose={() => setCurrentView('HOME')} />
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
        
      case 'EMAIL':
        return <EmailSettings config={config} onUpdateConfig={onUpdateConfig} onClose={() => setCurrentView('HOME')} />;

      case 'PROMOS':
        return <PromotionBuilder products={products} config={config} onClose={() => setCurrentView('HOME')} />;

      case 'LABELS':
        return <LabelDesigner onClose={() => setCurrentView('HOME')} />;

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
