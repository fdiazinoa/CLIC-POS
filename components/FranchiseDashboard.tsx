
import React, { useState, useMemo } from 'react';
import { 
  Globe, Store, Map as MapIcon, BarChart3, Settings, 
  CreditCard, Users, RefreshCw, ChevronDown, Bell, 
  CheckCircle2, AlertTriangle, ArrowLeft, Check, Layers,
  Monitor, Wifi, Activity, ArrowUpRight, AlertOctagon,
  Clock, DollarSign, Signal
} from 'lucide-react';

interface StoreData {
  id: string;
  name: string;
  group: string;
  status: 'open' | 'closed';
  dailySales: number;
  coordinates: { top: string; left: string }; // Abstract percentages
  config: {
    tariff: string;
    syncEnabled: boolean;
  }
}

const MOCK_STORES: StoreData[] = [
  {
    id: 'ST-001',
    name: 'Sucursal Central (HQ)',
    group: 'Metropolitana',
    status: 'open',
    dailySales: 45200.50,
    coordinates: { top: '30%', left: '45%' },
    config: { tariff: 'VIP_2024', syncEnabled: true }
  },
  {
    id: 'ST-002',
    name: 'Kiosco Norte',
    group: 'Norte',
    status: 'open',
    dailySales: 12500.00,
    coordinates: { top: '25%', left: '75%' },
    config: { tariff: 'Standard', syncEnabled: true }
  },
  {
    id: 'ST-003',
    name: 'Outlet Sur',
    group: 'Sur',
    status: 'open',
    dailySales: 31000.75,
    coordinates: { top: '70%', left: '35%' },
    config: { tariff: 'Outlet_Promo', syncEnabled: false }
  },
  {
    id: 'ST-004',
    name: 'Pop-up Este',
    group: 'Este',
    status: 'closed',
    dailySales: 0,
    coordinates: { top: '50%', left: '65%' },
    config: { tariff: 'Standard', syncEnabled: true }
  },
  {
    id: 'ST-005',
    name: 'Sucursal Centro',
    group: 'Metropolitana',
    status: 'open',
    dailySales: 28400.00,
    coordinates: { top: '35%', left: '40%' },
    config: { tariff: 'VIP_2024', syncEnabled: true }
  }
];

interface FranchiseDashboardProps {
  onBack: () => void;
}

