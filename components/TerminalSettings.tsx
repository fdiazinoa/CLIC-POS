
import React, { useState, useMemo, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
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
   Package, Layers, Crown, ListOrdered, Link2, Sparkles, Palette, MousePointer2, Banknote, ListChecks,
   Sun, ScanBarcode, Layout, Minus, ArrowDownCircle, ArrowUpCircle, Wallet, UserCheck, User, CreditCard, Fingerprint, UserCircle
} from 'lucide-react';
import { BusinessConfig, TerminalConfig, DocumentSeries, Tariff, TaxDefinition, Warehouse, NCFType, NCFConfig, Transaction, ScaleDevice, Product, DeviceRole, AuthLevel, Room } from '../types';
import { DEFAULT_DOCUMENT_SERIES, DEFAULT_TERMINAL_CONFIG } from '../constants';
import { db } from '../utils/db';
import { syncManager } from '../services/sync/SyncManager';
import { getDefaultRoleConfig, getRoleDisplayInfo, getAllModules } from '../utils/deviceRoleHelpers';
import AccessibilityToggle from './AccessibilityToggle';
import SettingsOperational from './SettingsOperational';
import { mergeDocumentSeriesCollection } from '../utils/documentSeriesIdentity';
import { isPartialXReportAllowed } from '../utils/seriesValidation';

interface TerminalSettingsProps {
   config: BusinessConfig;
   onUpdateConfig: (newConfig: BusinessConfig) => void;
   onClose: () => void;
   warehouses?: Warehouse[];
   products?: Product[];
   isAdminMode?: boolean;
   currentDeviceId?: string;
}

type ConfiguredTerminal = BusinessConfig['terminals'][number];

const resolveTerminalDisplayName = (terminal: ConfiguredTerminal) => (
   String(
      terminal.config?.terminalName
      || (terminal as any)?.name
      || terminal.config?.erpBinding?.terminalName
      || terminal.config?.stationNumber
      || terminal.config?.erpTerminalId
      || terminal.id
      || 'Terminal'
   ).trim()
);

const PRINTER_ROLES = [
   { id: 'TICKET', label: 'Ticket de Venta', icon: Receipt },
   { id: 'LABEL', label: 'Etiquetas', icon: Tag },
   { id: 'KITCHEN', label: 'Cocina', icon: ShoppingBag },
   { id: 'LOGISTICS', label: 'Logística', icon: Truck },
];

const DOCUMENT_ROLES = [
   { id: 'TICKET', label: 'Ticket de Venta (POS)', description: 'Secuencia principal para cobros estándar.', icon: Receipt, category: 'Ventas' },
   { id: 'REFUND', label: 'Notas de Crédito (Devoluciones)', description: 'Documento legal para abonos y retornos.', icon: RotateCcw, category: 'Ventas' },
   { id: 'VOID', label: 'Anulación', description: 'Anulación de transacciones', icon: X, category: 'Ventas' },
   { id: 'TRANSFER', label: 'Notas de Traspaso', description: 'Comprobantes de movimiento entre almacenes.', icon: ArrowRightLeft, category: 'Inventario' },
   { id: 'ADJUSTMENT_IN', label: 'Ajuste Positivo', description: 'Incremento de inventario', icon: Plus, category: 'Inventario' },
   { id: 'ADJUSTMENT_OUT', label: 'Ajuste Negativo', description: 'Reducción de inventario', icon: Minus, category: 'Inventario' },
   { id: 'PURCHASE', label: 'Compra a Proveedor', description: 'Entrada de mercancía', icon: ShoppingBag, category: 'Inventario' },
   { id: 'PRODUCTION', label: 'Producción/Ensamblaje', description: 'Productos manufacturados', icon: Box, category: 'Inventario' },
   { id: 'CASH_IN', label: 'Entrada de Efectivo', description: 'Ingreso de dinero a caja', icon: ArrowDownCircle, category: 'Efectivo' },
   { id: 'CASH_OUT', label: 'Salida de Efectivo', description: 'Egreso de dinero de caja', icon: ArrowUpCircle, category: 'Efectivo' },
   { id: 'CASH_DEPOSIT', label: 'Depósito Bancario', description: 'Depósito en banco', icon: Landmark, category: 'Efectivo' },
   { id: 'CASH_WITHDRAWAL', label: 'Retiro de Caja', description: 'Retiro para gastos', icon: Wallet, category: 'Efectivo' },
   { id: 'Z_REPORT', label: 'Cierre de Caja (Z)', description: 'Cierre fiscal diario', icon: Lock, category: 'Cierres' },
   { id: 'X_REPORT', label: 'Corte Parcial (X)', description: 'Reporte intermedio', icon: FileText, category: 'Cierres' },
   { id: 'RECEIVABLE', label: 'Cuenta por Cobrar', description: 'Venta a crédito', icon: UserCheck, category: 'Cuentas' },
   { id: 'PAYABLE', label: 'Cuenta por Pagar', description: 'Compra a crédito', icon: User, category: 'Cuentas' },
   { id: 'PAYMENT_IN', label: 'Cobro Recibido', description: 'Pago de cliente', icon: DollarSign, category: 'Cuentas' },
   { id: 'PAYMENT_OUT', label: 'Pago Realizado', description: 'Pago a proveedor', icon: CreditCard, category: 'Cuentas' }
];

