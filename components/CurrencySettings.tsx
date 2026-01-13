import React, { useState, useEffect } from 'react';
import { 
  ArrowRightLeft, Globe, RefreshCw, Calculator, 
  Check, X, TrendingUp, DollarSign, ArrowRight, Save,
  Crown, Plus, Search
} from 'lucide-react';
import { CurrencyConfig, BusinessConfig } from '../types';

interface CurrencySettingsProps {
  config?: BusinessConfig;
  onUpdateConfig?: (newConfig: BusinessConfig) => void;
  onClose: () => void;
}

const FLAGS: Record<string, string> = {
  'USD': '🇺🇸',
  'EUR': '🇪🇺',
  'MXN': '🇲🇽',
  'COP': '🇨🇴',
  'DOP': '🇩🇴',
  'GBP': '🇬🇧',
  'BTC': '₿',
  'CAD': '🇨🇦',
  'BRL': '🇧🇷'
};

const COMMON_CURRENCIES = [
  { code: 'USD', name: 'Dólar Estadounidense', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'MXN', name: 'Peso Mexicano', symbol: '$' },
  { code: 'COP', name: 'Peso Colombiano', symbol: '$' },
  { code: 'GBP', name: 'Libra Esterlina', symbol: '£' },
  { code: 'CAD', name: 'Dólar Canadiense', symbol: '$' },
  { code: 'BRL', name: 'Real Brasileño', symbol: 'R$' },
];

