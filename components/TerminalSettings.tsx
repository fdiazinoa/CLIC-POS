
import React, { useState, useMemo, useRef } from 'react';
import { 
  Database, Clock, WifiOff, X, Save, Image as ImageIcon, 
  Receipt, Monitor, Plus, Trash2, Smartphone, CheckCircle2,
  ChevronRight, ChevronLeft, Settings as SettingsIcon, AlertCircle,
  LayoutGrid, ShieldCheck, Zap, Lock, ShieldAlert,
  ArrowRight, Users, FileText, Hash, Type, RotateCcw, Tag, 
  DollarSign, Check, Percent, Calculator, Coins, Box, ArrowRightLeft,
  Link2Off, MonitorOff, Cloud, RefreshCw, Activity, Wifi, Server, AlertTriangle,
  Circle, CheckCircle
} from 'lucide-react';
import { BusinessConfig, TerminalConfig, DocumentSeries, Tariff, TaxDefinition, Warehouse } from '../types';
import { DEFAULT_TERMINAL_CONFIG } from '../constants';

interface TerminalSettingsProps {
  config: BusinessConfig;
  onUpdateConfig: (newConfig: BusinessConfig) => void;
  onClose: () => void;
  warehouses?: Warehouse[];
}

type TerminalTab = 'OPERATIONAL' | 'SECURITY' | 'SESSION' | 'PRICING' | 'DOCUMENTS' | 'OFFLINE' | 'TAXES' | 'INVENTORY';

const MOCK_WAREHOUSES_FOR_UI: Warehouse[] = [
    { id: 'wh_1', code: 'CEN', name: 'Almacén Central', type: 'PHYSICAL', address: '', allowPosSale: true, allowNegativeStock: false, isMain: true, storeId: 'S1' },
    { id: 'wh_2', code: 'NTE', name: 'Tienda Norte', type: 'PHYSICAL', address: '', allowPosSale: true, allowNegativeStock: false, isMain: false, storeId: 'S1' },
    { id: 'wh_3', code: 'MER', name: 'Bodega Mermas', type: 'VIRTUAL', address: '', allowPosSale: false, allowNegativeStock: false, isMain: false, storeId: 'S1' },
];

