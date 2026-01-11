import React, { useState, useRef } from 'react';
import { 
  ArrowLeft, Receipt, CheckCircle, Banknote, Calendar,
  AlertTriangle, Lock
} from 'lucide-react';
import { Transaction, BusinessConfig, CashMovement } from '../types';

interface ZReportDashboardProps {
  transactions: Transaction[];
  cashMovements: CashMovement[];
  config: BusinessConfig;
  userName: string;
  onClose: () => void;
  onConfirmClose: (cashCounted: number, notes: string) => void;
}

// --- HELPER: Slide To Action Button (Reused) ---
const SlideButton: React.FC<{ onComplete: () => void; label: string; colorClass: string }> = ({ onComplete, label, colorClass }) => {
   const [dragX, setDragX] = useState(0);
   const [isDragging, setIsDragging] = useState(false);
   const containerRef = useRef<HTMLDivElement>(null);
   const maxDrag = 250; 

   const handlePointerMove = (e: React.PointerEvent) => {
      if (!isDragging) return;
      const newX = Math.min(Math.max(0, e.clientX - (containerRef.current?.getBoundingClientRect().left || 0)), maxDrag);
      setDragX(newX);
      if (newX >= maxDrag - 10) {
         setIsDragging(false);
         onComplete();
      }
   };

   const reset = () => {
      if (dragX < maxDrag - 10) setDragX(0);
      setIsDragging(false);
   };

   return (
      <div 
        ref={containerRef}
        className="relative w-full max-w-sm h-16 bg-gray-100 rounded-full overflow-hidden select-none touch-none shadow-inner border border-gray-200"
        onPointerUp={reset}
        onPointerLeave={reset}
        onPointerMove={handlePointerMove}
      >
         <div className="absolute inset-0 flex items-center justify-center text-gray-400 font-bold uppercase tracking-widest text-sm pointer-events-none transition-opacity" style={{ opacity: 1 - (dragX / maxDrag) }}>
            {label}
         </div>
         <div className={`absolute left-0 top-0 bottom-0 ${colorClass} opacity-20`} style={{ width: dragX + 30 }}></div>
         <div 
            onPointerDown={() => setIsDragging(true)}
            className={`absolute top-1 bottom-1 w-14 rounded-full shadow-lg cursor-grab active:cursor-grabbing flex items-center justify-center transition-transform bg-white ${isDragging ? 'scale-105' : 'scale-100'}`}
            style={{ left: dragX, transform: `translateX(0)` }}
         >
            <Lock className="text-gray-600" size={24} />
         </div>
      </div>
   );
};

