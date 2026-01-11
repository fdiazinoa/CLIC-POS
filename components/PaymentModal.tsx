import React, { useState, useEffect } from 'react';
import { 
  X, CreditCard, Banknote, QrCode, CheckCircle2, 
  Smartphone, Trash2, Plus, Wallet, Printer, Mail, 
  ArrowRight, Repeat, Calculator 
} from 'lucide-react';
import { PaymentEntry, PaymentMethod } from '../types';

interface PaymentModalProps {
  total: number;
  currencySymbol: string;
  onClose: () => void;
  onConfirm: (payments: PaymentEntry[]) => void;
  themeColor: string;
}

const UnifiedPaymentModal: React.FC<PaymentModalProps> = ({ total, currencySymbol, onClose, onConfirm, themeColor }) => {
  // --- STATE ---
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [activeMethod, setActiveMethod] = useState<PaymentMethod>('CASH');
  const [inputAmount, setInputAmount] = useState<string>('');
  const [isSuccessScreen, setIsSuccessScreen] = useState(false);
  const [email, setEmail] = useState('');
  
  // Tracks if the input is currently auto-filled and should be overwritten on next keystroke
  const [shouldClearInput, setShouldClearInput] = useState(true);

  // --- CALCULATIONS ---
  const totalPaid = payments.reduce((acc, p) => acc + p.amount, 0);
  const remaining = Math.max(0, parseFloat((total - totalPaid).toFixed(2)));
  const change = Math.max(0, parseFloat((totalPaid - total).toFixed(2)));
  const isComplete = remaining === 0;

  // --- EFFECTS ---
  // Auto-fill input with remaining amount when switching context or updating remaining
  useEffect(() => {
    if (remaining > 0) {
      setInputAmount(remaining.toFixed(2));
      setShouldClearInput(true);
    } else {
      setInputAmount('');
      setShouldClearInput(false);
    }
  }, [remaining, activeMethod]);

  // --- SMART CASH LOGIC ---
  const getSmartSuggestions = () => {
    if (remaining <= 0) return [];
    
    const amount = remaining;
    const suggestions = new Set<number>();
    
    suggestions.add(amount); // Exacto

    // Next round numbers (multiples of 5, 10, 20, 50, 100)
    [5, 10, 20, 50, 100].forEach(bill => {
      if (bill > amount) suggestions.add(bill);
      else {
         // Logic for e.g. amount is 12, suggest 15 (10+5) or 20
         const nextMultiple = Math.ceil(amount / bill) * bill;
         if (nextMultiple > amount) suggestions.add(nextMultiple);
      }
    });

    return Array.from(suggestions).sort((a, b) => a - b).slice(0, 4); // Top 4 suggestions
  };

  // --- HANDLERS ---
  const handleNumPad = (key: string) => {
    if (key === 'C') {
      setInputAmount('');
      setShouldClearInput(false);
      return;
    } 

    if (key === 'BACK') {
      if (shouldClearInput) {
          setInputAmount('');
          setShouldClearInput(false);
      } else {
          setInputAmount(prev => prev.slice(0, -1));
      }
      return;
    }

    if (shouldClearInput) {
       setShouldClearInput(false);
       if (key === '.') {
          setInputAmount('0.');
       } else {
          setInputAmount(key);
       }
    } else {
       if (key === '.' && inputAmount.includes('.')) return;
       if (inputAmount.includes('.') && inputAmount.split('.')[1].length >= 2) return;
       setInputAmount(prev => prev + key);
    }
  };

  // Keyboard Support
  useEffect(() => {
     const handleKeyDown = (e: KeyboardEvent) => {
        if (isSuccessScreen) return;
        
        // Allow default behavior for inputs if not our main input
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' && target.getAttribute('type') === 'email') return;

        if (/^[0-9.]$/.test(e.key)) {
           handleNumPad(e.key);
        } else if (e.key === 'Backspace') {
           handleNumPad('BACK');
        } else if (e.key === 'Escape') {
           onClose();
        } else if (e.key === 'Enter') {
           handleAddPayment();
        }
     };
     window.addEventListener('keydown', handleKeyDown);
     return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shouldClearInput, inputAmount, isSuccessScreen, remaining, activeMethod]);

  const handleAddPayment = (amountOverride?: number) => {
    const val = amountOverride !== undefined ? amountOverride : parseFloat(inputAmount);
    if (!val || val <= 0) return;

    const newPayment: PaymentEntry = {
      id: Math.random().toString(36).substr(2, 9),
      method: activeMethod,
      amount: val,
      timestamp: new Date()
    };

    setPayments(prev => [...prev, newPayment]);
  };

  const handleRemovePayment = (id: string) => {
    setPayments(prev => prev.filter(p => p.id !== id));
  };

  const handleProcessSale = () => {
    setIsSuccessScreen(true);
  };

  const handleFinalize = () => {
    onConfirm(payments);
  };

  // --- THEME ---
  const themeClass = {
    blue: 'text-blue-600',
    orange: 'text-orange-600',
    gray: 'text-gray-800'
  }[themeColor] || 'text-indigo-600';

  const themeBgClass = {
    blue: 'bg-blue-600',
    orange: 'bg-orange-600',
    gray: 'bg-gray-800'
  }[themeColor] || 'bg-indigo-600';

  // --- RENDER SUCCESS SCREEN ---
  if (isSuccessScreen) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/90 backdrop-blur-md animate-in fade-in duration-300">
        <div className="bg-white rounded-[2.5rem] w-full max-w-lg p-8 shadow-2xl flex flex-col items-center text-center relative overflow-hidden">
          
          {/* Confetti / Decoration Background */}
          <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-green-300 via-transparent to-transparent pointer-events-none"></div>

          <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6 animate-in zoom-in duration-500">
            <CheckCircle2 size={48} className="text-green-600" />
          </div>

          <h2 className="text-4xl font-black text-gray-900 mb-2">¡Venta Exitosa!</h2>
          <p className="text-gray-500 mb-8">La transacción se ha registrado correctamente.</p>

          <div className="w-full bg-gray-50 rounded-2xl p-6 mb-8 border border-gray-100">
             <div className="flex justify-between items-center text-sm mb-2">
                <span className="text-gray-500">Total Cobrado</span>
                <span className="font-bold text-gray-900 text-lg">{currencySymbol}{totalPaid.toFixed(2)}</span>
             </div>
             {change > 0 && (
               <div className="flex justify-between items-center text-sm pt-2 border-t border-gray-200 mt-2">
                  <span className="text-green-600 font-bold uppercase">Su Cambio</span>
                  <span className="font-black text-green-600 text-2xl">{currencySymbol}{change.toFixed(2)}</span>
               </div>
             )}
          </div>

          <div className="w-full space-y-3">
             <div className="flex gap-3">
                <button 
                  onClick={() => alert("Imprimiendo ticket...")}
                  className="flex-1 py-4 rounded-xl bg-gray-100 font-bold text-gray-700 hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
                >
                   <Printer size={20} /> Imprimir
                </button>
                <div className="flex-1 relative">
                   <input 
                     type="email" 
                     placeholder="Email cliente" 
                     value={email}
                     onChange={(e) => setEmail(e.target.value)}
                     className="w-full h-full pl-10 pr-4 rounded-xl bg-gray-100 border-none outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                   />
                   <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                   {email && (
                      <button onClick={() => alert(`Enviado a ${email}`)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 bg-blue-500 text-white rounded-full">
                         <ArrowRight size={12} />
                      </button>
                   )}
                </div>
             </div>
             
             <button 
               onClick={handleFinalize}
               className={`w-full py-4 rounded-xl font-bold text-white shadow-xl flex items-center justify-center gap-2 transition-transform active:scale-95 ${themeBgClass}`}
             >
                <Repeat size={20} /> Nueva Venta
             </button>
          </div>

        </div>
      </div>
    );
  }

  // --- RENDER MAIN INTERFACE ---
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 md:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-6xl h-full md:h-[85vh] md:rounded-[2.5rem] shadow-2xl flex overflow-hidden">
        
        {/* === LEFT COLUMN: SUMMARY & HISTORY === */}
        <div className="w-[35%] bg-gray-50 border-r border-gray-200 flex flex-col relative">
           <button onClick={onClose} className="absolute top-4 left-4 p-2 text-gray-400 hover:bg-gray-200 rounded-full transition-colors z-10">
              <X size={24} />
           </button>

           <div className="flex-1 flex flex-col p-8 pt-16">
              <div className="mb-8">
                 <p className="text-gray-500 font-medium uppercase tracking-wider text-xs mb-1">Total a Cobrar</p>
                 <h1 className="text-6xl font-black text-gray-900 tracking-tighter">{currencySymbol}{total.toFixed(2)}</h1>
              </div>

              {/* Payment History List */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                 {payments.map(p => (
                    <div key={p.id} className="flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-gray-100 animate-in slide-in-from-left-5">
                       <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600">
                             {p.method === 'CASH' && <Banknote size={20} />}
                             {p.method === 'CARD' && <CreditCard size={20} />}
                             {p.method === 'QR' && <QrCode size={20} />}
                          </div>
                          <div>
                             <p className="font-bold text-gray-800 text-sm">
                                {p.method === 'CASH' ? 'Efectivo' : p.method === 'CARD' ? 'Tarjeta' : 'Digital'}
                             </p>
                             <p className="text-xs text-gray-400">{p.timestamp.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p>
                          </div>
                       </div>
                       <div className="flex items-center gap-4">
                          <span className="font-bold text-lg text-gray-900">{currencySymbol}{p.amount.toFixed(2)}</span>
                          <button onClick={() => handleRemovePayment(p.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                             <Trash2 size={18} />
                          </button>
                       </div>
                    </div>
                 ))}
                 
                 {payments.length === 0 && (
                    <div className="text-center py-10 text-gray-400 border-2 border-dashed border-gray-200 rounded-3xl">
                       <Wallet size={32} className="mx-auto mb-2 opacity-50" />
                       <p className="text-sm">Sin pagos registrados</p>
                    </div>
                 )}
              </div>
           </div>

           {/* Bottom Status Panel */}
           <div className="p-8 bg-white border-t border-gray-200">
              <div className="flex justify-between items-end mb-6">
                 <div>
                    <p className="text-sm font-bold text-gray-400 uppercase">Restante</p>
                    <p className={`text-4xl font-black ${remaining > 0 ? 'text-red-500' : 'text-gray-300'}`}>
                       {currencySymbol}{remaining.toFixed(2)}
                    </p>
                 </div>
                 {change > 0 && (
                    <div className="text-right animate-in zoom-in">
                       <p className="text-sm font-bold text-green-600 uppercase">Su Cambio</p>
                       <p className="text-4xl font-black text-green-600">{currencySymbol}{change.toFixed(2)}</p>
                    </div>
                 )}
              </div>

              <button 
                 onClick={handleProcessSale}
                 disabled={remaining > 0}
                 className={`w-full py-5 rounded-2xl font-bold text-xl text-white shadow-xl flex items-center justify-center gap-3 transition-all duration-300 ${
                    remaining > 0 
                       ? 'bg-gray-200 text-gray-400 cursor-not-allowed' 
                       : `${themeBgClass} hover:scale-[1.02] hover:shadow-2xl`
                 }`}
              >
                 {remaining > 0 ? `Faltan ${currencySymbol}${remaining.toFixed(2)}` : 'FINALIZAR VENTA'}
                 {remaining === 0 && <CheckCircle2 size={24} />}
              </button>
           </div>
        </div>

        {/* === RIGHT COLUMN: INPUT & METHODS === */}
        <div className="w-[65%] flex flex-col bg-white">
           
           {/* Method Tabs */}
           <div className="flex p-4 gap-4">
              {[
                 { id: 'CASH', label: 'Efectivo', icon: Banknote },
                 { id: 'CARD', label: 'Tarjeta', icon: CreditCard },
                 { id: 'QR', label: 'Digital / QR', icon: QrCode },
              ].map(m => (
                 <button
                   key={m.id}
                   onClick={() => setActiveMethod(m.id as PaymentMethod)}
                   className={`flex-1 py-6 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all duration-200 ${
                      activeMethod === m.id 
                         ? `border-current ${themeClass} bg-gray-50 shadow-sm` 
                         : 'border-transparent hover:bg-gray-50 text-gray-400'
                   }`}
                 >
                    <m.icon size={32} />
                    <span className="font-bold text-sm uppercase tracking-wide">{m.label}</span>
                 </button>
              ))}
           </div>

           {/* Input Display */}
           <div className="px-8 mt-4">
              <div className={`bg-gray-100 rounded-3xl p-6 flex justify-between items-center relative overflow-hidden border transition-colors ${shouldClearInput ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200'}`}>
                 <span className="text-3xl text-gray-400 font-medium">{currencySymbol}</span>
                 <input 
                    type="text" 
                    readOnly 
                    value={inputAmount} 
                    className="bg-transparent text-right text-6xl font-mono font-bold text-gray-800 w-full outline-none z-10 cursor-text"
                    placeholder="0.00"
                    onClick={() => {
                        // Optional: if clicked and not already set to clear, maybe select all? 
                        // For now, relying on initial state. 
                    }}
                 />
                 {activeMethod === 'CARD' && (
                    <div className="absolute left-6 bottom-4 flex gap-2 opacity-50">
                       <div className="h-6 w-10 bg-gray-300 rounded"></div> {/* Fake Visa Icon */}
                       <div className="h-6 w-10 bg-gray-300 rounded"></div> {/* Fake MC Icon */}
                    </div>
                 )}
              </div>
              <p className="text-xs text-center text-gray-400 mt-2">
                 {shouldClearInput ? "Escribe para modificar el monto" : "Ingresa el monto a cobrar"}
              </p>
           </div>

           {/* Smart Suggestions (Only for Cash) */}
           {activeMethod === 'CASH' && remaining > 0 && (
              <div className="px-8 mt-6 flex gap-3 overflow-x-auto no-scrollbar pb-2">
                 {getSmartSuggestions().map(sugg => (
                    <button 
                      key={sugg}
                      onClick={() => handleAddPayment(sugg)}
                      className="flex-1 min-w-[100px] py-4 bg-green-50 text-green-700 border border-green-200 rounded-2xl font-bold text-xl hover:bg-green-100 hover:scale-105 transition-all shadow-sm"
                    >
                       {currencySymbol}{sugg}
                    </button>
                 ))}
              </div>
           )}

           {/* Numeric Keypad */}
           <div className="flex-1 p-8 grid grid-cols-4 gap-4">
              {[1, 2, 3].map(n => (
                 <button key={n} onClick={() => handleNumPad(n.toString())} className="bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 rounded-3xl text-3xl font-bold text-gray-700 transition-all active:scale-95">
                    {n}
                 </button>
              ))}
              <button onClick={() => handleAddPayment()} className={`row-span-2 rounded-3xl font-bold text-white shadow-lg flex flex-col items-center justify-center gap-2 transition-all active:scale-95 ${themeBgClass} ${(!inputAmount || parseFloat(inputAmount) === 0) ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-110'}`}>
                 <Plus size={32} />
                 <span className="text-sm uppercase">Agregar</span>
              </button>

              {[4, 5, 6].map(n => (
                 <button key={n} onClick={() => handleNumPad(n.toString())} className="bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 rounded-3xl text-3xl font-bold text-gray-700 transition-all active:scale-95">
                    {n}
                 </button>
              ))}

              {[7, 8, 9].map(n => (
                 <button key={n} onClick={() => handleNumPad(n.toString())} className="bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 rounded-3xl text-3xl font-bold text-gray-700 transition-all active:scale-95">
                    {n}
                 </button>
              ))}
              <button onClick={() => handleNumPad('BACK')} className="rounded-3xl bg-red-50 text-red-500 font-bold hover:bg-red-100 transition-all flex items-center justify-center">
                 <Trash2 size={24} />
              </button>

              <button onClick={() => handleNumPad('C')} className="rounded-3xl bg-gray-100 text-gray-500 font-bold hover:bg-gray-200 transition-all text-xl">C</button>
              <button onClick={() => handleNumPad('0')} className="rounded-3xl bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 text-3xl font-bold text-gray-700 transition-all active:scale-95">0</button>
              <button onClick={() => handleNumPad('.')} className="rounded-3xl bg-white border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 text-3xl font-bold text-gray-700 transition-all active:scale-95">.</button>
           </div>

        </div>
      </div>
    </div>
  );
};

export default UnifiedPaymentModal;