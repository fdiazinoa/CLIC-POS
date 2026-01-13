import React, { useState, useEffect } from 'react';
import { 
  X, CreditCard, Banknote, QrCode, CheckCircle2, 
  Trash2, Plus, Wallet, Printer, Mail, 
  ArrowRight, Repeat, ChevronDown, ArrowRightLeft
} from 'lucide-react';
import { PaymentEntry, PaymentMethod, BusinessConfig, CurrencyConfig } from '../types';

interface PaymentModalProps {
  total: number;
  currencySymbol: string;
  config?: BusinessConfig;
  onClose: () => void;
  onConfirm: (payments: PaymentEntry[]) => void;
  themeColor: string;
}

const UnifiedPaymentModal: React.FC<PaymentModalProps> = ({ total, currencySymbol, config, onClose, onConfirm, themeColor }) => {
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [activeMethod, setActiveMethod] = useState<PaymentMethod>('CASH');
  const [inputAmount, setInputAmount] = useState<string>('');
  const [isSuccessScreen, setIsSuccessScreen] = useState(false);
  const [shouldClearInput, setShouldClearInput] = useState(true);
  
  const currencies = config?.currencies || [];
  const baseCurrency = currencies.find(c => c.isBase) || { code: 'DOP', symbol: 'RD$', rate: 1 };
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyConfig>(baseCurrency as CurrencyConfig);

  const totalPaid = payments.reduce((acc, p) => acc + p.amount, 0);
  const remaining = Math.max(0, parseFloat((total - totalPaid).toFixed(2)));
  const change = Math.max(0, parseFloat((totalPaid - total).toFixed(2)));

  const denominations = selectedCurrency.code === 'USD' ? [1, 5, 10, 20, 50, 100] : [50, 100, 200, 500, 1000, 2000];

  useEffect(() => {
    if (remaining > 0) {
      const suggestedAmount = (remaining / selectedCurrency.rate).toFixed(2);
      setInputAmount(suggestedAmount);
      setShouldClearInput(true);
    } else {
      setInputAmount('');
      setShouldClearInput(false);
    }
  }, [remaining, activeMethod, selectedCurrency]);

  const handleNumPad = (key: string) => {
    if (key === 'C') { setInputAmount(''); setShouldClearInput(false); return; } 
    if (key === 'BACK') { setInputAmount(prev => prev.slice(0, -1)); return; }
    if (shouldClearInput) {
       setShouldClearInput(false);
       setInputAmount(key === '.' ? '0.' : key);
    } else {
       if (key === '.' && inputAmount.includes('.')) return;
       if (inputAmount.includes('.') && inputAmount.split('.')[1].length >= 2) return;
       setInputAmount(prev => prev + key);
    }
  };

  const handleAddPayment = (amountOverride?: number) => {
    const valInSelectedCurrency = amountOverride !== undefined ? amountOverride : parseFloat(inputAmount);
    if (!valInSelectedCurrency || valInSelectedCurrency <= 0) return;

    const amountInBase = valInSelectedCurrency * selectedCurrency.rate;

    const newPayment: PaymentEntry = {
      id: Math.random().toString(36).substr(2, 9),
      method: activeMethod,
      amount: parseFloat(amountInBase.toFixed(2)),
      timestamp: new Date(),
      currencyCode: selectedCurrency.code,
      amountOriginal: valInSelectedCurrency,
      exchangeRate: selectedCurrency.rate
    };

    setPayments(prev => [...prev, newPayment]);
    setShouldClearInput(true);
  };

  const handleRemovePayment = (id: string) => { setPayments(prev => prev.filter(p => p.id !== id)); };
  const handleProcessSale = () => { setIsSuccessScreen(true); };
  const handleFinalize = () => { onConfirm(payments); };

  const themeBgClass = { blue: 'bg-blue-600', orange: 'bg-orange-600', gray: 'bg-gray-800' }[themeColor] || 'bg-indigo-600';
  const themeTextClass = { blue: 'text-blue-600', orange: 'text-orange-600', gray: 'text-gray-800' }[themeColor] || 'text-indigo-600';

  if (isSuccessScreen) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/90 backdrop-blur-md p-4">
        <div className="bg-white rounded-[2.5rem] w-full max-w-lg p-8 shadow-2xl flex flex-col items-center text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
            <CheckCircle2 size={40} className="text-green-600" />
          </div>
          <h2 className="text-3xl font-black text-gray-900 mb-2">¡Venta Exitosa!</h2>
          <div className="w-full bg-gray-50 rounded-2xl p-6 mb-8 border border-gray-100">
             <div className="flex justify-between text-sm mb-2 text-gray-500"><span>Cobrado</span><span>{currencySymbol}{totalPaid.toFixed(2)}</span></div>
             {change > 0 && <div className="flex justify-between items-center pt-2 border-t border-gray-200 mt-2"><span className="text-green-600 font-bold">Cambio</span><span className="font-black text-green-600 text-2xl">{currencySymbol}{change.toFixed(2)}</span></div>}
          </div>
          <div className="w-full space-y-3">
             <div className="flex gap-3">
                <button onClick={() => alert("Imprimiendo...")} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-700 flex items-center justify-center gap-2"><Printer size={18}/> Ticket</button>
                <button onClick={() => alert("Enviando...")} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-700 flex items-center justify-center gap-2"><Mail size={18}/> Email</button>
             </div>
             <button onClick={handleFinalize} className={`w-full py-4 rounded-xl font-bold text-white shadow-xl flex items-center justify-center gap-2 ${themeBgClass}`}><Repeat size={20} /> Nueva Venta</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white w-full max-w-6xl h-full md:h-[85vh] md:rounded-[2.5rem] shadow-2xl flex flex-col md:flex-row overflow-hidden">
        
        {/* SUMMARY SECTION (Collapsible/Header on mobile, Sidebar on desktop) */}
        <div className="flex md:w-[35%] w-full bg-gray-50 border-b md:border-b-0 md:border-r border-gray-200 flex-col p-4 md:p-8 shrink-0">
           <div className="flex justify-between items-center mb-4 md:mb-8">
              <button onClick={onClose} className="p-2 -ml-2 text-gray-400 hover:bg-gray-200 rounded-full transition-colors"><X size={24} /></button>
              <div className="flex md:hidden gap-1">
                 {currencies.filter(c => c.isEnabled).map(c => (
                    <button 
                       key={c.code}
                       onClick={() => setSelectedCurrency(c)}
                       className={`px-3 py-1 rounded-lg text-[10px] font-black transition-all border ${selectedCurrency.code === c.code ? `border-blue-600 text-blue-600 bg-white` : 'border-transparent text-gray-400 bg-gray-100'}`}
                    >
                       {c.code}
                    </button>
                 ))}
              </div>
           </div>

           <div className="mb-4 md:mb-8 flex flex-col md:block items-center md:items-start text-center md:text-left">
              <p className="text-gray-500 font-medium uppercase text-[10px] md:text-xs tracking-widest mb-1">Total a Cobrar</p>
              <h1 className="text-3xl md:text-5xl font-black text-gray-900 leading-none">{currencySymbol}{total.toFixed(2)}</h1>
              
              <div className="hidden md:flex mt-6 gap-2">
                 {currencies.filter(c => c.isEnabled).map(c => (
                    <button 
                       key={c.code}
                       onClick={() => setSelectedCurrency(c)}
                       className={`px-3 py-2 rounded-xl text-xs font-black transition-all border-2 ${selectedCurrency.code === c.code ? `border-current ${themeTextClass} bg-white shadow-sm` : 'border-transparent text-gray-400 bg-gray-100'}`}
                    >
                       {c.code}
                    </button>
                 ))}
              </div>
           </div>

           {/* Payments List (Compact on mobile) */}
           <div className="flex-1 overflow-y-auto space-y-2 md:space-y-3 no-scrollbar max-h-[15vh] md:max-h-full">
              {payments.map(p => (
                 <div key={p.id} className="flex justify-between items-center bg-white p-3 md:p-4 rounded-xl md:rounded-2xl shadow-sm border border-gray-100 animate-in slide-in-from-left-2">
                    <div className="flex items-center gap-2 md:gap-3">
                       <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600">
                          {p.method === 'CASH' ? <Banknote size={16}/> : p.method === 'CARD' ? <CreditCard size={16}/> : <QrCode size={16}/>}
                       </div>
                       <div>
                          <span className="font-bold text-[10px] md:text-xs text-gray-800 block">{p.method}</span>
                          {p.currencyCode !== baseCurrency.code && (
                             <span className="text-[9px] md:text-[10px] text-gray-400 font-bold">{p.amountOriginal} {p.currencyCode}</span>
                          )}
                       </div>
                    </div>
                    <div className="flex items-center gap-2 md:gap-4">
                       <span className="font-bold text-sm md:text-gray-900">{currencySymbol}{p.amount.toFixed(2)}</span>
                       <button onClick={() => handleRemovePayment(p.id)} className="text-gray-300 hover:text-red-500"><X size={16}/></button>
                    </div>
                 </div>
              ))}
           </div>

           <div className="p-3 md:p-4 bg-white border-t border-gray-200 rounded-xl md:rounded-2xl mt-4 shadow-inner shrink-0">
              <div className="flex justify-between items-end mb-3 md:mb-4">
                 <div>
                    <p className="text-[9px] md:text-[10px] font-bold text-gray-400 uppercase tracking-widest">Restante</p>
                    <p className={`text-xl md:text-3xl font-black ${remaining > 0 ? 'text-red-500' : 'text-green-500'}`}>{currencySymbol}{remaining.toFixed(2)}</p>
                 </div>
                 {change > 0 && (
                    <div className="text-right">
                       <p className="text-[9px] md:text-[10px] font-bold text-green-600 uppercase tracking-widest">Cambio</p>
                       <p className="text-xl md:text-3xl font-black text-green-600">{currencySymbol}{change.toFixed(2)}</p>
                    </div>
                 )}
              </div>
              <button 
                 onClick={handleProcessSale} 
                 disabled={remaining > 0.01} 
                 className={`w-full py-3 md:py-4 rounded-xl md:rounded-2xl font-black text-sm md:text-base text-white transition-all shadow-lg ${remaining > 0.01 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : `${themeBgClass} hover:brightness-110`}`}
              >
                 FINALIZAR VENTA
              </button>
           </div>
        </div>

        {/* INPUT SECTION */}
        <div className="flex-1 flex flex-col bg-white overflow-y-auto">
           {/* Payment Methods */}
           <div className="flex p-3 md:p-4 gap-3 md:gap-4 overflow-x-auto no-scrollbar shrink-0">
              {[ 
                 { id: 'CASH', label: 'Efectivo', icon: Banknote }, 
                 { id: 'CARD', label: 'Tarjeta', icon: CreditCard }, 
                 { id: 'QR', label: 'Digital', icon: QrCode } 
              ].map(m => (
                 <button key={m.id} onClick={() => setActiveMethod(m.id as PaymentMethod)} className={`flex-1 min-w-[100px] py-3 md:py-4 rounded-2xl md:rounded-3xl border-2 flex flex-col items-center gap-1 md:gap-2 transition-all ${activeMethod === m.id ? `border-current ${themeTextClass} bg-gray-50 shadow-sm` : 'border-transparent text-gray-400 hover:bg-gray-50'}`}>
                    <m.icon size={24} className="md:w-8 md:h-8" /><span className="font-black text-[9px] md:text-[10px] uppercase tracking-widest">{m.label}</span>
                 </button>
              ))}
           </div>

           {/* Amount Input */}
           <div className="px-4 md:px-8 mt-1 shrink-0">
              <div className="bg-gray-100 rounded-2xl md:rounded-[2rem] p-4 md:p-6 flex justify-between items-center border border-gray-200 shadow-inner">
                 <span className="text-xl md:text-3xl text-gray-400 font-black">{selectedCurrency.symbol}</span>
                 <input 
                    type="text" 
                    readOnly 
                    value={inputAmount} 
                    className="bg-transparent text-right text-3xl md:text-5xl font-mono font-black text-gray-800 w-full outline-none" 
                    placeholder="0.00" 
                 />
              </div>
              
              {activeMethod === 'CASH' && (
                 <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3 md:mt-4">
                    {denominations.map(d => (
                       <button 
                          key={d} 
                          onClick={() => handleAddPayment(d)}
                          className="py-2 bg-white border border-gray-200 rounded-lg md:rounded-xl text-[10px] md:text-xs font-black text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-all shadow-sm"
                       >
                          {selectedCurrency.symbol}{d}
                       </button>
                    ))}
                 </div>
              )}
           </div>

           {/* Numpad */}
           <div className="flex-1 p-4 md:p-8 grid grid-cols-4 gap-2 md:gap-3 min-h-[350px]">
              {[1,2,3].map(n => <button key={n} onClick={() => handleNumPad(n.toString())} className="bg-white border border-gray-100 rounded-xl md:rounded-2xl text-2xl md:text-3xl font-black text-gray-700 active:bg-gray-50 active:scale-95 transition-all shadow-sm">{n}</button>)}
              
              <button 
                 onClick={() => handleAddPayment()} 
                 className={`row-span-2 rounded-2xl md:rounded-[2rem] font-black text-white shadow-xl flex flex-col items-center justify-center gap-1 md:gap-2 ${themeBgClass} active:scale-95 hover:brightness-110`}
              >
                 <Plus size={28} className="md:w-8 md:h-8" />
                 <span className="text-[10px] tracking-widest uppercase">Agregar</span>
              </button>

              {[4,5,6].map(n => <button key={n} onClick={() => handleNumPad(n.toString())} className="bg-white border border-gray-100 rounded-xl md:rounded-2xl text-2xl md:text-3xl font-black text-gray-700 active:bg-gray-50 active:scale-95 transition-all shadow-sm">{n}</button>)}
              {[7,8,9].map(n => <button key={n} onClick={() => handleNumPad(n.toString())} className="bg-white border border-gray-100 rounded-xl md:rounded-2xl text-2xl md:text-3xl font-black text-gray-700 active:bg-gray-50 active:scale-95 transition-all shadow-sm">{n}</button>)}
              
              <button onClick={() => handleNumPad('BACK')} className="rounded-xl md:rounded-2xl bg-red-50 text-red-500 flex items-center justify-center active:scale-95 border border-red-100"><Trash2 size={24} className="md:w-7 md:h-7" /></button>
              <button onClick={() => handleNumPad('C')} className="rounded-xl md:rounded-2xl bg-gray-200 text-gray-600 font-black text-lg md:text-xl active:scale-95 transition-all shadow-inner">C</button>
              <button onClick={() => handleNumPad('0')} className="rounded-xl md:rounded-2xl bg-white border border-gray-100 text-2xl md:text-3xl font-black text-gray-700 active:bg-gray-50 active:scale-95 transition-all shadow-sm">0</button>
              <button onClick={() => handleNumPad('.')} className="rounded-xl md:rounded-2xl bg-white border border-gray-100 text-2xl md:text-3xl font-black text-gray-700 active:bg-gray-50 active:scale-95 transition-all shadow-sm">.</button>
           </div>
        </div>
      </div>
    </div>
  );
};

export default UnifiedPaymentModal;