const DEVICE_ROLE_OPTIONS = [
   { role: DeviceRole.STANDARD_POS, label: 'POS estándar', description: 'Caja de venta completa.', icon: Monitor },
   { role: DeviceRole.KITCHEN_DISPLAY, label: 'Pantalla cocina', description: 'KDS para órdenes y preparación.', icon: Tv },
   { role: DeviceRole.SELF_CHECKOUT, label: 'SelfCheckout', description: 'Kiosco de autoservicio.', icon: ShoppingBag },
   { role: DeviceRole.PRICE_CHECKER, label: 'Verificador precio', description: 'Consulta de precios por código.', icon: ScanBarcode },
   { role: DeviceRole.HANDHELD_INVENTORY, label: 'Inventario móvil', description: 'Conteo, recepción y etiquetas.', icon: Smartphone },
];

type TerminalTab = 'IDENTITY' | 'OPERATIONAL' | 'FISCAL' | 'SECURITY' | 'SESSION' | 'DOCUMENTS' | 'OFFLINE' | 'INVENTORY' | 'LAN_BINDING' | 'CATALOG' | 'DEVICE_ROLE';

const NCF_LABELS: Record<NCFType, string> = {
   'B01': 'Crédito Fiscal',
   'B02': 'Consumo',
   'B04': 'Nota de Crédito',
   'B14': 'Reg. Especiales',
   'B15': 'Gubernamentales'
};