const ZReportDashboard: React.FC<ZReportDashboardProps> = ({ transactions, cashMovements, config, userName, onClose, onConfirmClose }) => {
  const [cashCounted, setCashCounted] = useState<string>('');
  const [notes, setNotes] = useState('');

  // --- STATS CALCS ---
  const totalSales = transactions.reduce((acc, t) => acc + t.total, 0);
  
  const payments = transactions.flatMap(t => t.payments);
  const totalsByMethod = payments.reduce((acc, p) => {
     acc[p.method] = (acc[p.method] || 0) + p.amount;
     return acc;
  }, {} as Record<string, number>);

  const cashSalesTotal = totalsByMethod['CASH'] || 0;
  
  // Cash Movements Calcs
  const cashIn = cashMovements.filter(m => m.type === 'IN').reduce((acc, m) => acc + m.amount, 0);
  const cashOut = cashMovements.filter(m => m.type === 'OUT').reduce((acc, m) => acc + m.amount, 0);
  
  const expectedCashInDrawer = cashSalesTotal + cashIn - cashOut;
  const cashDiscrepancy = (parseFloat(cashCounted) || 0) - expectedCashInDrawer;

  return (
    <div className="fixed inset-0 z-[120] bg-gray-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom-5">
      <div className="relative bg-white pt-6 pb-6 px-6 shadow-sm border-b border-gray-200">
         <div className="flex justify-between items-center mb-2">
            <button onClick={onClose} className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500">
               <ArrowLeft size={24} />
            </button>
            <div className="text-right">
               <h1 className="text-2xl font-black text-gray-900 tracking-tight">Cierre de Caja (Z)</h1>
               <div className="flex items-center justify-end gap-2 text-sm text-gray-500">
                  <Calendar size={14} />
                  {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
               </div>
            </div>
         </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl mx-auto w-full">
         
         {/* Summary Cards */}
         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* System Calculation */}
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
               <h3 className="font-bold text-gray-500 uppercase text-xs tracking-wider mb-4">Balance Teórico (Sistema)</h3>
               
               <div className="space-y-4">
                  <div className="flex justify-between items-center text-sm">
                     <span className="text-gray-600">Ventas en Efectivo</span>
                     <span className="font-bold text-gray-900">{config.currencySymbol}{cashSalesTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                     <span className="text-emerald-600 font-medium">Total Entradas</span>
                     <span className="font-bold text-emerald-600">+{config.currencySymbol}{cashIn.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                     <span className="text-red-600 font-medium">Total Salidas</span>
                     <span className="font-bold text-red-600">-{config.currencySymbol}{cashOut.toFixed(2)}</span>
                  </div>
                  <div className="border-t border-dashed border-gray-200 pt-3 flex justify-between items-center">
                     <span className="font-black text-gray-800 uppercase text-sm">Debe haber en caja</span>
                     <span className="font-black text-2xl text-blue-600">{config.currencySymbol}{expectedCashInDrawer.toFixed(2)}</span>
                  </div>
               </div>
            </div>

            {/* Manual Count */}
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between">
               <div>
                  <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                     <Banknote size={18} className="text-gray-400" /> Conteo Físico
                  </h3>
                  <div className="relative mb-2">
                     <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">{config.currencySymbol}</span>
                     <input 
                        autoFocus
                        type="number" 
                        value={cashCounted} 
                        onChange={(e) => setCashCounted(e.target.value)} 
                        placeholder="0.00" 
                        className="w-full pl-10 pr-4 py-4 text-3xl font-bold border-2 border-gray-200 rounded-2xl focus:border-blue-500 outline-none transition-colors" 
                     />
                  </div>
                  <p className="text-xs text-gray-400">Ingresa el total de efectivo contado en el cajón.</p>
               </div>

               {/* Discrepancy Indicator */}
               {cashCounted && (
                  <div className={`mt-4 p-4 rounded-xl border flex items-center gap-3 ${cashDiscrepancy === 0 ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
                     {cashDiscrepancy === 0 ? <CheckCircle size={24} /> : <AlertTriangle size={24} />}
                     <div>
                        <p className="font-bold text-sm uppercase">{cashDiscrepancy === 0 ? 'Cuadre Perfecto' : 'Descuadre Detectado'}</p>
                        <p className="font-mono font-bold text-lg">{cashDiscrepancy > 0 ? '+' : ''}{config.currencySymbol}{cashDiscrepancy.toFixed(2)}</p>
                     </div>
                  </div>
               )}
            </div>
         </div>

         {/* Notes Section */}
         <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="font-bold text-gray-800 mb-2 flex items-center gap-2">
               <Receipt size={18} className="text-gray-400" /> Notas del Cierre
            </h3>
            <textarea 
               value={notes} 
               onChange={(e) => setNotes(e.target.value)} 
               placeholder="Observaciones, justificación de descuadre, etc." 
               rows={3} 
               className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none resize-none" 
            />
         </div>

      </div>

      {/* Footer Action */}
      <div className="p-6 bg-white border-t border-gray-200 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] flex flex-col items-center">
         <SlideButton 
            label="Desliza para Cerrar Caja" 
            colorClass={config.themeColor === 'orange' ? 'bg-orange-500' : 'bg-blue-500'} 
            onComplete={() => { 
               if(confirm("¿Estás seguro de cerrar la caja? Esta acción reseteará las ventas del día.")) { 
                  onConfirmClose(parseFloat(cashCounted) || 0, notes); 
               } 
            }} 
         />
         <p className="text-xs text-gray-400 mt-4 text-center">Responsable: <strong>{userName}</strong></p>
      </div>

    </div>
  );
};

export default ZReportDashboard;