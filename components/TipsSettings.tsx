import React, { useState } from 'react';
import { 
  Coins, Save, ToggleLeft, ToggleRight, DollarSign, 
  Users, AlertCircle, Sparkles, Smartphone, Check
} from 'lucide-react';
import { BusinessConfig, TipConfiguration } from '../types';

interface TipsSettingsProps {
  config: BusinessConfig;
  onUpdateConfig: (newConfig: BusinessConfig) => void;
  onClose: () => void;
}

// Default if undefined
const DEFAULT_TIPS: TipConfiguration = {
  enabled: true,
  defaultOptions: [10, 15, 20],
  allowCustomTip: true,
  serviceCharge: {
    enabled: false,
    percentage: 10,
    applyIfTotalOver: 0,
    applyIfGuestsOver: 5
  }
};

const TipsSettings: React.FC<TipsSettingsProps> = ({ config, onUpdateConfig, onClose }) => {
  const [tipsConfig, setTipsConfig] = useState<TipConfiguration>(config.tipsConfig || DEFAULT_TIPS);

  // Sync state to parent
  const handleSave = () => {
    onUpdateConfig({
      ...config,
      tipsConfig: tipsConfig
    });
    alert("Configuración de propinas guardada.");
  };

  const handlePercentageChange = (index: number, val: string) => {
    const newVal = parseInt(val) || 0;
    const newOpts = [...tipsConfig.defaultOptions] as [number, number, number];
    newOpts[index] = newVal;
    setTipsConfig({ ...tipsConfig, defaultOptions: newOpts });
  };

  // --- UI HELPERS ---
  const Toggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
    <div 
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between p-4 bg-white rounded-xl border border-gray-200 cursor-pointer hover:border-amber-400 transition-colors"
    >
      <span className="font-bold text-gray-700">{label}</span>
      {checked ? <ToggleRight className="text-amber-500" size={32} /> : <ToggleLeft className="text-gray-300" size={32} />}
    </div>
  );

  // --- PREVIEW CALCS ---
  const MOCK_TOTAL = 100.00;
  const autoGratuityApplied = 
    tipsConfig.serviceCharge.enabled && 
    (MOCK_TOTAL >= (tipsConfig.serviceCharge.applyIfTotalOver || 0)) &&
    (6 >= (tipsConfig.serviceCharge.applyIfGuestsOver || 0)); // Assuming 6 guests for preview

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in fade-in">
      
      {/* Header */}
      <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
             <Coins className="text-amber-500" /> Configuración de Propinas
          </h1>
          <p className="text-sm text-gray-500">Administra sugerencias y cargos por servicio.</p>
        </div>
        <button 
          onClick={handleSave}
          className="px-6 py-3 bg-gray-900 text-white rounded-xl font-bold hover:bg-gray-800 shadow-lg transition-all flex items-center gap-2"
        >
          <Save size={20} /> Guardar
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
         
         {/* LEFT: CONFIGURATION CONTROLS */}
         <div className="flex-1 overflow-y-auto p-8 space-y-8">
            
            {/* SECTION 1: SMART TIPPING */}
            <section>
               <h2 className="text-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                  <Sparkles size={18} className="text-amber-500" /> Propinas Inteligentes
               </h2>
               
               <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200">
                  <div className="mb-6">
                     <Toggle 
                        label="Habilitar Propinas en Pantalla" 
                        checked={tipsConfig.enabled} 
                        onChange={(v) => setTipsConfig({...tipsConfig, enabled: v})} 
                     />
                  </div>

                  <div className={`transition-opacity ${tipsConfig.enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                     <p className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-4">Porcentajes Sugeridos</p>
                     
                     <div className="flex justify-around items-center gap-4 mb-8">
                        {tipsConfig.defaultOptions.map((opt, idx) => (
                           <div key={idx} className="flex flex-col items-center gap-2">
                              <div className="relative group">
                                 <input 
                                    type="number" 
                                    value={opt}
                                    onChange={(e) => handlePercentageChange(idx, e.target.value)}
                                    className="w-24 h-24 rounded-full border-4 border-amber-100 text-center text-2xl font-black text-gray-800 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-50 transition-all"
                                 />
                                 <span className="absolute top-1/2 right-4 -translate-y-1/2 text-gray-400 font-bold">%</span>
                              </div>
                              <span className="text-xs font-bold text-gray-400">Opción {idx + 1}</span>
                           </div>
                        ))}
                     </div>

                     <Toggle 
                        label="Permitir Propina Personalizada (Otro Monto)" 
                        checked={tipsConfig.allowCustomTip} 
                        onChange={(v) => setTipsConfig({...tipsConfig, allowCustomTip: v})} 
                     />
                  </div>
               </div>
            </section>

            {/* SECTION 2: AUTO GRATUITY (SERVICE CHARGE) */}
            <section>
               <h2 className="text-lg font-bold text-gray-700 mb-4 flex items-center gap-2">
                  <AlertCircle size={18} className="text-blue-500" /> Cargo por Servicio (Auto-Gratuity)
               </h2>

               <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200">
                  <div className="mb-6">
                     <Toggle 
                        label="Habilitar Cargo Automático" 
                        checked={tipsConfig.serviceCharge.enabled} 
                        onChange={(v) => setTipsConfig({...tipsConfig, serviceCharge: {...tipsConfig.serviceCharge, enabled: v}})} 
                     />
                  </div>

                  <div className={`space-y-6 transition-opacity ${tipsConfig.serviceCharge.enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                     
                     <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                        <div className="flex flex-wrap items-center gap-2 text-gray-700 font-medium">
                           <span>SI el ticket es mayor a</span>
                           <div className="relative w-24">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                              <input 
                                 type="number" 
                                 className="w-full pl-6 p-2 rounded-lg border border-blue-200 outline-none focus:ring-2 focus:ring-blue-400 font-bold"
                                 value={tipsConfig.serviceCharge.applyIfTotalOver}
                                 onChange={(e) => setTipsConfig({
                                    ...tipsConfig, 
                                    serviceCharge: {...tipsConfig.serviceCharge, applyIfTotalOver: parseFloat(e.target.value)}
                                 })}
                              />
                           </div>
                           <span>O la mesa tiene más de</span>
                           <div className="relative w-20">
                              <input 
                                 type="number" 
                                 className="w-full pl-3 p-2 rounded-lg border border-blue-200 outline-none focus:ring-2 focus:ring-blue-400 font-bold"
                                 value={tipsConfig.serviceCharge.applyIfGuestsOver}
                                 onChange={(e) => setTipsConfig({
                                    ...tipsConfig, 
                                    serviceCharge: {...tipsConfig.serviceCharge, applyIfGuestsOver: parseFloat(e.target.value)}
                                 })}
                              />
                              <Users size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
                           </div>
                           <span>personas...</span>
                        </div>

                        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-blue-100">
                           <span className="font-bold text-blue-800">ENTONCES aplicar:</span>
                           <div className="relative w-24">
                              <input 
                                 type="number" 
                                 className="w-full pr-8 p-2 rounded-lg border border-blue-200 outline-none focus:ring-2 focus:ring-blue-400 font-bold text-lg text-blue-700"
                                 value={tipsConfig.serviceCharge.percentage}
                                 onChange={(e) => setTipsConfig({
                                    ...tipsConfig, 
                                    serviceCharge: {...tipsConfig.serviceCharge, percentage: parseFloat(e.target.value)}
                                 })}
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 font-bold">%</span>
                           </div>
                           <span className="text-sm text-blue-600">automáticamente.</span>
                        </div>
                     </div>

                  </div>
               </div>
            </section>

         </div>

         {/* RIGHT: LIVE PREVIEW */}
         <div className="w-full lg:w-[480px] bg-gray-100 border-l border-gray-200 flex flex-col items-center justify-center p-8 sticky top-0 h-full">
            <h3 className="text-gray-400 font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
               <Smartphone size={20} /> Vista Previa Cliente
            </h3>

            {/* TABLET MOCKUP */}
            <div className="relative w-full max-w-sm bg-gray-900 rounded-[2.5rem] p-4 shadow-2xl border-4 border-gray-800">
               {/* Screen Content */}
               <div className="bg-white rounded-[2rem] overflow-hidden h-[600px] flex flex-col relative">
                  
                  {/* Status Bar Mock */}
                  <div className="bg-gray-50 h-8 w-full flex justify-between px-6 items-center">
                     <span className="text-[10px] font-bold text-gray-400">9:41 AM</span>
                     <div className="flex gap-1">
                        <div className="w-4 h-2 bg-gray-300 rounded-sm"></div>
                        <div className="w-3 h-2 bg-gray-300 rounded-sm"></div>
                     </div>
                  </div>

                  {/* App Content */}
                  <div className="flex-1 p-6 flex flex-col">
                     <div className="text-center mb-8">
                        <h2 className="text-2xl font-bold text-gray-800">Total a Pagar</h2>
                        <p className="text-5xl font-black text-gray-900 mt-2">${MOCK_TOTAL.toFixed(2)}</p>
                     </div>

                     {tipsConfig.enabled ? (
                        <div className="flex-1 flex flex-col gap-4">
                           <p className="text-center text-gray-500 font-medium">¿Desea agregar propina?</p>
                           
                           {/* Tip Options */}
                           <div className="grid grid-cols-3 gap-3">
                              {tipsConfig.defaultOptions.map(pct => (
                                 <button key={pct} className="flex flex-col items-center justify-center p-4 bg-amber-50 border-2 border-amber-200 rounded-2xl text-amber-700 shadow-sm">
                                    <span className="text-lg font-black">{pct}%</span>
                                    <span className="text-xs">${(MOCK_TOTAL * (pct/100)).toFixed(2)}</span>
                                 </button>
                              ))}
                           </div>

                           {/* Custom Tip */}
                           {tipsConfig.allowCustomTip && (
                              <button className="w-full py-4 rounded-xl border-2 border-dashed border-gray-300 text-gray-400 font-bold hover:bg-gray-50">
                                 Otra Cantidad
                              </button>
                           )}

                           {/* No Tip */}
                           <button className="mt-auto w-full py-3 text-gray-400 font-bold text-sm underline">
                              No, gracias
                           </button>
                        </div>
                     ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-400 italic">
                           Propinas deshabilitadas
                        </div>
                     )}

                     {/* Footer Button */}
                     <div className="mt-6">
                        <button className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg shadow-xl flex justify-between px-6 items-center">
                           <span>Pagar</span>
                           <span>${(MOCK_TOTAL * (autoGratuityApplied ? (1 + tipsConfig.serviceCharge.percentage/100) : 1)).toFixed(2)}</span>
                        </button>
                        {autoGratuityApplied && (
                           <p className="text-center text-[10px] text-gray-400 mt-2">
                              Incluye {tipsConfig.serviceCharge.percentage}% de cargo por servicio.
                           </p>
                        )}
                     </div>

                  </div>
               </div>

               {/* Home Indicator */}
               <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-32 h-1 bg-gray-700 rounded-full"></div>
            </div>

            <div className="mt-8 text-center">
               <p className="text-xs text-gray-400 max-w-xs mx-auto">
                  * Vista previa simulada basada en una venta de $100.00 con 6 comensales.
               </p>
            </div>
         </div>

      </div>
    </div>
  );
};

export default TipsSettings;