const TerminalSettings: React.FC<TerminalSettingsProps> = ({ config, onUpdateConfig, onClose, warehouses = [], products = [], isAdminMode = false, currentDeviceId }) => {
   const isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
   const [terminals, setTerminals] = useState(config.terminals || []);

   const [selectedTerminalId, setSelectedTerminalId] = useState<string>(() => {
      if (currentDeviceId) {
         const activeTerminalId = localStorage.getItem('active_terminal_id') || localStorage.getItem('CLIC_POS_TERMINAL_ID') || '';
         const currentCandidates = terminals.filter(t => t.config.currentDeviceId === currentDeviceId);
         const current =
            currentCandidates.find((terminal) => terminal.id === activeTerminalId || terminal.config?.erpTerminalId === activeTerminalId)
            || currentCandidates.find((terminal) => resolveTerminalDisplayName(terminal) !== terminal.id)
            || currentCandidates[0];
         if (current) return current.id;
      }
      return terminals[0]?.id || '';
   });

   const [activeTab, setActiveTab] = useState<TerminalTab>('IDENTITY');
   const [showConflictModal, setShowConflictModal] = useState<string | null>(null);
   const [masterSequences, setMasterSequences] = useState<DocumentSeries[]>([]);
   const [isSyncing, setIsSyncing] = useState(false);
   const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
   const [allRooms, setAllRooms] = useState<Room[]>([]);

   useEffect(() => {
      const loadSequences = async () => {
         const seqs = (await db.get('internalSequences') || []) as DocumentSeries[];
         const configSeries = (config.terminals || [])
            .flatMap(t => (Array.isArray(t.config?.documentSeries) ? t.config.documentSeries : []))
            .filter((s: any) => !!s?.id && !!s?.documentType) as DocumentSeries[];

         const merged = mergeDocumentSeriesCollection([...seqs, ...configSeries]);
         if (merged.length !== seqs.length) {
            await db.save('internalSequences', merged);
         }

         setMasterSequences(merged);
         const rooms = (await db.get('rooms') || []) as Room[];
         setAllRooms(rooms);
      };
      loadSequences();
      const handleSeriesUpdate = () => loadSequences();
      window.addEventListener('seriesUpdated', handleSeriesUpdate);
      return () => window.removeEventListener('seriesUpdated', handleSeriesUpdate);
   }, [config.terminals]);

   const activeTerminal = useMemo(() =>
      terminals.find(t => t.id === selectedTerminalId),
      [terminals, selectedTerminalId]);

   const isReadOnly = useMemo(() => {
      if (!activeTerminal) return false;
      return activeTerminal.config.governedByMaster &&
         activeTerminal.config.currentDeviceId === currentDeviceId &&
         !activeTerminal.config.isPrimaryNode;
   }, [activeTerminal, currentDeviceId]);

   const clampInteger = (rawValue: string, min: number, max?: number) => {
      const parsed = Number.parseInt(rawValue || String(min), 10);
      const safeValue = Number.isFinite(parsed) ? parsed : min;
      return typeof max === 'number' ? Math.max(min, Math.min(max, safeValue)) : Math.max(min, safeValue);
   };

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
               for (const part of parts) {
                  if (!current[part] || typeof current[part] !== 'object') {
                     current[part] = {};
                  }
                  current = current[part];
               }
               current[key] = value;
            }
            return { ...t, config: newConfig };
         }
         return t;
      }));
   };

   const handleUpdateDeviceRole = (role: DeviceRole) => {
      if (!activeTerminal || isReadOnly) return;
      const currentRoleConfig = activeTerminal.config.deviceRole;
      const defaultRoleConfig = getDefaultRoleConfig(role);
      const nextRoleConfig = {
         ...defaultRoleConfig,
         apiToken: currentRoleConfig?.apiToken || defaultRoleConfig.apiToken,
         uiSettings: {
            ...defaultRoleConfig.uiSettings,
            escapeHatch: {
               ...defaultRoleConfig.uiSettings.escapeHatch,
               adminPin: currentRoleConfig?.uiSettings?.escapeHatch?.adminPin || defaultRoleConfig.uiSettings.escapeHatch?.adminPin,
            }
         }
      };

      handleUpdateActiveConfig('', 'deviceRole', nextRoleConfig);
   };

   const handleToggleMasterNode = (enabled: boolean) => {
      if (!activeTerminal) return;
      if (enabled) {
         const currentMaster = terminals.find(t => t.config.isPrimaryNode && t.id !== activeTerminal.id);
         if (currentMaster) {
            setShowConflictModal(currentMaster.id);
            return;
         }
      }
      setTerminals(prev => prev.map(t => ({
         ...t,
         config: {
            ...t.config,
            isPrimaryNode: t.id === activeTerminal.id ? enabled : (enabled ? false : t.config.isPrimaryNode)
         }
      })));
   };

   const confirmMasterTransfer = () => {
      if (!activeTerminal) return;
      setTerminals(prev => prev.map(t => ({
         ...t,
         config: {
            ...t.config,
            isPrimaryNode: t.id === activeTerminal.id
         }
      })));
      setShowConflictModal(null);
   };

   const handleSyncSeries = async () => {
      setIsSyncing(true);
      try {
         await syncManager.pullCatalog('internalSequences');
         const seqs = (await db.get('internalSequences') || []) as DocumentSeries[];
         setMasterSequences(seqs);
         setLastSyncTime(new Date());
      } catch (error) {
         console.error('Error syncing series:', error);
      } finally {
         setIsSyncing(false);
      }
   };

   const handleAssignSequence = (roleId: string, sequenceId: string) => {
      if (!activeTerminal) return;
      if (roleId === 'X_REPORT' && !isPartialXReportAllowed(activeTerminal.config)) return;
      const currentAssignments = activeTerminal.config.documentAssignments || {};
      const newAssignments = { ...currentAssignments, [roleId]: sequenceId };
      const startSeries = masterSequences.find(s => s.id === sequenceId);
      let newDocumentSeries = [...(activeTerminal.config.documentSeries || [])];
      if (sequenceId && startSeries) {
         const existingIndex = newDocumentSeries.findIndex(s => s.id === sequenceId);
         if (existingIndex >= 0) newDocumentSeries[existingIndex] = startSeries;
         else newDocumentSeries.push(startSeries);
      }
      setTerminals(prev => prev.map(t => {
         if (t.id === selectedTerminalId) {
            return { ...t, config: { ...t.config, documentAssignments: newAssignments, documentSeries: newDocumentSeries } };
         }
         return t;
      }));
   };

   const documentRolesForUi = useMemo(() => {
      if (!activeTerminal) return DOCUMENT_ROLES;
      const allowX = isPartialXReportAllowed(activeTerminal.config);
      return DOCUMENT_ROLES.filter((r) => r.id !== 'X_REPORT' || allowX);
   }, [activeTerminal]);

   const handleSave = () => {
      const cleanedTerminals = terminals.map((t) => {
         if (isPartialXReportAllowed(t.config)) return t;
         const da = { ...(t.config.documentAssignments || {}) };
         delete da.X_REPORT;
         return { ...t, config: { ...t.config, documentAssignments: da } };
      });
      onUpdateConfig({ ...config, terminals: cleanedTerminals });
      onClose();
   };

   const Toggle = ({ label, description, checked, onChange, danger = false, icon: Icon, disabled = false }: any) => (
      <div
         onClick={() => !disabled && onChange(!checked)}
         className={`p-5 rounded-2xl border-2 flex justify-between items-center transition-all group ${disabled ? 'opacity-60 cursor-not-allowed bg-gray-50 border-gray-100' : 'cursor-pointer'} ${checked ? (danger ? 'bg-red-50 border-red-500 shadow-sm' : 'bg-blue-50 border-blue-500 shadow-sm') : 'bg-white border-gray-100 hover:border-gray-300'}`}
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
      <div className={`responsive-shell flex h-full bg-gray-50 animate-in fade-in overflow-hidden relative flex-col lg:flex-row`}>
         <div className="responsive-content flex-1 flex flex-col min-w-0 h-full">
            <header className="bg-white px-8 py-6 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-6 shrink-0 z-30 shadow-sm relative">
               <div className="flex items-center gap-5">
                  <div className="p-3 bg-blue-600 text-white rounded-[1.25rem] shadow-xl shadow-blue-200/50">
                     <Monitor size={32} strokeWidth={2.5} />
                  </div>
                  <div>
                     <h2 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
                        Terminal: <span className="text-blue-600">{activeTerminal ? resolveTerminalDisplayName(activeTerminal) : selectedTerminalId}</span>
                     </h2>
                     <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">Gestión de Estaciones</p>
                  </div>
               </div>
               <div className="flex items-center gap-4">
                  <button onClick={handleSave} className="px-8 py-4 bg-blue-600 text-white rounded-2xl font-black flex items-center gap-3 shadow-xl">
                     <Save size={20} /> Guardar
                  </button>
                  <button onClick={onClose} className="p-4 bg-slate-100 text-slate-500 hover:bg-slate-200 rounded-2xl">
                     <X size={24} />
                  </button>
               </div>
            </header>

            <div className="bg-white border-b border-gray-100 p-6 z-20 overflow-x-auto no-scrollbar">
               <div className="flex gap-4">
                  {terminals.map((t) => (
                     <div key={t.id} onClick={() => setSelectedTerminalId(t.id)} className={`min-w-[200px] p-4 rounded-3xl border-2 transition-all cursor-pointer ${selectedTerminalId === t.id ? 'bg-blue-600 border-blue-600 text-white shadow-xl' : 'bg-white border-slate-100'}`}>
                        <div className="flex items-center gap-3">
                           <Monitor size={20} />
                           <span className="font-black">{resolveTerminalDisplayName(t)}</span>
                        </div>
                     </div>
                  ))}
                  <button onClick={() => {
                     const nextId = `t${terminals.length + 1}`;
                     setTerminals([...terminals, { id: nextId, config: JSON.parse(JSON.stringify(DEFAULT_TERMINAL_CONFIG)) }]);
                     setSelectedTerminalId(nextId);
                  }} className="min-w-[100px] p-4 rounded-3xl border-2 border-dashed border-slate-200 flex flex-col items-center gap-1 text-slate-400">
                     <Plus size={20} />
                     <span className="text-[10px] font-black uppercase">Nueva</span>
                  </button>
               </div>
            </div>

            <div className="bg-white border-b border-gray-100 px-6 py-4 shrink-0 z-10 overflow-x-auto no-scrollbar">
               <div className="flex min-w-max gap-3">
               {[
                  { id: 'IDENTITY', label: 'Identidad', icon: UserCircle },
                  { id: 'OPERATIONAL', label: 'Operación', icon: Zap },
                  { id: 'FISCAL', label: 'Fiscal', icon: Landmark },
                  { id: 'DOCUMENTS', label: 'Documentos', icon: FileText },
                  { id: 'SESSION', label: 'Sesión', icon: Clock },
                  { id: 'SECURITY', label: 'Seguridad', icon: ShieldCheck },
                  { id: 'OFFLINE', label: 'Red/Nube', icon: Cloud },
               ].map(tab => (
                  <button
                     key={tab.id}
                     onClick={() => setActiveTab(tab.id as TerminalTab)}
                     className={`px-5 py-3 text-xs font-black flex items-center gap-2 rounded-2xl border-2 uppercase whitespace-nowrap transition-all shadow-sm ${
                        activeTab === tab.id
                           ? 'bg-white border-blue-200 text-blue-600 shadow-blue-100'
                           : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'
                     }`}
                  >
                     <tab.icon size={16} /> {tab.label}
                  </button>
               ))}
               </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
               {activeTerminal ? (
                  <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4">
                     <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-2xl p-10 overflow-hidden">
                        
                        {activeTab === 'IDENTITY' && (
                           <div className="space-y-8">
                              <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3"><UserCircle className="text-blue-600" /> Identidad</h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                 <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase">ID de Terminal</label>
                                    <input type="text" value={activeTerminal.id} readOnly className="w-full p-4 bg-slate-50 rounded-2xl font-bold" />
                                 </div>
                                 <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase">Número Estación</label>
                                    <input type="number" value={activeTerminal.config.stationNumber || 1} onChange={(e) => handleUpdateActiveConfig('', 'stationNumber', parseInt(e.target.value))} className="w-full p-4 bg-slate-50 rounded-2xl font-bold" />
                                 </div>
                              </div>
                              <div className="p-6 bg-slate-50 rounded-3xl space-y-4">
                                 <h4 className="text-xs font-black uppercase text-slate-800">Seguridad Rápida</h4>
                                 <Toggle label="PIN para Anulaciones" checked={activeTerminal.config.security.requirePinForVoid} onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requirePinForVoid', v)} icon={Lock} />
                                 <Toggle label="PIN para Descuentos" checked={activeTerminal.config.security.requirePinForDiscount} onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requirePinForDiscount', v)} icon={Percent} />
                              </div>
                           </div>
                        )}

                        {activeTab === 'OPERATIONAL' && (
                           <div className="space-y-8">
                              <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3"><Zap className="text-yellow-500" /> Operativa</h3>
                              <Toggle label="Terminal Principal" description="Actúa como servidor local." checked={activeTerminal.config.isPrimaryNode} onChange={handleToggleMasterNode} icon={Crown} disabled={activeTerminal.config.governedByMaster} />
                              {!activeTerminal.config.isPrimaryNode && <Toggle label="Gobernado por Maestra" checked={activeTerminal.config.governedByMaster} onChange={(v: boolean) => handleUpdateActiveConfig('', 'governedByMaster', v)} icon={ShieldCheck} />}
                              <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100 space-y-4">
                                 <div className="flex items-start gap-4">
                                    <div className="p-3 rounded-2xl bg-white text-blue-600 shadow-sm">
                                       <Monitor size={20} />
                                    </div>
                                    <div>
                                       <h4 className="text-sm font-black text-slate-800 uppercase tracking-[0.18em]">Tipo de terminal</h4>
                                       <p className="text-xs font-medium text-slate-500 mt-1">
                                          Define qué experiencia abre esta estación local al iniciar el POS.
                                       </p>
                                    </div>
                                 </div>
                                 <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                    {DEVICE_ROLE_OPTIONS.map(option => {
                                       const selected = (activeTerminal.config.deviceRole?.role || DeviceRole.STANDARD_POS) === option.role;
                                       return (
                                          <button
                                             type="button"
                                             key={option.role}
                                             onClick={() => handleUpdateDeviceRole(option.role)}
                                             disabled={isReadOnly}
                                             className={`p-4 rounded-2xl border-2 text-left transition-all ${selected ? 'bg-blue-50 border-blue-500 text-blue-900 shadow-sm' : 'bg-white border-slate-100 text-slate-600 hover:border-slate-300'} ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                                          >
                                             <div className="flex items-center gap-3">
                                                <div className={`p-2 rounded-xl ${selected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                                   <option.icon size={18} />
                                                </div>
                                                <div>
                                                   <p className="text-sm font-black">{option.label}</p>
                                                   <p className="text-[11px] font-bold opacity-70">{option.description}</p>
                                                </div>
                                             </div>
                                          </button>
                                       );
                                    })}
                                 </div>
                              </div>
                              <SettingsOperational config={activeTerminal.config} onUpdate={handleUpdateActiveConfig} isReadOnly={isReadOnly} />
                              <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100 space-y-4">
                                 <div className="flex items-start gap-4">
                                    <div className="p-3 rounded-2xl bg-white text-slate-700 shadow-sm">
                                       <Truck size={20} />
                                    </div>
                                    <div>
                                       <h4 className="text-sm font-black text-slate-800 uppercase tracking-[0.18em]">Delivery y Marketplaces</h4>
                                       <p className="text-xs font-medium text-slate-500 mt-1">
                                          Configura esta caja para recibir alertas automáticas de Uber Eats y abrir el modal de pedidos solo si está dedicada a delivery.
                                       </p>
                                    </div>
                                 </div>
                                 <Toggle
                                    label="Caja asignada a Delivery"
                                    description="Marca esta terminal como la caja operativa para pedidos de delivery y marketplaces."
                                    checked={Boolean(activeTerminal.config.operational?.deliveryAlerts?.isDeliveryTerminal)}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('operational.deliveryAlerts', 'isDeliveryTerminal', v)}
                                    icon={Package}
                                    disabled={isReadOnly}
                                 />
                                 <Toggle
                                    label="Toast al llegar pedido Uber Eats"
                                    description="Muestra una alerta visual corta cuando entra una orden nueva marcada como PUSHED_TO_POS."
                                    checked={activeTerminal.config.operational?.deliveryAlerts?.showUberEatsToast !== false}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('operational.deliveryAlerts', 'showUberEatsToast', v)}
                                    icon={ShoppingBag}
                                    disabled={isReadOnly}
                                 />
                                 <Toggle
                                    label="Abrir modal automático de pedidos"
                                    description="Al detectar una orden nueva, abre automáticamente la ventana de Reservas y Pedidos. Recomendado solo para la caja de delivery."
                                    checked={Boolean(activeTerminal.config.operational?.deliveryAlerts?.autoOpenUberEatsModal)}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('operational.deliveryAlerts', 'autoOpenUberEatsModal', v)}
                                    icon={Monitor}
                                    disabled={isReadOnly || !activeTerminal.config.operational?.deliveryAlerts?.isDeliveryTerminal}
                                 />
                              </div>
                           </div>
                        )}

                        {activeTab === 'DOCUMENTS' && (
                           <div className="space-y-8">
                              <div className="flex justify-between items-center">
                                 <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3"><FileText className="text-blue-500" /> Secuencias</h3>
                                 <button onClick={handleSyncSeries} disabled={isSyncing} className="p-3 bg-blue-100 text-blue-600 rounded-xl flex items-center gap-2 font-bold text-xs"><RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} /> Sync</button>
                              </div>
                              <div className="space-y-4">
                                 {documentRolesForUi.map(role => (
                                    <div key={role.id} className="p-6 bg-slate-50 rounded-3xl flex items-center justify-between gap-6">
                                       <div className="flex items-center gap-4">
                                          <div className="p-3 bg-white rounded-2xl text-blue-600 shadow-sm"><role.icon size={20} /></div>
                                          <div><p className="font-black text-slate-800">{role.label}</p><p className="text-[10px] text-slate-400 uppercase">{role.description}</p></div>
                                       </div>
                                       <select value={activeTerminal.config.documentAssignments?.[role.id] || ''} onChange={(e) => handleAssignSequence(role.id, e.target.value)} disabled={activeTerminal.config.governedByMaster} className="p-3 bg-white border border-slate-200 rounded-xl font-bold outline-none text-sm w-48">
                                          <option value="">-- Sin Vincular --</option>
                                          {masterSequences.filter(s => s.documentType === role.id).map(s => <option key={s.id} value={s.id}>{s.name} ({s.prefix})</option>)}
                                       </select>
                                    </div>
                                 ))}
                              </div>
                           </div>
                        )}

                        {activeTab === 'SECURITY' && (
                           <div className="space-y-6">
                              <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3"><ShieldCheck className="text-red-500" /> Seguridad</h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                 <Toggle label="PIN Anulaciones" checked={activeTerminal.config.security.requirePinForVoid} onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requirePinForVoid', v)} icon={ShieldAlert} />
                                 <Toggle label="PIN Descuentos" checked={activeTerminal.config.security.requirePinForDiscount} onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requirePinForDiscount', v)} icon={Percent} />
                                 <Toggle label="Reembolsos Gerente" checked={activeTerminal.config.security.requireManagerForRefunds} onChange={(v: boolean) => handleUpdateActiveConfig('security', 'requireManagerForRefunds', v)} icon={RotateCcw} />
                                 <Toggle label="TouchID/Biometría" checked={activeTerminal.config.security.allowBiometrics || false} onChange={(v: boolean) => handleUpdateActiveConfig('security', 'allowBiometrics', v)} icon={Fingerprint} />
                              </div>
                           </div>
                        )}

                        {activeTab === 'SESSION' && (
                           <div className="space-y-6">
                              <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3"><Clock className="text-purple-500" /> Sesión y Cierre Z</h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                 <Toggle
                                    label="Requiere apertura de sesión"
                                    description="La terminal debe abrir turno antes de vender."
                                    checked={activeTerminal.config.workflow.session.allowSalesWithOpenZ === false}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'allowSalesWithOpenZ', !v)}
                                    icon={Power}
                                    disabled={isReadOnly}
                                 />
                                 <Toggle
                                    label="Permitir reporte X parcial"
                                    description="Muestra el monitor Reporte X en Finanzas y permite asignar su serie."
                                    checked={activeTerminal.config.workflow.session.allowPartialXReport !== false}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'allowPartialXReport', v)}
                                    icon={FileText}
                                    disabled={isReadOnly}
                                 />
                                 <Toggle
                                    label="Requiere cierre Z"
                                    description="Marca el cierre formal como obligatorio antes de terminar jornada."
                                    checked={Boolean(activeTerminal.config.workflow.session.forceZChange)}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'forceZChange', v)}
                                    icon={Lock}
                                    disabled={isReadOnly}
                                 />
                                 <Toggle
                                    label="Impresión automática del Z"
                                    description="Tras confirmar el cierre Z, envía el reporte a la impresora configurada."
                                    checked={Boolean(activeTerminal.config.workflow.session.autoPrintZReport)}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'autoPrintZReport', v)}
                                    icon={Printer}
                                    disabled={isReadOnly}
                                 />
                                 <Toggle
                                    label="Enviar Z por correo"
                                    description="Habilita el envío por email según los destinatarios configurados."
                                    checked={Boolean(activeTerminal.config.workflow.session.emailZReport)}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'emailZReport', v)}
                                    icon={Mail}
                                    disabled={isReadOnly}
                                 />
                                 <Toggle
                                    label="Cierre Ciego"
                                    description="Permite cerrar la caja sin exigir arqueo visible al cajero."
                                    checked={activeTerminal.config.workflow.session.blindClose}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'blindClose', v)}
                                    icon={ShieldQuestion}
                                    disabled={isReadOnly}
                                 />
                                 <Toggle
                                    label="Validar Mesas"
                                    description="Verifica órdenes abiertas o pendientes antes del cierre operativo."
                                    checked={activeTerminal.config.workflow.session.checkOpenOrders}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'checkOpenOrders', v)}
                                    icon={ListChecks}
                                    disabled={isReadOnly}
                                 />
                                 <Toggle
                                    label="Conteo por Denominación"
                                    description="Exige declarar cantidades por billete/moneda durante el Cierre Z."
                                    checked={Boolean(activeTerminal.config.workflow.session.forceDenominationCount)}
                                    onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'forceDenominationCount', v)}
                                    icon={Coins}
                                    disabled={isReadOnly}
                                 />
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                 <label className="p-5 bg-slate-50 rounded-3xl border border-slate-100 space-y-3">
                                    <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Hora inicio jornada (0-23)</span>
                                    <input
                                       type="number"
                                       min="0"
                                       max="23"
                                       value={activeTerminal.config.workflow.session.businessStartHour ?? 0}
                                       onChange={(e) => handleUpdateActiveConfig('workflow.session', 'businessStartHour', clampInteger(e.target.value, 0, 23))}
                                       disabled={isReadOnly}
                                       className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-lg font-black text-slate-800 outline-none focus:border-blue-500 disabled:opacity-50"
                                    />
                                    <p className="text-xs font-medium text-slate-500">Delimita el día operativo para cierres Z.</p>
                                 </label>
                                 <label className="p-5 bg-slate-50 rounded-3xl border border-slate-100 space-y-3">
                                    <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Auto Lock (minutos)</span>
                                    <input
                                       type="number"
                                       min="0"
                                       value={activeTerminal.config.security.autoLogoutMinutes ?? 15}
                                       onChange={(e) => handleUpdateActiveConfig('security', 'autoLogoutMinutes', clampInteger(e.target.value, 0))}
                                       disabled={isReadOnly}
                                       className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-lg font-black text-slate-800 outline-none focus:border-blue-500 disabled:opacity-50"
                                    />
                                    <p className="text-xs font-medium text-slate-500">0 desactiva el bloqueo automático.</p>
                                 </label>
                                 <label className="md:col-span-2 p-5 bg-slate-50 rounded-3xl border border-slate-100 space-y-3">
                                    <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Correos para reporte Z</span>
                                    <textarea
                                       value={activeTerminal.config.workflow.session.zReportEmails || ''}
                                       onChange={(e) => handleUpdateActiveConfig('workflow.session', 'zReportEmails', e.target.value)}
                                       disabled={isReadOnly || !activeTerminal.config.workflow.session.emailZReport}
                                       placeholder="admin@empresa.com, supervisor@empresa.com"
                                       rows={2}
                                       className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold text-slate-800 outline-none focus:border-blue-500 disabled:opacity-50"
                                    />
                                    <p className="text-xs font-medium text-slate-500">Separar múltiples destinatarios con coma.</p>
                                 </label>
                              </div>
                           </div>
                        )}

                        {activeTab === 'OFFLINE' && (
                           <div className="space-y-6">
                              <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3"><Cloud className="text-sky-500" /> Red y Offline</h3>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                 {['OPTIMISTIC', 'STRICT', 'READ_ONLY'].map(mode => (
                                    <button key={mode} onClick={() => handleUpdateActiveConfig('workflow.offline', 'mode', mode)} className={`p-4 rounded-3xl border-2 font-black text-xs ${activeTerminal.config.workflow.offline.mode === mode ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-50 text-slate-400'}`}>{mode}</button>
                                 ))}
                              </div>
                           </div>
                        )}

                        {activeTab === 'FISCAL' && (
                           <div className="space-y-6">
                              <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3"><Landmark className="text-indigo-600" /> Fiscal</h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                 {['B01', 'B02', 'B04', 'B14', 'B15'].map(type => (
                                    <div key={type} className="p-5 bg-slate-50 rounded-3xl space-y-3">
                                       <p className="font-black text-slate-800 text-xs">{type} - {NCF_LABELS[type as NCFType]}</p>
                                       <input type="number" value={activeTerminal.config.fiscal?.typeConfigs?.[type as NCFType]?.batchSize || 100} onChange={(e) => handleUpdateActiveConfig('fiscal.typeConfigs', type, { ...(activeTerminal.config.fiscal?.typeConfigs?.[type as NCFType] || {}), batchSize: parseInt(e.target.value) })} className="w-full p-3 rounded-xl bg-white border font-bold text-sm" />
                                    </div>
                                 ))}
                              </div>
                           </div>
                        )}

                     </div>
                  </div>
               ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 font-bold italic">Selecciona una terminal para configurar</div>
               )}
            </div>
         </div>

         {showConflictModal && (
            <div className="fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
               <div className="bg-white rounded-[2.5rem] w-full max-w-sm shadow-2xl p-10 text-center animate-in zoom-in-95">
                  <ShieldAlert size={48} className="text-orange-600 mx-auto mb-4" />
                  <h3 className="text-xl font-black mb-2">Conflicto de Jerarquía</h3>
                  <p className="text-sm text-slate-500 mb-6">La terminal '{showConflictModal}' ya es Maestra. ¿Transferir el mando?</p>
                  <button onClick={confirmMasterTransfer} className="w-full py-4 bg-orange-600 text-white rounded-2xl font-black mb-3 shadow-lg">Transferir Rol</button>
                  <button onClick={() => setShowConflictModal(null)} className="w-full py-4 bg-slate-100 text-slate-500 rounded-2xl font-bold">Cancelar</button>
               </div>
            </div>
         )}
      </div>
   );
};

export default TerminalSettings;