const TerminalSettings: React.FC<TerminalSettingsProps> = ({ config, onUpdateConfig, onClose, warehouses = MOCK_WAREHOUSES_FOR_UI }) => {
  const [terminals, setTerminals] = useState(config.terminals || []);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>(terminals[0]?.id || '');
  const [activeTab, setActiveTab] = useState<TerminalTab>('OPERATIONAL');
  const [unlinkConfirmId, setUnlinkConfirmId] = useState<string | null>(null);

  const [taxes, setTaxes] = useState<TaxDefinition[]>(config.taxes || []);
  const [editingTaxId, setEditingTaxId] = useState<string | null>(null);

  // Sync Status State (moved from SyncStatusHub)
  const [syncStatus, setSyncStatus] = useState<'SYNCED' | 'SYNCING' | 'OFFLINE'>('SYNCED');
  const [lastSync, setLastSync] = useState<Date>(new Date());
  const [pendingItems, setPendingItems] = useState(0);
  const [syncProgress, setSyncProgress] = useState(0);
  const [latency, setLatency] = useState(24);

  const tabsRef = useRef<HTMLDivElement>(null);

  const activeTerminal = useMemo(() => 
    terminals.find(t => t.id === selectedTerminalId), 
  [terminals, selectedTerminalId]);

  const handleUpdateActiveConfig = (sectionPath: string, key: string, value: any) => {
    if (!activeTerminal) return;

    setTerminals(prev => prev.map(t => {
      if (t.id === selectedTerminalId) {
        const newConfig = JSON.parse(JSON.stringify(t.config));
        
        if (!sectionPath) {
          newConfig[key] = value;
        } else {
          const parts = sectionPath.split('.');
          let current: any = newConfig;
          for (let i = 0; i < parts.length; i++) {
              if (!current[parts[i]]) current[parts[i]] = {};
              if (i === parts.length - 1) {
                  current[parts[i]][key] = value;
              } else {
                  current = current[parts[i]];
              }
          }
        }
        return { ...t, config: newConfig };
      }
      return t;
    }));
  };

  const handleAddTerminal = () => {
    const nextNum = terminals.length + 1;
    let newId = `t${nextNum}`;
    let counter = nextNum;
    while(terminals.some(t => t.id === newId)) {
        counter++;
        newId = `t${counter}`;
    }
    const newConfig = JSON.parse(JSON.stringify(DEFAULT_TERMINAL_CONFIG));
    newConfig.documentSeries = newConfig.documentSeries.map((series: DocumentSeries) => ({
        ...series,
        prefix: series.prefix.includes('B01') 
            ? `${series.prefix}-${counter}` 
            : `${series.prefix}${counter}`
    }));
    const newTerminal = { id: newId, config: newConfig };
    const updatedTerminals = [...terminals, newTerminal];
    setTerminals(updatedTerminals);
    setSelectedTerminalId(newId);
  };

  const handleDeleteTerminal = (id: string) => {
    if (terminals.length <= 1) {
        alert("Debe existir al menos una terminal configurada.");
        return;
    }
    if (confirm(`¿Estás seguro de eliminar la terminal ${id}? Esta acción no se puede deshacer.`)) {
      const newTerminals = terminals.filter(t => t.id !== id);
      setTerminals(newTerminals);
      if (selectedTerminalId === id) {
        setSelectedTerminalId(newTerminals[0].id);
      }
    }
  };

  const handleUnlinkTerminal = (id: string) => {
    setTerminals(prev => prev.map(t => {
      if (t.id === id) {
        return { 
          ...t, 
          config: { 
            ...t.config, 
            currentDeviceId: undefined, 
            lastPairingDate: undefined 
          } 
        };
      }
      return t;
    }));
    setUnlinkConfirmId(null);
  };

  const handleUpdatePrimaryTaxName = (newName: string) => {
    setTaxes(prev => {
      if (prev.length === 0) {
        return [{ id: 'tax-default', name: newName, rate: 0.18, type: 'VAT' }];
      }
      return prev.map((t, idx) => idx === 0 ? { ...t, name: newName } : t);
    });
  };

  const handleAddTax = () => {
    const newTax: TaxDefinition = {
      id: `tax-${Date.now()}`,
      name: 'Nuevo Impuesto',
      rate: 0.18,
      type: 'VAT'
    };
    setTaxes([...taxes, newTax]);
    setEditingTaxId(newTax.id);
  };

  const handleUpdateTax = (id: string, updates: Partial<TaxDefinition>) => {
    setTaxes(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const handleDeleteTax = (id: string) => {
    if (confirm('¿Eliminar este impuesto? Se desvinculará de los productos.')) {
      setTaxes(prev => prev.filter(t => t.id !== id));
    }
  };

  const loadTaxPreset = (preset: 'RETAIL' | 'RESTAURANT') => {
    if (confirm('¿Cargar impuestos predefinidos? Esto reemplazará la lista actual.')) {
      if (preset === 'RETAIL') {
        setTaxes([
          { id: 'tax-18', name: 'ITBIS 18%', rate: 0.18, type: 'VAT' },
          { id: 'tax-16', name: 'ITBIS 16%', rate: 0.16, type: 'VAT' },
          { id: 'tax-exempt', name: 'Exento 0%', rate: 0, type: 'EXEMPT' },
        ]);
      } else {
        setTaxes([
          { id: 'tax-18', name: 'ITBIS 18%', rate: 0.18, type: 'VAT' },
          { id: 'tax-propina', name: 'Propina Legal 10%', rate: 0.10, type: 'SERVICE_CHARGE' },
        ]);
      }
    }
  };

  const handleSave = () => {
    onUpdateConfig({ ...config, terminals: terminals, taxes: taxes });
    alert("Configuraciones guardadas correctamente.");
    onClose();
  };

  const scrollTabs = (direction: 'left' | 'right') => {
    if (tabsRef.current) {
      const scrollAmount = 300;
      tabsRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  // Sync Handlers
  const handleForceSync = () => {
    if (syncStatus === 'OFFLINE') {
      alert("No hay conexión a internet. Verifique su red.");
      return;
    }
    setSyncStatus('SYNCING');
    setSyncProgress(0);
    const interval = setInterval(() => {
      setSyncProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setSyncStatus('SYNCED');
          setLastSync(new Date());
          setPendingItems(0);
          return 100;
        }
        return prev + 5;
      });
    }, 100);
  };

  const toggleSimulationMode = () => {
    if (syncStatus === 'OFFLINE') {
      setSyncStatus('SYNCED');
      setPendingItems(0);
    } else {
      setSyncStatus('OFFLINE');
      setPendingItems(12);
    }
  };

  // Helpers for Sync UI
  const getStatusColor = () => {
    switch (syncStatus) {
      case 'SYNCED': return 'bg-emerald-500 shadow-emerald-200';
      case 'SYNCING': return 'bg-blue-500 shadow-blue-200';
      case 'OFFLINE': return 'bg-red-500 shadow-red-200';
    }
  };

  const getStatusIcon = () => {
    switch (syncStatus) {
      case 'SYNCED': return <CheckCircle2 size={64} className="text-white drop-shadow-md" />;
      case 'SYNCING': return <RefreshCw size={64} className="text-white animate-spin drop-shadow-md" />;
      case 'OFFLINE': return <WifiOff size={64} className="text-white drop-shadow-md" />;
    }
  };

  const getStatusText = () => {
    switch (syncStatus) {
      case 'SYNCED': return 'Todo Sincronizado';
      case 'SYNCING': return 'Sincronizando...';
      case 'OFFLINE': return 'Modo Offline';
    }
  };

  const Toggle = ({ label, description, checked, onChange, danger = false, icon: Icon }: any) => (
    <div 
        onClick={() => onChange(!checked)}
        className={`p-5 rounded-2xl border-2 cursor-pointer flex justify-between items-center transition-all group ${checked ? (danger ? 'bg-red-50 border-red-500 shadow-sm' : 'bg-blue-50 border-blue-500 shadow-sm') : 'bg-white border-gray-100 hover:border-gray-200'}`}
    >
        <div className="flex items-start gap-4 flex-1 pr-4">
            {Icon && <div className={`p-2 rounded-lg shrink-0 ${checked ? (danger ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600') : 'bg-gray-100 text-gray-400'}`}><Icon size={20} /></div>}
            <div>
              <h4 className={`font-bold text-sm ${checked ? (danger ? 'text-red-700' : 'text-blue-700') : 'text-gray-700 group-hover:text-gray-900'}`}>{label}</h4>
              <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{description}</p>
            </div>
        </div>
        <div className={`w-12 h-6 rounded-full relative transition-colors shrink-0 ${checked ? (danger ? 'bg-red-500' : 'bg-blue-600') : 'bg-gray-300'}`}>
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-300 ${checked ? 'left-7' : 'left-1'}`} />
        </div>
    </div>
  );

  return (
    <div className="flex h-full bg-gray-50 animate-in fade-in overflow-hidden relative">
        
        {/* SIDEBAR */}
        <aside className="w-80 bg-white border-r border-gray-200 flex flex-col shrink-0 z-20 shadow-sm">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
               <div>
                  <h2 className="text-xl font-black text-slate-800">Terminales</h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Nodos de venta activos</p>
               </div>
               <button onClick={handleAddTerminal} className="p-2 bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all" title="Agregar Terminal">
                  <Plus size={20} />
               </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
               {terminals.map((t) => {
                  const isLinked = !!t.config.currentDeviceId;
                  return (
                    <div 
                      key={t.id}
                      onClick={() => setSelectedTerminalId(t.id)}
                      className={`group p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between ${
                          selectedTerminalId === t.id ? 'bg-blue-50 border-blue-500 shadow-md ring-4 ring-blue-50' : 'bg-white border-transparent hover:border-gray-200 hover:bg-gray-50/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                          <div className={`p-2.5 rounded-xl ${selectedTerminalId === t.id ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-100 text-gray-400 group-hover:text-gray-600'}`}>
                            <Monitor size={20} />
                          </div>
                          <div>
                            <h3 className={`font-bold text-sm ${selectedTerminalId === t.id ? 'text-blue-900' : 'text-gray-700'}`}>{t.id}</h3>
                            <div className="flex items-center gap-1.5">
                                <div className={`w-2 h-2 rounded-full ${isLinked ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">
                                    {isLinked ? 'En línea / Vinculado' : 'Sin dispositivo'}
                                </p>
                            </div>
                          </div>
                      </div>
                      <div className="flex items-center gap-1">
                          {isLinked && (
                            <button 
                                onClick={(e) => { e.stopPropagation(); setUnlinkConfirmId(t.id); }}
                                className="p-2 text-orange-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-all"
                                title="Liberar Terminal"
                            >
                                <Link2Off size={18} />
                            </button>
                          )}
                          {terminals.length > 1 && (
                            <button 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  handleDeleteTerminal(t.id); 
                                }} 
                                className={`p-2 rounded-lg transition-all ${
                                  selectedTerminalId === t.id 
                                      ? 'text-blue-300 hover:text-red-500 hover:bg-white' 
                                      : 'text-gray-300 hover:text-red-500 hover:bg-red-50'
                                }`}
                                title="Eliminar Terminal"
                            >
                                <Trash2 size={18} />
                            </button>
                          )}
                          {selectedTerminalId === t.id && <ChevronRight size={16} className="text-blue-500" />}
                      </div>
                    </div>
                  );
               })}
            </div>
        </aside>

        {/* MAIN AREA */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
            <header className="bg-white px-8 py-5 border-b border-gray-200 flex justify-between items-center shrink-0 z-10">
                <div className="flex items-center gap-4">
                   <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3">
                     <SettingsIcon className="text-blue-600" /> 
                     Terminal: <span className="text-blue-600 underline decoration-blue-200 underline-offset-4">{selectedTerminalId}</span>
                   </h2>
                </div>
                <div className="flex gap-3">
                    <button onClick={handleSave} className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold flex items-center gap-2 shadow-xl shadow-blue-500/20 hover:bg-blue-700 active:scale-95 transition-all">
                       <Save size={20}/> Guardar Cambios
                    </button>
                    <button onClick={onClose} className="p-3 bg-gray-100 text-gray-500 hover:bg-gray-200 rounded-xl transition-colors">
                       <X size={20}/>
                    </button>
                </div>
            </header>

            <div className="relative bg-white border-b border-gray-100 shrink-0">
                <button 
                    onClick={() => scrollTabs('left')}
                    className="absolute left-0 top-0 bottom-0 z-10 w-12 bg-gradient-to-r from-white via-white/80 to-transparent flex items-center justify-center text-gray-400 hover:text-blue-600 transition-colors"
                >
                    <ChevronLeft size={24} />
                </button>

                <div 
                    ref={tabsRef}
                    className="flex gap-8 px-12 overflow-x-auto no-scrollbar scroll-smooth"
                >
                {[
                  { id: 'OPERATIONAL', label: 'Operativa', icon: Database },
                  { id: 'INVENTORY', label: 'Alcance de Inventario', icon: Box },
                  { id: 'TAXES', label: 'Impuestos', icon: Percent },
                  { id: 'PRICING', label: 'Tarifas y Precios', icon: Tag },
                  { id: 'SECURITY', label: 'Seguridad', icon: ShieldAlert },
                  { id: 'SESSION', label: 'Sesión y Z', icon: Clock },
                  { id: 'DOCUMENTS', label: 'Documentos', icon: FileText },
                  { id: 'OFFLINE', label: 'Estado de Conexión', icon: Cloud },
                ].map(tab => (
                  <button 
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as TerminalTab)}
                    className={`pb-4 pt-4 text-sm font-bold flex items-center gap-2 border-b-4 transition-all whitespace-nowrap ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                  >
                    <tab.icon size={18} /> {tab.label}
                  </button>
                ))}
                </div>

                <button 
                    onClick={() => scrollTabs('right')}
                    className="absolute right-0 top-0 bottom-0 z-10 w-12 bg-gradient-to-l from-white via-white/80 to-transparent flex items-center justify-center text-gray-400 hover:text-blue-600 transition-colors"
                >
                    <ChevronRight size={24} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-50/50">
                {activeTerminal ? (
                    <div className="max-w-5xl mx-auto pb-20">
                        {activeTab === 'OPERATIONAL' && (
                          <div className="space-y-6 animate-in slide-in-from-right-4">
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                  <Toggle 
                                     label="Validación en Tiempo Real" 
                                     description="Verifica stock centralizado antes de procesar el cobro."
                                     checked={activeTerminal.config.workflow.inventory.realTimeValidation} 
                                     onChange={(v: boolean) => handleUpdateActiveConfig('workflow.inventory', 'realTimeValidation', v)} 
                                  />
                                  <Toggle 
                                     label="Permitir Stock Negativo" 
                                     description="Permite facturar artículos sin existencias físicas."
                                     checked={activeTerminal.config.workflow.inventory.allowNegativeStock} 
                                     danger={true}
                                     onChange={(v: boolean) => handleUpdateActiveConfig('workflow.inventory', 'allowNegativeStock', v)} 
                                  />
                                  <Toggle 
                                     label="Mostrar Stock en Caja" 
                                     description="Visible en las tarjetas de producto."
                                     checked={activeTerminal.config.workflow.inventory.showStockOnTiles} 
                                     onChange={(v: boolean) => handleUpdateActiveConfig('workflow.inventory', 'showStockOnTiles', v)} 
                                  />
                                  <div className="p-5 rounded-2xl border-2 border-transparent bg-white shadow-sm flex flex-col gap-4">
                                      <div className="flex items-start gap-4">
                                          <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 shrink-0">
                                              <Percent size={20} />
                                          </div>
                                          <div className="flex-1">
                                              <h4 className="font-bold text-sm text-gray-700">Tipo de impuesto</h4>
                                              <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">Define el nombre del impuesto principal (ITBIS, IVA, Tax). Se sincroniza con el Maestro de Impuestos.</p>
                                          </div>
                                      </div>
                                      <div className="relative">
                                          <input 
                                              type="text" 
                                              value={taxes[0]?.name || ''} 
                                              onChange={(e) => handleUpdatePrimaryTaxName(e.target.value)}
                                              placeholder="Ej: ITBIS 18%"
                                              className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl font-bold text-gray-800 outline-none focus:ring-2 focus:ring-emerald-100 transition-all"
                                          />
                                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                              <Tag size={16} className="text-gray-300" />
                                          </div>
                                      </div>
                                  </div>
                              </div>
                          </div>
                        )}
                        {activeTab === 'INVENTORY' && (
                           <div className="space-y-8 animate-in slide-in-from-right-4">
                              <section className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm">
                                 <div className="mb-6">
                                    <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                                       <Box className="text-indigo-600" /> Alcance de Inventario Multi-Tienda
                                    </h3>
                                    <p className="text-sm text-gray-500 mt-1">
                                       Define qué almacenes puede "ver" y "vender" esta terminal. 
                                    </p>
                                 </div>
                                 <div className="space-y-4">
                                    <div className="grid grid-cols-12 gap-4 border-b border-gray-100 pb-2 text-xs font-bold text-gray-400 uppercase tracking-widest px-4">
                                       <div className="col-span-6">Almacén / Tienda</div>
                                       <div className="col-span-3 text-center">Visibilidad (Consulta)</div>
                                       <div className="col-span-3 text-center">Venta Predeterminada</div>
                                    </div>
                                    {warehouses.map(wh => {
                                       const isVisible = activeTerminal.config.inventoryScope?.visibleWarehouseIds?.includes(wh.id) || false;
                                       const isDefault = activeTerminal.config.inventoryScope?.defaultSalesWarehouseId === wh.id;
                                       return (
                                          <div key={wh.id} className={`grid grid-cols-12 gap-4 items-center p-4 rounded-xl border-2 transition-all ${isDefault ? 'bg-indigo-50 border-indigo-200' : isVisible ? 'bg-white border-gray-200' : 'bg-gray-50 border-transparent opacity-60'}`}>
                                             <div className="col-span-6">
                                                <h4 className="font-bold text-gray-800">{wh.name}</h4>
                                                <p className="text-xs text-gray-400 font-mono">{wh.code} • {wh.type}</p>
                                             </div>
                                             <div className="col-span-3 flex justify-center">
                                                <div 
                                                   onClick={() => {
                                                      const current = activeTerminal.config.inventoryScope?.visibleWarehouseIds || [];
                                                      const newVisible = current.includes(wh.id) 
                                                         ? current.filter(id => id !== wh.id)
                                                         : [...current, wh.id];
                                                      handleUpdateActiveConfig('inventoryScope', 'visibleWarehouseIds', newVisible);
                                                      if (current.includes(wh.id) && isDefault) {
                                                         handleUpdateActiveConfig('inventoryScope', 'defaultSalesWarehouseId', '');
                                                      }
                                                   }}
                                                   className={`w-12 h-6 rounded-full relative transition-colors cursor-pointer ${isVisible ? 'bg-indigo-600' : 'bg-gray-300'}`}
                                                >
                                                   <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm ${isVisible ? 'left-7' : 'left-1'}`} />
                                                </div>
                                             </div>
                                             <div className="col-span-3 flex justify-center">
                                                <div 
                                                   onClick={() => {
                                                      if (!isVisible) return;
                                                      handleUpdateActiveConfig('inventoryScope', 'defaultSalesWarehouseId', wh.id);
                                                   }}
                                                   className={`w-6 h-6 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all ${isDefault ? 'border-indigo-600 bg-indigo-50' : 'border-gray-300 bg-white hover:border-indigo-300'} ${!isVisible ? 'opacity-30 cursor-not-allowed' : ''}`}
                                                >
                                                   {isDefault && <div className="w-3 h-3 rounded-full bg-indigo-600" />}
                                                </div>
                                             </div>
                                          </div>
                                       );
                                    })}
                                 </div>
                              </section>
                              <div className="bg-orange-50 p-6 rounded-[2rem] border border-orange-100 flex items-start gap-4">
                                 <AlertCircle className="text-orange-500 mt-1" size={24} />
                                 <div className="text-sm text-orange-800">
                                    <h4 className="font-bold mb-1">Aviso de Seguridad</h4>
                                    <p>Si seleccionas un almacén externo como predeterminado, asegúrate de que el cajero tenga permisos para mover stock desde esa ubicación.</p>
                                 </div>
                              </div>
                           </div>
                        )}
                        {activeTab === 'TAXES' && (
                           <div className="space-y-8 animate-in slide-in-from-right-4">
                              <div className="flex justify-between items-center bg-white p-6 rounded-3xl border border-gray-200 shadow-sm">
                                 <div>
                                    <h3 className="text-xl font-bold text-gray-800">Maestro de Impuestos</h3>
                                    <p className="text-sm text-gray-500">Configura las tasas impositivas del negocio.</p>
                                 </div>
                                 <div className="flex gap-2">
                                    <button onClick={() => loadTaxPreset('RETAIL')} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200 transition-colors">Supermercado</button>
                                    <button onClick={() => loadTaxPreset('RESTAURANT')} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200 transition-colors">Restaurante</button>
                                    <button onClick={handleAddTax} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold flex items-center gap-2 hover:bg-emerald-700 shadow-lg shadow-emerald-100 transition-all">
                                       <Plus size={16} /> Crear Impuesto
                                    </button>
                                 </div>
                              </div>
                              <div className="grid grid-cols-1 gap-4">
                                 {taxes.map((tax) => (
                                    <div 
                                       key={tax.id} 
                                       className={`p-6 bg-white rounded-3xl border-2 transition-all ${editingTaxId === tax.id ? 'border-blue-500 shadow-lg' : 'border-transparent hover:border-gray-200 shadow-sm'}`}
                                    >
                                       <div className="flex flex-col md:flex-row gap-6 items-center">
                                          <div className={`p-4 rounded-2xl ${tax.type === 'VAT' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>
                                             <Calculator size={24} />
                                          </div>
                                          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
                                             <div>
                                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nombre</label>
                                                <input 
                                                   type="text" 
                                                   value={tax.name}
                                                   onChange={(e) => handleUpdateTax(tax.id, { name: e.target.value })}
                                                   className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-100"
                                                />
                                             </div>
                                             <div>
                                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Tasa (%)</label>
                                                <div className="relative">
                                                   <input 
                                                      type="number" 
                                                      value={tax.rate * 100}
                                                      onChange={(e) => handleUpdateTax(tax.id, { rate: parseFloat(e.target.value) / 100 })}
                                                      className="w-full p-3 pr-8 bg-gray-50 border border-gray-100 rounded-xl font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-100"
                                                   />
                                                   <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-gray-400">%</span>
                                                </div>
                                             </div>
                                             <div>
                                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Tipo</label>
                                                <select 
                                                   value={tax.type}
                                                   onChange={(e) => handleUpdateTax(tax.id, { type: e.target.value as any })}
                                                   className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-100"
                                                >
                                                   <option value="VAT">ITBIS / IVA</option>
                                                   <option value="SERVICE_CHARGE">Propina Legal</option>
                                                   <option value="EXEMPT">Exento</option>
                                                   <option value="OTHER">Otros</option>
                                                </select>
                                             </div>
                                          </div>
                                          <button onClick={() => handleDeleteTax(tax.id)} className="p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all">
                                             <Trash2 size={20} />
                                          </button>
                                       </div>
                                    </div>
                                 ))}
                              </div>
                              <div className="bg-blue-50 p-6 rounded-[2rem] border border-blue-100 flex items-start gap-4">
                                 <AlertCircle className="text-blue-500 mt-1" size={24} />
                                 <div className="text-sm text-blue-800">
                                    <h4 className="font-bold mb-1">Nota sobre Impuestos Compuestos</h4>
                                    <p>Por defecto, los impuestos se suman sobre el precio neto. Si un producto tiene ITBIS (18%) y Propina (10%), se aplicará un total de 28% sobre el subtotal neto.</p>
                                 </div>
                              </div>
                           </div>
                        )}
                        
                        {/* --- PRICING TAB (MODIFIED WATERFALL LOGIC) --- */}
                        {activeTab === 'PRICING' && (
                           <div className="space-y-10 animate-in slide-in-from-right-4">
                              <section>
                                 <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                                    <Tag size={18} className="text-purple-500" /> Tarifas Disponibles (Catálogo Maestro)
                                 </h3>
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {config.tariffs.map(tariff => {
                                       const isAllowed = activeTerminal.config.pricing?.allowedTariffIds.includes(tariff.id);
                                       const isDefault = activeTerminal.config.pricing?.defaultTariffId === tariff.id;
                                       
                                       return (
                                          <div 
                                             key={tariff.id}
                                             className={`p-5 rounded-3xl border-2 transition-all flex flex-col gap-4 relative overflow-hidden ${
                                                isAllowed 
                                                   ? 'bg-white border-purple-500 shadow-lg' 
                                                   : 'bg-gray-50 border-gray-100 opacity-70'
                                             }`}
                                          >
                                             <div className="flex justify-between items-start">
                                                <div className="flex items-center gap-3">
                                                   <div className={`p-2 rounded-xl ${isAllowed ? 'bg-purple-100 text-purple-600' : 'bg-gray-200 text-gray-400'}`}>
                                                      <DollarSign size={20} />
                                                   </div>
                                                   <div>
                                                      <h4 className="font-bold text-gray-800">{tariff.name}</h4>
                                                      <p className="text-xs text-gray-400">{tariff.currency} • {tariff.strategy.type}</p>
                                                   </div>
                                                </div>
                                                
                                                {/* Enable Toggle */}
                                                <div 
                                                   onClick={() => {
                                                      const currentAllowed = activeTerminal.config.pricing?.allowedTariffIds || [];
                                                      let newAllowed;
                                                      if (isAllowed) {
                                                         // Integrity: Cannot disable default
                                                         if (isDefault) return alert("No puedes deshabilitar la tarifa predeterminada. Cambia la predeterminada primero.");
                                                         // Integrity: Must have at least one
                                                         if (currentAllowed.length === 1) return alert("Debe haber al menos una tarifa activa.");
                                                         
                                                         newAllowed = currentAllowed.filter(id => id !== tariff.id);
                                                      } else {
                                                         newAllowed = [...currentAllowed, tariff.id];
                                                      }
                                                      handleUpdateActiveConfig('pricing', 'allowedTariffIds', newAllowed);
                                                   }}
                                                   className={`w-12 h-6 rounded-full relative transition-colors cursor-pointer ${isAllowed ? 'bg-purple-600' : 'bg-gray-300'}`}
                                                >
                                                   <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm ${isAllowed ? 'left-7' : 'left-1'}`} />
                                                </div>
                                             </div>

                                             {/* Default Selector */}
                                             <div className={`flex items-center gap-2 pt-3 border-t ${isAllowed ? 'border-purple-50' : 'border-gray-200'}`}>
                                                <button 
                                                   onClick={() => {
                                                      if (!isAllowed) return; // Cannot set default if not allowed
                                                      handleUpdateActiveConfig('pricing', 'defaultTariffId', tariff.id);
                                                   }}
                                                   disabled={!isAllowed}
                                                   className="flex items-center gap-2 text-sm font-medium disabled:opacity-50 cursor-pointer"
                                                >
                                                   <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isDefault ? 'border-purple-600 bg-purple-50' : 'border-gray-300'}`}>
                                                      {isDefault && <div className="w-2.5 h-2.5 rounded-full bg-purple-600" />}
                                                   </div>
                                                   <span className={isDefault ? 'text-purple-700 font-bold' : 'text-gray-500'}>
                                                      {isDefault ? 'Tarifa Predeterminada' : 'Usar como predeterminada'}
                                                   </span>
                                                </button>
                                             </div>
                                          </div>
                                       );
                                    })}
                                 </div>
                              </section>
                           </div>
                        )}

                        {activeTab === 'SECURITY' && (
                          <div className="space-y-6 animate-in slide-in-from-right-4">
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                 <Toggle 
                                    label="PIN para Anulaciones" 
                                    description="Requiere autorización de gerente para borrar items."
                                    checked={activeTerminal.config.security.requirePinForVoid} 
                                    danger={true}
                                    icon={Lock}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requirePinForVoid', v)} 
                                 />
                                 <Toggle 
                                    label="PIN para Descuentos" 
                                    description="Protege los descuentos manuales con clave."
                                    checked={activeTerminal.config.security.requirePinForDiscount} 
                                    icon={ShieldCheck}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requirePinForDiscount', v)} 
                                 />
                              </div>
                          </div>
                        )}
                        {activeTab === 'SESSION' && (
                          <div className="space-y-6 animate-in slide-in-from-right-4">
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                 <Toggle 
                                    label="Cierre Ciego (Blind Close)" 
                                    description="El cajero no ve el monto esperado por el sistema al cerrar."
                                    checked={activeTerminal.config.workflow.session.blindClose} 
                                    icon={ShieldAlert}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'blindClose', v)} 
                                 />
                                 <Toggle 
                                    label="Impresión Automática Z" 
                                    description="Genera el reporte físico al confirmar el cierre."
                                    checked={activeTerminal.config.workflow.session.autoPrintZReport} 
                                    icon={Receipt}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'autoPrintZReport', v)} 
                                 />
                                 <div className="p-5 rounded-2xl border-2 border-transparent bg-white shadow-sm flex flex-col gap-4">
                                      <div className="flex items-start gap-4">
                                          <div className="p-2 rounded-lg bg-orange-50 text-orange-600 shrink-0">
                                              <Coins size={20} />
                                          </div>
                                          <div className="flex-1">
                                              <h4 className="font-bold text-sm text-gray-700">Límite de Efectivo en Gaveta</h4>
                                              <p className="text-left text-[11px] text-gray-400 mt-1 leading-relaxed">Alerta al cajero para realizar retiro cuando se supere este monto.</p>
                                          </div>
                                      </div>
                                      <div className="relative">
                                          <input 
                                              type="number" 
                                              value={activeTerminal.config.workflow.session.maxCashInDrawer} 
                                              onChange={(e) => handleUpdateActiveConfig('workflow.session', 'maxCashInDrawer', parseFloat(e.target.value))}
                                              className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl font-bold text-gray-800 outline-none focus:ring-2 focus:ring-orange-100 transition-all"
                                          />
                                      </div>
                                  </div>
                              </div>
                          </div>
                        )}
                        {activeTab === 'DOCUMENTS' && (
                           <div className="space-y-6 animate-in slide-in-from-right-4">
                              <div className="flex items-center gap-4 mb-4 bg-blue-50 p-4 rounded-2xl border border-blue-100">
                                 <AlertCircle className="text-blue-500" />
                                 <p className="text-sm text-blue-800 font-medium">Configura los prefijos y numeración fiscal para cada tipo de documento en esta terminal.</p>
                              </div>
                              <div className="space-y-4">
                                 {activeTerminal.config.documentSeries.map((series, index) => {
                                    let Icon = FileText;
                                    if (series.icon === 'Receipt') Icon = Receipt;
                                    if (series.icon === 'RotateCcw') Icon = RotateCcw;
                                    if (series.icon === 'ArrowRightLeft') Icon = ArrowRightLeft;
                                    return (
                                    <div key={series.id} className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm transition-all hover:border-blue-300">
                                       <div className="flex flex-col md:flex-row items-start md:items-center gap-6 mb-6">
                                          <div className="flex items-center gap-4 flex-1">
                                             <div className="p-3 rounded-2xl bg-gray-100 text-gray-600">
                                                <Icon size={24} />
                                             </div>
                                             <div>
                                                <h3 className="text-lg font-bold text-gray-800">{series.name}</h3>
                                                <p className="text-xs text-gray-500 uppercase font-bold tracking-widest">{series.id}</p>
                                             </div>
                                          </div>
                                          <div className="bg-slate-900 px-6 py-2.5 rounded-2xl text-white shadow-xl flex flex-col items-center">
                                             <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Próximo Folio</span>
                                             <span className="font-mono text-lg font-black tracking-widest text-blue-400">
                                                {series.prefix}-{series.nextNumber.toString().padStart(series.padding, '0')}
                                             </span>
                                          </div>
                                       </div>
                                       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                          <div>
                                             <label className="block text-[10px] font-bold text-gray-400 uppercase mb-2 ml-1">Prefijo de Serie</label>
                                             <div className="relative">
                                                <input 
                                                   type="text" 
                                                   value={series.prefix}
                                                   onChange={(e) => {
                                                      const newSeries = [...activeTerminal.config.documentSeries];
                                                      newSeries[index].prefix = e.target.value.toUpperCase();
                                                      handleUpdateActiveConfig('', 'documentSeries', newSeries);
                                                   }}
                                                   className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-100 uppercase"
                                                   placeholder="TCK"
                                                />
                                                <Type className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300" size={16} />
                                             </div>
                                          </div>
                                          <div>
                                             <label className="block text-[10px] font-bold text-gray-400 uppercase mb-2 ml-1">Siguiente Número</label>
                                             <div className="relative">
                                                <input 
                                                   type="number" 
                                                   value={series.nextNumber}
                                                   onChange={(e) => {
                                                      const newSeries = [...activeTerminal.config.documentSeries];
                                                      newSeries[index].nextNumber = parseInt(e.target.value) || 1;
                                                      handleUpdateActiveConfig('', 'documentSeries', newSeries);
                                                   }}
                                                   className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-100"
                                                />
                                                <Hash className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300" size={16} />
                                             </div>
                                          </div>
                                          <div>
                                             <label className="block text-[10px] font-bold text-gray-400 uppercase mb-2 ml-1">Ceros a la Izquierda</label>
                                             <select 
                                                value={series.padding}
                                                onChange={(e) => {
                                                   const newSeries = [...activeTerminal.config.documentSeries];
                                                   newSeries[index].padding = parseInt(e.target.value);
                                                   handleUpdateActiveConfig('', 'documentSeries', newSeries);
                                                }}
                                                className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-100"
                                             >
                                                {[4, 6, 8, 10].map(n => <option key={n} value={n}>{n} dígitos</option>)}
                                             </select>
                                          </div>
                                       </div>
                                    </div>
                                 )})}
                              </div>
                           </div>
                        )}
                        {/* OFFLINE / SYNC TAB */}
                        {activeTab === 'OFFLINE' && (
                           <div className="space-y-8 animate-in slide-in-from-right-4 max-w-4xl mx-auto">
                              
                              {/* Central Indicator Card */}
                              <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 p-10 flex flex-col items-center justify-center relative overflow-hidden">
                                 <div className={`absolute top-0 left-0 w-full h-2 bg-gradient-to-r ${syncStatus === 'SYNCED' ? 'from-emerald-400 to-green-500' : syncStatus === 'OFFLINE' ? 'from-red-500 to-orange-500' : 'from-blue-400 to-indigo-500'}`}></div>
                                 
                                 <div className={`w-40 h-40 rounded-full flex items-center justify-center mb-6 shadow-2xl transition-all duration-500 ${getStatusColor()} ${syncStatus === 'SYNCED' ? 'scale-100' : 'scale-105'}`}>
                                    {getStatusIcon()}
                                 </div>

                                 <h2 className={`text-3xl font-black mb-2 transition-colors ${syncStatus === 'OFFLINE' ? 'text-red-600' : 'text-gray-800'}`}>
                                    {getStatusText()}
                                 </h2>
                                 
                                 <p className="text-gray-500 font-medium text-lg text-center max-w-md">
                                    {syncStatus === 'SYNCED' ? 'Los datos de esta terminal están seguros en la nube.' : syncStatus === 'SYNCING' ? 'Subiendo cambios recientes...' : 'Datos guardados localmente. Se subirán al reconectar.'}
                                 </p>

                                 {/* Progress Bar (Syncing) */}
                                 {syncStatus === 'SYNCING' && (
                                    <div className="w-full max-w-xs mt-6 bg-gray-100 h-2 rounded-full overflow-hidden">
                                       <div className="bg-blue-500 h-full transition-all duration-300" style={{ width: `${syncProgress}%` }}></div>
                                    </div>
                                 )}

                                 {/* Last Sync Info */}
                                 {syncStatus !== 'SYNCING' && (
                                    <div className="mt-8 flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-full border border-gray-200 text-sm text-gray-500">
                                       <Activity size={16} />
                                       <span>Último respaldo: <strong>{lastSync.toLocaleTimeString()}</strong></span>
                                    </div>
                                 )}
                              </div>

                              {/* Details Grid */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                 {/* Queue Info */}
                                 <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-200">
                                    <div className="flex items-center gap-3 mb-4 text-orange-600">
                                       <div className="p-2 bg-orange-100 rounded-lg"><Server size={20} /></div>
                                       <h3 className="font-bold text-lg">Cola de Subida</h3>
                                    </div>
                                    <div className="flex-1 bg-orange-50/50 rounded-xl p-4 border border-orange-100 mb-4">
                                       <div className="flex justify-between items-center mb-2">
                                          <span className="text-sm font-medium text-gray-700 flex items-center gap-2"><FileText size={14}/> Tickets de Venta</span>
                                          <span className="font-bold text-orange-600">{pendingItems} pendientes</span>
                                       </div>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-auto">* Los datos se almacenan de forma segura en el dispositivo hasta recuperar la conexión.</p>
                                 </div>

                                 {/* Actions */}
                                 <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-200 flex flex-col justify-between">
                                    <div>
                                       <h3 className="font-bold text-lg text-gray-800 mb-2">Acciones Manuales</h3>
                                       <p className="text-sm text-gray-500 mb-6">Opciones de diagnóstico y sincronización.</p>
                                    </div>
                                    <div className="space-y-3">
                                       <button onClick={handleForceSync} disabled={syncStatus === 'SYNCING'} className="w-full py-4 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-slate-800 disabled:opacity-50 shadow-lg active:scale-95 transition-all">
                                          <RefreshCw size={20} className={syncStatus === 'SYNCING' ? 'animate-spin' : ''} />
                                          {syncStatus === 'SYNCING' ? 'Sincronizando...' : 'Forzar Sincronización'}
                                       </button>
                                       
                                       <div className="flex justify-center pt-2">
                                          <button onClick={toggleSimulationMode} className="text-xs text-gray-400 underline">
                                             Simular {syncStatus === 'OFFLINE' ? 'Conexión' : 'Desconexión'}
                                          </button>
                                       </div>
                                       
                                       {syncStatus === 'OFFLINE' && (
                                          <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-xl text-xs font-bold justify-center">
                                             <AlertTriangle size={14} /> Verifique conexión WiFi
                                          </div>
                                       )}
                                    </div>
                                 </div>
                              </div>
                           </div>
                        )}
                    </div>
                ) : <div className="h-full flex flex-col items-center justify-center text-gray-400 italic"><p>Selecciona una terminal</p></div>}
            </div>
        </div>

        {/* --- UNLINK CONFIRMATION MODAL --- */}
        {unlinkConfirmId && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white rounded-[2rem] w-full max-w-sm p-8 shadow-2xl animate-in zoom-in-95 text-center">
              <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <Link2Off size={32} />
              </div>
              <h3 className="text-xl font-black text-slate-800 mb-2">¿Liberar esta terminal?</h3>
              <p className="text-slate-500 text-sm mb-8 leading-relaxed">
                Esto desconectará el dispositivo actual de la terminal <strong>{unlinkConfirmId}</strong>. 
                La próxima computadora que ingrese podrá tomar el control de esta caja. <br/><br/>
                ¿Está seguro?
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setUnlinkConfirmId(null)}
                  className="flex-1 py-3.5 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => handleUnlinkTerminal(unlinkConfirmId)}
                  className="flex-1 py-3.5 bg-orange-500 text-white rounded-xl font-bold shadow-lg shadow-orange-200 hover:bg-orange-600 active:scale-95 transition-all"
                >
                  Sí, Liberar
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};

export default TerminalSettings;
