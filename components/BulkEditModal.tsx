
import React, { useState, useMemo } from 'react';
import { 
  X, Save, Truck, Settings2, Tag, Layers, 
  Check, AlertTriangle, Box, Info, ShieldCheck,
  Package, Building2, ChevronRight, Ban, Minus, Sun,
  LayoutGrid, RefreshCw
} from 'lucide-react';
import { BusinessConfig, Warehouse, Season, ProductGroup, Product } from '../types';

interface BulkEditModalProps {
  config: BusinessConfig;
  warehouses: Warehouse[];
  products: Product[];
  seasons: Season[];
  groups: ProductGroup[];
  selectedCount: number;
  onClose: () => void;
  onSave: (changes: any) => void;
}

type BulkTab = 'LOGISTICS' | 'FLAGS' | 'CLASSIFICATION';

const BulkEditModal: React.FC<BulkEditModalProps> = ({ 
  config, warehouses, products, seasons, groups, selectedCount, onClose, onSave 
}) => {
  const [activeTab, setActiveTab] = useState<BulkTab>('LOGISTICS');
  const [isSaving, setIsSaving] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  
  // Extraer categorías únicas disponibles en el catálogo
  const availableCategories = useMemo(() => {
    return Array.from(new Set(products.map(p => p.category))).sort();
  }, [products]);

  // STATE: Warehouse Actions (ENABLE, DISABLE, NO_CHANGE)
  const [warehouseActions, setWarehouseActions] = useState<Record<string, 'ENABLE' | 'DISABLE' | 'NO_CHANGE'>>({});

  // STATE: Flags with Application Switch
  const [flags, setFlags] = useState({
    trackInventory: { apply: false, value: true },
    isWeighted: { apply: false, value: false },
    autoPrintLabel: { apply: false, value: false },
    allowNegativeStock: { apply: false, value: false },
    ageRestricted: { apply: false, value: false },
  });

  // STATE: Classification
  const [classification, setClassification] = useState({
    categoryId: '',
    seasonId: '',
    groupId: ''
  });

  const handleToggleWarehouse = (whId: string) => {
    setWarehouseActions(prev => {
      const current = prev[whId] || 'NO_CHANGE';
      const next: any = current === 'NO_CHANGE' ? 'ENABLE' : current === 'ENABLE' ? 'DISABLE' : 'NO_CHANGE';
      return { ...prev, [whId]: next };
    });
  };

  const handleInitialClick = () => {
    setNeedsConfirmation(true);
  };

  const handleFinalConfirm = () => {
    setIsSaving(true);
    // Pequeño delay para asegurar que el UI muestre el estado de carga
    setTimeout(() => {
      onSave({
        warehouseActions,
        flags,
        classification
      });
    }, 50);
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-[2.5rem] w-full max-w-4xl h-[85vh] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-8 border-b flex justify-between items-center bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-blue-600 text-white rounded-2xl shadow-xl shadow-blue-500/20">
               <Settings2 size={28} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-800">Edición Masiva</h2>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">
                Actualizando <span className="text-blue-600 font-black">{selectedCount}</span> artículos simultáneamente
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} className="p-3 hover:bg-slate-100 rounded-full text-slate-400 transition-colors disabled:opacity-30">
             <X size={24} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex px-8 border-b bg-white shrink-0 overflow-x-auto no-scrollbar gap-2 py-2">
          {[
            { id: 'LOGISTICS', label: 'Logística & Almacenes', icon: Building2 },
            { id: 'FLAGS', label: 'Propiedades & Flags', icon: ShieldCheck },
            { id: 'CLASSIFICATION', label: 'Clasificación', icon: LayoutGrid },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as BulkTab)}
              disabled={isSaving}
              className={`flex items-center gap-2 py-3 px-6 font-black text-xs uppercase tracking-wider transition-all rounded-xl ${activeTab === tab.id ? 'bg-blue-50 text-blue-600 shadow-sm border border-blue-100' : 'text-slate-400 hover:text-slate-600'} disabled:opacity-50`}
            >
              <tab.icon size={16} /> {tab.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-10 bg-slate-50/30 custom-scrollbar">
          
          {activeTab === 'LOGISTICS' && (
            <div className="max-w-2xl mx-auto space-y-6 animate-in slide-in-from-right-4 duration-300">
               <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-3 mb-6">
                     <Info size={20} className="text-blue-500" />
                     <p className="text-sm text-slate-500 font-medium leading-relaxed">
                        Usa el selector para habilitar o deshabilitar la disponibilidad en bloque. Los artículos que ya estaban habilitados no se verán afectados si eliges <span className="font-bold">Sin Cambios</span>.
                     </p>
                  </div>
                  
                  <div className="space-y-3">
                     {warehouses.map(wh => {
                        const status = warehouseActions[wh.id] || 'NO_CHANGE';
                        return (
                           <div 
                              key={wh.id} 
                              onClick={() => !isSaving && handleToggleWarehouse(wh.id)}
                              className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between group ${status === 'ENABLE' ? 'bg-blue-50 border-blue-400' : status === 'DISABLE' ? 'bg-red-50 border-red-400' : 'bg-white border-slate-100'} ${isSaving ? 'pointer-events-none opacity-80' : ''}`}
                           >
                              <div className="flex items-center gap-4">
                                 <div className={`p-2 rounded-xl transition-colors ${status === 'ENABLE' ? 'bg-blue-600 text-white' : status === 'DISABLE' ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-400 group-hover:text-slate-600'}`}>
                                    <Building2 size={20} />
                                 </div>
                                 <div>
                                    <h4 className={`font-bold ${status !== 'NO_CHANGE' ? 'text-slate-900' : 'text-slate-700'}`}>{wh.name}</h4>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase">{wh.code}</p>
                                 </div>
                              </div>

                              <div className="flex items-center gap-3">
                                 <span className={`text-[10px] font-black uppercase tracking-widest ${status === 'ENABLE' ? 'text-blue-600' : status === 'DISABLE' ? 'text-red-600' : 'text-slate-300'}`}>
                                    {status === 'ENABLE' ? 'Activar Venta' : status === 'DISABLE' ? 'Bloquear Venta' : 'Sin Cambios'}
                                 </span>
                                 <div className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center transition-all ${status === 'ENABLE' ? 'bg-blue-600 border-blue-600 text-white' : status === 'DISABLE' ? 'bg-red-600 border-red-600 text-white' : 'bg-slate-50 border-slate-200 text-slate-300'}`}>
                                    {status === 'ENABLE' ? <Check size={20} strokeWidth={3} /> : status === 'DISABLE' ? <Ban size={20} strokeWidth={3} /> : <Minus size={20} strokeWidth={3} />}
                                 </div>
                              </div>
                           </div>
                        );
                     })}
                  </div>
               </div>
            </div>
          )}

          {activeTab === 'FLAGS' && (
            <div className="max-w-2xl mx-auto space-y-4 animate-in slide-in-from-right-4 duration-300">
               {[
                 { id: 'trackInventory', label: 'Controlar Stock', icon: Package, desc: 'Valida existencias físicas.' },
                 { id: 'isWeighted', label: '¿Es Pesado / Balanza?', icon: Layers, desc: 'Usa decimales y balanza externa.' },
                 { id: 'autoPrintLabel', label: 'Generar Etiqueta al Recibir', icon: Sun, desc: 'Impresión automática en stock-in.' },
                 { id: 'allowNegativeStock', label: 'Permitir Stock Negativo', icon: AlertTriangle, desc: 'Vender aunque no haya stock.' },
                 { id: 'ageRestricted', label: 'Verificación Edad (+18)', icon: ShieldCheck, desc: 'Requerir cédula en caja.' },
               ].map(flag => {
                 const cfg = (flags as any)[flag.id];
                 return (
                   <div key={flag.id} className={`bg-white p-6 rounded-3xl border-2 transition-all flex items-center gap-6 ${cfg.apply ? 'border-blue-400 shadow-md ring-4 ring-blue-50' : 'border-slate-100 opacity-80'} ${isSaving ? 'pointer-events-none' : ''}`}>
                      <div className="flex items-center justify-center">
                         <input 
                            type="checkbox" 
                            checked={cfg.apply}
                            disabled={isSaving}
                            onChange={(e) => setFlags({...flags, [flag.id]: { ...cfg, apply: e.target.checked }})}
                            className="w-6 h-6 rounded-lg text-blue-600 focus:ring-blue-500 border-slate-300"
                         />
                      </div>
                      
                      <div className="flex items-center gap-4 flex-1">
                         <div className={`p-3 rounded-xl ${cfg.apply ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
                            <flag.icon size={20} />
                         </div>
                         <div className="flex-1">
                            <h4 className="font-black text-sm text-slate-800 uppercase tracking-tight">{flag.label}</h4>
                            <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">{flag.desc}</p>
                         </div>
                      </div>

                      <div className={`transition-all ${cfg.apply ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                        <div 
                           onClick={() => !isSaving && setFlags({...flags, [flag.id]: { ...cfg, value: !cfg.value }})}
                           className={`w-14 h-7 rounded-full relative transition-colors cursor-pointer ${cfg.value ? 'bg-blue-600' : 'bg-slate-300'}`}
                        >
                           <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-300 ${cfg.value ? 'left-8' : 'left-1'}`} />
                        </div>
                      </div>
                   </div>
                 );
               })}
            </div>
          )}

          {activeTab === 'CLASSIFICATION' && (
             <div className="max-w-2xl mx-auto space-y-6 animate-in slide-in-from-right-4 duration-300">
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-8">
                   <div>
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Cambiar Categoría</label>
                      <select 
                        value={classification.categoryId}
                        disabled={isSaving}
                        onChange={(e) => setClassification({...classification, categoryId: e.target.value})}
                        className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-bold text-slate-800 focus:bg-white focus:border-blue-200 outline-none transition-all disabled:opacity-50"
                      >
                         <option value="">-- Sin Cambios (Mantener Actual) --</option>
                         {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                   </div>

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                         <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Asignar Temporada</label>
                         <select 
                           value={classification.seasonId}
                           disabled={isSaving}
                           onChange={(e) => setClassification({...classification, seasonId: e.target.value})}
                           className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-bold text-slate-800 focus:bg-white focus:border-blue-200 outline-none transition-all disabled:opacity-50"
                         >
                            <option value="">-- Sin Cambios --</option>
                            {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                         </select>
                      </div>
                      <div>
                         <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Mover a Grupo</label>
                         <select 
                           value={classification.groupId}
                           disabled={isSaving}
                           onChange={(e) => setClassification({...classification, groupId: e.target.value})}
                           className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-bold text-slate-800 focus:bg-white focus:border-blue-200 outline-none transition-all disabled:opacity-50"
                         >
                            <option value="">-- Sin Cambios --</option>
                            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                         </select>
                      </div>
                   </div>
                </div>
                
                <div className="p-6 bg-blue-50 rounded-[2rem] border border-blue-100 flex items-start gap-4">
                   <AlertTriangle className="text-blue-600 mt-1 shrink-0" size={24} />
                   <p className="text-xs text-blue-800 leading-relaxed font-medium">
                      <strong>Importante:</strong> Solo los campos que selecciones explícitamente serán actualizados en los artículos. Los valores actuales de los productos seleccionados se mantendrán intactos en los campos que dejes en blanco.
                   </p>
                </div>
             </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="p-8 border-t bg-white flex justify-end gap-4 shrink-0 shadow-[0_-10px_40px_rgba(0,0,0,0.03)]">
           <button 
             type="button" 
             onClick={onClose} 
             disabled={isSaving}
             className="px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-wider text-slate-400 hover:bg-slate-50 transition-colors disabled:opacity-30"
           >
              Cancelar
           </button>

           {needsConfirmation ? (
              <button 
                type="button"
                onClick={handleFinalConfirm}
                disabled={isSaving}
                className="px-12 py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-black text-sm uppercase tracking-wider shadow-2xl shadow-orange-500/30 active:scale-95 transition-all flex items-center gap-3 animate-in zoom-in-95"
              >
                 {isSaving ? <RefreshCw size={20} className="animate-spin" /> : <AlertTriangle size={20} />}
                 {isSaving ? 'Procesando...' : 'Confirmar Aplicación Masiva'}
              </button>
           ) : (
              <button 
                type="button"
                onClick={handleInitialClick}
                disabled={isSaving}
                className="px-12 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-sm uppercase tracking-wider shadow-2xl shadow-blue-500/30 active:scale-95 transition-all flex items-center gap-3"
              >
                 <Save size={20} /> Guardar Cambios Masivos
              </button>
           )}
        </div>

      </div>
    </div>
  );
};

export default BulkEditModal;
