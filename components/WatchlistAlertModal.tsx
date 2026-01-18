
import React, { useState } from 'react';
import { X, Save, ShieldCheck, Zap, AlertTriangle, TrendingDown, Clock, PieChart, ShoppingBag, ListChecks, Trash2 } from 'lucide-react';
import { Watchlist, WatchlistAlertSettings, Product } from '../types';

interface WatchlistAlertModalProps {
  watchlist: Watchlist;
  products: Product[]; // Se añadieron productos para listar los actuales
  onClose: () => void;
  onSave: (settings: WatchlistAlertSettings, updatedProductIds?: string[]) => void;
}

const WatchlistAlertModal: React.FC<WatchlistAlertModalProps> = ({ watchlist, products, onClose, onSave }) => {
  const [activeSubTab, setActiveSubTab] = useState<'CRITERIA' | 'ITEMS'>('CRITERIA');
  const [settings, setSettings] = useState<WatchlistAlertSettings>({ ...watchlist.alertSettings });
  const [currentProductIds, setCurrentProductIds] = useState<string[]>(watchlist.productIds);

  const handleChange = (key: keyof WatchlistAlertSettings, value: number) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const removeProductId = (id: string) => {
    setCurrentProductIds(prev => prev.filter(pid => pid !== id));
  };

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-[2.5rem] w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-slate-900 text-white rounded-2xl shadow-xl">
              <Zap size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-800">Ajustes de Tablero</h2>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Editando: {watchlist.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-slate-200 rounded-full text-slate-400 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-8 border-b bg-white gap-8 shrink-0">
           <button 
             onClick={() => setActiveSubTab('CRITERIA')}
             className={`py-4 text-sm font-bold border-b-4 transition-all ${activeSubTab === 'CRITERIA' ? 'border-slate-900 text-slate-900' : 'border-transparent text-gray-400'}`}
           >
              Umbrales de Alerta
           </button>
           <button 
             onClick={() => setActiveSubTab('ITEMS')}
             className={`py-4 text-sm font-bold border-b-4 transition-all flex items-center gap-2 ${activeSubTab === 'ITEMS' ? 'border-slate-900 text-slate-900' : 'border-transparent text-gray-400'}`}
           >
              Artículos Monitoreados <span className="bg-slate-100 px-1.5 rounded text-[10px]">{currentProductIds.length}</span>
           </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-10 space-y-10 custom-scrollbar bg-slate-50/30">
          
          {activeSubTab === 'CRITERIA' && (
             <div className="space-y-10 animate-in slide-in-from-left-4">
                <div className="bg-blue-50/50 p-5 rounded-3xl border border-blue-100 flex items-start gap-4">
                   <AlertTriangle size={24} className="text-blue-500 mt-1 shrink-0" />
                   <p className="text-xs text-blue-800 leading-relaxed font-medium">
                      Define los umbrales críticos para esta lista. El sistema resaltará en rojo intenso los artículos que no cumplan con estos objetivos de eficiencia comercial.
                   </p>
                </div>

                {/* Dormancy Settings */}
                <section>
                  <div className="flex justify-between items-end mb-4">
                     <div>
                        <h3 className="font-black text-slate-800 flex items-center gap-2">
                           <Clock size={18} className="text-red-500" /> Dormancy (Inactividad)
                        </h3>
                        <p className="text-xs text-slate-400">¿Cuántos días sin venta disparan una alerta?</p>
                     </div>
                     <span className="text-2xl font-black text-red-600">{settings.maxDormancyDays}d</span>
                  </div>
                  <input 
                     type="range" min="1" max="120" step="1"
                     value={settings.maxDormancyDays}
                     onChange={(e) => handleChange('maxDormancyDays', parseInt(e.target.value))}
                     className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-red-500"
                  />
                </section>

                {/* Velocity & Efficiency */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                   <section>
                      <div className="flex justify-between items-end mb-4">
                         <h3 className="font-bold text-sm text-slate-500 uppercase tracking-widest flex items-center gap-2">
                            <TrendingDown size={14} /> Vel. Mínima
                         </h3>
                         <span className="font-black text-slate-800">{settings.minVelocity}u/d</span>
                      </div>
                      <input 
                         type="range" min="0.1" max="10" step="0.1"
                         value={settings.minVelocity}
                         onChange={(e) => handleChange('minVelocity', parseFloat(e.target.value))}
                         className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      />
                   </section>
                   <section>
                      <div className="flex justify-between items-end mb-4">
                         <h3 className="font-bold text-sm text-slate-500 uppercase tracking-widest flex items-center gap-2">
                            <PieChart size={14} /> Sell-Through
                         </h3>
                         <span className="font-black text-slate-800">{settings.minSellThrough}%</span>
                      </div>
                      <input 
                         type="range" min="1" max="100" step="1"
                         value={settings.minSellThrough}
                         onChange={(e) => handleChange('minSellThrough', parseInt(e.target.value))}
                         className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                      />
                   </section>
                </div>

                {/* Supply Coverage */}
                <section className="bg-white p-6 rounded-[2rem] border border-slate-100">
                   <h3 className="font-black text-slate-800 mb-6 flex items-center gap-2">
                      <ShoppingBag size={18} className="text-indigo-600" /> Cobertura de Stock (WOS)
                   </h3>
                   <div className="space-y-8">
                      <div>
                         <div className="flex justify-between text-xs font-bold text-slate-500 uppercase mb-2">
                            <span>Riesgo de Quiebre (Agotado)</span>
                            <span className="text-red-600">Menos de {settings.criticalWeeksOfSupply} semanas</span>
                         </div>
                         <input 
                            type="range" min="0.5" max="4" step="0.5"
                            value={settings.criticalWeeksOfSupply}
                            onChange={(e) => handleChange('criticalWeeksOfSupply', parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-red-500"
                         />
                      </div>
                      <div>
                         <div className="flex justify-between text-xs font-bold text-slate-500 uppercase mb-2">
                            <span>Alerta de Sobre-stock (Exceso)</span>
                            <span className="text-indigo-600">Más de {settings.overstockWeeksOfSupply} semanas</span>
                         </div>
                         <input 
                            type="range" min="4" max="52" step="1"
                            value={settings.overstockWeeksOfSupply}
                            onChange={(e) => handleChange('overstockWeeksOfSupply', parseInt(e.target.value))}
                            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                         />
                      </div>
                   </div>
                </section>
             </div>
          )}

          {activeSubTab === 'ITEMS' && (
             <div className="animate-in slide-in-from-right-4 space-y-4">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Productos en este monitor</p>
                <div className="space-y-2">
                   {currentProductIds.length === 0 ? (
                      <div className="py-20 text-center text-slate-400 italic">No hay artículos en esta lista.</div>
                   ) : (
                      currentProductIds.map(pid => {
                         const product = products.find(p => p.id === pid);
                         if (!product) return null;
                         return (
                            <div key={pid} className="bg-white p-4 rounded-2xl border border-slate-200 flex items-center justify-between group">
                               <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-lg bg-slate-50 overflow-hidden border border-slate-100 shrink-0">
                                     {product.image && <img src={product.image} className="w-full h-full object-cover" />}
                                  </div>
                                  <div>
                                     <p className="font-bold text-slate-700 text-sm">{product.name}</p>
                                     <p className="text-[10px] text-slate-400 font-mono">{product.barcode}</p>
                                  </div>
                               </div>
                               <button 
                                 onClick={() => removeProductId(pid)}
                                 className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                               >
                                  <Trash2 size={16} />
                               </button>
                            </div>
                         );
                      })
                   )}
                </div>
             </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-8 border-t bg-white flex justify-end gap-4 shadow-[0_-10px_40px_rgba(0,0,0,0.03)]">
           <button onClick={onClose} className="px-8 py-3 rounded-2xl font-bold text-slate-400 hover:bg-slate-50 transition-colors">Cancelar</button>
           <button 
             onClick={() => onSave(settings, currentProductIds)}
             className="px-10 py-3 bg-slate-900 text-white rounded-2xl font-black shadow-xl hover:bg-black active:scale-95 transition-all flex items-center gap-2"
           >
              <Save size={20} /> Guardar Configuración
           </button>
        </div>

      </div>
    </div>
  );
};

export default WatchlistAlertModal;
