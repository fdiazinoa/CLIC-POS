
import React, { useState, useMemo, useRef } from 'react';
import { 
  Database, Clock, WifiOff, X, Save, Image as ImageIcon, 
  Receipt, Monitor, Plus, Trash2, Smartphone, CheckCircle2,
  ChevronRight, ChevronLeft, Settings as SettingsIcon, AlertCircle,
  LayoutGrid, ShieldCheck, Zap, Lock, ShieldAlert,
  ArrowRight, Users, FileText, Hash, Type, RotateCcw, Tag, 
  DollarSign, Check, Percent, Calculator, Coins, Box, ArrowRightLeft,
  Link2Off, MonitorOff, Cloud, RefreshCw, Activity, Wifi, Server, AlertTriangle,
  Circle, CheckCircle, ChevronDown, Landmark, Link, Shield, Globe, HardDrive,
  Building2, Printer, Settings2, Info, Unlink, BarChart3, ShieldQuestion,
  ToggleLeft, ToggleRight, Radio, Power, Scale, Tv, Mail, ShoppingBag, Truck
} from 'lucide-react';
import { BusinessConfig, TerminalConfig, DocumentSeries, Tariff, TaxDefinition, Warehouse, NCFType, NCFConfig, Transaction, ScaleDevice } from '../types';
import { DEFAULT_DOCUMENT_SERIES, DEFAULT_TERMINAL_CONFIG } from '../constants';
import { db } from '../utils/db';

interface TerminalSettingsProps {
  config: BusinessConfig;
  onUpdateConfig: (newConfig: BusinessConfig) => void;
  onClose: () => void;
  warehouses?: Warehouse[];
}

// Roles de impresora para el terminal
const PRINTER_ROLES = [
  { id: 'TICKET', label: 'Ticket de Venta', icon: Receipt },
  { id: 'LABEL', label: 'Etiquetas (Deli/Precios)', icon: Tag },
  { id: 'KITCHEN', label: 'Comandas de Cocina', icon: ShoppingBag },
  { id: 'LOGISTICS', label: 'Logística / Almacén', icon: Truck },
];

type TerminalTab = 'OPERATIONAL' | 'FISCAL' | 'SECURITY' | 'SESSION' | 'PRICING' | 'DOCUMENTS' | 'OFFLINE' | 'TAXES' | 'INVENTORY';

