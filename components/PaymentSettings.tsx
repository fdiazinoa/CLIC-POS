
import React, { useState, useRef } from 'react';
import { 
  CreditCard, Banknote, QrCode, Wallet, GripVertical, 
  Edit2, Trash2, X, Plus, Save, PenTool, Zap, 
  CreditCard as CardIcon, DollarSign, Smartphone,
  Key, Server, CheckCircle2, AlertCircle, Wifi, RefreshCw
} from 'lucide-react';
import { BusinessConfig, PaymentMethodDefinition, PaymentMethod } from '../types';

interface PaymentSettingsProps {
  config: BusinessConfig;
  onUpdateConfig: (newConfig: BusinessConfig) => void;
  onClose: () => void;
}

// Default Data if config is empty
const DEFAULT_METHODS: PaymentMethodDefinition[] = [
  { id: 'cash', name: 'Efectivo', type: 'CASH', isEnabled: true, icon: 'Banknote', color: 'bg-green-500', opensDrawer: true, requiresSignature: false, integration: 'NONE' },
  { id: 'card', name: 'Tarjeta', type: 'CARD', isEnabled: true, icon: 'CreditCard', color: 'bg-blue-500', opensDrawer: false, requiresSignature: false, integration: 'NONE' },
  { id: 'qr', name: 'Transferencia / QR', type: 'QR', isEnabled: true, icon: 'QrCode', color: 'bg-purple-500', opensDrawer: false, requiresSignature: false, integration: 'NONE' },
];

// Available Icons for Picker
const ICONS = {
  Banknote, CreditCard, QrCode, Wallet, DollarSign, Smartphone, Zap, CardIcon
};

const COLORS = [
  'bg-green-500', 'bg-blue-500', 'bg-red-500', 'bg-orange-500', 
  'bg-purple-500', 'bg-pink-500', 'bg-teal-500', 'bg-gray-800'
];

// Helper icon
const LockIcon = ({ size, className }: any) => <Key size={size} className={className} />;

// --- PROVIDER SCHEMA CONFIGURATIONS ---
const PROVIDER_SCHEMAS: Record<string, { key: string; label: string; type: 'text' | 'password'; placeholder?: string; icon: React.ElementType }[]> = {
  STRIPE: [
    { key: 'publishableKey', label: 'Publishable Key', type: 'text', placeholder: 'pk_test_...', icon: Key },
    { key: 'secretKey', label: 'Secret Key', type: 'password', placeholder: 'sk_test_...', icon: LockIcon },
    { key: 'terminalId', label: 'Terminal ID (Reader)', type: 'text', placeholder: 'tmr_...', icon: Server },
  ],
  VISANET: [
    { key: 'merchantId', label: 'Merchant ID', type: 'text', placeholder: '39000...', icon: Server },
    { key: 'terminalId', label: 'Terminal ID', type: 'text', placeholder: '0001', icon: Smartphone },
    { key: 'authKey', label: 'Auth Key (Token)', type: 'password', placeholder: '••••••', icon: Key },
  ],
  CARNET: [
    { key: 'affiliateCode', label: 'Código Afiliado', type: 'text', placeholder: '789...', icon: Server },
    { key: 'accessPin', label: 'Access PIN', type: 'password', placeholder: '1234', icon: Key },
  ]
};

