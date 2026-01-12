import React, { useState, useRef } from 'react';
import { 
  CreditCard, Banknote, QrCode, Wallet, GripVertical, 
  Edit2, Trash2, Check, X, Plus, Search, Globe, 
  ArrowRightLeft, Save, DollarSign, PenTool, Smartphone,
  Zap, CreditCard as CardIcon
} from 'lucide-react';
import { BusinessConfig, PaymentMethodDefinition, CurrencyConfig, PaymentMethod } from '../types';

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

const DEFAULT_CURRENCIES: CurrencyConfig[] = [
  { code: 'DOP', name: 'Peso Dominicano', symbol: 'RD$', rate: 1, isEnabled: true, isBase: true },
];

// Available Icons for Picker
const ICONS = {
  Banknote, CreditCard, QrCode, Wallet, DollarSign, Smartphone, Zap, CardIcon
};

const WORLD_CURRENCIES = [
  { code: 'USD', name: 'Dólar Estadounidense', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'MXN', name: 'Peso Mexicano', symbol: '$' },
  { code: 'COP', name: 'Peso Colombiano', symbol: '$' },
  { code: 'GBP', name: 'Libra Esterlina', symbol: '£' },
];

const COLORS = [
  'bg-green-500', 'bg-blue-500', 'bg-red-500', 'bg-orange-500', 
  'bg-purple-500', 'bg-pink-500', 'bg-teal-500', 'bg-gray-800'
];