const CurrencySettings: React.FC<CurrencySettingsProps> = ({ config, onUpdateConfig, onClose }) => {
  const initialCurrencies = config?.currencies || [
    { code: 'DOP', name: 'Peso Dominicano', symbol: 'RD$', rate: 1, isEnabled: true, isBase: true }
  ];

  const [currencies, setCurrencies] = useState<CurrencyConfig[]>(initialCurrencies);
  const [selectedCode, setSelectedCode] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [testAmount, setTestAmount] = useState<string>('100');

  const baseCurrency = currencies.find(c => c.isBase) || currencies[0];
  
  useEffect(() => {
    if (!selectedCode || !currencies.find(c => c.code === selectedCode)) {
        const secondary = currencies.find(c => !c.isBase);
        setSelectedCode(secondary ? secondary.code : baseCurrency.code);
    }
  }, [currencies, selectedCode, baseCurrency]);

  const activeCurrency = currencies.find(c => c.code === selectedCode) || baseCurrency;

  const handleRateChange = (val: string) => {
    const newRate = parseFloat(val);
    if (isNaN(newRate) || newRate < 0) return;
    setCurrencies(prev => prev.map(c => c.code === activeCurrency.code ? { ...c, rate: newRate } : c));
  };

  const handleSetAsBase = (targetCode: string) => {
    if (!confirm(`¿Cambiar moneda base a ${targetCode}? Esto reseteará su tasa a 1.00.`)) return;
    setCurrencies(prev => prev.map(c => {
      if (c.code === targetCode) return { ...c, isBase: true, rate: 1, isEnabled: true };
      if (c.isBase) return { ...c, isBase: false };
      return c;
    }));
    setSelectedCode(targetCode);
  };

  const handleAddCurrency = (curr: typeof COMMON_CURRENCIES[0]) => {
    if (currencies.find(c => c.code === curr.code)) {
      alert("Esta moneda ya está configurada.");
      return;
    }
    const newConfig: CurrencyConfig = {
      code: curr.code,
      name: curr.name,
      symbol: curr.symbol,
      rate: 0,
      isEnabled: true,
      isBase: false
    };
    setCurrencies([...currencies, newConfig]);
    setSelectedCode(curr.code);
    setShowAddModal(false);
  };

  const handleFetchRate = () => {
    setIsSyncing(true);
    setTimeout(() => {
      const mockRates: Record<string, number> = { 'USD': 59.15, 'EUR': 64.05, 'MXN': 3.45, 'DOP': 1 };
      const newRate = mockRates[activeCurrency.code] || activeCurrency.rate;
      setCurrencies(prev => prev.map(c => c.code === activeCurrency.code ? { ...c, rate: newRate } : c));
      setIsSyncing(false);
    }, 1500);
  };

  const handleSave = () => {
    if (config && onUpdateConfig) {
      onUpdateConfig({ ...config, currencies, currencySymbol: baseCurrency.symbol });
      alert("Configuración guardada.");
      onClose();
    }
  };

  const calcResult = (parseFloat(testAmount) || 0) * activeCurrency.rate;

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300">
      <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
             <ArrowRightLeft className="text-emerald-600" /> Control de Cambio
          </h1>
          <p className="text-sm text-gray-500">Gestión de tasas, divisas aceptadas y conversión.</p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400"><X size={24} /></button>
      </div>

      <div className="flex-1 overflow-hidden p-8">
        <div className="max-w-6xl mx-auto h-full flex flex-col lg:flex-row gap-8">
           <div className="w-full lg:w-1/3 flex flex-col gap-4 overflow-hidden">
              <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-lg relative overflow-hidden shrink-0">
                 <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-10 -mt-10 blur-2xl"></div>
                 <div className="relative z-10">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1"><Crown size={14} className="text-yellow-500" /> Moneda Base</p>
                    <div className="flex items-center gap-4">
                       <div className="text-5xl">{FLAGS[baseCurrency.code] || '🏳️'}</div>
                       <div><h2 className="text-3xl font-black">{baseCurrency.code}</h2><p className="text-slate-400 font-medium">{baseCurrency.name}</p></div>
                    </div>
                 </div>
              </div>

              <div className="flex items-center justify-between mt-2 px-2 shrink-0">
                 <h3 className="text-sm font-bold text-gray-500 uppercase">Divisas Aceptadas</h3>
                 <button className="text-xs font-bold text-emerald-600 hover:underline flex items-center gap-1"><TrendingUp size={14} /> Histórico</button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pr-2 no-scrollbar">
                 {currencies.filter(c => !c.isBase).map(currency => (
                    <div key={currency.code} onClick={() => setSelectedCode(currency.code)} className={`group p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center justify-between ${selectedCode === currency.code ? 'bg-white border-emerald-500 shadow-md ring-4 ring-emerald-50' : 'bg-white border-transparent hover:border-gray-200'}`}>
                       <div className="flex items-center gap-3">
                          <span className="text-2xl">{FLAGS[currency.code] || '🏳️'}</span>
                          <div><p className="font-bold text-gray-800">{currency.code}</p><p className="text-xs text-gray-400">{currency.name}</p></div>
                       </div>
                       <div className="text-right"><p className={`font-mono font-bold ${selectedCode === currency.code ? 'text-emerald-600' : 'text-gray-600'}`}>{currency.rate.toFixed(2)}</p></div>
                    </div>
                 ))}
                 <button onClick={() => setShowAddModal(true)} className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 font-bold hover:border-emerald-400 hover:text-emerald-600 transition-colors">
                    + Agregar Nueva Moneda
                 </button>
              </div>
           </div>

           <div className="flex-1 bg-white rounded-3xl shadow-xl border border-gray-200 flex flex-col overflow-hidden relative">
              <div className="p-8 flex-1 overflow-y-auto no-scrollbar">
                 <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                       <span className="text-6xl">{FLAGS[activeCurrency.code] || '🏳️'}</span>
                       <div><h2 className="text-4xl font-black text-gray-900">{activeCurrency.code}</h2><p className="text-gray-500 font-medium">{activeCurrency.name}</p></div>
                    </div>
                    <button onClick={handleFetchRate} disabled={isSyncing || activeCurrency.isBase} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-colors disabled:opacity-50">
                       <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />{isSyncing ? 'Sincronizando...' : 'Actualizar de Internet'}
                    </button>
                 </div>

                 <div className="mb-8">
                    <label className="block text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Tasa del Día</label>
                    <div className="flex items-end gap-4">
                       <div className="flex-1 relative">
                          <span className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300 text-4xl font-light">1 =</span>
                          <input type="number" value={activeCurrency.rate} onChange={(e) => handleRateChange(e.target.value)} disabled={activeCurrency.isBase} className="w-full bg-gray-50 border-2 border-gray-200 rounded-3xl py-6 pl-24 pr-8 text-5xl font-black text-slate-800 outline-none focus:border-emerald-500 focus:bg-white transition-all text-right disabled:opacity-50" />
                       </div>
                       <div className="pb-6"><span className="text-2xl font-bold text-gray-400">{baseCurrency.code}</span></div>
                    </div>
                 </div>

                 {!activeCurrency.isBase && (
                    <div className="mb-8 p-4 bg-yellow-50 border border-yellow-200 rounded-2xl flex items-center justify-between">
                        <div><h4 className="font-bold text-yellow-800 text-sm flex items-center gap-2"><Crown size={16} /> Moneda Principal</h4><p className="text-xs text-yellow-700">Cambiar la base afectará toda la facturación.</p></div>
                        <button onClick={() => handleSetAsBase(activeCurrency.code)} className="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm">Establecer Base</button>
                    </div>
                 )}

                 <div className="bg-emerald-50 rounded-3xl p-6 border border-emerald-100 mb-4">
                    <div className="flex items-center gap-2 mb-4 text-emerald-800"><Calculator size={20} /><span className="font-bold text-sm uppercase">Calculadora</span></div>
                    <div className="flex items-center gap-4">
                       <div className="flex-1 bg-white p-3 rounded-xl border border-emerald-200 flex items-center">
                          <span className="text-gray-400 font-bold mr-2">{activeCurrency.symbol}</span>
                          <input type="number" value={testAmount} onChange={(e) => setTestAmount(e.target.value)} className="w-full font-bold text-xl text-gray-800 outline-none" />
                       </div>
                       <ArrowRight size={24} className="text-emerald-400" />
                       <div className="flex-1 bg-emerald-100 p-3 rounded-xl border border-emerald-300 flex items-center justify-between">
                          <span className="text-emerald-700 font-bold mr-2">{baseCurrency.symbol}</span>
                          <span className="font-black text-xl text-emerald-900">{calcResult.toFixed(2)}</span>
                       </div>
                    </div>
                 </div>
              </div>

              <div className="p-6 bg-gray-50 border-t border-gray-200 flex justify-end gap-4 shrink-0">
                 <button onClick={onClose} className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-200 rounded-xl transition-colors">Cancelar</button>
                 <button onClick={handleSave} className="px-8 py-3 bg-emerald-600 text-white font-bold rounded-xl shadow-lg hover:bg-emerald-700 transition-all flex items-center gap-2"><Save size={20} /> Guardar Cambios</button>
              </div>
           </div>
        </div>
      </div>

      {/* MODAL AGREGAR MONEDA */}
      {showAddModal && (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-black text-xl text-gray-800">Agregar Moneda</h3>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20}/></button>
            </div>
            <div className="p-4 bg-white border-b border-gray-100">
               <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input type="text" placeholder="Buscar moneda..." value={addSearch} onChange={(e) => setAddSearch(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-emerald-200 text-sm" />
               </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {COMMON_CURRENCIES.filter(c => c.code.toLowerCase().includes(addSearch.toLowerCase()) || c.name.toLowerCase().includes(addSearch.toLowerCase())).map(c => (
                <button key={c.code} onClick={() => handleAddCurrency(c)} className="w-full p-4 rounded-2xl flex items-center justify-between hover:bg-emerald-50 border border-transparent hover:border-emerald-200 transition-all group">
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">{FLAGS[c.code] || '🏳️'}</span>
                    <div className="text-left">
                      <p className="font-bold text-gray-800 group-hover:text-emerald-700">{c.code}</p>
                      <p className="text-xs text-gray-400">{c.name}</p>
                    </div>
                  </div>
                  <Plus size={20} className="text-gray-300 group-hover:text-emerald-500" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CurrencySettings;