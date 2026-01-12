import React, { useState } from 'react';
import { 
  ArrowLeft, Wallet, ArrowUpRight, ArrowDownLeft, Plus, Minus, 
  TrendingUp, TrendingDown, DollarSign, CreditCard, Smartphone, 
  Banknote, X, FileText, Lock
} from 'lucide-react';
import { Transaction, CashMovement, BusinessConfig } from '../types';

interface FinanceDashboardProps {
  transactions: Transaction[];
  cashMovements: CashMovement[];
  config: BusinessConfig;
  onClose: () => void;
  onRegisterMovement: (type: 'IN' | 'OUT', amount: number, reason: string) => void;
  onOpenZReport: () => void;
}

// --- HELPER: Petty Cash Modal (Reused) ---
const PettyCashModal: React.FC<{ 
  type: 'IN' | 'OUT'; 
  currency: string; 
  onClose: () => void; 
  onConfirm: (amount: number, reason: string) => void; 
}> = ({ type, currency, onClose, onConfirm }) => {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const REASONS_IN = ['Cambio Inicial', 'Aporte Caja', 'Cobro Pendiente', 'Otro Ingreso'];
  const REASONS_OUT = ['Pago Proveedor', 'Compra Insumos', 'Taxi / Transporte', 'Adelanto Sueldo', 'Gastos Varios'];
  
  const reasons = type === 'IN' ? REASONS_IN : REASONS_OUT;
  const themeClass = type === 'IN' ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50';
  const btnClass = type === 'IN' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700';

  const handleNumPad = (key: string) => {
    if (key === 'BACK') setAmount(prev => prev.slice(0, -1));
    else if (key === '.') { if(!amount.includes('.')) setAmount(prev => prev + key); }
    else setAmount(prev => prev + key);
  };

  const handleConfirm = () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    onConfirm(val, reason || 'Movimiento General');
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md rounded-t-[2.5rem] p-6 shadow-2xl animate-in slide-in-from-bottom-full duration-300">
        <div className="flex justify-between items-center mb-6">
          <div className={`px-4 py-2 rounded-xl font-bold uppercase tracking-wide text-xs ${themeClass}`}>
            {type === 'IN' ? 'Entrada de Dinero' : 'Salida de Dinero'}
          </div>
          <button onClick={onClose} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"><X size={20} /></button>
        </div>
        <div className="text-center mb-6">
          <div className="flex items-center justify-center text-5xl font-black text-gray-800">
            <span className="text-2xl text-gray-400 mr-1 mt-2">{currency}</span>
            {amount || '0.00'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mb-6 justify-center">
          {reasons.map(r => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${
                reason === r 
                  ? `${themeClass} border-current ring-1 ring-current` 
                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[1,2,3,4,5,6,7,8,9,'.',0].map(n => (
            <button key={n} onClick={() => handleNumPad(n.toString())} className="py-4 bg-gray-50 rounded-xl text-xl font-bold text-gray-700 active:bg-gray-200 transition-colors">
              {n}
            </button>
          ))}
          <button onClick={() => handleNumPad('BACK')} className="py-4 bg-gray-50 rounded-xl text-gray-500 flex items-center justify-center active:bg-gray-200">
            <ArrowLeft size={24} />
          </button>
        </div>
        <button 
          onClick={handleConfirm}
          disabled={!amount || parseFloat(amount) <= 0}
          className={`w-full py-4 rounded-2xl text-white font-bold text-lg shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-all ${btnClass} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {type === 'IN' ? <Plus size={24} /> : <Minus size={24} />}
          Confirmar {type === 'IN' ? 'Ingreso' : 'Retiro'}
        </button>
      </div>
    </div>
  );
};

const FinanceDashboard: React.FC<FinanceDashboardProps> = ({ 
  transactions, 
  cashMovements, 
  config, 
  onClose,
  onRegisterMovement,
  onOpenZReport
}) => {
  const [activeModal, setActiveModal] = useState<'IN' | 'OUT' | null>(null);

  // --- CALCS FOR X-REPORT ---
  const payments = transactions.flatMap(t => t.payments);
  const totalsByMethod = payments.reduce((acc: Record<string, number>, p) => {
     acc[p.method] = (acc[p.method] || 0) + p.amount;
     return acc;
  }, {} as Record<string, number>);

  const cashSalesTotal = totalsByMethod['CASH'] || 0;
  const cashIn = cashMovements.filter(m => m.type === 'IN').reduce((acc, m) => acc + m.amount, 0);
  const cashOut = cashMovements.filter(m => m.type === 'OUT').reduce((acc, m) => acc + m.amount, 0);
  
  const expectedCashInDrawer = cashSalesTotal + cashIn - cashOut;
  const totalSales = (Object.values(totalsByMethod) as number[]).reduce((acc: number, val: number) => acc + val, 0);

  return (
    <div className="h-screen w-full bg-gray-50 flex flex-col overflow-hidden">
      
      {/* Header */}
      <header className="bg-white border-b border-gray-200 p-4 shadow-sm z-20 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Wallet size={20} className="text-blue-600" />
            Finanzas & Caja
          </h1>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-bold">
           <Banknote size={16} />
           En Caja: {config.currencySymbol}{expectedCashInDrawer.toFixed(2)}
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col md:flex-row p-6 gap-6 max-w-7xl mx-auto w-full">
         
         {/* LEFT: PETTY CASH OPERATIONS */}
         <div className="w-full md:w-1/2 flex flex-col gap-6">
            
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
               <h3 className="font-bold text-gray-700 mb-6 flex items-center gap-2">
                  <TrendingUp size={20} className="text-gray-400" /> Operaciones Rápidas
               </h3>
               <div className="grid grid-cols-2 gap-4">
                  <button 
                     onClick={() => setActiveModal('IN')}
                     className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 rounded-2xl p-6 flex flex-col items-center justify-center gap-3 transition-all active:scale-95 group"
                  >
                     <div className="w-14 h-14 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-200 group-hover:scale-110 transition-transform">
                        <Plus size={28} />
                     </div>
                     <span className="font-bold text-emerald-800 text-lg">Entrada</span>
                     <span className="text-xs text-emerald-600 font-medium">Ingreso / Cambio</span>
                  </button>
                  <button 
                     onClick={() => setActiveModal('OUT')}
                     className="bg-red-50 hover:bg-red-100 border border-red-100 rounded-2xl p-6 flex flex-col items-center justify-center gap-3 transition-all active:scale-95 group"
                  >
                     <div className="w-14 h-14 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg shadow-red-200 group-hover:scale-110 transition-transform">
                        <Minus size={28} />
                     </div>
                     <span className="font-bold text-red-800 text-lg">Salida</span>
                     <span className="text-xs text-red-600 font-medium">Pago / Gasto</span>
                  </button>
               </div>
            </div>

            <div className="flex-1 bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
               <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2">
                  <FileText size={20} className="text-gray-400" /> Movimientos del Día
               </h3>
               {cashMovements.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
                     <Wallet size={48} className="mb-2 opacity-50" />
                     <p className="text-sm font-medium">No hay movimientos registrados hoy</p>
                  </div>
               ) : (
                  <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                     {cashMovements.slice().reverse().map(m => (
                        <div key={m.id} className="flex justify-between items-center p-3 rounded-xl bg-gray-50 border border-gray-100 hover:bg-gray-100 transition-colors">
                           <div className="flex items-center gap-3">
                              <div className={`p-2 rounded-full ${m.type === 'IN' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                                 {m.type === 'IN' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                              </div>
                              <div>
                                 <p className="text-sm font-bold text-gray-800">{m.reason}</p>
                                 <p className="text-[10px] text-gray-400">{new Date(m.timestamp).toLocaleTimeString()} • {m.userName}</p>
                              </div>
                           </div>
                           <span className={`font-bold ${m.type === 'IN' ? 'text-emerald-600' : 'text-red-600'}`}>
                              {m.type === 'IN' ? '+' : '-'}{config.currencySymbol}{m.amount.toFixed(2)}
                           </span>
                        </div>
                     ))}
                  </div>
               )}
            </div>

         </div>

         {/* RIGHT: X-REPORT (MONITOR) & Z-REPORT LINK */}
         <div className="w-full md:w-1/2 flex flex-col gap-6">
            
            {/* Control X Card */}
            <div className="bg-gray-900 text-white p-6 rounded-3xl shadow-xl relative overflow-hidden">
               {/* Background Pattern */}
               <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
               
               <div className="flex justify-between items-start mb-6 relative z-10">
                  <div>
                     <h3 className="text-xl font-bold mb-1">Reporte X (Monitor)</h3>
                     <p className="text-gray-400 text-xs">Resumen de ventas en tiempo real (No cierra caja)</p>
                  </div>
                  <div className="p-2 bg-white/10 rounded-lg backdrop-blur-sm">
                     <TrendingUp size={24} className="text-blue-400" />
                  </div>
               </div>

               <div className="grid grid-cols-2 gap-4 mb-6 relative z-10">
                  <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                     <p className="text-xs text-gray-400 uppercase font-bold mb-1">Ventas Brutas</p>
                     <p className="text-2xl font-bold">{config.currencySymbol}{totalSales.toFixed(2)}</p>
                  </div>
                  <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                     <p className="text-xs text-gray-400 uppercase font-bold mb-1">Efectivo Teórico</p>
                     <p className="text-2xl font-bold text-emerald-400">{config.currencySymbol}{expectedCashInDrawer.toFixed(2)}</p>
                  </div>
               </div>

               <div className="space-y-3 relative z-10">
                  <p className="text-xs font-bold text-gray-500 uppercase">Desglose por Método</p>
                  <div className="flex justify-between items-center text-sm border-b border-white/10 pb-2">
                     <span className="flex items-center gap-2 text-gray-300"><Banknote size={14} /> Efectivo</span>
                     <span className="font-bold">{config.currencySymbol}{cashSalesTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm border-b border-white/10 pb-2">
                     <span className="flex items-center gap-2 text-gray-300"><CreditCard size={14} /> Tarjetas</span>
                     <span className="font-bold">{config.currencySymbol}{(totalsByMethod['CARD'] || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                     <span className="flex items-center gap-2 text-gray-300"><Smartphone size={14} /> Digital / QR</span>
                     <span className="font-bold">{config.currencySymbol}{(totalsByMethod['QR'] || 0).toFixed(2)}</span>
                  </div>
               </div>
            </div>

            {/* Z-Report Action */}
            <div className="mt-auto">
               <div className="bg-orange-50 border border-orange-100 p-4 rounded-2xl mb-4 flex gap-3 items-start">
                  <Lock size={20} className="text-orange-500 mt-1 shrink-0" />
                  <div>
                     <h4 className="font-bold text-orange-800 text-sm">¿Listo para cerrar el día?</h4>
                     <p className="text-xs text-orange-700 mt-1">
                        El Cierre Z realizará el corte final, reseteará las ventas y generará el reporte diario. Esta acción es irreversible.
                     </p>
                  </div>
               </div>
               
               <button 
                  onClick={onOpenZReport}
                  className="w-full py-4 bg-white border-2 border-gray-200 hover:border-red-500 hover:bg-red-50 text-gray-600 hover:text-red-600 rounded-2xl font-bold text-lg transition-all shadow-sm flex items-center justify-center gap-3 group"
               >
                  <span>Realizar Cierre Z</span>
                  <ArrowUpRight size={20} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
               </button>
            </div>

         </div>

      </div>

      {/* Petty Cash Modal */}
      {activeModal && (
        <PettyCashModal 
          type={activeModal} 
          currency={config.currencySymbol} 
          onClose={() => setActiveModal(null)} 
          onConfirm={(amount, reason) => {
             onRegisterMovement(activeModal, amount, reason);
             setActiveModal(null);
          }} 
        />
      )}

    </div>
  );
};

export default FinanceDashboard;