const PaymentSettings: React.FC<PaymentSettingsProps> = ({ config, onUpdateConfig, onClose }) => {
  
  // State Initialization
  const [methods, setMethods] = useState<PaymentMethodDefinition[]>(config.paymentMethods || DEFAULT_METHODS);
  const [currencies, setCurrencies] = useState<CurrencyConfig[]>(config.currencies || DEFAULT_CURRENCIES);
  
  // Method Editing State
  const [editingMethod, setEditingMethod] = useState<PaymentMethodDefinition | null>(null);
  const [isMethodModalOpen, setIsMethodModalOpen] = useState(false);

  // Currency Editing State
  const [isCurrencyModalOpen, setIsCurrencyModalOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');

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
      integration: 'NONE'
    });
    setIsMethodModalOpen(true);
  };

  const handleEditMethod = (method: PaymentMethodDefinition) => {
    setEditingMethod({ ...method });
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

  // --- CURRENCY HANDLERS ---

  const handleAddCurrency = (curr: typeof WORLD_CURRENCIES[0]) => {
    if (currencies.find(c => c.code === curr.code)) return;
    setCurrencies(prev => [...prev, {
      ...curr,
      rate: 1, // Default rate
      isEnabled: true,
      isBase: false
    }]);
    setIsCurrencyModalOpen(false);
    setCurrencySearch('');
  };

  const handleRateChange = (code: string, newRate: number) => {
    setCurrencies(prev => prev.map(c => c.code === code ? { ...c, rate: newRate } : c));
  };

  const handleDeleteCurrency = (code: string) => {
    if (currencies.find(c => c.code === code)?.isBase) {
      alert("No puedes eliminar la moneda base.");
      return;
    }
    setCurrencies(prev => prev.filter(c => c.code !== code));
  };

  // --- FINAL SAVE ---
  const handleSaveChanges = () => {
    onUpdateConfig({
      ...config,
      paymentMethods: methods,
      currencies: currencies
    });
    alert("Configuración de pagos guardada.");
    onClose(); // Optional: close on save
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
          <h1 className="text-2xl font-black text-gray-800">Configuración de Pagos</h1>
          <p className="text-sm text-gray-500">Administra métodos de cobro y divisas.</p>
        </div>
        <button 
          onClick={handleSaveChanges}
          className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-lg hover:shadow-blue-500/30 transition-all flex items-center gap-2"
        >
          <Save size={20} /> Guardar Cambios
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* === LEFT: PAYMENT METHODS === */}
          <section>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-700 flex items-center gap-2">
                <Wallet size={20} className="text-blue-500" /> Métodos Activos
              </h2>
              <button 
                onClick={handleAddNewMethod}
                className="text-sm font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1"
              >
                <Plus size={16} /> Nuevo
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
                    className="group bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all flex items-center gap-4 cursor-grab active:cursor-grabbing"
                  >
                    <div className="text-gray-300 group-hover:text-gray-500">
                      <GripVertical size={20} />
                    </div>
                    
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-sm ${method.color}`}>
                      <IconComp size={24} />
                    </div>

                    <div className="flex-1">
                      <h3 className="font-bold text-gray-800">{method.name}</h3>
                      <div className="flex gap-2 mt-1">
                        {method.integration !== 'NONE' && (
                          <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-100 uppercase font-bold">
                            {method.integration}
                          </span>
                        )}
                        {method.opensDrawer && (
                          <span className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded border border-green-100 flex items-center gap-1">
                            <Zap size={10} /> Cajón
                          </span>
                        )}
                        {method.requiresSignature && (
                          <span className="text-[10px] bg-orange-50 text-orange-700 px-2 py-0.5 rounded border border-orange-100 flex items-center gap-1">
                            <PenTool size={10} /> Firma
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEditMethod(method)} className="p-2 bg-gray-50 hover:bg-blue-50 text-gray-500 hover:text-blue-600 rounded-lg">
                        <Edit2 size={18} />
                      </button>
                      <button onClick={() => handleDeleteMethod(method.id)} className="p-2 bg-gray-50 hover:bg-red-50 text-gray-500 hover:text-red-600 rounded-lg">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* === RIGHT: CURRENCIES === */}
          <section>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-700 flex items-center gap-2">
                <Globe size={20} className="text-emerald-500" /> Multidivisa
              </h2>
              <button 
                onClick={() => setIsCurrencyModalOpen(true)}
                className="text-sm font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg hover:bg-emerald-100 transition-colors flex items-center gap-1"
              >
                <Plus size={16} /> Agregar Divisa
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="divide-y divide-gray-100">
                {currencies.map((curr) => (
                  <div key={curr.code} className="p-5 flex items-center gap-4">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center font-bold text-gray-600 text-sm">
                      {curr.code}
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex justify-between items-center mb-1">
                        <h3 className="font-bold text-gray-800">{curr.name}</h3>
                        {curr.isBase ? (
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">BASE</span>
                        ) : (
                          <button onClick={() => handleDeleteCurrency(curr.code)} className="text-gray-300 hover:text-red-500">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                      
                      {!curr.isBase ? (
                        <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-lg border border-gray-200">
                          <span className="text-xs text-gray-500 font-medium">1 {curr.code} =</span>
                          <input 
                            type="number" 
                            value={curr.rate}
                            onChange={(e) => handleRateChange(curr.code, parseFloat(e.target.value))}
                            className="w-20 bg-white border border-gray-300 rounded px-2 py-1 text-sm font-bold text-right outline-none focus:border-blue-500"
                          />
                          <span className="text-xs text-gray-500 font-medium">{currencies.find(c => c.isBase)?.code}</span>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">Moneda principal del sistema.</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

        </div>
      </div>

      {/* --- METHOD EDITOR MODAL --- */}
      {isMethodModalOpen && editingMethod && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-lg text-gray-800">Editar Método de Pago</h3>
              <button onClick={() => setIsMethodModalOpen(false)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[70vh] space-y-6">
              
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
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo</label>
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
                
                {/* Integration Selector - Only for CARDS */}
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

            <div className="p-5 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button onClick={() => setIsMethodModalOpen(false)} className="px-5 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-200">Cancelar</button>
              <button onClick={handleSaveMethod} className="px-6 py-2.5 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-700 shadow-md">Guardar Método</button>
            </div>
          </div>
        </div>
      )}

      {/* --- CURRENCY ADD MODAL --- */}
      {isCurrencyModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-lg text-gray-800">Agregar Divisa</h3>
              <button onClick={() => setIsCurrencyModalOpen(false)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200">
                <X size={20} />
              </button>
            </div>
            <div className="p-4">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input 
                  type="text" 
                  placeholder="Buscar moneda (USD, EUR...)" 
                  className="w-full pl-10 p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                  value={currencySearch}
                  onChange={(e) => setCurrencySearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="max-h-60 overflow-y-auto space-y-2">
                {WORLD_CURRENCIES
                  .filter(c => c.name.toLowerCase().includes(currencySearch.toLowerCase()) || c.code.includes(currencySearch.toUpperCase()))
                  .map(curr => (
                    <button 
                      key={curr.code}
                      onClick={() => handleAddCurrency(curr)}
                      className="w-full text-left p-3 hover:bg-emerald-50 rounded-xl flex items-center justify-between group transition-colors"
                    >
                      <div>
                        <span className="font-bold text-gray-800">{curr.code}</span>
                        <span className="text-gray-500 text-sm ml-2">{curr.name}</span>
                      </div>
                      <span className="text-emerald-600 font-bold opacity-0 group-hover:opacity-100">
                        <Plus size={20} />
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default PaymentSettings;
