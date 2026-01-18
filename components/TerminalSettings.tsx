
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
  ToggleLeft, ToggleRight, Radio, Power, Scale, Tv, Mail, ShoppingBag, Truck,
  /* Added missing icons to fix "Cannot find name" errors on lines 293 and 300 */
  Package, Layers
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

const PRINTER_ROLES = [
  { id: 'TICKET', label: 'Ticket de Venta', icon: Receipt },
  { id: 'LABEL', label: 'Etiquetas', icon: Tag },
  { id: 'KITCHEN', label: 'Cocina', icon: ShoppingBag },
  { id: 'LOGISTICS', label: 'Logística', icon: Truck },
];

type TerminalTab = 'OPERATIONAL' | 'FISCAL' | 'SECURITY' | 'SESSION' | 'DOCUMENTS' | 'OFFLINE' | 'INVENTORY';

const TerminalSettings: React.FC<TerminalSettingsProps> = ({ config, onUpdateConfig, onClose, warehouses = [] }) => {
  const [terminals, setTerminals] = useState(config.terminals || []);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>(terminals[0]?.id || '');
  const [activeTab, setActiveTab] = useState<TerminalTab>('OPERATIONAL');
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

  const handleSave = () => {
    onUpdateConfig({ ...config, terminals: terminals });
    alert("Configuraciones de terminales guardadas correctamente.");
    onClose();
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
        {/* SIDEBAR */}
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

        {/* MAIN AREA */}
        <div className="flex-1 flex flex-col min-w-0 h-full">
            <header className="bg-white px-8 py-5 border-b border-gray-200 flex justify-between items-center shrink-0 z-10">
                <h2 className="text-2xl font-black text-gray-800 flex items-center gap-3"><SettingsIcon className="text-blue-600" /> Terminal: <span className="text-blue-600">{selectedTerminalId}</span></h2>
                <div className="flex gap-3">
                    <button onClick={handleSave} className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold flex items-center gap-2 shadow-xl hover:bg-blue-700 transition-all"><Save size={20}/> Guardar Cambios</button>
                    <button onClick={onClose} className="p-3 bg-gray-100 text-gray-500 hover:bg-gray-200 rounded-xl transition-colors"><X size={20}/></button>
                </div>
            </header>

            {/* TABS NAVIGATION */}
            <div className="relative bg-white border-b border-gray-100 shrink-0 overflow-x-auto no-scrollbar flex px-4">
                {[
                  { id: 'OPERATIONAL', label: 'Operativa', icon: Database },
                  { id: 'FISCAL', label: 'Lotes Fiscales', icon: Landmark },
                  { id: 'INVENTORY', label: 'Almacenes', icon: Box },
                  { id: 'SECURITY', label: 'Seguridad', icon: ShieldAlert },
                  { id: 'SESSION', label: 'Sesión y Z', icon: Clock },
                  { id: 'OFFLINE', label: 'Conexión', icon: Cloud },
                ].map(tab => (
                  <button 
                    key={tab.id} 
                    onClick={() => setActiveTab(tab.id as TerminalTab)} 
                    className={`pb-4 pt-4 px-4 text-sm font-bold flex items-center gap-2 border-b-4 transition-all whitespace-nowrap ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                  >
                    <tab.icon size={18} /> {tab.label}
                  </button>
                ))}
            </div>

            {/* TAB CONTENT */}
            <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50 custom-scrollbar">
                {activeTerminal ? (
                    <div className="max-w-4xl mx-auto space-y-8 animate-in slide-in-from-right-4">
                        
                        {/* 1. OPERATIONAL SECTION */}
                        {activeTab === 'OPERATIONAL' && (
                           <div className="space-y-6">
                              <div className="bg-white p-8 rounded-3xl border shadow-sm space-y-8">
                                 <h3 className="text-xl font-black flex items-center gap-2"><HardDrive size={24} className="text-indigo-600"/> Hardware Asignado</h3>
                                 
                                 {/* Impresoras por Rol */}
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {PRINTER_ROLES.map(role => (
                                       <div key={role.id} className="p-4 bg-slate-50 rounded-2xl border space-y-2">
                                          <div className="flex items-center gap-2 text-slate-600"><role.icon size={16} /><span className="text-xs font-bold uppercase">{role.label}</span></div>
                                          <select 
                                             value={activeTerminal.config.hardware?.printerAssignments?.[role.id] || ''}
                                             onChange={(e) => {
                                                const current = activeTerminal.config.hardware?.printerAssignments || {};
                                                handleUpdateActiveConfig('hardware', 'printerAssignments', { ...current, [role.id]: e.target.value });
                                             }}
                                             className="w-full p-3 bg-white border rounded-xl font-bold text-sm outline-none"
                                          >
                                             <option value="">-- No asignada --</option>
                                             {(config.availablePrinters || []).map(p => <option key={p.id} value={p.id}>{p.name} ({p.connection})</option>)}
                                          </select>
                                       </div>
                                    ))}
                                 </div>

                                 <div className="h-px bg-slate-100"></div>

                                 {/* Visor de Cliente */}
                                 <div className="space-y-4">
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Visor de Cliente (VFD/LCD)</label>
                                    <div className={`p-6 rounded-3xl border-2 transition-all flex items-center justify-between ${activeTerminal.config.hardware?.customerDisplay?.isEnabled ? 'border-blue-500 bg-blue-50/50' : 'border-slate-100 bg-white'}`}>
                                       <div className="flex items-center gap-4">
                                          <div className={`p-3 rounded-2xl ${activeTerminal.config.hardware?.customerDisplay?.isEnabled ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-100 text-slate-400'}`}>
                                             <Tv size={24} />
                                          </div>
                                          <div>
                                             <p className={`font-black text-sm uppercase ${activeTerminal.config.hardware?.customerDisplay?.isEnabled ? 'text-blue-900' : 'text-slate-500'}`}>
                                                {activeTerminal.config.hardware?.customerDisplay?.isEnabled ? 'Visualización Activada' : 'Visualización Desactivada'}
                                             </p>
                                             <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Gestiona anuncios y mensajes de bienvenida</p>
                                          </div>
                                       </div>
                                       <div className="flex items-center gap-3">
                                          {activeTerminal.config.hardware?.customerDisplay?.isEnabled && (
                                             <button 
                                                onClick={() => alert("Usa el menú: Hardware Global -> Visor Cliente para cargar Ads y banners.")}
                                                className="px-4 py-2 bg-white text-blue-600 rounded-xl text-xs font-black border-2 border-blue-200 hover:bg-blue-50 shadow-sm transition-all"
                                             >
                                                CONFIGURAR CONTENIDO
                                             </button>
                                          )}
                                          <button 
                                             onClick={() => {
                                                const current = activeTerminal.config.hardware?.customerDisplay;
                                                handleUpdateActiveConfig('hardware', 'customerDisplay', { ...current, isEnabled: !current?.isEnabled });
                                             }}
                                             className={`w-14 h-7 rounded-full relative transition-all ${activeTerminal.config.hardware?.customerDisplay?.isEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}
                                          >
                                             <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${activeTerminal.config.hardware?.customerDisplay?.isEnabled ? 'left-8' : 'left-1'}`} />
                                          </button>
                                       </div>
                                    </div>
                                 </div>

                                 {/* Balanzas */}
                                 <div className="space-y-4">
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Balanzas de Pesaje Asignadas</label>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                       {(config.scales || []).map(scale => {
                                          const isAssigned = activeTerminal.config.hardware?.scales?.some(s => s.id === scale.id);
                                          return (
                                             <div 
                                                key={scale.id}
                                                onClick={() => {
                                                   const current = activeTerminal.config.hardware?.scales || [];
                                                   const updated = isAssigned ? current.filter(s => s.id !== scale.id) : [...current, scale];
                                                   handleUpdateActiveConfig('hardware', 'scales', updated);
                                                }}
                                                className={`p-4 rounded-2xl border-2 flex items-center justify-between cursor-pointer transition-all ${isAssigned ? 'border-emerald-500 bg-emerald-50 shadow-sm' : 'border-slate-100 bg-white hover:border-slate-200'}`}
                                             >
                                                <div className="flex gap-3 items-center"><Scale size={18} className={isAssigned ? 'text-emerald-600' : 'text-slate-400'}/><span className={`text-sm font-bold ${isAssigned ? 'text-emerald-900' : 'text-slate-700'}`}>{scale.name}</span></div>
                                                {isAssigned && <CheckCircle size={18} className="text-emerald-600" />}
                                             </div>
                                          );
                                       })}
                                    </div>
                                 </div>
                              </div>

                              {/* Toggles de Flujo Operativo */}
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                  <Toggle 
                                    label="Validación en Tiempo Real" 
                                    description="Verifica stock centralizado antes de completar ventas." 
                                    checked={activeTerminal.config.workflow.inventory.realTimeValidation} 
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.inventory', 'realTimeValidation', v)} 
                                    icon={Database} 
                                  />
                                  <Toggle 
                                    label="Permitir Stock Negativo" 
                                    description="Facturar artículos aunque el sistema marque cero existencias." 
                                    checked={activeTerminal.config.workflow.inventory.allowNegativeStock} 
                                    danger={true}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.inventory', 'allowNegativeStock', v)} 
                                    icon={AlertTriangle} 
                                  />
                                  <Toggle 
                                    label="Reservar Stock al Marcar" 
                                    description="Bloquea el artículo al añadirlo al carrito." 
                                    checked={activeTerminal.config.workflow.inventory.reserveStockOnCart} 
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.inventory', 'reserveStockOnCart', v)} 
                                    icon={Package} 
                                  />
                                  <Toggle 
                                    label="Mostrar Stock en Tiles" 
                                    description="Visualiza existencias directamente en los botones de productos." 
                                    checked={activeTerminal.config.workflow.inventory.showStockOnTiles} 
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.inventory', 'showStockOnTiles', v)} 
                                    icon={Layers} 
                                  />
                              </div>
                           </div>
                        )}

                        {/* 2. SECURITY SECTION */}
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

                        {/* 3. SESSION & Z SECTION */}
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

                        {/* 4. INVENTORY SCOPE */}
                        {activeTab === 'INVENTORY' && (
                          <div className="space-y-6 animate-in slide-in-from-right-4">
                             <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm">
                                <h3 className="text-xl font-black text-gray-800 mb-6 flex items-center gap-2">
                                   <Building2 size={24} className="text-blue-600"/> Alcance de Almacenes
                                </h3>
                                
                                <div className="space-y-4">
                                   <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Almacenes Visibles en Terminal</label>
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
                                                        className={`px-2 py-1 rounded-md text-[9px] font-black uppercase transition-all ${isDefault ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white text-gray-400 border border-gray-200 hover:text-emerald-600'}`}
                                                     >
                                                        {isDefault ? 'Despacho OK' : 'Fijar Defecto'}
                                                     </button>
                                                  )}
                                               </div>
                                            </div>
                                         );
                                      })}
                                   </div>
                                </div>
                             </div>
                          </div>
                        )}

                        {/* 5. CONNECTION / OFFLINE SECTION */}
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
                                             className={`p-4 rounded-2xl border-2 text-left transition-all ${activeTerminal.config.workflow.offline.mode === mode.id ? 'border-blue-500 bg-blue-50 shadow-sm' : 'bg-white border-gray-100 hover:border-gray-200'}`}
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
                                 </div>
                              </div>
                           </div>
                        )}

                        {/* 6. FISCAL SETTINGS */}
                        {activeTab === 'FISCAL' && (
                           <div className="animate-in slide-in-from-right-4 space-y-6">
                              <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm">
                                 <h3 className="text-xl font-black text-gray-800 mb-6 flex items-center gap-2">
                                    <Landmark size={24} className="text-indigo-600"/> Gestión de Lotes DGII
                                 </h3>
                                 <p className="text-sm text-gray-500 mb-6">Configura el tamaño del lote de NCF que esta terminal descarga automáticamente del pool central.</p>
                                 
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    {['B01', 'B02'].map((type) => {
                                       const typeConfig = activeTerminal.config.fiscal?.typeConfigs?.[type as NCFType] || { batchSize: 100, lowBatchThreshold: 20 };
                                       
                                       return (
                                          <div key={type} className="bg-slate-50 p-6 rounded-2xl border border-slate-100 space-y-4">
                                             <div className="flex items-center gap-2">
                                                <span className="bg-indigo-600 text-white px-2.5 py-1 rounded-lg text-xs font-black tracking-widest">{type}</span>
                                                <h4 className="font-bold text-gray-800">{type === 'B01' ? 'Crédito Fiscal' : 'Consumo'}</h4>
                                             </div>
                                             <div>
                                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Docs por Lote</label>
                                                <input 
                                                   type="number" 
                                                   value={typeConfig.batchSize}
                                                   onChange={(e) => {
                                                      const current = activeTerminal.config.fiscal?.typeConfigs || {};
                                                      handleUpdateActiveConfig('fiscal.typeConfigs', type, { ...typeConfig, batchSize: parseInt(e.target.value) || 0 });
                                                   }}
                                                   className="w-full p-3 bg-white border rounded-xl font-bold text-indigo-600"
                                                />
                                             </div>
                                          </div>
                                       );
                                    })}
                                 </div>
                              </div>
                           </div>
                        )}
                    </div>
                ) : (
                    <div className="h-full flex items-center justify-center text-gray-400 italic">
                        <p>Selecciona una terminal del panel izquierdo para configurar.</p>
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};

export default TerminalSettings;
