
import React, { useState, useMemo } from 'react';
import { 
  Database, Clock, WifiOff, X, Save, Image as ImageIcon, 
  Receipt, Monitor, Plus, Trash2, Smartphone, CheckCircle2,
  ChevronRight, Settings as SettingsIcon, AlertCircle,
  LayoutGrid, ShieldCheck, Zap, Lock, ShieldAlert,
  ArrowRight, Users, FileText, Hash, Type, RotateCcw, Tag, 
  DollarSign, Check
} from 'lucide-react';
import { BusinessConfig, TerminalConfig, DocumentSeries, Tariff } from '../types';
import { DEFAULT_TERMINAL_CONFIG } from '../constants';

interface TerminalSettingsProps {
  config: BusinessConfig;
  onUpdateConfig: (newConfig: BusinessConfig) => void;
  onClose: () => void;
}

type TerminalTab = 'OPERATIONAL' | 'SECURITY' | 'SESSION' | 'PRICING' | 'DOCUMENTS' | 'OFFLINE';

const TerminalSettings: React.FC<TerminalSettingsProps> = ({ config, onUpdateConfig, onClose }) => {
  const [terminals, setTerminals] = useState(config.terminals || []);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>(terminals[0]?.id || '');
  const [activeTab, setActiveTab] = useState<TerminalTab>('OPERATIONAL');

  // Document Editing State
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);

  const activeTerminal = useMemo(() => 
    terminals.find(t => t.id === selectedTerminalId), 
  [terminals, selectedTerminalId]);

  const handleUpdateActiveConfig = (sectionPath: string, key: string, value: any) => {
    if (!activeTerminal) return;

    setTerminals(prev => prev.map(t => {
      if (t.id === selectedTerminalId) {
        const newConfig = JSON.parse(JSON.stringify(t.config));
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
        return { ...t, config: newConfig };
      }
      return t;
    }));
  };

  const toggleTariffPermission = (tariffId: string) => {
    if (!activeTerminal) return;
    const currentAllowed = activeTerminal.config.pricing?.allowedTariffIds || [];
    const isAllowed = currentAllowed.includes(tariffId);
    
    let newAllowed;
    if (isAllowed) {
       if (currentAllowed.length === 1) return alert("Debe haber al menos una tarifa permitida.");
       newAllowed = currentAllowed.filter(id => id !== tariffId);
    } else {
       newAllowed = [...currentAllowed, tariffId];
    }
    
    handleUpdateActiveConfig('pricing', 'allowedTariffIds', newAllowed);
    
    // Si la tarifa por defecto es la que quitamos, poner la primera disponible
    if (isAllowed && activeTerminal.config.pricing?.defaultTariffId === tariffId) {
       handleUpdateActiveConfig('pricing', 'defaultTariffId', newAllowed[0]);
    }
  };

  const handleUpdateDocumentSeries = (seriesId: string, updates: Partial<DocumentSeries>) => {
     if (!activeTerminal) return;
     setTerminals(prev => prev.map(t => {
        if (t.id === selectedTerminalId) {
           const newSeries = t.config.documentSeries.map(s => s.id === seriesId ? { ...s, ...updates } : s);
           return { ...t, config: { ...t.config, documentSeries: newSeries } };
        }
        return t;
     }));
  };

  const handleAddTerminal = () => {
    const newId = `POS-${(terminals.length + 1).toString().padStart(3, '0')}`;
    const newTerminal = {
      id: newId,
      config: JSON.parse(JSON.stringify(DEFAULT_TERMINAL_CONFIG))
    };
    setTerminals([...terminals, newTerminal]);
    setSelectedTerminalId(newId);
  };

  const handleDeleteTerminal = (id: string) => {
    if (terminals.length === 1) return alert("Debe existir al menos una terminal configurada.");
    if (confirm(`¿Eliminar la configuración de la terminal ${id}?`)) {
      const newTerminals = terminals.filter(t => t.id !== id);
      setTerminals(newTerminals);
      if (selectedTerminalId === id) {
        setSelectedTerminalId(newTerminals[0].id);
      }
    }
  };

  const handleSave = () => {
    onUpdateConfig({ ...config, terminals: terminals });
    alert("Configuraciones de terminales guardadas correctamente.");
    onClose();
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
    <div className="flex h-full bg-gray-50 animate-in fade-in overflow-hidden">
        
        {/* SIDEBAR */}
        <aside className="w-80 bg-white border-r border-gray-200 flex flex-col shrink-0 z-20 shadow-sm">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
               <div>
                  <h2 className="text-xl font-black text-slate-800">Terminales</h2>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Nodos de venta activos</p>
               </div>
               <button onClick={handleAddTerminal} className="p-2 bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all">
                  <Plus size={20} />
               </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
               {terminals.map((t) => (
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
                           <p className="text-[10px] font-medium text-gray-400 uppercase tracking-tighter">POS Terminal</p>
                        </div>
                     </div>
                     <div className="flex items-center gap-1">
                        {selectedTerminalId === t.id ? <ChevronRight size={16} className="text-blue-500" /> : <button onClick={(e) => { e.stopPropagation(); handleDeleteTerminal(t.id); }} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={16} /></button>}
                     </div>
                  </div>
               ))}
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
                       <Save size={20}/> Guardar
                    </button>
                    <button onClick={onClose} className="p-3 bg-gray-100 text-gray-500 hover:bg-gray-200 rounded-xl transition-colors">
                       <X size={20}/>
                    </button>
                </div>
            </header>

            <div className="px-8 bg-white border-b border-gray-100 flex gap-8 shrink-0 overflow-x-auto no-scrollbar">
                {[
                  { id: 'OPERATIONAL', label: 'Operativa', icon: Database },
                  { id: 'PRICING', label: 'Tarifas y Precios', icon: Tag },
                  { id: 'SECURITY', label: 'Seguridad', icon: ShieldAlert },
                  { id: 'SESSION', label: 'Sesión y Z', icon: Clock },
                  { id: 'DOCUMENTS', label: 'Documentos', icon: FileText },
                  { id: 'OFFLINE', label: 'Offline', icon: WifiOff },
                ].map(tab => (
                  <button 
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as TerminalTab)}
                    className={`pb-4 pt-2 text-sm font-bold flex items-center gap-2 border-b-4 transition-all whitespace-nowrap ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                  >
                    <tab.icon size={18} /> {tab.label}
                  </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-50/50">
                {activeTerminal ? (
                    <div className="max-w-5xl mx-auto pb-20">
                        
                        {activeTab === 'OPERATIONAL' && (
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 animate-in slide-in-from-right-4">
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
                          </div>
                        )}

                        {/* NUEVA PESTAÑA: PRICING */}
                        {activeTab === 'PRICING' && (
                           <div className="space-y-10 animate-in slide-in-from-right-4">
                              <section>
                                 <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                                    <Tag size={18} className="text-purple-500" /> Tarifas Permitidas en este POS
                                 </h3>
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {config.tariffs.map(tariff => {
                                       const isAllowed = activeTerminal.config.pricing?.allowedTariffIds.includes(tariff.id);
                                       const isDefault = activeTerminal.config.pricing?.defaultTariffId === tariff.id;
                                       
                                       return (
                                          <div 
                                             key={tariff.id}
                                             onClick={() => toggleTariffPermission(tariff.id)}
                                             className={`p-5 rounded-3xl border-2 transition-all cursor-pointer flex flex-col gap-4 relative overflow-hidden ${isAllowed ? 'bg-white border-purple-500 shadow-lg' : 'bg-gray-50 border-gray-100 opacity-60'}`}
                                          >
                                             <div className="flex justify-between items-start">
                                                <div className="flex items-center gap-3">
                                                   <div className={`p-2 rounded-xl ${isAllowed ? 'bg-purple-100 text-purple-600' : 'bg-gray-200 text-gray-400'}`}>
                                                      <DollarSign size={20} />
                                                   </div>
                                                   <div>
                                                      <h4 className="font-bold text-gray-800">{tariff.name}</h4>
                                                      <p className="text-[10px] text-gray-400 font-mono uppercase">{tariff.strategy.type}</p>
                                                   </div>
                                                </div>
                                                {isAllowed && <div className="bg-purple-500 text-white p-1 rounded-full"><Check size={14} strokeWidth={4} /></div>}
                                             </div>
                                             
                                             {isAllowed && (
                                                <button 
                                                   onClick={(e) => { e.stopPropagation(); handleUpdateActiveConfig('pricing', 'defaultTariffId', tariff.id); }}
                                                   className={`w-full py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isDefault ? 'bg-purple-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-purple-50 hover:text-purple-600'}`}
                                                >
                                                   {isDefault ? 'Tarifa Predeterminada' : 'Establecer como por defecto'}
                                                </button>
                                             )}
                                          </div>
                                       );
                                    })}
                                 </div>
                              </section>

                              <div className="bg-amber-50 border border-amber-100 p-6 rounded-[2rem] flex items-start gap-4">
                                 <AlertCircle className="text-amber-500 shrink-0 mt-1" size={24} />
                                 <div>
                                    <h4 className="font-bold text-amber-800">Control de Visibilidad</h4>
                                    <p className="text-sm text-amber-700 leading-relaxed mt-1">
                                       En la pantalla de ventas, esta caja solo mostrará los productos que tengan un precio definido en las tarifas seleccionadas anteriormente. Si un producto no tiene precio en la tarifa activa, se ocultará automáticamente para prevenir errores.
                                    </p>
                                 </div>
                              </div>
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
                              <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                                 <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                       <div className="p-2 bg-orange-100 text-orange-600 rounded-lg"><Clock size={20} /></div>
                                       <div>
                                          <h4 className="font-bold text-sm text-gray-800">Auto-Logout</h4>
                                          <p className="text-[11px] text-gray-400">Cierre de sesión automático por inactividad.</p>
                                       </div>
                                    </div>
                                    <div className="text-xl font-black text-orange-600">{activeTerminal.config.security.autoLogoutMinutes} min</div>
                                 </div>
                                 <input type="range" min="0" max="60" step="5" value={activeTerminal.config.security.autoLogoutMinutes} onChange={(e) => handleUpdateActiveConfig('security', 'autoLogoutMinutes', parseInt(e.target.value))} className="w-full h-2 bg-gray-100 rounded-full appearance-none cursor-pointer accent-orange-500" />
                              </div>
                          </div>
                        )}

                        {activeTab === 'SESSION' && (
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 animate-in slide-in-from-right-4">
                              <Toggle 
                                 label="Arqueo Ciego" 
                                 description="El cajero no conoce el monto esperado en el cierre."
                                 checked={activeTerminal.config.workflow.session.blindClose} 
                                 onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'blindClose', v)} 
                              />
                              <Toggle 
                                 label="Impresión Automática Z" 
                                 description="Imprimir reporte físico al finalizar el cierre de caja."
                                 checked={activeTerminal.config.workflow.session.autoPrintZReport} 
                                 icon={Receipt}
                                 onChange={(v: boolean) => handleUpdateActiveConfig('workflow.session', 'autoPrintZReport', v)} 
                              />
                          </div>
                        )}

                        {activeTab === 'DOCUMENTS' && (
                           <div className="flex flex-col lg:flex-row gap-8 animate-in slide-in-from-right-4 h-full">
                              <div className="flex-1 space-y-4">
                                 {activeTerminal.config.documentSeries.map(series => (
                                    <div key={series.id} onClick={() => setEditingSeriesId(series.id)} className={`p-5 bg-white rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between ${editingSeriesId === series.id ? 'border-blue-500 shadow-md ring-4 ring-blue-50' : 'border-transparent hover:border-gray-200'}`}>
                                       <div className="flex items-center gap-4">
                                          <div className="p-3 rounded-xl bg-blue-50 text-blue-600"><FileText size={20} /></div>
                                          <div>
                                             <h4 className="font-bold text-slate-800 text-sm">{series.name}</h4>
                                             <p className="text-[10px] text-gray-400 font-mono mt-1">{series.prefix}-{series.nextNumber.toString().padStart(series.padding, '0')}</p>
                                          </div>
                                       </div>
                                       <ChevronRight size={16} className="text-gray-300" />
                                    </div>
                                 ))}
                              </div>
                              <div className="w-full lg:w-96 bg-white rounded-3xl p-6 border border-gray-200 shadow-sm h-fit sticky top-0">
                                 {editingSeriesId ? (
                                    <div className="space-y-6">
                                       {(() => {
                                          const s = activeTerminal.config.documentSeries.find(x => x.id === editingSeriesId)!;
                                          return (
                                             <>
                                                <div className="bg-slate-900 rounded-2xl p-6 text-center">
                                                   <p className="text-slate-400 text-[10px] font-bold uppercase mb-2">Próximo Folio</p>
                                                   <div className="text-2xl font-mono font-bold text-white tracking-wider">
                                                      <span className="text-blue-400">{s.prefix}</span>-<span className="text-white">{s.nextNumber.toString().padStart(s.padding, '0')}</span>
                                                   </div>
                                                </div>
                                                <div className="space-y-4">
                                                   <input type="text" value={s.prefix} onChange={(e) => handleUpdateDocumentSeries(s.id, { prefix: e.target.value.toUpperCase() })} className="w-full p-3 bg-gray-50 rounded-xl font-bold uppercase" placeholder="PREFIJO" />
                                                   <div className="grid grid-cols-2 gap-4">
                                                      <input type="number" value={s.nextNumber} onChange={(e) => handleUpdateDocumentSeries(s.id, { nextNumber: parseInt(e.target.value) || 1 })} className="w-full p-3 bg-gray-50 rounded-xl font-bold" placeholder="FOLIO" />
                                                      <select value={s.padding} onChange={(e) => handleUpdateDocumentSeries(s.id, { padding: parseInt(e.target.value) })} className="w-full p-3 bg-gray-50 rounded-xl font-bold">
                                                         {[4,5,6,8].map(n => <option key={n} value={n}>{n} ceros</option>)}
                                                      </select>
                                                   </div>
                                                </div>
                                                <button onClick={() => handleUpdateDocumentSeries(s.id, { nextNumber: 1 })} className="w-full py-2.5 bg-red-50 text-red-600 rounded-xl text-xs font-bold flex items-center justify-center gap-2"><RotateCcw size={14} /> Reiniciar contador</button>
                                             </>
                                          )
                                       })()}
                                    </div>
                                 ) : <div className="text-center py-10 text-gray-400 text-sm italic">Selecciona una serie para editar.</div>}
                              </div>
                           </div>
                        )}

                        {activeTab === 'OFFLINE' && (
                           <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm animate-in slide-in-from-right-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                 {[
                                    { id: 'OPTIMISTIC', label: 'Optimista', desc: 'Permite vender. Sincroniza después.' },
                                    { id: 'STRICT', label: 'Estricto', desc: 'Bloquea ventas sin red.' },
                                    { id: 'READ_ONLY', label: 'Lectura', desc: 'Solo consulta stock.' }
                                 ].map(mode => (
                                    <button 
                                       key={mode.id}
                                       onClick={() => handleUpdateActiveConfig('workflow.offline', 'mode', mode.id)}
                                       className={`p-6 rounded-[2rem] border-4 text-left transition-all ${activeTerminal.config.workflow.offline.mode === mode.id ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-100 text-gray-500 bg-white'}`}
                                    >
                                       <p className="font-black text-lg mb-2">{mode.label}</p>
                                       <p className="text-xs opacity-70">{mode.desc}</p>
                                    </button>
                                 ))}
                              </div>
                           </div>
                        )}

                    </div>
                ) : <div className="h-full flex flex-col items-center justify-center text-gray-400 italic"><p>Selecciona una terminal</p></div>}
            </div>
        </div>
    </div>
  );
};

export default TerminalSettings;
