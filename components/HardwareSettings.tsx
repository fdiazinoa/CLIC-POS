
import React, { useState, useMemo } from 'react';
import { 
  Printer, ScanBarcode, Bluetooth, RefreshCw, CheckCircle, 
  X, Zap, Settings as SettingsIcon, Usb, Network, Plus, 
  Monitor, MessageSquare, DollarSign, Scale,
  Save, Info, AlertTriangle, Check, Tv, MonitorPlay, QrCode, Trash2,
  Cable, Radio, MousePointer2, Image as ImageIcon, ArrowLeft,
  Smartphone, Wallet, ShieldCheck, Database, HardDrive
} from 'lucide-react';
import { BusinessConfig, Product, CustomerDisplayConfig, ScaleDevice, ScaleTech } from '../types';

interface Device {
  id: string;
  name: string;
  type: 'PRINTER' | 'SCANNER' | 'SCALE';
  connection: 'BLUETOOTH' | 'NETWORK' | 'USB' | 'SERIAL';
  status: 'CONNECTED' | 'DISCONNECTED' | 'PAIRING';
}

const MOCK_PRINTERS: Device[] = [
  { id: 'dev1', name: 'Cocina Caliente', type: 'PRINTER', connection: 'NETWORK', status: 'CONNECTED' },
];

