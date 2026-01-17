
import React, { useState, useMemo, useRef } from 'react';
import { 
  Database, Clock, WifiOff, X, Save, Image as ImageIcon, 
  Receipt, Monitor, Plus, Trash2, Smartphone, CheckCircle2,
  ChevronRight, ChevronLeft, Settings as SettingsIcon, AlertCircle,
  LayoutGrid, ShieldCheck, Zap, Lock, ShieldAlert,
  ArrowRight, Users, FileText, Hash, Type, RotateCcw, Tag, 
  DollarSign, Check, Percent, Calculator, Coins, Box, ArrowRightLeft,
  Link2Off, MonitorOff, Cloud, RefreshCw, Activity, Wifi, Server, AlertTriangle,
  Circle, CheckCircle, ChevronDown
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

const TerminalSettings: React.FC<TerminalSettingsProps> = ({ config, onUpdateConfig, onClose, warehouses = [] }) => {
  const [terminals, setTerminals] = useState(config.terminals || []);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>(terminals[0]?.id || '');
  const [activeTab, setActiveTab] = useState<TerminalTab>('OPERATIONAL');
  const [unlinkConfirmId, setUnlinkConfirmId] = useState<string | null>(null);

  const [taxes, setTaxes] = useState<TaxDefinition[]>(config.taxes || []);
  const [editingTaxId, setEditingTaxId] = useState<string | null>(null);

  // Sync Status State
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
            currentDeviceId: null, // Explicit null to ensure unlinking
            lastPairingDate: undefined 
          } 
        };
      }
      return t;
    }));
    setUnlinkConfirmId(null);
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

  const handleSave = () => {
    onUpdateConfig({ ...config, terminals: terminals, taxes: taxes });
    alert("Configuraciones guardadas correctamente.");
    onClose();
  };

  const handleForceSync = () => {
    setSyncStatus('SYNCING');
    // Simulate sync process
    setTimeout(() => {
      setSyncStatus('SYNCED');
      setLastSync(new Date());
    }, 2000);
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

  // Helpers for Toggle Switch
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
                          <div className="space-y-8 animate-in slide-in-from-right-4">
                              <section>
                                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Control de Inventario</h3>
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
                                    <Toggle 
                                      label="Reservar Stock en Carrito" 
                                      description="Bloquea el inventario temporalmente mientras está en el carrito."
                                      checked={activeTerminal.config.workflow.inventory.reserveStockOnCart} 
                                      onChange={(v: boolean) => handleUpdateActiveConfig('workflow.inventory', 'reserveStockOnCart', v)} 
                                    />
                                </div>
                              </section>
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

                        {activeTab === 'PRICING' && (
                          <div className="space-y-8 animate-in slide-in-from-right-4">
                            <section className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm">
                              <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                                <Tag className="text-purple-600" /> Configuración de Tarifas
                              </h3>
                              
                              {/* Default Tariff */}
                              <div className="mb-8">
                                <label className="block text-sm font-bold text-gray-500 uppercase tracking-widest mb-2">Tarifa Predeterminada</label>
                                <div className="relative">
                                  <select
                                    value={activeTerminal.config.pricing.defaultTariffId}
                                    onChange={(e) => handleUpdateActiveConfig('pricing', 'defaultTariffId', e.target.value)}
                                    className="w-full p-4 bg-purple-50 border border-purple-100 rounded-xl font-bold text-purple-900 outline-none focus:ring-2 focus:ring-purple-200 appearance-none"
                                  >
                                    {config.tariffs.map(t => (
                                      <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                  </select>
                                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-purple-400" size={20} />
                                </div>
                                <p className="text-xs text-gray-400 mt-2">Esta tarifa se aplicará automáticamente al iniciar una venta.</p>
                              </div>

                              {/* Allowed Tariffs */}
                              <div>
                                <label className="block text-sm font-bold text-gray-500 uppercase tracking-widest mb-4">Listas Disponibles</label>
                                <div className="space-y-3">
                                  {config.tariffs.map(tariff => {
                                    const isAllowed = activeTerminal.config.pricing.allowedTariffIds.includes(tariff.id);
                                    return (
                                      <div 
                                        key={tariff.id}
                                        onClick={() => {
                                          const current = activeTerminal.config.pricing.allowedTariffIds;
                                          const newAllowed = isAllowed 
                                            ? current.filter(id => id !== tariff.id)
                                            : [...current, tariff.id];
                                          handleUpdateActiveConfig('pricing', 'allowedTariffIds', newAllowed);
                                          
                                          // Validation: Default must be in allowed
                                          if (isAllowed && activeTerminal.config.pricing.defaultTariffId === tariff.id) {
                                             // If removing default, pick another if possible
                                             if (newAllowed.length > 0) handleUpdateActiveConfig('pricing', 'defaultTariffId', newAllowed[0]);
                                          }
                                        }}
                                        className={`flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all ${
                                          isAllowed ? 'bg-white border-purple-500 shadow-sm' : 'bg-gray-50 border-gray-100 opacity-60 hover:opacity-100'
                                        }`}
                                      >
                                        <div className="flex items-center gap-4">
                                          <div className={`p-2 rounded-lg ${isAllowed ? 'bg-purple-100 text-purple-600' : 'bg-gray-200 text-gray-400'}`}>
                                            <Tag size={20} />
                                          </div>
                                          <div>
                                            <h4 className={`font-bold ${isAllowed ? 'text-gray-800' : 'text-gray-500'}`}>{tariff.name}</h4>
                                            <p className="text-xs text-gray-400">{tariff.currency} • {tariff.strategy.type}</p>
                                          </div>
                                        </div>
                                        
                                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${isAllowed ? 'bg-purple-600 border-purple-600' : 'bg-white border-gray-300'}`}>
                                          {isAllowed && <Check size={14} className="text-white" />}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </section>
                          </div>
                        )}

                        {activeTab === 'TAXES' && (
                           <div className="space-y-8 animate-in slide-in-from-right-4">
                              <section className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm">
                                 <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                       <Percent className="text-emerald-600" /> Impuestos Globales
                                    </h3>
                                    <button onClick={handleAddTax} className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-xs shadow-md hover:bg-emerald-700 flex items-center gap-2">
                                       <Plus size={16} /> Nuevo Impuesto
                                    </button>
                                 </div>
                                 
                                 <div className="space-y-4">
                                    {taxes.map(tax => (
                                       <div key={tax.id} className="p-4 rounded-xl border border-gray-200 flex flex-col md:flex-row items-center gap-4 bg-gray-50/50">
                                          <div className="flex-1 w-full md:w-auto">
                                             <label className="text-[10px] font-bold text-gray-400 uppercase">Nombre</label>
                                             <input 
                                                type="text" 
                                                value={tax.name}
                                                onChange={(e) => handleUpdateTax(tax.id, { name: e.target.value })}
                                                className="w-full p-2 bg-white border border-gray-200 rounded-lg font-bold text-gray-700"
                                             />
                                          </div>
                                          <div className="w-full md:w-32">
                                             <label className="text-[10px] font-bold text-gray-400 uppercase">Tasa (%)</label>
                                             <div className="relative">
                                                <input 
                                                   type="number" 
                                                   value={(tax.rate * 100).toFixed(2)}
                                                   onChange={(e) => handleUpdateTax(tax.id, { rate: parseFloat(e.target.value) / 100 })}
                                                   className="w-full p-2 bg-white border border-gray-200 rounded-lg font-bold text-emerald-700 text-right pr-8"
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">%</span>
                                             </div>
                                          </div>
                                          <div className="w-full md:w-40">
                                             <label className="text-[10px] font-bold text-gray-400 uppercase">Tipo</label>
                                             <select 
                                                value={tax.type}
                                                onChange={(e) => handleUpdateTax(tax.id, { type: e.target.value as any })}
                                                className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm"
                                             >
                                                <option value="VAT">IVA / ITBIS</option>
                                                <option value="SERVICE_CHARGE">Ley / Propina</option>
                                                <option value="EXEMPT">Exento</option>
                                                <option value="OTHER">Otro</option>
                                             </select>
                                          </div>
                                          <button onClick={() => handleDeleteTax(tax.id)} className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 mt-4 md:mt-0">
                                             <Trash2 size={18} />
                                          </button>
                                       </div>
                                    ))}
                                 </div>
                              </section>
                           </div>
                        )}

                        {activeTab === 'SECURITY' && (
                           <div className="space-y-8 animate-in slide-in-from-right-4">
                              <section>
                                 <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Permisos y Accesos</h3>
                                 <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                    <Toggle 
                                       label="Requiere PIN para Anular"
                                       description="Solicita código de supervisor para anular tickets."
                                       checked={activeTerminal.config.security.requirePinForVoid}
                                       onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requirePinForVoid', v)}
                                       icon={Lock}
                                    />
                                    <Toggle 
                                       label="Requiere PIN para Descuento"
                                       description="Solo supervisores pueden aplicar descuentos manuales."
                                       checked={activeTerminal.config.security.requirePinForDiscount}
                                       onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requirePinForDiscount', v)}
                                       icon={Percent}
                                    />
                                    <Toggle 
                                       label="Devoluciones Protegidas"
                                       description="Requerir huella o PIN de gerente para reembolsos."
                                       checked={activeTerminal.config.security.requireManagerForRefunds}
                                       onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requireManagerForRefunds', v)}
                                       icon={ShieldAlert}
                                    />
                                 </div>
                              </section>
                              
                              <section className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                                 <div className="flex items-center gap-4 mb-6">
                                    <div className="p-3 bg-orange-100 text-orange-600 rounded-xl">
                                      <Clock size={24} />
                                    </div>
                                    <div>
                                      <h3 className="font-bold text-lg text-gray-900">Auto-Logout por Inactividad</h3>
                                      <p className="text-sm text-gray-400">Cerrar sesión automáticamente tras X minutos.</p>
                                    </div>
                                    <div className="ml-auto text-2xl font-black text-orange-500">
                                      {activeTerminal.config.security.autoLogoutMinutes > 0 ? `${activeTerminal.config.security.autoLogoutMinutes} min` : 'Desactivado'}
                                    </div>
                                 </div>
                                 
                                 <input 
                                    type="range" 
                                    min="0" 
                                    max="60" 
                                    step="5"
                                    value={activeTerminal.config.security.autoLogoutMinutes}
                                    onChange={(e) => handleUpdateActiveConfig('security', 'autoLogoutMinutes', parseInt(e.target.value))}
                                    className="w-full h-3 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                 />
                                 <div className="flex justify-between mt-2 text-xs font-bold text-gray-300 uppercase">
                                    <span>Nunca</span>
                                    <span>30 min</span>
                                    <span>1 hora</span>
                                 </div>
                              </section>
                           </div>
                        )}

                        {activeTab === 'SESSION' && (
                           <div className="space-y-8 animate-in slide-in-from-right-4">
                              <section>
                                 <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Cierre de Caja</h3>
                                 <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                    <Toggle 
                                       label="Cierre Ciego (Blind Close)"
                                       description="Oculta el total esperado al cajero durante el conteo."
                                       checked={activeTerminal.config.workflow.session.blindClose}
                                       onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'blindClose', v)}
                                       icon={CheckCircle2}
                                    />
                                    <Toggle 
                                       label="Impresión Automática Z"
                                       description="Imprime reporte físico al finalizar el turno."
                                       checked={activeTerminal.config.workflow.session.autoPrintZReport}
                                       onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'autoPrintZReport', v)}
                                       icon={Receipt}
                                    />
                                 </div>
                              </section>

                              <section className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                                 <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                                    <Coins size={20} className="text-yellow-500" /> Límites de Efectivo
                                 </h3>
                                 <div className="flex gap-4 items-center">
                                    <div className="flex-1">
                                       <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Alerta de Exceso en Caja</label>
                                       <div className="relative">
                                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                                          <input 
                                             type="number" 
                                             value={activeTerminal.config.workflow.session.maxCashInDrawer}
                                             onChange={(e) => handleUpdateActiveConfig('workflow.session', 'maxCashInDrawer', parseFloat(e.target.value))}
                                             className="w-full p-3 pl-8 bg-gray-50 border border-gray-200 rounded-xl outline-none font-mono font-bold text-gray-800"
                                          />
                                       </div>
                                       <p className="text-xs text-gray-400 mt-2">El sistema sugerirá un retiro parcial al superar este monto.</p>
                                    </div>
                                 </div>
                              </section>
                           </div>
                        )}

                        {activeTab === 'DOCUMENTS' && (
                           <div className="space-y-8 animate-in slide-in-from-right-4">
                              <section>
                                 <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Secuencias de Documentos</h3>
                                 <div className="space-y-3">
                                    {activeTerminal.config.documentSeries.map((series, idx) => (
                                       <div key={series.id} className="bg-white p-4 rounded-xl border border-gray-200 flex items-center justify-between">
                                          <div className="flex items-center gap-4">
                                             <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-xs ${
                                                series.id === 'INVOICE' ? 'bg-indigo-500' : 'bg-blue-500'
                                             }`}>
                                                {series.prefix.split('-')[0]}
                                             </div>
                                             <div>
                                                <h4 className="font-bold text-gray-800">{series.name}</h4>
                                                <p className="text-xs text-gray-400">Próximo: {series.prefix}-{series.nextNumber}</p>
                                             </div>
                                          </div>
                                          <div className="w-32">
                                             <label className="block text-[9px] font-bold text-gray-400 uppercase mb-1">Prefijo</label>
                                             <input 
                                                type="text" 
                                                value={series.prefix}
                                                onChange={(e) => {
                                                   const newSeries = [...activeTerminal.config.documentSeries];
                                                   newSeries[idx].prefix = e.target.value;
                                                   handleUpdateActiveConfig('documentSeries', '', newSeries); // Direct array update workaround
                                                   // Actually, handleUpdateActiveConfig supports direct key update if path is empty or matches logic
                                                   // But let's use the object path logic properly or do a direct config update
                                                   const newConfig = { ...activeTerminal.config, documentSeries: newSeries };
                                                   setTerminals(prev => prev.map(t => t.id === selectedTerminalId ? { ...t, config: newConfig } : t));
                                                }}
                                                className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 uppercase"
                                             />
                                          </div>
                                       </div>
                                    ))}
                                 </div>
                              </section>
                           </div>
                        )}

                        {activeTab === 'OFFLINE' && (
                           <div className="space-y-8 animate-in slide-in-from-right-4">
                              <section className="bg-white p-6 rounded-3xl border border-gray-200 shadow-sm text-center">
                                 <div className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4 transition-colors ${
                                    syncStatus === 'SYNCED' ? 'bg-emerald-100 text-emerald-600' : 
                                    syncStatus === 'OFFLINE' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
                                 }`}>
                                    {syncStatus === 'SYNCED' ? <CheckCircle2 size={48} /> : 
                                     syncStatus === 'OFFLINE' ? <WifiOff size={48} /> : <RefreshCw size={48} className="animate-spin" />}
                                 </div>
                                 <h3 className="text-2xl font-black text-gray-800 mb-2">
                                    {syncStatus === 'SYNCED' ? 'Terminal Sincronizada' : 
                                     syncStatus === 'OFFLINE' ? 'Modo Sin Conexión' : 'Sincronizando...'}
                                 </h3>
                                 <p className="text-gray-500 mb-6">
                                    {syncStatus === 'SYNCED' ? 'Todos los datos están respaldados en la nube.' : 
                                     'Los datos se guardan localmente hasta recuperar la conexión.'}
                                 </p>
                                 <button 
                                    onClick={handleForceSync}
                                    disabled={syncStatus === 'SYNCING'}
                                    className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold shadow-lg hover:bg-black transition-all disabled:opacity-50"
                                 >
                                    Forzar Sincronización
                                 </button>
                              </section>

                              <section>
                                 <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Configuración Offline</h3>
                                 <div className="grid grid-cols-1 gap-4">
                                    <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                                       <div className="flex justify-between items-center mb-4">
                                          <div>
                                             <h4 className="font-bold text-gray-800">Límite de Transacciones Offline</h4>
                                             <p className="text-xs text-gray-400">Máximo de ventas permitidas sin conexión.</p>
                                          </div>
                                          <span className="text-xl font-black text-blue-600">{activeTerminal.config.workflow.offline.maxOfflineTransactionLimit}</span>
                                       </div>
                                       <input 
                                          type="range" 
                                          min="100" 
                                          max="2000" 
                                          step="100"
                                          value={activeTerminal.config.workflow.offline.maxOfflineTransactionLimit}
                                          onChange={(e) => handleUpdateActiveConfig('workflow.offline', 'maxOfflineTransactionLimit', parseInt(e.target.value))}
                                          className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                       />
                                    </div>
                                 </div>
                              </section>
                           </div>
                        )}

                    </div>
                ) : <div className="h-full flex flex-col items-center justify-center text-gray-400 italic"><p>Selecciona una terminal</p></div>}
            </div>
        </div>
        
        {/* Unlink Confirmation Modal */}
        {unlinkConfirmId && (
           <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
              <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl text-center">
                 <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Link2Off size={32} />
                 </div>
                 <h3 className="text-xl font-bold text-gray-800 mb-2">¿Desvincular Terminal?</h3>
                 <p className="text-sm text-gray-500 mb-6">
                    La terminal <strong>{unlinkConfirmId}</strong> perderá la conexión con su hardware actual. Será necesario volver a emparejar el dispositivo.
                 </p>
                 <div className="flex gap-3">
                    <button onClick={() => setUnlinkConfirmId(null)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-50 rounded-xl">Cancelar</button>
                    <button onClick={() => handleUnlinkTerminal(unlinkConfirmId)} className="flex-1 py-3 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 shadow-md">Confirmar</button>
                 </div>
              </div>
           </div>
        )}
    </div>
  );
};

export default TerminalSettings;