const PaymentSettings: React.FC<PaymentSettingsProps> = ({ config, onUpdateConfig, onClose }) => {
  
  // State Initialization
  const [methods, setMethods] = useState<PaymentMethodDefinition[]>(config.paymentMethods || DEFAULT_METHODS);
  
  // Method Editing State
  const [editingMethod, setEditingMethod] = useState<PaymentMethodDefinition | null>(null);
  const [isMethodModalOpen, setIsMethodModalOpen] = useState(false);
  
  // Connection Testing State
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'IDLE' | 'SUCCESS' | 'ERROR'>('IDLE');

  // --- DRAG & DROP LOGIC ---
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, position: number) => {
    dragItem.current = position;
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, position: number) => {
    dragOverItem.current = position;
  };

  const handleDragEnd = () => {
    const copyListItems = [...methods];
    const dragItemContent = copyListItems[dragItem.current!];
    copyListItems.splice(dragItem.current!, 1);
    copyListItems.splice(dragOverItem.current!, 0, dragItemContent);
    dragItem.current = null;
    dragOverItem.current = null;
    setMethods(copyListItems);
  };

  // --- METHOD HANDLERS ---
  
  const handleAddNewMethod = () => {
    setEditingMethod({
      id: Math.random().toString(36).substr(2, 9),
      name: 'Nuevo Método',
      type: 'OTHER',
      isEnabled: true,
      icon: 'Wallet',
      color: 'bg-gray-800',
      opensDrawer: false,
      requiresSignature: false,
      integration: 'NONE',
      integrationConfig: {}
    });
    setConnectionStatus('IDLE');
    setIsMethodModalOpen(true);
  };

  const handleEditMethod = (method: PaymentMethodDefinition) => {
    setEditingMethod({ ...method, integrationConfig: method.integrationConfig || {} });
    setConnectionStatus('IDLE');
    setIsMethodModalOpen(true);
  };

  const handleSaveMethod = () => {
    if (!editingMethod) return;
    setMethods(prev => {
      const exists = prev.find(m => m.id === editingMethod.id);
      if (exists) {
        return prev.map(m => m.id === editingMethod.id ? editingMethod : m);
      }
      return [...prev, editingMethod];
    });
    setIsMethodModalOpen(false);
  };

  const handleDeleteMethod = (id: string) => {
    if (confirm('¿Eliminar este método de pago?')) {
      setMethods(prev => prev.filter(m => m.id !== id));
    }
  };

  const handleIntegrationConfigChange = (key: string, value: string) => {
    if (!editingMethod) return;
    setEditingMethod({
      ...editingMethod,
      integrationConfig: {
        ...editingMethod.integrationConfig,
        [key]: value
      }
    });
    setConnectionStatus('IDLE'); // Reset status on change
  };

  const handleTestConnection = () => {
    setIsTestingConnection(true);
    setConnectionStatus('IDLE');
    
    // Simulate API Call
    setTimeout(() => {
      const success = Math.random() > 0.3; // 70% success chance for demo
      setConnectionStatus(success ? 'SUCCESS' : 'ERROR');
      setIsTestingConnection(false);
    }, 2000);
  };

  // --- FINAL SAVE ---
  const handleSaveChanges = () => {
    onUpdateConfig({
      ...config,
      paymentMethods: methods,
    });
    alert("Métodos de pago guardados correctamente.");
    onClose();
  };

  // --- RENDER HELPERS ---
  const Toggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
    <div 
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between p-4 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors border border-transparent hover:border-gray-200"
    >
      <span className="font-medium text-gray-700">{label}</span>
      <div className={`w-12 h-6 rounded-full relative transition-colors duration-300 ${checked ? 'bg-green-500' : 'bg-gray-300'}`}>
        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${checked ? 'left-7' : 'left-1'}`} />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in fade-in">
      
      {/* Header */}
      <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-black text-gray-800">Métodos de Pago</h1>
          <p className="text-sm text-gray-500">Configura las opciones de cobro disponibles en caja.</p>
        </div>
        <div className="flex gap-3">
           <button onClick={onClose} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg font-bold">
              Cancelar
           </button>
           <button 
             onClick={handleSaveChanges}
             className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-lg hover:shadow-blue-500/30 transition-all flex items-center gap-2"
           >
             <Save size={20} /> Guardar Cambios
           </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto">
          
          {/* === PAYMENT METHODS LIST === */}
          <section>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-gray-700 flex items-center gap-2">
                <Wallet size={20} className="text-blue-500" /> Métodos Activos
              </h2>
              <button 
                onClick={handleAddNewMethod}
                className="text-sm font-bold text-white bg-blue-600 px-4 py-2 rounded-xl hover:bg-blue-700 shadow-md transition-all flex items-center gap-2"
              >
                <Plus size={18} /> Nuevo Método
              </button>
            </div>

            <div className="space-y-3">
              {methods.map((method, index) => {
                // Dynamic Icon Rendering
                const IconComp = ICONS[method.icon as keyof typeof ICONS] || Wallet;

                return (
                  <div 
                    key={method.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragEnter={(e) => handleDragEnter(e, index)}
                    onDragEnd={handleDragEnd}
                    className="group bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all flex items-center gap-5 cursor-grab active:cursor-grabbing"
                  >
                    <div className="text-gray-300 group-hover:text-gray-500 cursor-grab">
                      <GripVertical size={24} />
                    </div>
                    
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-md ${method.color}`}>
                      <IconComp size={28} />
                    </div>

                    <div className="flex-1">
                      <h3 className="font-bold text-gray-800 text-lg">{method.name}</h3>
                      <div className="flex gap-2 mt-1.5">
                        {method.integration !== 'NONE' && (
                          <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-100 uppercase font-bold">
                            {method.integration}
                          </span>
                        )}
                        {method.opensDrawer && (
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-100 flex items-center gap-1 font-medium">
                            <Zap size={10} /> Cajón
                          </span>
                        )}
                        {method.requiresSignature && (
                          <span className="text-[10px] bg-orange-50 text-orange-700 px-2 py-0.5 rounded border border-orange-100 flex items-center gap-1 font-medium">
                            <PenTool size={10} /> Firma
                          </span>
                        )}
                        <span className="text-[10px] bg-gray-50 text-gray-500 px-2 py-0.5 rounded border border-gray-200 uppercase font-bold">
                           {method.type}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEditMethod(method)} className="p-2 bg-gray-50 hover:bg-blue-50 text-gray-500 hover:text-blue-600 rounded-lg transition-colors">
                        <Edit2 size={20} />
                      </button>
                      <button onClick={() => handleDeleteMethod(method.id)} className="p-2 bg-gray-50 hover:bg-red-50 text-gray-500 hover:text-red-600 rounded-lg transition-colors">
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            
            <p className="text-center text-gray-400 text-xs mt-8">
               Arrastra y suelta los elementos para reordenar cómo aparecen en la pantalla de cobro.
            </p>
          </section>

        </div>
      </div>

      {/* --- METHOD EDITOR MODAL --- */}
      {isMethodModalOpen && editingMethod && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 flex flex-col max-h-[85vh]">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0 z-10">
              <h3 className="font-bold text-lg text-gray-800">Editar Método de Pago</h3>
              <button onClick={() => setIsMethodModalOpen(false)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              
              {/* Name & Type */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre</label>
                  <input 
                    type="text" 
                    value={editingMethod.name}
                    onChange={(e) => setEditingMethod({...editingMethod, name: e.target.value})}
                    className="w-full p-3 bg-gray-50 rounded-xl border-none outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo de Fondo</label>
                  <select 
                    value={editingMethod.type}
                    onChange={(e) => setEditingMethod({...editingMethod, type: e.target.value as PaymentMethod})}
                    className="w-full p-3 bg-gray-50 rounded-xl border-none outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="CASH">Efectivo</option>
                    <option value="CARD">Tarjeta</option>
                    <option value="QR">QR / Digital</option>
                    <option value="OTHER">Otro</option>
                  </select>
                </div>
                
                {/* Integration Selector */}
                {editingMethod.type === 'CARD' && (
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Pasarela / Integración</label>
                    <select 
                      value={editingMethod.integration || 'NONE'}
                      onChange={(e) => setEditingMethod({...editingMethod, integration: e.target.value as any})}
                      className="w-full p-3 bg-indigo-50 text-indigo-900 rounded-xl border border-indigo-100 outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                    >
                      <option value="NONE">Ninguna (Manual)</option>
                      <option value="CARNET">Carnet</option>
                      <option value="VISANET">VisaNet</option>
                      <option value="STRIPE">Stripe Terminal</option>
                    </select>
                  </div>
                )}
              </div>

              {/* --- DYNAMIC INTEGRATION CONFIGURATION --- */}
              {editingMethod.type === 'CARD' && editingMethod.integration && editingMethod.integration !== 'NONE' && (
                <div className="bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100 space-y-4 animate-in slide-in-from-top-2">
                   <div className="flex items-center gap-2 mb-2">
                      <Wifi size={18} className="text-indigo-600" />
                      <h4 className="text-sm font-bold text-indigo-800 uppercase tracking-wide">Configuración de Conexión</h4>
                   </div>
                   
                   {PROVIDER_SCHEMAS[editingMethod.integration]?.map((field) => (
                      <div key={field.key}>
                         <label className="block text-xs font-bold text-indigo-400 uppercase mb-1">{field.label}</label>
                         <div className="relative">
                            <input 
                               type={field.type}
                               value={editingMethod.integrationConfig?.[field.key] || ''}
                               onChange={(e) => handleIntegrationConfigChange(field.key, e.target.value)}
                               placeholder={field.placeholder}
                               className="w-full p-3 pl-10 bg-white border border-indigo-100 rounded-xl outline-none focus:ring-2 focus:ring-indigo-300 transition-all font-medium text-indigo-900 placeholder:text-indigo-300"
                            />
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300">
                               <field.icon size={16} />
                            </div>
                         </div>
                      </div>
                   ))}

                   <div className="pt-2">
                      <button 
                         onClick={handleTestConnection}
                         disabled={isTestingConnection}
                         className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                            connectionStatus === 'SUCCESS' ? 'bg-green-100 text-green-700 border border-green-200' :
                            connectionStatus === 'ERROR' ? 'bg-red-100 text-red-700 border border-red-200' :
                            'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border border-indigo-200'
                         }`}
                      >
                         {isTestingConnection ? (
                            <>
                               <RefreshCw size={16} className="animate-spin" /> Probando...
                            </>
                         ) : connectionStatus === 'SUCCESS' ? (
                            <>
                               <CheckCircle2 size={16} /> Conexión Exitosa
                            </>
                         ) : connectionStatus === 'ERROR' ? (
                            <>
                               <AlertCircle size={16} /> Falló la Conexión
                            </>
                         ) : (
                            <>
                               <Wifi size={16} /> Probar Conexión
                            </>
                         )}
                      </button>
                   </div>
                </div>
              )}

              {/* Visuals */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Apariencia</label>
                <div className="flex gap-4">
                  <div className="grid grid-cols-4 gap-2">
                    {Object.keys(ICONS).map((iconName) => {
                      const I = ICONS[iconName as keyof typeof ICONS];
                      return (
                        <button 
                          key={iconName}
                          onClick={() => setEditingMethod({...editingMethod, icon: iconName})}
                          className={`p-2 rounded-lg flex items-center justify-center border transition-all ${
                            editingMethod.icon === iconName ? 'bg-gray-800 text-white border-gray-800' : 'bg-white border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <I size={20} />
                        </button>
                      )
                    })}
                  </div>
                  <div className="w-px bg-gray-200"></div>
                  <div className="grid grid-cols-4 gap-2">
                    {COLORS.map(color => (
                      <button
                        key={color}
                        onClick={() => setEditingMethod({...editingMethod, color})}
                        className={`w-9 h-9 rounded-full ${color} transition-transform ${editingMethod.color === color ? 'scale-110 ring-2 ring-offset-2 ring-gray-300' : 'hover:scale-105'}`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Toggles */}
              <div className="space-y-2">
                <Toggle 
                  label="Abrir cajón portamonedas al cobrar" 
                  checked={editingMethod.opensDrawer} 
                  onChange={(v) => setEditingMethod({...editingMethod, opensDrawer: v})} 
                />
                <Toggle 
                  label="Requerir firma del cliente" 
                  checked={editingMethod.requiresSignature} 
                  onChange={(v) => setEditingMethod({...editingMethod, requiresSignature: v})} 
                />
              </div>

            </div>

            <div className="p-5 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 sticky bottom-0 z-10">
              <button onClick={() => setIsMethodModalOpen(false)} className="px-5 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-200">Cancelar</button>
              <button onClick={handleSaveMethod} className="px-6 py-2.5 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-700 shadow-md">Guardar Método</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default PaymentSettings;