const DEFAULT_DISPLAY_CONFIG: CustomerDisplayConfig = {
  isEnabled: true,
  welcomeMessage: '¡Bienvenido a CLIC POS!',
  showItemImages: true,
  showQrPayment: true,
  layout: 'SPLIT',
  connectionType: 'VIRTUAL',
  ads: [
    { id: 'ad1', url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=600&auto=format&fit=crop', active: true },
    { id: 'ad2', url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=600&auto=format&fit=crop', active: true }
  ]
};

interface HardwareSettingsProps {
  config: BusinessConfig;
  products: Product[];
  onUpdateConfig: (cfg: BusinessConfig) => void;
  onClose: () => void;
}

type HardwareTab = 'PERIPHERALS' | 'SCALES' | 'DISPLAY' | 'CASHDRO';

const HardwareSettings: React.FC<HardwareSettingsProps> = ({ config: globalConfig, products, onUpdateConfig, onClose }) => {
  const [activeTab, setActiveTab] = useState<HardwareTab>('PERIPHERALS');
  
  // -- Scales State --
  const [scales, setScales] = useState<ScaleDevice[]>(globalConfig.scales || []);
  const [editingScale, setEditingScale] = useState<ScaleDevice | null>(null);
  
  // -- Label Tester State --
  const [testBarcode, setTestBarcode] = useState('');
  const [testResult, setTestResult] = useState<any>(null);

  // -- Customer Display State --
  const [displayConfig, setDisplayConfig] = useState<CustomerDisplayConfig>(
    globalConfig.terminals?.[0]?.config?.hardware?.customerDisplay || DEFAULT_DISPLAY_CONFIG
  );
  const [previewMode, setPreviewMode] = useState<'IDLE' | 'CHECKOUT'>('CHECKOUT');

  // -- Cash Drawer State --
  const [cashDroType, setCashDroType] = useState<'STANDARD' | 'INTELLIGENT'>('STANDARD');
  const [isCashDroEnabled, setIsCashDroEnabled] = useState(true);
  const [intelligentConfig, setIntelligentConfig] = useState({ ip: '192.168.1.100', model: 'CASHDRO_7' });

  const selectedTerminalId = useMemo(() => globalConfig.terminals?.[0]?.id || 'POS-01', [globalConfig.terminals]);

  // --- ACTIONS ---
  const handleSaveAllHardware = () => {
    const newConfig = { ...globalConfig, scales };
    if (newConfig.terminals?.[0]) {
       newConfig.terminals[0].config.hardware.customerDisplay = displayConfig;
    }
    onUpdateConfig(newConfig);
    alert("Configuración de hardware guardada correctamente.");
  };

  const handleSaveScale = () => {
    if (!editingScale) return;
    const newScales = scales.some(s => s.id === editingScale.id)
      ? scales.map(s => s.id === editingScale.id ? editingScale : s)
      : [...scales, editingScale];
    
    setScales(newScales);
    setEditingScale(null);
    
    // Auto-persist to global config
    onUpdateConfig({ ...globalConfig, scales: newScales });
  };

  const createNewScale = () => {
    setEditingScale({
      id: `scale_${Date.now()}`,
      name: '',
      isEnabled: true,
      technology: 'DIRECT',
      directConfig: { port: 'COM1', baudRate: 9600, dataBits: 8, protocol: 'CAS' },
      labelConfig: { mode: 'WEIGHT', prefixes: ['20'], decimals: 3, itemDigits: 5, valueDigits: 5 }
    });
  };

  const handleDeleteScale = (id: string) => {
    if (confirm("¿Eliminar esta balanza?")) {
      const newScales = scales.filter(s => s.id !== id);
      setScales(newScales);
      onUpdateConfig({ ...globalConfig, scales: newScales });
    }
  };

  const handleDigitClick = (index: number) => {
     if (!editingScale?.labelConfig) return;
     if (index < 2 || index > 11) return;
     const newItemDigits = index - 1;
     const newValueDigits = 10 - newItemDigits;
     setEditingScale({
        ...editingScale,
        labelConfig: { ...editingScale.labelConfig, itemDigits: newItemDigits, valueDigits: newValueDigits }
     });
     setTestResult(null);
  };

  const addAd = () => {
     const url = prompt("Introduce la URL de la imagen publicitaria:");
     if (url) {
        setDisplayConfig({
           ...displayConfig,
           ads: [...displayConfig.ads, { id: `ad_${Date.now()}`, url, active: true }]
        });
     }
  };

  const renderCashDro = () => (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 pb-20">
       <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Config Column */}
          <div className="space-y-6">
             <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-2xl ${isCashDroEnabled ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
                         <DollarSign size={24} />
                      </div>
                      <div>
                         <h3 className="font-bold text-gray-800">Gestión de Cajón</h3>
                         <p className="text-xs text-gray-500">Configura la apertura automática y cajones inteligentes.</p>
                      </div>
                   </div>
                   <button 
                      onClick={() => setIsCashDroEnabled(!isCashDroEnabled)}
                      className={`w-14 h-7 rounded-full transition-all relative ${isCashDroEnabled ? 'bg-emerald-600' : 'bg-gray-300'}`}
                   >
                      <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all shadow-sm ${isCashDroEnabled ? 'left-8' : 'left-1'}`} />
                   </button>
                </div>
             </div>

             <div className={`bg-white p-6 rounded-3xl shadow-sm border border-gray-200 space-y-6 transition-all ${isCashDroEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                <div>
                   <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Tipo de Cajón</label>
                   <div className="grid grid-cols-2 gap-3">
                      {[
                         { id: 'STANDARD', label: 'Cajón Estándar (RJ11)', icon: Printer, desc: 'Conectado a impresora' },
                         { id: 'INTELLIGENT', label: 'Cajón Inteligente', icon: Smartphone, desc: 'CashDro / Glory / Otros' },
                      ].map(type => (
                         <button 
                           key={type.id}
                           onClick={() => setCashDroType(type.id as any)}
                           className={`p-4 rounded-2xl border-2 text-left flex flex-col gap-2 transition-all ${cashDroType === type.id ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm' : 'border-gray-100 text-gray-500 hover:border-gray-200'}`}
                         >
                            <type.icon size={20} />
                            <div>
                               <span className="text-sm font-bold block">{type.label}</span>
                               <span className="text-[10px] opacity-70">{type.desc}</span>
                            </div>
                         </button>
                      ))}
                   </div>
                </div>

                {cashDroType === 'INTELLIGENT' ? (
                   <div className="space-y-4 animate-in slide-in-from-top-2">
                      <div className="grid grid-cols-2 gap-4">
                         <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Modelo / Proveedor</label>
                            <select 
                               value={intelligentConfig.model}
                               onChange={(e) => setIntelligentConfig({...intelligentConfig, model: e.target.value})}
                               className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold"
                            >
                               <option value="CASHDRO_7">CashDro 7</option>
                               <option value="CASHDRO_3">CashDro 3</option>
                               <option value="GLORY_CI10">Glory CI-10</option>
                               <option value="AZKOYEN">Azkoyen Cashlogy</option>
                            </select>
                         </div>
                         <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Dirección IP</label>
                            <input 
                               type="text" 
                               value={intelligentConfig.ip}
                               onChange={(e) => setIntelligentConfig({...intelligentConfig, ip: e.target.value})}
                               className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono font-bold"
                            />
                         </div>
                      </div>
                      <button className="w-full py-3 bg-blue-50 text-blue-600 rounded-xl font-bold text-xs flex items-center justify-center gap-2 hover:bg-blue-100">
                         <RefreshCw size={14} /> Probar Sincronización de Fondos
                      </button>
                   </div>
                ) : (
                   <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <div className="flex items-center gap-3 text-sm text-gray-600">
                         <Info size={18} className="text-blue-500 shrink-0" />
                         <p>El cajón estándar se abrirá enviando un pulso eléctrico a través de la impresora de tickets seleccionada.</p>
                      </div>
                   </div>
                )}
             </div>

             <div className={`bg-white p-6 rounded-3xl shadow-sm border border-gray-200 transition-all ${isCashDroEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                <h3 className="font-bold text-gray-700 text-sm uppercase mb-4">Acciones Manuales</h3>
                <button className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold flex items-center justify-center gap-3 shadow-lg active:scale-95 transition-all">
                   <Zap size={20} className="text-yellow-400 fill-current" /> Abrir Cajón Ahora
                </button>
             </div>
          </div>

          {/* Stats Column */}
          <div className="space-y-6">
             {cashDroType === 'INTELLIGENT' && (
                <div className="bg-slate-900 rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden">
                   <div className="absolute top-0 right-0 w-40 h-40 bg-blue-500/10 rounded-full -mr-10 -mt-10 blur-3xl"></div>
                   <div className="relative z-10">
                      <div className="flex justify-between items-center mb-8">
                         <div>
                            <h4 className="text-xs font-bold text-blue-400 uppercase tracking-widest">Nivel de Efectivo</h4>
                            <p className="text-3xl font-black mt-1">Sincronizado</p>
                         </div>
                         <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md">
                            <Database size={24} className="text-blue-400" />
                         </div>
                      </div>

                      <div className="space-y-6">
                         <div>
                            <div className="flex justify-between text-xs font-bold mb-2">
                               <span className="text-slate-400">BILLETES</span>
                               <span>85%</span>
                            </div>
                            <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                               <div className="h-full bg-blue-500 w-[85%] rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
                            </div>
                         </div>
                         <div>
                            <div className="flex justify-between text-xs font-bold mb-2">
                               <span className="text-slate-400">MONEDAS</span>
                               <span>42%</span>
                            </div>
                            <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                               <div className="h-full bg-emerald-500 w-[42%] rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                            </div>
                         </div>
                      </div>

                      <div className="mt-10 pt-6 border-t border-white/5 flex justify-between items-end">
                         <div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total en Máquina</p>
                            <p className="text-4xl font-black text-white">$14,580.00</p>
                         </div>
                         <div className="text-right">
                            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20">
                               <RefreshCw size={10} /> AUTO-SYNC ON
                            </span>
                         </div>
                      </div>
                   </div>
                </div>
             )}

             <div className="bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-sm">
                <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                   <ShieldCheck size={20} className="text-blue-500" /> Auditoría de Aperturas
                </h3>
                <div className="space-y-3">
                   {[
                      { time: '11:24 AM', user: 'Ana C.', reason: 'Venta #452', type: 'AUTO' },
                      { time: '10:15 AM', user: 'Admin', reason: 'Apertura Manual', type: 'MANUAL' },
                      { time: '09:00 AM', user: 'Ana C.', reason: 'Fondo de Caja', type: 'AUTO' },
                   ].map((log, i) => (
                      <div key={i} className="flex justify-between items-center p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs">
                         <div className="flex items-center gap-3">
                            <span className="font-mono text-gray-400">{log.time}</span>
                            <div>
                               <p className="font-bold text-gray-700">{log.reason}</p>
                               <p className="text-[10px] text-gray-400">{log.user}</p>
                            </div>
                         </div>
                         <span className={`font-black text-[9px] px-1.5 py-0.5 rounded ${log.type === 'MANUAL' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                            {log.type}
                         </span>
                      </div>
                   ))}
                </div>
             </div>
          </div>
       </div>
    </div>
  );

  const renderCustomerDisplay = () => (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 pb-20">
       <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* CONFIGURATION COLUMN */}
          <div className="space-y-6">
             {/* Master Enable */}
             <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200">
                <div className="flex items-center justify-between">
                   <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-2xl ${displayConfig.isEnabled ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                         <Tv size={24} />
                      </div>
                      <div>
                         <h3 className="font-bold text-gray-800">Visor de Cliente</h3>
                         <p className="text-xs text-gray-500">Activa una pantalla secundaria para el cliente.</p>
                      </div>
                   </div>
                   <button 
                      onClick={() => setDisplayConfig({...displayConfig, isEnabled: !displayConfig.isEnabled})}
                      className={`w-14 h-7 rounded-full transition-all relative ${displayConfig.isEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}
                   >
                      <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all shadow-sm ${displayConfig.isEnabled ? 'left-8' : 'left-1'}`} />
                   </button>
                </div>
             </div>

             {/* Connection & Setup */}
             <div className={`bg-white p-6 rounded-3xl shadow-sm border border-gray-200 space-y-6 transition-all ${displayConfig.isEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                <div>
                   <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Conexión</label>
                   <div className="grid grid-cols-2 gap-3">
                      {[
                         { id: 'VIRTUAL', label: 'Segunda Pantalla (HDMI)', icon: MonitorPlay },
                         { id: 'NETWORK', label: 'Tablet Red (IP)', icon: Network },
                         { id: 'USB', label: 'Display VFD (USB)', icon: Usb },
                      ].map(conn => (
                         <button 
                           key={conn.id}
                           onClick={() => setDisplayConfig({...displayConfig, connectionType: conn.id as any})}
                           className={`p-3 rounded-xl border-2 flex items-center gap-3 transition-all ${displayConfig.connectionType === conn.id ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm' : 'border-gray-100 text-gray-500 hover:border-gray-200'}`}
                         >
                            <conn.icon size={18} />
                            <span className="text-xs font-bold">{conn.label}</span>
                         </button>
                      ))}
                   </div>
                </div>

                <div>
                   <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Mensaje de Bienvenida (Idle)</label>
                   <div className="relative">
                      <input 
                         type="text" 
                         value={displayConfig.welcomeMessage}
                         onChange={(e) => setDisplayConfig({...displayConfig, welcomeMessage: e.target.value})}
                         className="w-full p-3 pl-10 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100"
                         placeholder="Ej. ¡Gracias por preferirnos!"
                      />
                      <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
                   </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer" onClick={() => setDisplayConfig({...displayConfig, showItemImages: !displayConfig.showItemImages})}>
                      <input type="checkbox" checked={displayConfig.showItemImages} onChange={() => {}} className="w-5 h-5 text-blue-600 rounded" />
                      <span className="text-sm font-bold text-gray-600">Fotos de Artículos</span>
                   </div>
                   <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer" onClick={() => setDisplayConfig({...displayConfig, showQrPayment: !displayConfig.showQrPayment})}>
                      <input type="checkbox" checked={displayConfig.showQrPayment} onChange={() => {}} className="w-5 h-5 text-blue-600 rounded" />
                      <span className="text-sm font-bold text-gray-600">QR de Pago</span>
                   </div>
                </div>
             </div>

             {/* Ads Management */}
             <div className={`bg-white p-6 rounded-3xl shadow-sm border border-gray-200 transition-all ${displayConfig.isEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                <div className="flex justify-between items-center mb-4">
                   <h3 className="font-bold text-gray-700 text-sm uppercase">Banners Publicitarios</h3>
                   <button onClick={addAd} className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100">
                      <Plus size={16} />
                   </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                   {displayConfig.ads.map(ad => (
                      <div key={ad.id} className="relative group rounded-xl overflow-hidden aspect-video border border-gray-200 bg-gray-100">
                         <img src={ad.url} className="w-full h-full object-cover" alt="Publicidad" />
                         <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button 
                              onClick={() => setDisplayConfig({...displayConfig, ads: displayConfig.ads.filter(a => a.id !== ad.id)})}
                              className="p-2 bg-white rounded-full text-red-500 hover:scale-110 transition-transform"
                            >
                               <Trash2 size={16} />
                            </button>
                         </div>
                      </div>
                   ))}
                </div>
             </div>
          </div>

          {/* PREVIEW COLUMN */}
          <div className="flex flex-col items-center">
             <div className="flex bg-gray-200 p-1 rounded-xl mb-6">
                <button onClick={() => setPreviewMode('CHECKOUT')} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${previewMode === 'CHECKOUT' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>Modo Cobro</button>
                <button onClick={() => setPreviewMode('IDLE')} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${previewMode === 'IDLE' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>Modo Inactivo</button>
             </div>

             <div className="relative w-full max-w-2xl bg-gray-900 rounded-[2.5rem] p-4 shadow-2xl border-4 border-gray-800">
                <div className="bg-white rounded-[1.5rem] overflow-hidden aspect-[16/10] flex flex-col relative">
                   {previewMode === 'IDLE' ? (
                      <div className="flex-1 flex flex-col">
                         <div className="flex-1 relative overflow-hidden">
                            <img src={displayConfig.ads[0]?.url} className="w-full h-full object-cover" alt="Publicidad" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-10 text-white">
                               <h4 className="text-4xl font-black mb-2">{displayConfig.welcomeMessage}</h4>
                               <p className="text-lg text-white/70 font-medium tracking-wide">Descarga nuestra App para ofertas exclusivas.</p>
                            </div>
                         </div>
                         <div className="h-20 bg-gray-900 flex items-center justify-between px-10 text-white shrink-0">
                            <div className="flex items-center gap-4">
                               <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center font-black text-xl italic text-blue-400">CP</div>
                               <div><p className="font-bold text-sm leading-none">{globalConfig.companyInfo.name}</p></div>
                            </div>
                            <div className="text-right"><p className="text-xl font-mono font-bold">{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p></div>
                         </div>
                      </div>
                   ) : (
                      <div className="flex-1 flex overflow-hidden">
                         <div className="flex-1 flex flex-col border-r border-gray-100 bg-white">
                            <div className="bg-slate-900 px-6 py-4 text-white shrink-0 flex justify-between">
                               <span className="font-black text-xs uppercase tracking-widest">Resumen de Cuenta</span>
                               <span className="text-[10px] font-bold text-blue-400">#000452</span>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
                               {[
                                  { name: 'Zapatillas Runner X', qty: 1, price: 2500, img: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=100&auto=format&fit=facearea&facepad=2&w=100&h=100&q=80' },
                                  { name: 'Tomate Barceló (Fresco)', qty: 2.5, price: 35, img: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?q=80&w=200&auto=format&fit=crop' },
                               ].map((item, i) => (
                                  <div key={i} className="flex gap-4 items-center">
                                     {displayConfig.showItemImages && <img src={item.img} className="w-12 h-12 rounded-xl object-cover shadow-sm" />}
                                     <div className="flex-1">
                                        <p className="font-bold text-gray-800 text-sm leading-tight">{item.name}</p>
                                        <p className="text-[10px] text-gray-400 font-medium">{item.qty} un x ${item.price.toFixed(2)}</p>
                                     </div>
                                     <div className="text-right font-black text-gray-800 text-sm">${(item.qty * item.price).toFixed(2)}</div>
                                  </div>
                               ))}
                            </div>
                         </div>
                         <div className="w-56 bg-slate-50 flex flex-col p-6 items-center justify-between shrink-0">
                            <div className="text-center">
                               <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total a Pagar</p>
                               <p className="text-4xl font-black text-slate-900 leading-none tracking-tighter">${(2587.50).toLocaleString()}</p>
                            </div>
                            {displayConfig.showQrPayment && (
                               <div className="bg-white p-3 rounded-2xl shadow-lg border border-slate-100 flex flex-col items-center gap-2">
                                  <QrCode size={80} className="text-slate-800" />
                                  <span className="text-[8px] font-black text-slate-400 uppercase">Paga con QR</span>
                               </div>
                            )}
                            <div className="w-full pt-4 border-t border-slate-200">
                               <p className="text-center text-[10px] font-bold text-emerald-600 bg-emerald-50 py-1 rounded-full">Terminal {selectedTerminalId}</p>
                            </div>
                         </div>
                      </div>
                   )}
                </div>
                <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-40 h-10 bg-gray-800 rounded-t-2xl shadow-xl"></div>
             </div>
             <p className="text-xs text-gray-400 mt-16 text-center max-w-sm font-medium">Sugerencia: El visor de cliente aumenta la confianza y reduce errores en caja.</p>
          </div>
       </div>
       <div className="fixed bottom-10 right-20 z-50">
          <button onClick={handleSaveAllHardware} className="px-10 py-5 bg-blue-600 text-white rounded-[2rem] font-black text-xl shadow-2xl shadow-blue-500/40 hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-3">
             <Save size={24} /> Confirmar Todo el Hardware
          </button>
       </div>
    </div>
  );

  const renderLabelScales = () => (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Scale className="text-blue-600" /> Balanzas de Pesaje
            </h3>
            <p className="text-sm text-gray-500">Configura balanzas de mostrador y lectura de etiquetas Deli.</p>
          </div>
          <button onClick={createNewScale} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 flex items-center gap-2">
            <Plus size={20} /> Nueva Balanza
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {scales.map(scale => (
              <div key={scale.id} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 group relative">
                 <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 flex gap-2">
                    <button onClick={() => setEditingScale(scale)} className="p-2 bg-gray-50 text-gray-400 hover:text-blue-600 rounded-lg"><SettingsIcon size={16} /></button>
                    <button onClick={() => handleDeleteScale(scale.id)} className="p-2 bg-gray-50 text-gray-400 hover:text-red-600 rounded-lg"><Trash2 size={16} /></button>
                 </div>
                 <div className="flex items-center gap-4 mb-4">
                    <div className={`p-3 rounded-2xl ${scale.isEnabled ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}><Scale size={24} /></div>
                    <div>
                       <h4 className="font-bold text-gray-800">{scale.name || 'Sin nombre'}</h4>
                       <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">{scale.technology === 'DIRECT' ? 'Conexión PC' : 'Lectura Etiquetas'}</span>
                    </div>
                 </div>
              </div>
           ))}
        </div>
      </div>
    </div>
  );

  const renderPeripherals = () => (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
       <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <button className="p-4 bg-white border border-gray-200 rounded-xl flex flex-col items-center gap-2 hover:border-blue-300 hover:bg-blue-50 transition-all shadow-sm">
             <Bluetooth size={24} className="text-gray-600" />
             <span className="text-sm font-bold text-gray-700">Escanear Bluetooth</span>
          </button>
          <button className="p-4 bg-white border border-gray-200 rounded-xl flex flex-col items-center gap-2 hover:border-blue-300 hover:bg-blue-50 transition-all shadow-sm">
             <Network size={24} className="text-gray-600" />
             <span className="text-sm font-bold text-gray-700">Agregar por IP</span>
          </button>
          <button className="p-4 bg-white border border-gray-200 rounded-xl flex flex-col items-center gap-2 hover:border-blue-300 hover:bg-blue-50 transition-all shadow-sm">
             <Usb size={24} className="text-gray-600" />
             <span className="text-sm font-bold text-gray-700">Detectar USB</span>
          </button>
       </div>

       <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="divide-y divide-gray-100">
             {MOCK_PRINTERS.map(device => (
                <div key={device.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                   <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${device.status === 'CONNECTED' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                         {device.type === 'PRINTER' && <Printer size={24} />}
                      </div>
                      <div>
                         <h4 className="font-bold text-gray-800">{device.name}</h4>
                         <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span className="uppercase font-bold">{device.connection}</span>
                            <span>•</span>
                            <span className={device.status === 'CONNECTED' ? 'text-green-600 font-bold' : 'text-gray-400'}>{device.status}</span>
                         </div>
                      </div>
                   </div>
                   <button className="p-2 text-gray-400 hover:text-red-600"><X size={18} /></button>
                </div>
             ))}
          </div>
       </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300">
      <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
             <ArrowLeft size={24} />
          </button>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
             <SettingsIcon className="text-slate-900" /> Hardware & Periféricos
          </h1>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-8 flex flex-col">
         <div className="flex space-x-1 bg-gray-200 p-1 rounded-xl mb-6 self-start">
            {[
               { id: 'PERIPHERALS', label: 'Impresoras y Escáneres', icon: Printer },
               { id: 'SCALES', label: 'Balanzas', icon: Scale },
               { id: 'DISPLAY', label: 'Visor Cliente', icon: Tv },
               { id: 'CASHDRO', label: 'CashDro / Cajón', icon: DollarSign },
            ].map(tab => (
               <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as HardwareTab)}
                  className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
                     activeTab === tab.id ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-300/50'
                  }`}
               >
                  <tab.icon size={16} /> {tab.label}
               </button>
            ))}
         </div>

         <div className="flex-1 overflow-y-auto">
            {activeTab === 'PERIPHERALS' && renderPeripherals()}
            {activeTab === 'SCALES' && renderLabelScales()}
            {activeTab === 'DISPLAY' && renderCustomerDisplay()}
            {activeTab === 'CASHDRO' && renderCashDro()}
         </div>
      </div>

      {/* SCALE MODAL */}
      {editingScale && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
           <div className="bg-white rounded-[2.5rem] w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                 <div className="flex items-center gap-3">
                    <Scale className="text-blue-600" />
                    <h3 className="text-xl font-black text-gray-800">Configuración de Balanza</h3>
                 </div>
                 <button onClick={() => setEditingScale(null)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X size={20} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Nombre</label>
                       <input type="text" value={editingScale.name} onChange={(e) => setEditingScale({...editingScale, name: e.target.value})} className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl font-bold text-gray-700" placeholder="Ej. Balanza Carnicería" />
                    </div>
                    <div>
                       <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Tecnología</label>
                       <select value={editingScale.technology} onChange={(e) => setEditingScale({...editingScale, technology: e.target.value as ScaleTech})} className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl font-bold text-gray-700 outline-none">
                          <option value="DIRECT">Conexión Directa (Serial/COM)</option>
                          <option value="LABEL">Lectura de Etiquetas (Barcode)</option>
                       </select>
                    </div>
                 </div>

                 {editingScale.technology === 'LABEL' && (
                    <div className="space-y-8 animate-in slide-in-from-bottom-4">
                       <div className="flex bg-gray-100 p-1.5 rounded-2xl w-full md:w-80">
                          <button onClick={() => setEditingScale({ ...editingScale, labelConfig: { ...editingScale.labelConfig!, mode: 'WEIGHT', decimals: 3 }})} className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${editingScale.labelConfig?.mode === 'WEIGHT' ? 'bg-white shadow-md text-emerald-600' : 'text-gray-500'}`}><Scale size={18} /> Por Peso</button>
                          <button onClick={() => setEditingScale({ ...editingScale, labelConfig: { ...editingScale.labelConfig!, mode: 'PRICE', decimals: 2 }})} className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${editingScale.labelConfig?.mode === 'PRICE' ? 'bg-white shadow-md text-blue-600' : 'text-gray-500'}`}><DollarSign size={18} /> Por Precio</button>
                       </div>

                       <div className="bg-gray-50 p-8 rounded-[2.5rem] border border-gray-200 relative shadow-inner overflow-x-auto no-scrollbar">
                          <div className="flex gap-1.5 min-w-[600px]">
                            {[...Array(13)].map((_, i) => {
                              let color = "bg-slate-200 text-slate-400";
                              let label = "";
                              let isInteractive = (i >= 2 && i <= 11);
                              if (i < 2) { color = "bg-slate-300 text-slate-600"; label = "P"; }
                              else if (i < 2 + (editingScale.labelConfig?.itemDigits || 5)) { color = "bg-indigo-500 text-white shadow-lg"; label = "I"; }
                              else if (i < 12) { color = editingScale.labelConfig?.mode === 'WEIGHT' ? 'bg-emerald-500 text-white shadow-lg' : 'bg-blue-600 text-white shadow-lg'; label = editingScale.labelConfig?.mode === 'WEIGHT' ? 'kg' : '$'; }
                              else { color = "bg-amber-400 text-white shadow-lg"; label = "C"; }

                              return (
                                <div key={i} onClick={() => isInteractive && handleDigitClick(i + 1)} className={`flex flex-col items-center gap-3 flex-1 transition-all ${isInteractive ? 'cursor-pointer hover:scale-110 active:scale-95' : 'opacity-80'}`}>
                                  <div className={`w-full aspect-square rounded-2xl flex items-center justify-center font-black text-xl border-b-4 border-black/10 transition-all ${color}`}>{i + 1}</div>
                                  <span className="text-[10px] font-black text-gray-400 uppercase">{label}</span>
                                </div>
                              )
                            })}
                          </div>
                       </div>
                    </div>
                 )}
              </div>

              <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 z-20">
                 <button onClick={() => setEditingScale(null)} className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl transition-colors">Cancelar</button>
                 <button onClick={handleSaveScale} className="px-10 py-3 bg-blue-600 text-white font-black text-lg rounded-2xl shadow-xl hover:bg-blue-700 active:scale-95 transition-all">Aplicar</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default HardwareSettings;
