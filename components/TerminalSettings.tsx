import React, { useState } from 'react';
import { 
  Database, Clock, WifiOff, X, Save, Image as ImageIcon, Receipt
} from 'lucide-react';
import { BusinessConfig, TerminalConfig } from '../types';

interface TerminalSettingsProps {
  config: BusinessConfig;
  onUpdateConfig: (newConfig: BusinessConfig) => void;
  onClose: () => void;
}

const TerminalSettings: React.FC<TerminalSettingsProps> = ({ config, onUpdateConfig, onClose }) => {
  const [activeTab, setActiveTab] = useState('WORKFLOW');
  // Mock selecting the first terminal for editing
  const terminalIndex = 0;
  const [selectedTerminal, setSelectedTerminal] = useState(config.terminals?.[terminalIndex] || { id: 'default', config: config.terminals?.[0]?.config });

  const handleUpdateConfig = (sectionPath: string, key: string, value: any) => {
    const section = sectionPath.split('.')[0] as keyof TerminalConfig;
    const subSection = sectionPath.split('.')[1];
    
    setSelectedTerminal(prev => {
        const newConfig = { ...prev.config };
        if (subSection) {
            // @ts-ignore
            if (!newConfig[section][subSection]) newConfig[section][subSection] = {};
            // @ts-ignore
            newConfig[section][subSection][key] = value;
        } else {
            // @ts-ignore
            newConfig[section][key] = value;
        }
        return { ...prev, config: newConfig };
    });
  };

  const handleSave = () => {
      const newTerminals = [...(config.terminals || [])];
      newTerminals[terminalIndex] = selectedTerminal;
      onUpdateConfig({ ...config, terminals: newTerminals });
      onClose();
  };

  const Toggle = ({ label, description, checked, onChange, danger = false }: any) => (
    <div 
        onClick={() => onChange(!checked)}
        className={`p-4 rounded-xl border-2 cursor-pointer flex justify-between items-center transition-all ${checked ? (danger ? 'bg-red-50 border-red-500' : 'bg-blue-50 border-blue-500') : 'bg-white border-gray-100 hover:border-gray-300'}`}
    >
        <div className="flex-1 pr-4">
            <h4 className={`font-bold text-sm ${checked ? (danger ? 'text-red-700' : 'text-blue-700') : 'text-gray-700'}`}>{label}</h4>
            <p className="text-xs text-gray-400 mt-1">{description}</p>
        </div>
        <div className={`w-10 h-6 rounded-full relative transition-colors shrink-0 ${checked ? (danger ? 'bg-red-500' : 'bg-blue-600') : 'bg-gray-300'}`}>
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${checked ? 'left-5' : 'left-1'}`} />
        </div>
    </div>
  );

  if (!selectedTerminal || !selectedTerminal.config) return <div>Cargando configuración...</div>;

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in fade-in">
        <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center">
            <h1 className="text-2xl font-black text-gray-800">Configuración de Terminal</h1>
            <div className="flex gap-2">
                <button onClick={handleSave} className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold flex items-center gap-2"><Save size={18}/> Guardar</button>
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X size={24}/></button>
            </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
              {activeTab === 'WORKFLOW' && (
                <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                  <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
                    <h3 className="text-lg font-black text-gray-800 mb-6 flex items-center gap-2 uppercase tracking-tight">
                       <Database size={20} className="text-emerald-500" /> Operativa e Inventario
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Toggle 
                        label="Validación en Tiempo Real" 
                        description="Verifica stock centralizado antes de procesar el cobro."
                        checked={selectedTerminal.config.workflow.inventory.realTimeValidation} 
                        onChange={(v: boolean) => handleUpdateConfig('workflow.inventory', 'realTimeValidation', v)} 
                      />
                      <Toggle 
                        label="Permitir Stock Negativo" 
                        description="Permite facturar artículos sin existencias físicas."
                        checked={selectedTerminal.config.workflow.inventory.allowNegativeStock} 
                        danger={true}
                        onChange={(v: boolean) => handleUpdateConfig('workflow.inventory', 'allowNegativeStock', v)} 
                      />
                      <Toggle 
                        label="Mostrar Stock en Caja" 
                        description="Visible en las tarjetas de producto."
                        checked={selectedTerminal.config.workflow.inventory.showStockOnTiles} 
                        onChange={(v: boolean) => handleUpdateConfig('workflow.inventory', 'showStockOnTiles', v)} 
                      />
                      <Toggle 
                        label="Imágenes en Ticket" 
                        description="Incluir miniatura en el recibo. No recomendado para supermercados por velocidad."
                        checked={selectedTerminal.config.workflow.inventory.showProductImagesInReceipt} 
                        onChange={(v: boolean) => handleUpdateConfig('workflow.inventory', 'showProductImagesInReceipt', v)} 
                      />
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
                    <h3 className="text-lg font-black text-gray-800 mb-6 flex items-center gap-2 uppercase tracking-tight">
                       <Clock size={20} className="text-indigo-500" /> Gestión de Sesión
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <Toggle 
                        label="Arqueo Ciego" 
                        description="El cajero debe contar el dinero sin saber el total esperado."
                        checked={selectedTerminal.config.workflow.session.blindClose} 
                        onChange={(v: boolean) => handleUpdateConfig('workflow.session', 'blindClose', v)} 
                      />
                      <Toggle 
                        label="Venta sin Apertura Z" 
                        description="Permite ventas rápidas sin haber iniciado turno formal."
                        checked={selectedTerminal.config.workflow.session.allowSalesWithOpenZ} 
                        onChange={(v: boolean) => handleUpdateConfig('workflow.session', 'allowSalesWithOpenZ', v)} 
                      />
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
                    <h3 className="text-lg font-black text-gray-800 mb-6 flex items-center gap-2 uppercase tracking-tight">
                       <WifiOff size={20} className="text-red-500" /> Operativa Offline
                    </h3>
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-xs font-black text-gray-400 uppercase mb-2 ml-1">Modo de Contingencia</label>
                        <select 
                          value={selectedTerminal.config.workflow.offline.mode}
                          onChange={(e) => handleUpdateConfig('workflow.offline', 'mode', e.target.value)}
                          className="w-full p-4 bg-gray-50 border border-transparent rounded-2xl font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100"
                        >
                          <option value="OPTIMISTIC">Optimista (Vende y Sincroniza después)</option>
                          <option value="STRICT">Estricto (Solo productos con stock local)</option>
                          <option value="READ_ONLY">Solo Consulta (No permite ventas)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}
        </div>
    </div>
  );
};

export default TerminalSettings;