const FranchiseDashboard: React.FC<FranchiseDashboardProps> = ({ onBack }) => {
  const [selectedContext, setSelectedContext] = useState<string>('ALL'); // 'ALL', 'GROUP:Name', or StoreID
  
  // Mock Config State
  const [globalTariff, setGlobalTariff] = useState('Standard');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastSuccess, setBroadcastSuccess] = useState(false);

  // Extract unique groups
  const groups = useMemo(() => {
    return Array.from(new Set(MOCK_STORES.map(s => s.group))).sort();
  }, []);

  // Filter Logic
  const visibleStores = useMemo(() => {
    if (selectedContext === 'ALL') return MOCK_STORES;
    
    if (selectedContext.startsWith('GROUP:')) {
      const groupName = selectedContext.replace('GROUP:', '');
      return MOCK_STORES.filter(s => s.group === groupName);
    }

    return MOCK_STORES.filter(s => s.id === selectedContext);
  }, [selectedContext]);

  const currentStore = MOCK_STORES.find(s => s.id === selectedContext);
  const isSingleStoreMode = !!currentStore;

  const totalSales = visibleStores.reduce((acc, s) => acc + s.dailySales, 0);

  const getContextLabel = () => {
    if (selectedContext === 'ALL') return 'Toda la Red';
    if (selectedContext.startsWith('GROUP:')) return `Región ${selectedContext.replace('GROUP:', '')}`;
    const store = MOCK_STORES.find(s => s.id === selectedContext);
    return store ? store.name : 'Desconocido';
  };

  const handleBroadcast = () => {
    setIsBroadcasting(true);
    setTimeout(() => {
      setIsBroadcasting(false);
      setBroadcastSuccess(true);
      setTimeout(() => setBroadcastSuccess(false), 3000);
    }, 1500);
  };

  // --- RENDER HELPERS ---

  const renderNetworkOverview = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
        {/* ROW 1: Map & Stats Comparator */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[450px]">
          
          {/* MAP VIEW */}
          <div className="lg:col-span-2 bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden relative group">
             <div className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur px-3 py-1.5 rounded-lg shadow-sm border border-slate-100 flex items-center gap-2">
                <MapIcon size={14} className="text-slate-500" />
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">Mapa de Cobertura</span>
             </div>

             {/* Stylized CSS Map */}
             <div className="w-full h-full bg-slate-50 relative">
                {/* Abstract Land Masses */}
                <div className="absolute top-10 left-10 w-3/4 h-3/4 bg-slate-200/50 rounded-[4rem] mix-blend-multiply opacity-50"></div>
                <div className="absolute bottom-20 right-20 w-1/3 h-1/2 bg-slate-200/50 rounded-full mix-blend-multiply opacity-50"></div>
                
                {/* Connection Lines (Visual Polish) - Only show if ALL or Group */}
                {!selectedContext.startsWith('ST-') && (
                   <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
                      <path d="M 45% 30% L 75% 25%" stroke="black" strokeWidth="2" strokeDasharray="5,5" />
                      <path d="M 45% 30% L 35% 70%" stroke="black" strokeWidth="2" strokeDasharray="5,5" />
                      <path d="M 45% 30% L 40% 35%" stroke="black" strokeWidth="2" strokeDasharray="5,5" />
                   </svg>
                )}

                {/* Pins */}
                {visibleStores.map(store => (
                   <div 
                      key={store.id}
                      onClick={() => setSelectedContext(store.id)}
                      className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer group/pin transition-all duration-500"
                      style={{ top: store.coordinates.top, left: store.coordinates.left }}
                   >
                      <div className="relative">
                         <div className={`w-4 h-4 rounded-full border-2 border-white shadow-lg ${store.status === 'open' ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                         {store.status === 'open' && (
                            <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75"></div>
                         )}
                      </div>
                      
                      {/* Tooltip */}
                      <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs py-1 px-3 rounded-lg opacity-0 group-hover/pin:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none shadow-xl">
                         <p className="font-bold">{store.name}</p>
                         <p className="text-[10px] text-slate-400">{store.group}</p>
                         <p className="opacity-80 font-mono mt-1">${store.dailySales.toLocaleString()}</p>
                      </div>
                   </div>
                ))}
             </div>
          </div>

          {/* STATS COMPARATOR */}
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 flex flex-col">
             <div className="flex justify-between items-start mb-6">
                <div>
                   <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                      <BarChart3 size={16} /> Comparativa {selectedContext.includes('GROUP') ? 'Regional' : 'Ventas'}
                   </h3>
                   <p className="text-3xl font-black text-slate-900 mt-1">${totalSales.toLocaleString()}</p>
                </div>
                <div className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded text-xs font-bold">
                   +12% vs Ayer
                </div>
             </div>

             <div className="flex-1 flex items-end gap-3 pb-2">
                {visibleStores.map(store => {
                   const height = Math.max(10, Math.min(100, (store.dailySales / 50000) * 100));
                   return (
                      <div key={store.id} className="flex-1 flex flex-col justify-end group cursor-pointer" onClick={() => setSelectedContext(store.id)}>
                         <div className="relative w-full bg-slate-100 rounded-t-lg overflow-hidden">
                            <div 
                               className={`absolute bottom-0 w-full transition-all duration-1000 ease-out ${store.status === 'open' ? (store.id === selectedContext ? 'bg-blue-600' : 'bg-blue-400 group-hover:bg-blue-500') : 'bg-red-300'}`}
                               style={{ height: `${height}%` }}
                            ></div>
                            <div className="h-40"></div> {/* Spacer */}
                         </div>
                         <p className="text-[10px] text-center font-bold text-slate-500 mt-2 truncate w-full">
                            {store.name.split(' ')[0]}
                         </p>
                      </div>
                   )
                })}
             </div>
          </div>
        </div>

        {/* ROW 2: Mass Configuration (Index 13.2) */}
        <div className="bg-white rounded-3xl shadow-md border border-slate-200 overflow-hidden">
           
           <div className={`bg-slate-50 border-b border-slate-200 px-8 py-4 flex justify-between items-center transition-colors ${selectedContext.startsWith('GROUP:') ? 'bg-blue-50/50' : ''}`}>
              <div>
                 <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <Settings size={20} className="text-slate-500" /> 
                    Configuración {selectedContext.startsWith('GROUP:') ? 'Regional' : 'Masiva'}
                 </h2>
                 <p className="text-xs text-slate-500">
                    Aplicando a: <span className="font-bold text-blue-600">{getContextLabel()}</span>
                    {selectedContext.startsWith('GROUP:') && <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold uppercase">Grupo Activo</span>}
                 </p>
              </div>
              
              <button 
                 onClick={handleBroadcast}
                 disabled={isBroadcasting}
                 className={`px-6 py-2.5 rounded-xl font-bold text-white shadow-lg transition-all flex items-center gap-2 ${
                    broadcastSuccess ? 'bg-emerald-500' : 'bg-blue-600 hover:bg-blue-700 active:scale-95'
                 }`}
              >
                 {isBroadcasting ? (
                    <RefreshCw size={18} className="animate-spin" />
                 ) : broadcastSuccess ? (
                    <CheckCircle2 size={18} />
                 ) : (
                    <RefreshCw size={18} />
                 )}
                 {isBroadcasting ? 'Sincronizando...' : broadcastSuccess ? '¡Aplicado!' : `Aplicar a ${visibleStores.length} Tiendas`}
              </button>
           </div>

           <div className="p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                 
                 {/* COLUMN 1: General & Resources */}
                 <div className="space-y-6">
                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200">
                       <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                          <Users size={18} /> Recursos Compartidos
                       </h3>
                       <div className="space-y-4">
                          <label className="flex items-center justify-between cursor-pointer group">
                             <span className="text-sm font-medium text-slate-600 group-hover:text-slate-900 transition-colors">Compartir Vendedores {selectedContext === 'ALL' ? '(Global)' : '(En Grupo)'}</span>
                             <div className="w-12 h-6 bg-blue-600 rounded-full relative">
                                <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full shadow-sm"></div>
                             </div>
                          </label>
                          <p className="text-xs text-slate-400">Permite a los empleados iniciar sesión en {selectedContext === 'ALL' ? 'cualquier tienda.' : 'las tiendas de este grupo.'}</p>
                          
                          <div className="h-px bg-slate-200 my-2"></div>

                          <label className="flex items-center justify-between cursor-pointer group">
                             <span className="text-sm font-medium text-slate-600 group-hover:text-slate-900 transition-colors">Centralizar Clientes (CRM)</span>
                             <div className="w-12 h-6 bg-blue-600 rounded-full relative">
                                <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full shadow-sm"></div>
                             </div>
                          </label>
                       </div>
                    </div>

                    <div className="bg-orange-50 p-5 rounded-2xl border border-orange-100">
                       <h3 className="font-bold text-orange-800 mb-4 flex items-center gap-2">
                          <AlertTriangle size={18} /> Alertas de Caja (Z-Report)
                       </h3>
                       <div className="space-y-3">
                          <div>
                             <label className="block text-xs font-bold text-orange-700 uppercase mb-1">Email para Reportes ({getContextLabel()})</label>
                             <input 
                                type="email" 
                                placeholder="finanzas@franquicia.com" 
                                className="w-full p-2 bg-white border border-orange-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-300"
                             />
                          </div>
                          <div className="flex items-center gap-2">
                             <input type="checkbox" className="w-4 h-4 text-orange-600 rounded" defaultChecked />
                             <span className="text-sm text-orange-800">Notificar descuadres > $50.00</span>
                          </div>
                       </div>
                    </div>
                 </div>

                 {/* COLUMN 2: Tariffs & Prices */}
                 <div className="space-y-6">
                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 h-full">
                       <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                          <CreditCard size={18} /> Tarifas y Precios
                       </h3>
                       
                       <div className="mb-6">
                          <label className="block text-sm font-bold text-slate-600 mb-2">Tarifa Activa para {getContextLabel()}</label>
                          <select 
                             value={globalTariff}
                             onChange={(e) => setGlobalTariff(e.target.value)}
                             className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-blue-500 font-medium"
                          >
                             <option value="Standard">Estándar (PVP)</option>
                             <option value="VIP_2024">Precios VIP 2024</option>
                             <option value="Happy_Hour">Happy Hour (Auto)</option>
                             <option value="Outlet_Promo">Liquidación Outlet</option>
                          </select>
                       </div>

                       <div className="space-y-3">
                          <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
                             <div className="p-2 bg-green-100 text-green-700 rounded-lg"><Check size={16} /></div>
                             <div className="flex-1">
                                <p className="text-sm font-bold text-slate-700">Sincronización Automática</p>
                                <p className="text-xs text-slate-400">Los cambios de precio se reflejan en 5 min.</p>
                             </div>
                          </div>
                          
                          <button className="w-full py-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 font-bold text-sm hover:border-blue-400 hover:text-blue-600 transition-colors">
                             + Programar Oferta {selectedContext.startsWith('GROUP:') ? 'Regional' : 'Global'}
                          </button>
                       </div>
                    </div>
                 </div>

              </div>
           </div>

        </div>
    </div>
  );

  const renderStoreDetail = (store: StoreData) => (
    <div className="space-y-6 animate-in zoom-in-95 duration-300">
       
       {/* Store Hero Banner */}
       <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 relative overflow-hidden">
          <div className={`absolute top-0 right-0 w-64 h-full bg-gradient-to-l from-slate-50 to-transparent pointer-events-none`}></div>
          
          <div className="flex justify-between items-start relative z-10">
             <div className="flex items-center gap-6">
                <div className={`w-20 h-20 rounded-2xl flex items-center justify-center text-white shadow-lg ${store.status === 'open' ? 'bg-blue-600' : 'bg-slate-400'}`}>
                   <Store size={40} />
                </div>
                <div>
                   <div className="flex items-center gap-3 mb-1">
                      <h2 className="text-3xl font-black text-slate-900">{store.name}</h2>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${store.status === 'open' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-700 border-red-200'}`}>
                         {store.status === 'open' ? 'Abierto' : 'Cerrado'}
                      </span>
                   </div>
                   <div className="flex items-center gap-4 text-sm text-slate-500 font-medium">
                      <span className="flex items-center gap-1"><MapIcon size={14} /> {store.group}</span>
                      <span className="flex items-center gap-1"><Layers size={14} /> ID: {store.id}</span>
                      <span className="flex items-center gap-1 text-blue-600"><Wifi size={14} /> Conectado (12ms)</span>
                   </div>
                </div>
             </div>

             <div className="flex gap-3">
                <button 
                   onClick={() => alert("Reiniciando terminales...")}
                   className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors"
                >
                   <RefreshCw size={16} /> Reiniciar POS
                </button>
                <button 
                   onClick={() => setSelectedContext('ALL')}
                   className="px-4 py-2 border-2 border-slate-200 hover:border-slate-300 text-slate-500 rounded-xl font-bold text-sm transition-colors"
                >
                   Cerrar Detalles
                </button>
             </div>
          </div>
       </div>

       {/* KPIs Row */}
       <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
             <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Ventas Hoy</p>
             <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-900">${store.dailySales.toLocaleString()}</span>
                <span className="text-xs font-bold text-green-500 flex items-center"><ArrowUpRight size={12} /> 15%</span>
             </div>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
             <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Transacciones</p>
             <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-900">142</span>
                <span className="text-xs font-bold text-slate-400">Tickets</span>
             </div>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
             <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Personal Activo</p>
             <div className="flex items-center gap-2 mt-1">
                <div className="flex -space-x-2">
                   {[1,2,3].map(i => (
                      <div key={i} className="w-8 h-8 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center text-[10px] font-bold text-slate-600">
                         U{i}
                      </div>
                   ))}
                </div>
                <span className="text-sm font-bold text-slate-700">+2 Turno Tarde</span>
             </div>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
             <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Estado Hardware</p>
             <div className="flex gap-2 mt-1">
                <span className="w-3 h-3 rounded-full bg-green-500" title="POS 1 OK"></span>
                <span className="w-3 h-3 rounded-full bg-green-500" title="POS 2 OK"></span>
                <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" title="Impresora Error"></span>
                <span className="text-xs text-slate-500 ml-1">1 Alerta</span>
             </div>
          </div>
       </div>

       {/* Live Activity & Details */}
       <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Live Feed */}
          <div className="lg:col-span-2 bg-white rounded-3xl shadow-sm border border-slate-200 p-6">
             <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Activity size={18} className="text-blue-500" /> Actividad en Vivo
             </h3>
             <div className="space-y-0">
                {[
                   { time: '10:42 AM', action: 'Venta #1042', amount: 450.00, user: 'Ana P.', status: 'success' },
                   { time: '10:38 AM', action: 'Cierre Z (Turno Mañana)', amount: null, user: 'Carlos M.', status: 'info' },
                   { time: '10:35 AM', action: 'Anulación Item', amount: -12.50, user: 'Ana P.', status: 'warning' },
                   { time: '10:30 AM', action: 'Venta #1041', amount: 1200.00, user: 'Ana P.', status: 'success' },
                ].map((log, idx) => (
                   <div key={idx} className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 px-2 rounded-lg transition-colors">
                      <div className="flex items-center gap-4">
                         <span className="text-xs font-mono text-slate-400">{log.time}</span>
                         <div>
                            <p className="text-sm font-bold text-slate-700">{log.action}</p>
                            <p className="text-xs text-slate-400">{log.user}</p>
                         </div>
                      </div>
                      <div className="text-right">
                         {log.amount !== null && (
                            <span className={`font-bold ${log.status === 'warning' ? 'text-red-500' : 'text-slate-800'}`}>
                               ${Math.abs(log.amount).toFixed(2)}
                            </span>
                         )}
                      </div>
                   </div>
                ))}
             </div>
          </div>

          {/* Config & Alerts */}
          <div className="space-y-6">
             {/* Critical Alerts */}
             <div className="bg-red-50 border border-red-100 rounded-3xl p-6">
                <h3 className="font-bold text-red-800 mb-2 flex items-center gap-2">
                   <AlertOctagon size={18} /> Atención Requerida
                </h3>
                <div className="space-y-2">
                   <div className="bg-white/60 p-3 rounded-xl flex gap-3 items-center">
                      <Monitor size={16} className="text-red-500" />
                      <span className="text-sm text-red-900 font-medium">Impresora Cocina desconectada</span>
                   </div>
                   <div className="bg-white/60 p-3 rounded-xl flex gap-3 items-center">
                      <Clock size={16} className="text-orange-500" />
                      <span className="text-sm text-red-900 font-medium">Turno Tarde sin abrir</span>
                   </div>
                </div>
             </div>

             {/* Store Config Override */}
             <div className="bg-white border border-slate-200 rounded-3xl p-6">
                <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                   <Settings size={18} className="text-slate-400" /> Configuración Local
                </h3>
                <div className="space-y-4">
                   <div>
                      <label className="text-xs font-bold text-slate-400 uppercase">Tarifa Actual</label>
                      <select className="w-full mt-1 p-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 outline-none">
                         <option>VIP_2024 (Global)</option>
                         <option>Standard</option>
                         <option>Playa_Precios</option>
                      </select>
                   </div>
                   <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600 font-medium">Sincronización Stock</span>
                      <div className="w-10 h-5 bg-green-500 rounded-full relative"><div className="absolute right-1 top-1 w-3 h-3 bg-white rounded-full"></div></div>
                   </div>
                </div>
             </div>
          </div>
       </div>

    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans flex flex-col">
      
      {/* --- Header (Context Selector) --- */}
      <header className="bg-slate-900 text-white shadow-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors">
              <ArrowLeft size={20} />
            </button>
            <div className="flex items-center gap-2">
              <Globe className="text-blue-500" size={24} />
              <div>
                <h1 className="font-bold text-lg leading-tight">Master Control</h1>
                <span className="text-[10px] text-slate-400 font-medium tracking-widest uppercase">Franquicias & Cadenas (13.2)</span>
              </div>
            </div>
          </div>

          {/* Global Context Dropdown */}
          <div className="relative group">
            <div className="flex items-center gap-3 bg-slate-800 px-4 py-2 rounded-lg border border-slate-700 cursor-pointer hover:border-slate-600 transition-colors">
              {selectedContext.startsWith('GROUP:') ? (
                <Layers size={16} className="text-blue-400" />
              ) : selectedContext === 'ALL' ? (
                <Globe size={16} className="text-blue-400" />
              ) : (
                <Store size={16} className="text-slate-400" />
              )}
              
              <select 
                value={selectedContext}
                onChange={(e) => setSelectedContext(e.target.value)}
                className="bg-transparent text-sm font-bold text-white outline-none appearance-none w-56 cursor-pointer"
              >
                <option value="ALL" className="bg-slate-900 text-white">🌍 Toda la Red (Global)</option>
                
                <optgroup label="Por Región / Grupo" className="bg-slate-800 text-slate-300">
                  {groups.map(group => (
                    <option key={group} value={`GROUP:${group}`} className="bg-slate-900 text-white">
                      🔹 Región {group} ({MOCK_STORES.filter(s => s.group === group).length})
                    </option>
                  ))}
                </optgroup>

                <optgroup label="Tiendas Individuales" className="bg-slate-800 text-slate-300">
                  {MOCK_STORES.map(s => (
                    <option key={s.id} value={s.id} className="bg-slate-900 text-white">
                      🔸 {s.name}
                    </option>
                  ))}
                </optgroup>
              </select>
              <ChevronDown size={14} className="text-slate-400" />
            </div>
          </div>

          <div className="flex items-center gap-4">
             <div className="text-right hidden md:block">
                <p className="text-xs text-slate-400">Ventas Hoy ({selectedContext === 'ALL' ? 'Red' : 'Filtro'})</p>
                <p className="text-lg font-bold text-emerald-400">${totalSales.toLocaleString()}</p>
             </div>
             <button className="p-2 bg-slate-800 rounded-full hover:bg-slate-700 relative">
                <Bell size={20} />
                <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-slate-900"></span>
             </button>
          </div>
        </div>
      </header>

      {/* --- Main Content --- */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-6 space-y-6">
        {isSingleStoreMode && currentStore ? renderStoreDetail(currentStore) : renderNetworkOverview()}
      </main>
    </div>
  );
};

export default FranchiseDashboard;