const TerminalSettings: React.FC<TerminalSettingsProps> = ({ config, onUpdateConfig, onClose, warehouses = [] }) => {
  const [terminals, setTerminals] = useState(config.terminals || []);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>(terminals[0]?.id || '');
  const [activeTab, setActiveTab] = useState<TerminalTab>('OPERATIONAL');
  
  const [isLinkingSeries, setIsLinkingSeries] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);

  const activeTerminal = useMemo(() => 
    terminals.find(t => t.id === selectedTerminalId), 
  [terminals, selectedTerminalId]);

  // --- FISCAL CONSUMPTION CALCULATION ---
  const terminalFiscalStats = useMemo(() => {
    const txns = db.get('transactions') as Transaction[] || [];
    const stats: Record<NCFType, number> = { 'B01': 0, 'B02': 0, 'B14': 0, 'B15': 0 };
    
    txns.filter(t => t.terminalId === selectedTerminalId).forEach(tx => {
      if (tx.ncfType) {
        stats[tx.ncfType] = (stats[tx.ncfType] || 0) + 1;
      }
    });

    return stats;
  }, [selectedTerminalId]);

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
    const terminalNumber = terminals.length + 1;
    const nextId = `t${terminalNumber}`;
    const suffix = terminalNumber.toString().padStart(2, '0');

    const newConfig = JSON.parse(JSON.stringify(DEFAULT_TERMINAL_CONFIG));
    
    newConfig.documentSeries = DEFAULT_DOCUMENT_SERIES.map(series => ({
      ...series,
      prefix: `${series.prefix}${suffix}`
    }));

    const newTerminal = {
      id: nextId,
      config: newConfig
    };
    
    setTerminals([...terminals, newTerminal]);
    setSelectedTerminalId(nextId);
  };

  const handleUpdateTypeConfig = (type: NCFType, key: keyof NCFConfig, val: number) => {
    if (!activeTerminal) return;
    const currentFiscal = activeTerminal.config.fiscal || { batchSize: 100, lowBatchThreshold: 20 };
    const typeConfigs = currentFiscal.typeConfigs || {};
    const typeConfig = typeConfigs[type] || { batchSize: 100, lowBatchThreshold: 20 };
    
    handleUpdateActiveConfig('fiscal.typeConfigs', type, {
       ...typeConfig,
       [key]: val
    });
  };

  const toggleScaleAssignment = (scale: ScaleDevice) => {
    if (!activeTerminal) return;
    const currentScales = activeTerminal.config.hardware.scales || [];
    const isAssigned = currentScales.some(s => s.id === scale.id);
    
    const updatedScales = isAssigned 
      ? currentScales.filter(s => s.id !== scale.id)
      : [...currentScales, scale];
      
    handleUpdateActiveConfig('hardware', 'scales', updatedScales);
  };

  const updatePrinterAssignment = (role: string, printerId: string) => {
    if (!activeTerminal) return;
    const currentAssignments = activeTerminal.config.hardware.printerAssignments || {};
    handleUpdateActiveConfig('hardware', 'printerAssignments', {
       ...currentAssignments,
       [role]: printerId
    });
    
    // Mantener compatibilidad con el legacyId
    if (role === 'TICKET') {
      handleUpdateActiveConfig('hardware', 'receiptPrinterId', printerId);
    }
  };

  const unlinkSeriesFromTerminal = (seriesId: string) => {
    if (!activeTerminal) return;
    const currentSeries = activeTerminal.config.documentSeries || [];
    handleUpdateActiveConfig('', 'documentSeries', currentSeries.filter(s => s.id !== seriesId));
  };

  const linkSeriesToTerminal = (series: DocumentSeries) => {
    if (!activeTerminal) return;
    const currentSeries = activeTerminal.config.documentSeries || [];
    if (currentSeries.some(s => s.id === series.id)) return;
    handleUpdateActiveConfig('', 'documentSeries', [...currentSeries, series]);
    setIsLinkingSeries(false);
  };

  const handleUnpairDevice = () => {
    if (confirm("¿Desvincular este dispositivo de la terminal? El dispositivo actual perderá acceso inmediatamente.")) {
      handleUpdateActiveConfig('', 'currentDeviceId', undefined);
      handleUpdateActiveConfig('', 'lastPairingDate', undefined);
    }
  };

  const handleSave = () => {
    onUpdateConfig({ ...config, terminals: terminals });
    alert("Configuraciones de terminales guardadas.");
    onClose();
  };

  const scrollTabs = (direction: 'left' | 'right') => {
    if (tabsRef.current) {
      const scrollAmount = 300;
      tabsRef.current.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
    }
  };

  const Toggle = ({ label, description, checked, onChange, danger = false, icon: Icon }: any) => (
    <div 
        onClick={() => onChange(!checked)}
        className={`p-5 rounded-2xl border-2 cursor-pointer flex justify-between items-center transition-all group ${checked ? (danger ? 'bg-red-50 border-red-500 shadow-sm' : 'bg-blue-50 border-blue-500 shadow-sm') : 'bg-white border-gray-100 hover:border-gray-300'}`}
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
        <aside className="w-80 bg-white border-r border-gray-200 flex flex-col shrink-0 z-20 shadow-sm">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
               <div>
                  <h2 className="text-xl font-black text-slate-800">Terminales</h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Configuración técnica</p>
               </div>
               <button 
                  onClick={handleAddTerminal}
                  className="p-2 bg-blue-600 text-white rounded-xl shadow-lg hover:bg-blue-700 active:scale-95 transition-all"
                >
                  <Plus size={20} />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
               {terminals.map((t) => (
                    <div key={t.id} onClick={() => setSelectedTerminalId(t.id)} className={`group p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between ${selectedTerminalId === t.id ? 'bg-blue-50 border-blue-500 shadow-md ring-4 ring-blue-50' : 'bg-white border-transparent hover:border-gray-200'}`}>
                      <div className="flex items-center gap-3">
                          <div className={`p-2.5 rounded-xl ${selectedTerminalId === t.id ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-100 text-gray-400'}`}><Monitor size={20} /></div>
                          <h3 className={`font-bold text-sm ${selectedTerminalId === t.id ? 'text-blue-900' : 'text-gray-700'}`}>{t.id}</h3>
                      </div>
                      {selectedTerminalId === t.id && <ChevronRight size={16} className="text-blue-500" />}
                    </div>
               ))}
            </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0 h-full">
            <header className="bg-white px-8 py-5 border-b border-gray-200 flex justify-between items-center shrink-0 z-10">
                <div className="flex items-center gap-4">
                   <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3"><SettingsIcon className="text-blue-600" /> Terminal: <span className="text-blue-600">{selectedTerminalId}</span></h2>
                </div>
                <div className="flex gap-3">
                    <button onClick={handleSave} className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold flex items-center gap-2 shadow-xl shadow-blue-500/20 hover:bg-blue-700 active:scale-95 transition-all"><Save size={20}/> Guardar Cambios</button>
                    <button onClick={onClose} className="p-3 bg-gray-100 text-gray-500 hover:bg-gray-200 rounded-xl transition-colors"><X size={20}/></button>
                </div>
            </header>

            <div className="relative bg-white border-b border-gray-100 shrink-0">
                <button onClick={() => scrollTabs('left')} className="absolute left-0 top-0 bottom-0 z-10 w-12 bg-gradient-to-r from-white via-white/80 to-transparent flex items-center justify-center text-gray-400"><ChevronLeft size={24} /></button>
                <div ref={tabsRef} className="flex gap-8 px-12 overflow-x-auto no-scrollbar scroll-smooth">
                {[
                  { id: 'OPERATIONAL', label: 'Operativa', icon: Database },
                  { id: 'FISCAL', label: 'Lotes Fiscales', icon: Landmark },
                  { id: 'INVENTORY', label: 'Alcance Inventario', icon: Box },
                  { id: 'SECURITY', label: 'Seguridad', icon: ShieldAlert },
                  { id: 'SESSION', label: 'Sesión y Z', icon: Clock },
                  { id: 'DOCUMENTS', label: 'Series Internas', icon: FileText },
                  { id: 'OFFLINE', label: 'Conexión', icon: Cloud },
                ].map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id as TerminalTab)} className={`pb-4 pt-4 text-sm font-bold flex items-center gap-2 border-b-4 transition-all whitespace-nowrap ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                    <tab.icon size={18} /> {tab.label}
                  </button>
                ))}
                </div>
                <button onClick={() => scrollTabs('right')} className="absolute right-0 top-0 bottom-0 z-10 w-12 bg-gradient-to-l from-white via-white/80 to-transparent flex items-center justify-center text-gray-400"><ChevronRight size={24} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-50/50">
                {activeTerminal ? (
                    <div className="max-w-4xl mx-auto pb-20 space-y-8">
                        
                        {/* OPERATIONAL SECTION */}
                        {activeTab === 'OPERATIONAL' && (
                           <div className="space-y-6 animate-in slide-in-from-right-4">
                                <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm mb-6">
                                   <h3 className="text-xl font-black text-gray-800 mb-6 flex items-center gap-2">
                                      <Smartphone size={24} className="text-blue-600"/> Vinculación de Dispositivo
                                   </h3>
                                   
                                   {activeTerminal.config.currentDeviceId ? (
                                      <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 flex justify-between items-center">
                                         <div className="flex items-center gap-4">
                                            <div className="p-3 bg-blue-600 text-white rounded-xl shadow-lg">
                                               <Monitor size={24} />
                                            </div>
                                            <div>
                                               <p className="text-xs font-black text-blue-400 uppercase tracking-widest">Dispositivo Vinculado</p>
                                               <p className="text-lg font-mono font-bold text-blue-900">{activeTerminal.config.currentDeviceId}</p>
                                               <p className="text-[10px] text-blue-600 font-medium">Vinculado el: {new Date(activeTerminal.config.lastPairingDate || '').toLocaleString()}</p>
                                            </div>
                                         </div>
                                         <button 
                                            onClick={handleUnpairDevice}
                                            className="px-4 py-2 bg-white text-red-500 rounded-xl font-bold text-xs border-2 border-red-100 hover:bg-red-50 transition-all flex items-center gap-2"
                                         >
                                            <Unlink size={14} /> Desvincular Dispositivo
                                         </button>
                                      </div>
                                   ) : (
                                      <div className="bg-slate-100 p-6 rounded-2xl border border-dashed border-slate-300 text-center">
                                         <MonitorOff size={32} className="mx-auto text-slate-400 mb-2" />
                                         <p className="text-slate-500 font-bold">Sin dispositivo vinculado</p>
                                         <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest">El próximo administrador que inicie sesión aquí vinculará su hardware.</p>
                                      </div>
                                   )}
                                </div>

                                {/* --- SECCIÓN: ASIGNACIÓN DE HARDWARE --- */}
                                <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-8">
                                   <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                                      <h3 className="text-xl font-black text-gray-800 flex items-center gap-2">
                                         <HardDrive size={24} className="text-indigo-600"/> Hardware Asignado
                                      </h3>
                                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Configuración Periférica</span>
                                   </div>

                                   {/* Asignación de Impresoras por Rol */}
                                   <div className="space-y-6">
                                      <div className="flex justify-between items-end">
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Asignación de Impresoras por Función</label>
                                        <p className="text-[10px] text-slate-400 font-medium">Define qué impresora ejecuta cada tarea</p>
                                      </div>
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                         {PRINTER_ROLES.map(role => (
                                            <div key={role.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
                                               <div className="flex items-center gap-2 text-slate-600">
                                                  <role.icon size={16} />
                                                  <span className="text-xs font-bold uppercase tracking-tight">{role.label}</span>
                                               </div>
                                               <div className="relative group">
                                                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-hover:text-blue-500 transition-colors pointer-events-none">
                                                     <Printer size={16} />
                                                  </div>
                                                  <select 
                                                     value={activeTerminal.config.hardware.printerAssignments?.[role.id] || ''}
                                                     onChange={(e) => updatePrinterAssignment(role.id, e.target.value)}
                                                     className="w-full pl-10 pr-8 py-3 bg-white border border-slate-200 rounded-xl font-bold text-sm text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 appearance-none transition-all"
                                                  >
                                                     <option value="">-- No asignada --</option>
                                                     {/* Simulación de impresoras disponibles */}
                                                     <option value="p1">Impresora Térmica 80mm (USB)</option>
                                                     <option value="p2">Impresora de Cocina (LAN)</option>
                                                     <option value="p3">Zebra Etiquetas (BT)</option>
                                                     <option value="p4">Epson Warehouse (Wifi)</option>
                                                  </select>
                                                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                               </div>
                                            </div>
                                         ))}
                                      </div>
                                   </div>

                                   <div className="h-px bg-slate-100"></div>

                                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                      {/* Visor de Cliente */}
                                      <div className="space-y-4">
                                         <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Visor de Cliente (VFD/LCD)</label>
                                         <button 
                                            onClick={() => {
                                               const current = activeTerminal.config.hardware.customerDisplay;
                                               handleUpdateActiveConfig('hardware', 'customerDisplay', {
                                                  ...current,
                                                  isEnabled: !current?.isEnabled
                                               });
                                            }}
                                            className={`w-full p-4 rounded-2xl border-2 flex items-center justify-between transition-all ${activeTerminal.config.hardware.customerDisplay?.isEnabled ? 'border-blue-500 bg-blue-50' : 'border-slate-100 bg-slate-50'}`}
                                         >
                                            <div className="flex items-center gap-3">
                                               <Tv size={20} className={activeTerminal.config.hardware.customerDisplay?.isEnabled ? 'text-blue-600' : 'text-slate-400'} />
                                               <span className={`font-bold text-sm ${activeTerminal.config.hardware.customerDisplay?.isEnabled ? 'text-blue-900' : 'text-slate-500'}`}>
                                                  {activeTerminal.config.hardware.customerDisplay?.isEnabled ? 'Display Activado' : 'Display Desactivado'}
                                               </span>
                                            </div>
                                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${activeTerminal.config.hardware.customerDisplay?.isEnabled ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300'}`}>
                                               {activeTerminal.config.hardware.customerDisplay?.isEnabled && <Check size={14} strokeWidth={3} />}
                                            </div>
                                         </button>
                                      </div>
                                   </div>

                                   {/* Asignación de Balanzas */}
                                   <div className="space-y-4">
                                      <div className="flex justify-between items-end">
                                         <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Balanzas de Pesaje</label>
                                         <span className="text-[10px] text-slate-400 font-medium">Asigna las balanzas registradas globalmente</span>
                                      </div>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                         {(config.scales || []).map(scale => {
                                            const isAssigned = activeTerminal.config.hardware.scales?.some(s => s.id === scale.id);
                                            return (
                                               <div 
                                                  key={scale.id}
                                                  onClick={() => toggleScaleAssignment(scale)}
                                                  className={`p-4 rounded-2xl border-2 flex items-center justify-between cursor-pointer transition-all ${isAssigned ? 'border-emerald-500 bg-emerald-50 shadow-sm' : 'border-slate-100 bg-white hover:border-slate-200'}`}
                                               >
                                                  <div className="flex items-center gap-3">
                                                     <div className={`p-2 rounded-xl ${isAssigned ? 'bg-emerald-600 text-white shadow-md' : 'bg-slate-100 text-slate-400'}`}>
                                                        <Scale size={18} />
                                                     </div>
                                                     <div>
                                                        <p className={`font-bold text-sm ${isAssigned ? 'text-emerald-900' : 'text-slate-700'}`}>{scale.name}</p>
                                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">{scale.technology === 'DIRECT' ? 'SERIAL/USB' : 'ETIQUETAS'}</p>
                                                     </div>
                                                  </div>
                                                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${isAssigned ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200'}`}>
                                                     {isAssigned && <Check size={14} strokeWidth={3} />}
                                                  </div>
                                               </div>
                                            );
                                         })}
                                         {(config.scales || []).length === 0 && (
                                            <div className="col-span-full py-10 text-center bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-3 group hover:border-blue-400 transition-colors">
                                               <div className="p-3 bg-white rounded-full shadow-sm text-slate-300 group-hover:text-blue-400 transition-colors">
                                                  <Scale size={32} />
                                               </div>
                                               <p className="text-xs text-slate-400 font-bold uppercase tracking-widest px-4">No hay balanzas configuradas globalmente en Hardware.</p>
                                            </div>
                                         )}
                                      </div>
                                   </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                    <Toggle label="Validación en Tiempo Real" description="Verifica stock centralizado antes de procesar el cobro." checked={activeTerminal.config.workflow.inventory.realTimeValidation} onChange={(v: boolean) => handleUpdateActiveConfig('workflow.inventory', 'realTimeValidation', v)} icon={Database} />
                                    <Toggle label="Permitir Stock Negativo" description="Permite facturar artículos sin existencias físicas." checked={activeTerminal.config.workflow.inventory.allowNegativeStock} danger={true} onChange={(v: boolean) => handleUpdateActiveConfig('workflow.inventory', 'allowNegativeStock', v)} icon={AlertTriangle} />
                                </div>
                           </div>
                        )}

                        {/* FISCAL BATCHES SECTION */}
                        {activeTab === 'FISCAL' && (
                           <div className="animate-in slide-in-from-right-4 space-y-8">
                              <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl relative overflow-hidden">
                                 <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -mr-10 -mt-10" />
                                 <div className="relative z-10">
                                    <div className="flex justify-between items-center mb-6">
                                       <div>
                                          <h4 className="text-xs font-black text-blue-400 uppercase tracking-[0.2em] mb-1">Auditoría de Emisión</h4>
                                          <p className="text-2xl font-black text-white">Consumo Acumulado en Caja</p>
                                       </div>
                                       <div className="p-3 bg-white/5 rounded-2xl border border-white/10">
                                          <BarChart3 className="text-blue-400" size={24} />
                                       </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                       {['B01', 'B02'].map((type) => {
                                          const consumed = terminalFiscalStats[type as NCFType] || 0;
                                          const color = type === 'B01' ? 'text-blue-400' : 'text-emerald-400';
                                          
                                          return (
                                             <div key={type} className="bg-white/5 p-4 rounded-2xl border border-white/5">
                                                <div className="flex justify-between items-center mb-2">
                                                   <span className={`text-[10px] font-black uppercase ${color}`}>{type === 'B01' ? 'Crédito Fiscal' : 'Consumo'}</span>
                                                   <span className="text-[10px] font-bold text-slate-500">{type}</span>
                                                </div>
                                                <p className="text-3xl font-mono font-black text-white">{consumed.toLocaleString()}</p>
                                                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter mt-1">Total Emitidos</p>
                                             </div>
                                          );
                                       })}
                                    </div>
                                 </div>
                              </div>

                              <div className="flex items-center gap-4 mb-4">
                                 <div className="p-4 bg-indigo-100 text-indigo-600 rounded-2xl"><Landmark size={32} /></div>
                                 <div>
                                    <h3 className="text-xl font-black text-gray-800">Reservas Locales (Pool DGII)</h3>
                                    <p className="text-sm text-gray-500">Configura el tamaño de la reserva fiscal que esta terminal descarga del pool central.</p>
                                 </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                 {['B01', 'B02'].map((type) => {
                                    const typeConfig = activeTerminal.config.fiscal?.typeConfigs?.[type as NCFType] || { batchSize: 100, lowBatchThreshold: 20 };
                                    
                                    return (
                                       <div key={type} className="bg-white p-6 rounded-[2rem] border border-gray-200 shadow-sm relative overflow-hidden group">
                                          <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-500" />
                                          <div className="flex justify-between items-center mb-6">
                                             <div className="flex items-center gap-2">
                                                <span className="bg-indigo-600 text-white px-2.5 py-1 rounded-lg text-xs font-black tracking-widest">{type}</span>
                                                <h4 className="font-bold text-gray-800">{type === 'B01' ? 'Crédito Fiscal' : 'Consumo'}</h4>
                                             </div>
                                             <Settings2 size={18} className="text-gray-300 group-hover:text-indigo-400 transition-colors" />
                                          </div>

                                          <div className="space-y-6">
                                             <div>
                                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Reserva por Lote (Docs)</label>
                                                <div className="relative">
                                                   <input 
                                                      type="number"
                                                      value={typeConfig.batchSize}
                                                      onChange={(e) => handleUpdateTypeConfig(type as NCFType, 'batchSize', parseInt(e.target.value) || 0)}
                                                      className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl text-2xl font-black text-indigo-600 focus:bg-white focus:border-indigo-400 outline-none transition-all"
                                                   />
                                                   <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400 uppercase">Cantidad</span>
                                                </div>
                                             </div>

                                             <div>
                                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Umbral de Alerta (%)</label>
                                                <div className="relative">
                                                   <input 
                                                      type="number"
                                                      value={typeConfig.lowBatchThreshold}
                                                      onChange={(e) => handleUpdateTypeConfig(type as NCFType, 'lowBatchThreshold', parseInt(e.target.value) || 0)}
                                                      className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl text-2xl font-black text-indigo-600 focus:bg-white focus:border-indigo-400 outline-none transition-all"
                                                   />
                                                   <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400 uppercase">Trigger</span>
                                                </div>
                                             </div>
                                          </div>
                                       </div>
                                    );
                                 })}
                              </div>
                           </div>
                        )}

                        {/* INVENTORY SCOPE SECTION */}
                        {activeTab === 'INVENTORY' && (
                          <div className="space-y-6 animate-in slide-in-from-right-4">
                             <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm">
                                <h3 className="text-xl font-black text-gray-800 mb-6 flex items-center gap-2">
                                   <Building2 size={24} className="text-blue-600"/> Alcance de Almacenes
                                </h3>
                                
                                <div className="space-y-4">
                                   <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Almacenes Visibles</label>
                                   <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                      {warehouses.map(wh => {
                                         const isVisible = activeTerminal.config.inventoryScope?.visibleWarehouseIds.includes(wh.id);
                                         const isDefault = activeTerminal.config.inventoryScope?.defaultSalesWarehouseId === wh.id;
                                         
                                         return (
                                            <div 
                                               key={wh.id}
                                               onClick={() => {
                                                  const current = activeTerminal.config.inventoryScope?.visibleWarehouseIds || [];
                                                  const updated = isVisible ? current.filter(id => id !== wh.id) : [...current, wh.id];
                                                  handleUpdateActiveConfig('inventoryScope', 'visibleWarehouseIds', updated);
                                               }}
                                               className={`p-4 rounded-2xl border-2 flex items-center justify-between cursor-pointer transition-all ${isVisible ? 'bg-blue-50 border-blue-500 shadow-sm' : 'bg-white border-gray-100 hover:border-gray-200'}`}
                                            >
                                               <div className="flex items-center gap-3">
                                                  <div className={`p-2 rounded-lg ${isVisible ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                                                     <Box size={18} />
                                                  </div>
                                                  <div>
                                                     <p className={`font-bold text-sm ${isVisible ? 'text-blue-900' : 'text-gray-700'}`}>{wh.name}</p>
                                                     <p className="text-[10px] text-gray-400 font-mono uppercase">{wh.code}</p>
                                                  </div>
                                               </div>
                                               
                                               <div className="flex items-center gap-2">
                                                  {isVisible && (
                                                     <button 
                                                        onClick={(e) => {
                                                           e.stopPropagation();
                                                           handleUpdateActiveConfig('inventoryScope', 'defaultSalesWarehouseId', wh.id);
                                                        }}
                                                        className={`px-2 py-1 rounded-md text-[9px] font-black uppercase transition-all ${isDefault ? 'bg-emerald-50 text-white shadow-sm' : 'bg-white text-gray-400 border border-gray-200 hover:text-emerald-600'}`}
                                                     >
                                                        {isDefault ? 'Despacho Defecto' : 'Fijar Defecto'}
                                                     </button>
                                                  )}
                                                  <div className={`w-5 h-5 rounded flex items-center justify-center border-2 ${isVisible ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200'}`}>
                                                     {isVisible && <Check size={14} strokeWidth={3} />}
                                                  </div>
                                               </div>
                                            </div>
                                         );
                                      })}
                                   </div>
                                </div>
                             </div>

                             <div className="p-5 bg-orange-50 rounded-2xl border border-orange-100 flex items-start gap-4">
                                <AlertTriangle size={24} className="text-orange-500 shrink-0 mt-0.5" />
                                <p className="text-xs text-orange-800 font-medium leading-relaxed">
                                   <strong>Importante:</strong> El almacén de despacho por defecto es desde donde se restará el inventario automáticamente al completar una venta. Los almacenes visibles determinan qué stock puede consultar el cajero.
                                </p>
                             </div>
                          </div>
                        )}

                        {/* SECURITY SECTION */}
                        {activeTab === 'SECURITY' && (
                          <div className="space-y-6 animate-in slide-in-from-right-4">
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <Toggle 
                                   label="PIN para Anulaciones" 
                                   description="Requerir autorización de administrador para borrar líneas o tickets." 
                                   checked={activeTerminal.config.security.requirePinForVoid} 
                                   onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requirePinForVoid', v)} 
                                   icon={ShieldAlert}
                                />
                                <Toggle 
                                   label="PIN para Descuentos" 
                                   description="Requerir PIN para aplicar rebajas manuales en el ticket." 
                                   checked={activeTerminal.config.security.requirePinForDiscount} 
                                   onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requirePinForDiscount', v)} 
                                   icon={Percent}
                                />
                                <Toggle 
                                   label="Gerente para Reembolsos" 
                                   description="Solo usuarios con rol Manager pueden procesar devoluciones." 
                                   checked={activeTerminal.config.security.requireManagerForRefunds} 
                                   onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requireManagerForRefunds', v)} 
                                   icon={ShieldCheck}
                                />
                             </div>

                             <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm">
                                <div className="flex items-center gap-4 mb-6">
                                   <div className="p-3 bg-orange-100 text-orange-600 rounded-xl">
                                      <Clock size={24} />
                                   </div>
                                   <div>
                                      <h3 className="font-bold text-lg text-gray-900">Auto-Logout por Inactividad</h3>
                                      <p className="text-sm text-gray-400">Cerrar sesión automáticamente tras un periodo sin uso.</p>
                                   </div>
                                   <div className="ml-auto text-2xl font-black text-orange-500">
                                      {activeTerminal.config.security.autoLogoutMinutes > 0 ? `${activeTerminal.config.security.autoLogoutMinutes} min` : 'OFF'}
                                   </div>
                                </div>
                                <input 
                                   type="range" 
                                   min="0" max="60" step="5"
                                   value={activeTerminal.config.security.autoLogoutMinutes}
                                   onChange={(e) => handleUpdateActiveConfig('security', 'autoLogoutMinutes', parseInt(e.target.value))}
                                   className="w-full h-3 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-orange-500"
                                />
                             </div>
                          </div>
                        )}

                        {/* SESSION & Z SECTION */}
                        {activeTab === 'SESSION' && (
                           <div className="space-y-6 animate-in slide-in-from-right-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                 <Toggle 
                                    label="Cierre Ciego" 
                                    description="El cajero no puede ver el total esperado del sistema antes de contar." 
                                    checked={activeTerminal.config.workflow.session.blindClose} 
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'blindClose', v)} 
                                    icon={ShieldQuestion}
                                 />
                                 <Toggle 
                                    label="Ventas sin Z Abierta" 
                                    description="Permitir transacciones aunque no se haya registrado fondo inicial." 
                                    checked={activeTerminal.config.workflow.session.allowSalesWithOpenZ} 
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'allowSalesWithOpenZ', v)} 
                                    icon={Zap}
                                 />
                                 <Toggle 
                                    label="Auto-Print Reporte Z" 
                                    description="Imprimir copia física del corte diario al finalizar la sesión." 
                                    checked={activeTerminal.config.workflow.session.autoPrintZReport} 
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'autoPrintZReport', v)} 
                                    icon={Printer}
                                 />
                              </div>

                              <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
                                 <div>
                                    <div className="flex items-center gap-4 mb-4">
                                       <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
                                          <DollarSign size={24} />
                                       </div>
                                       <div>
                                          <h3 className="font-bold text-lg text-gray-900">Límite de Efectivo en Gaveta</h3>
                                          <p className="text-sm text-gray-400">Notificar retiro (drop) cuando el efectivo supere este monto.</p>
                                       </div>
                                    </div>
                                    <div className="relative">
                                       <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-gray-400 text-lg">{config.currencySymbol}</span>
                                       <input 
                                          type="number" 
                                          value={activeTerminal.config.workflow.session.maxCashInDrawer}
                                          onChange={(e) => handleUpdateActiveConfig('workflow.session', 'maxCashInDrawer', parseFloat(e.target.value) || 0)}
                                          className="w-full pl-12 pr-4 py-4 bg-gray-50 border-2 border-transparent rounded-2xl text-2xl font-black text-gray-800 focus:bg-white focus:border-indigo-400 outline-none transition-all"
                                       />
                                    </div>
                                 </div>

                                 <div className="pt-6 border-t border-gray-100">
                                    <div className="flex items-center gap-4 mb-4">
                                       <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
                                          <Mail size={24} />
                                       </div>
                                       <div>
                                          <h3 className="font-bold text-lg text-gray-900">Destinatarios Reporte Z</h3>
                                          <p className="text-sm text-gray-400">Emails que recibirán el cierre automáticamente al finalizar.</p>
                                       </div>
                                    </div>
                                    <div className="relative">
                                       <input 
                                          type="text" 
                                          placeholder="ejemplo@correo.com, jefe@tienda.com"
                                          value={activeTerminal.config.workflow.session.zReportEmails || ''}
                                          onChange={(e) => handleUpdateActiveConfig('workflow.session', 'zReportEmails', e.target.value)}
                                          className="w-full p-4 bg-gray-50 border-2 border-transparent rounded-2xl font-bold text-gray-700 focus:bg-white focus:border-blue-400 outline-none transition-all"
                                       />
                                       <p className="text-[10px] text-gray-400 mt-2 uppercase font-bold px-1">Separa múltiples correos con comas.</p>
                                    </div>
                                 </div>
                              </div>
                           </div>
                        )}

                        {/* DOCUMENTS SECTION */}
                        {activeTab === 'DOCUMENTS' && (
                           <div className="space-y-6 animate-in slide-in-from-right-4">
                              <div className="flex justify-between items-center px-2">
                                 <div>
                                    <h3 className="text-xl font-black text-gray-800">Series Internas Vinculadas</h3>
                                    <p className="text-sm text-gray-500">Documentos que este terminal puede emitir bajo su propia numeración.</p>
                                 </div>
                                 <button 
                                    onClick={() => setIsLinkingSeries(true)}
                                    className="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm shadow-lg flex items-center gap-2"
                                 >
                                    <Plus size={18} /> Vincular Serie
                                 </button>
                              </div>

                              <div className="grid grid-cols-1 gap-4">
                                 {activeTerminal.config.documentSeries.map(series => (
                                    <div key={series.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                                       <div className="flex items-center gap-4">
                                          <div className={`p-3 rounded-xl bg-slate-100 text-slate-600`}>
                                             <FileText size={20} />
                                          </div>
                                          <div>
                                             <h4 className="font-bold text-gray-800">{series.name}</h4>
                                             <p className="text-xs text-gray-400 font-mono uppercase">Prefijo: {series.prefix} • Próximo: #{series.nextNumber}</p>
                                          </div>
                                       </div>
                                       <button 
                                          onClick={() => unlinkSeriesFromTerminal(series.id)}
                                          className="p-2 text-gray-300 hover:text-red-500 transition-colors"
                                       >
                                          <Unlink size={18} />
                                       </button>
                                    </div>
                                 ))}
                                 {activeTerminal.config.documentSeries.length === 0 && (
                                    <div className="py-12 bg-white rounded-3xl border border-dashed border-gray-200 text-center">
                                       <Link2Off size={32} className="mx-auto text-gray-300 mb-2" />
                                       <p className="text-gray-400 font-bold">Sin series vinculadas</p>
                                    </div>
                                 )}
                              </div>
                           </div>
                        )}

                        {/* CONNECTION / OFFLINE SECTION */}
                        {activeTab === 'OFFLINE' && (
                           <div className="space-y-6 animate-in slide-in-from-right-4">
                              <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm space-y-8">
                                 <h3 className="text-xl font-black text-gray-800 mb-6 flex items-center gap-2">
                                    <Cloud size={24} className="text-blue-600"/> Comportamiento de Red
                                 </h3>

                                 <div className="space-y-4">
                                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Modo de Operación</label>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                       {[
                                          { id: 'OPTIMISTIC', label: 'Optimista', desc: 'Permite todo offline.', color: 'bg-emerald-500' },
                                          { id: 'STRICT', label: 'Estricto', desc: 'Bloquea si no hay red.', color: 'bg-red-500' },
                                          { id: 'READ_ONLY', label: 'Consulta', desc: 'Solo ver stock.', color: 'bg-blue-500' },
                                       ].map(mode => (
                                          <button 
                                             key={mode.id}
                                             onClick={() => handleUpdateActiveConfig('workflow.offline', 'mode', mode.id)}
                                             className={`p-4 rounded-2xl border-2 text-left transition-all ${activeTerminal.config.workflow.offline.mode === mode.id ? 'border-blue-500 bg-blue-50 shadow-sm' : 'bg-white border-gray-100 hover:border-gray-300'}`}
                                          >
                                             <div className="flex items-center gap-2 mb-2">
                                                <div className={`w-2 h-2 rounded-full ${mode.color}`} />
                                                <span className="font-bold text-sm">{mode.label}</span>
                                             </div>
                                             <p className="text-[10px] text-gray-400 font-medium uppercase">{mode.desc}</p>
                                          </button>
                                       ))}
                                    </div>
                                 </div>

                                 <div>
                                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">Límite de Transacciones Offline</label>
                                    <div className="flex items-center gap-4">
                                       <div className="relative flex-1">
                                          <input 
                                             type="number" 
                                             value={activeTerminal.config.workflow.offline.maxOfflineTransactionLimit}
                                             onChange={(e) => handleUpdateActiveConfig('workflow.offline', 'maxOfflineTransactionLimit', parseInt(e.target.value) || 0)}
                                             className="w-full p-4 bg-gray-50 border-2 border-transparent rounded-2xl text-2xl font-black text-gray-800 focus:bg-white focus:border-blue-400 outline-none transition-all"
                                          />
                                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 uppercase">Docs</span>
                                       </div>
                                       <div className="p-4 bg-slate-100 rounded-2xl text-slate-400">
                                          <Server size={32} />
                                       </div>
                                    </div>
                                    <p className="text-[10px] text-gray-400 font-bold uppercase mt-2">Capacidad máxima de almacenamiento local antes de forzar sincronización.</p>
                                 </div>
                              </div>
                           </div>
                        )}
                    </div>
                ) : <div className="h-full flex items-center justify-center text-gray-400 italic"><p>Selecciona una terminal</p></div>}
            </div>
        </div>

        {isLinkingSeries && (
           <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-[2.5rem] w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95">
                 <div className="p-6 border-b bg-gray-50 flex justify-between items-center"><h3 className="font-black text-xl text-gray-800">Vincular Serie Interna</h3><button onClick={() => setIsLinkingSeries(false)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20}/></button></div>
                 <div className="p-4 overflow-y-auto max-h-[60vh] space-y-2">
                    {DEFAULT_DOCUMENT_SERIES.map(series => {
                       const isLinked = activeTerminal?.config.documentSeries?.some(s => s.id === series.id);
                       return (
                          <button key={series.id} disabled={isLinked} onClick={() => linkSeriesToTerminal(series)} className={`w-full p-4 rounded-2xl border-2 flex items-center justify-between transition-all ${isLinked ? 'opacity-40 grayscale cursor-not-allowed border-gray-100' : 'bg-white border-gray-100 hover:border-blue-400 hover:bg-blue-50 group'}`}>
                             <div className="flex items-center gap-4"><div className="p-2 bg-gray-100 rounded-lg text-gray-500 group-hover:bg-blue-100 group-hover:text-blue-600"><FileText size={18}/></div><div className="text-left"><p className="font-bold text-sm text-gray-800">{series.name}</p><p className="text-[10px] text-gray-400 font-bold uppercase">{series.prefix}</p></div></div>
                             {isLinked ? <CheckCircle2 size={18} className="text-green-500" /> : <Plus size={18} className="text-gray-300 group-hover:text-blue-500" />}
                          </button>
                       );
                    })}
                 </div>
              </div>
           </div>
        )}
    </div>
  );
};

export default TerminalSettings;
