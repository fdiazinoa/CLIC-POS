
import React, { useState } from 'react';
import { 
  Cpu, ShoppingCart, Users, Lock, Printer, 
  ToggleLeft, ToggleRight, Save, X, AlertTriangle, 
  Clock, ShieldAlert, FileText
} from 'lucide-react';
import { BehaviorConfig } from '../types';

interface BehaviorSettingsProps {
  onClose: () => void;
  // In a real app, you'd pass current config and update function here
  // For demo, we'll manage local state
}

const DEFAULT_BEHAVIOR: BehaviorConfig = {
  allowNegativeStock: true,
  askGuestsOnTicketOpen: false,
  autoLogoutMinutes: 15,
  requireManagerForRefunds: true,
  autoPrintZReport: true,
};

const BehaviorSettings: React.FC<BehaviorSettingsProps> = ({ onClose }) => {
  const [config, setConfig] = useState<BehaviorConfig>(DEFAULT_BEHAVIOR);

  const handleSave = () => {
    // In real app: onUpdateConfig({ ...globalConfig, behaviorConfig: config });
    alert("Reglas de comportamiento actualizadas correctamente.");
    onClose();
  };

  const ToggleSwitch = ({ 
    label, 
    description, 
    checked, 
    onChange, 
    icon: Icon 
  }: { 
    label: string; 
    description?: string; 
    checked: boolean; 
    onChange: (val: boolean) => void;
    icon: React.ElementType;
  }) => (
    <div 
      onClick={() => onChange(!checked)}
      className={`flex items-center justify-between p-5 rounded-2xl border-2 transition-all cursor-pointer ${
        checked 
          ? 'bg-white border-blue-500 shadow-md' 
          : 'bg-gray-50 border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-start gap-4">
        <div className={`p-3 rounded-xl ${checked ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500'}`}>
          <Icon size={24} />
        </div>
        <div>
          <h3 className={`font-bold text-lg ${checked ? 'text-gray-900' : 'text-gray-500'}`}>{label}</h3>
          {description && <p className="text-sm text-gray-400 font-medium mt-1">{description}</p>}
        </div>
      </div>
      <div className="shrink-0 ml-4">
        {checked ? (
          <ToggleRight size={40} className="text-blue-500 transition-colors" />
        ) : (
          <ToggleLeft size={40} className="text-gray-300 transition-colors" />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300">
      
      {/* Header */}
      <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
             <Cpu className="text-indigo-600" /> Comportamiento del Sistema
          </h1>
          <p className="text-sm text-gray-500">Define reglas de negocio, seguridad y automatización.</p>
        </div>
        <div className="flex gap-3">
           <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
              <X size={24} />
           </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 pb-24">
        <div className="max-w-4xl mx-auto space-y-10">
           
           {/* SECTION 1: SALES RULES */}
           <section>
              <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 ml-1 flex items-center gap-2">
                 <ShoppingCart size={16} /> Reglas de Venta
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {/* Stock Negativo removed - Managed in Terminal Settings */}
                 <ToggleSwitch 
                    label="Solicitar Comensales"
                    description="Pedir # personas al abrir mesa (Restaurante)."
                    checked={config.askGuestsOnTicketOpen}
                    onChange={(v) => setConfig({...config, askGuestsOnTicketOpen: v})}
                    icon={Users}
                 />
              </div>
           </section>

           {/* SECTION 2: SECURITY */}
           <section>
              <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 ml-1 flex items-center gap-2">
                 <Lock size={16} /> Seguridad y Sesión
              </h2>
              <div className="space-y-4">
                 {/* Slider Card */}
                 <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                    <div className="flex items-center gap-4 mb-6">
                       <div className="p-3 bg-orange-100 text-orange-600 rounded-xl">
                          <Clock size={24} />
                       </div>
                       <div>
                          <h3 className="font-bold text-lg text-gray-900">Auto-Logout por Inactividad</h3>
                          <p className="text-sm text-gray-400">Cerrar sesión automáticamente tras X minutos.</p>
                       </div>
                       <div className="ml-auto text-2xl font-black text-orange-500">
                          {config.autoLogoutMinutes > 0 ? `${config.autoLogoutMinutes} min` : 'Desactivado'}
                       </div>
                    </div>
                    
                    <input 
                       type="range" 
                       min="0" 
                       max="60" 
                       step="5"
                       value={config.autoLogoutMinutes}
                       onChange={(e) => setConfig({...config,autoLogoutMinutes: parseInt(e.target.value)})}
                       className="w-full h-3 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-orange-500"
                    />
                    <div className="flex justify-between mt-2 text-xs font-bold text-gray-300 uppercase">
                       <span>Nunca</span>
                       <span>30 min</span>
                       <span>1 hora</span>
                    </div>
                 </div>

                 <ToggleSwitch 
                    label="Devoluciones Protegidas"
                    description="Requerir huella o PIN de gerente para reembolsos."
                    checked={config.requireManagerForRefunds}
                    onChange={(v) => setConfig({...config, requireManagerForRefunds: v})}
                    icon={ShieldAlert}
                 />
              </div>
           </section>

           {/* SECTION 3: CLOSING */}
           <section>
              <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 ml-1 flex items-center gap-2">
                 <FileText size={16} /> Modo Cierre (Z)
              </h2>
              <div className="grid grid-cols-1 gap-4">
                 <ToggleSwitch 
                    label="Impresión Automática Z"
                    description="Imprimir reporte físico al finalizar el cierre de caja."
                    checked={config.autoPrintZReport}
                    onChange={(v) => setConfig({...config, autoPrintZReport: v})}
                    icon={Printer}
                 />
              </div>
           </section>

        </div>
      </div>

      {/* Footer */}
      <div className="p-6 bg-white border-t border-gray-200 flex justify-end gap-4 z-10">
         <button onClick={onClose} className="px-8 py-4 text-gray-500 font-bold hover:bg-gray-50 rounded-xl transition-colors">
            Cancelar
         </button>
         <button 
            onClick={handleSave}
            className="px-10 py-4 bg-indigo-600 text-white font-bold rounded-xl shadow-lg hover:bg-indigo-500 transition-all flex items-center gap-2 active:scale-95"
         >
            <Save size={20} /> Guardar Reglas
         </button>
      </div>

    </div>
  );
};

export default BehaviorSettings;
