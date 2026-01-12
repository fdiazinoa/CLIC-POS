
import React, { useState, useEffect } from 'react';
import { 
  ArrowRightLeft, Globe, RefreshCw, Calculator, 
  Check, X, TrendingUp, DollarSign, ArrowRight, Save
} from 'lucide-react';
import { CurrencyConfig } from '../types';

interface CurrencySettingsProps {
  onClose: () => void;
}

// Flags Map
const FLAGS: Record<string, string> = {
  'USD': '🇺🇸',
  'EUR': '🇪🇺',
  'MXN': '🇲🇽',
  'COP': '🇨🇴',
  'DOP': '🇩🇴',
  'GBP': '🇬🇧',
  'BTC': '₿'
};

const MOCK_CURRENCIES: CurrencyConfig[] = [
  { code: 'DOP', name: 'Peso Dominicano', symbol: 'RD$', rate: 1, isEnabled: true, isBase: true },
  { code: 'USD', name: 'Dólar Estadounidense', symbol: '$', rate: 58.50, isEnabled: true, isBase: false },
  { code: 'EUR', name: 'Euro', symbol: '€', rate: 63.20, isEnabled: true, isBase: false },
];

const CurrencySettings: React.FC<CurrencySettingsProps> = ({ onClose }) => {
  const [currencies, setCurrencies] = useState<CurrencyConfig[]>(MOCK_CURRENCIES);
  const [selectedCode, setSelectedCode] = useState<string>('USD');
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Calculator State
  const [testAmount, setTestAmount] = useState<string>('100');

  const baseCurrency = currencies.find(c => c.isBase) || currencies[0];
  const activeCurrency = currencies.find(c => c.code === selectedCode) || currencies[1];

  // --- HANDLERS ---

  const handleRateChange = (val: string) => {
    const newRate = parseFloat(val);
    if (isNaN(newRate) || newRate < 0) return;
    
    setCurrencies(prev => prev.map(c => 
      c.code === activeCurrency.code ? { ...c, rate: newRate } : c
    ));
  };

  const handleFetchRate = () => {
    setIsSyncing(true);
    // Simulate API Call
    setTimeout(() => {
      const mockRates: Record<string, number> = { 
        'USD': 59.15, 
        'EUR': 64.05, 
        'MXN': 3.45 
      };
      const newRate = mockRates[activeCurrency.code] || activeCurrency.rate;
      
      setCurrencies(prev => prev.map(c => 
        c.code === activeCurrency.code ? { ...c, rate: newRate } : c
      ));
      setIsSyncing(false);
    }, 1500);
  };

  const handleSave = () => {
    // In a real app, verify against prop function
    alert("Tipos de cambio actualizados correctamente.");
    onClose();
  };

  // --- CALCULATOR LOGIC ---
  const calcResult = (parseFloat(testAmount) || 0) * activeCurrency.rate;

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300">
      
      {/* Header */}
      <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
             <ArrowRightLeft className="text-emerald-600" /> Control de Cambio
          </h1>
          <p className="text-sm text-gray-500">Gestión de tasas, divisas aceptadas y conversión.</p>
        </div>
        <div className="flex gap-3">
           <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
              <X size={24} />
           </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-8">
        <div className="max-w-6xl mx-auto h-full flex flex-col lg:flex-row gap-8">
           
           {/* LEFT: CURRENCY LIST */}
           <div className="w-full lg:w-1/3 flex flex-col gap-4">
              
              {/* Base Currency Card */}
              <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-lg relative overflow-hidden">
                 <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-10 -mt-10 blur-2xl"></div>
                 <div className="relative z-10">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Moneda Base (Tienda)</p>
                    <div className="flex items-center gap-4">
                       <div className="text-5xl">{FLAGS[baseCurrency.code] || '🏳️'}</div>
                       <div>
                          <h2 className="text-3xl font-black">{baseCurrency.code}</h2>
                          <p className="text-slate-400 font-medium">{baseCurrency.name}</p>
                       </div>
                    </div>
                 </div>
              </div>

              <div className="flex items-center justify-between mt-2 px-2">
                 <h3 className="text-sm font-bold text-gray-500 uppercase">Divisas Aceptadas</h3>
                 <button className="text-xs font-bold text-emerald-600 hover:underline flex items-center gap-1">
                    <TrendingUp size={14} /> Histórico
                 </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                 {currencies.filter(c => !c.isBase).map(currency => (
                    <div 
                       key={currency.code}
                       onClick={() => setSelectedCode(currency.code)}
                       className={`group p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center justify-between ${
                          selectedCode === currency.code 
                             ? 'bg-white border-emerald-500 shadow-md ring-4 ring-emerald-50' 
                             : 'bg-white border-transparent hover:border-gray-200'
                       }`}
                    >
                       <div className="flex items-center gap-3">
                          <span className="text-2xl">{FLAGS[currency.code] || '🏳️'}</span>
                          <div>
                             <p className="font-bold text-gray-800">{currency.code}</p>
                             <p className="text-xs text-gray-400">{currency.name}</p>
                          </div>
                       </div>
                       <div className="text-right">
                          <p className={`font-mono font-bold ${selectedCode === currency.code ? 'text-emerald-600' : 'text-gray-600'}`}>
                             {currency.rate.toFixed(2)}
                          </p>
                       </div>
                    </div>
                 ))}
                 
                 <button className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 font-bold hover:border-emerald-400 hover:text-emerald-600 transition-colors">
                    + Agregar Nueva Moneda
                 </button>
              </div>
           </div>

           {/* RIGHT: EDITOR */}
           <div className="flex-1 bg-white rounded-3xl shadow-xl border border-gray-200 flex flex-col overflow-hidden relative">
              
              <div className="p-8 flex-1 flex flex-col justify-center">
                 
                 <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                       <span className="text-6xl">{FLAGS[activeCurrency.code] || '🏳️'}</span>
                       <div>
                          <h2 className="text-4xl font-black text-gray-900">{activeCurrency.code}</h2>
                          <p className="text-gray-500 font-medium">{activeCurrency.name}</p>
                       </div>
                    </div>
                    {/* Simulated API Fetch */}
                    <button 
                       onClick={handleFetchRate}
                       disabled={isSyncing}
                       className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-colors disabled:opacity-50"
                    >
                       <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                       {isSyncing ? 'Sincronizando...' : 'Actualizar de Internet'}
                    </button>
                 </div>

                 {/* RATE INPUT */}
                 <div className="mb-12">
                    <label className="block text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Tasa del Día (Compra)</label>
                    <div className="flex items-end gap-4">
                       <div className="flex-1 relative">
                          <span className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300 text-4xl font-light">1 =</span>
                          <input 
                             type="number"
                             value={activeCurrency.rate}
                             onChange={(e) => handleRateChange(e.target.value)}
                             className="w-full bg-gray-50 border-2 border-gray-200 rounded-3xl py-6 pl-24 pr-8 text-5xl font-black text-slate-800 outline-none focus:border-emerald-500 focus:bg-white transition-all text-right"
                          />
                       </div>
                       <div className="pb-6">
                          <span className="text-2xl font-bold text-gray-400">{baseCurrency.code}</span>
                       </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-3 pl-4">
                       * Valor utilizado para convertir pagos en {activeCurrency.code} a {baseCurrency.code}.
                    </p>
                 </div>

                 {/* TEST CALCULATOR */}
                 <div className="bg-emerald-50 rounded-3xl p-6 border border-emerald-100">
                    <div className="flex items-center gap-2 mb-4 text-emerald-800">
                       <Calculator size={20} />
                       <span className="font-bold text-sm uppercase">Calculadora de Prueba</span>
                    </div>

                    <div className="flex items-center gap-4">
                       {/* Input Side */}
                       <div className="flex-1 bg-white p-3 rounded-xl border border-emerald-200 flex items-center">
                          <span className="text-gray-400 font-bold mr-2">{activeCurrency.symbol}</span>
                          <input 
                             type="number" 
                             value={testAmount}
                             onChange={(e) => setTestAmount(e.target.value)}
                             className="w-full font-bold text-xl text-gray-800 outline-none"
                          />
                          <span className="text-xs font-bold text-gray-400 ml-2">{activeCurrency.code}</span>
                       </div>

                       <ArrowRight size={24} className="text-emerald-400" />

                       {/* Result Side */}
                       <div className="flex-1 bg-emerald-100 p-3 rounded-xl border border-emerald-300 flex items-center justify-between">
                          <span className="text-emerald-700 font-bold mr-2">{baseCurrency.symbol}</span>
                          <span className="font-black text-xl text-emerald-900">
                             {calcResult.toFixed(2)}
                          </span>
                          <span className="text-xs font-bold text-emerald-600 ml-2">{baseCurrency.code}</span>
                       </div>
                    </div>
                    <p className="text-xs text-emerald-600 mt-3 text-center">
                       Si el cliente entrega <span className="font-bold">{testAmount} {activeCurrency.code}</span>, 
                       el sistema registrará <span className="font-bold">{calcResult.toFixed(2)} {baseCurrency.code}</span>.
                    </p>
                 </div>

              </div>

              {/* Footer */}
              <div className="p-6 bg-gray-50 border-t border-gray-200 flex justify-end gap-4">
                 <button onClick={onClose} className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-200 rounded-xl transition-colors">
                    Cancelar
                 </button>
                 <button onClick={handleSave} className="px-8 py-3 bg-emerald-600 text-white font-bold rounded-xl shadow-lg hover:bg-emerald-500 transition-all flex items-center gap-2">
                    <Save size={20} /> Guardar Cambios
                 </button>
              </div>

           </div>

        </div>
      </div>

    </div>
  );
};

export default CurrencySettings;
