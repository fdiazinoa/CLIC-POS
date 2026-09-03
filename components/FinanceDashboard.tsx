import React, { useEffect, useMemo, useState } from 'react';
import {
   ArrowLeft, Wallet, ArrowUpRight, ArrowDownLeft, Plus, Minus,
   TrendingUp, TrendingDown, DollarSign, CreditCard, Smartphone,
   Banknote, X, FileText, Lock, ClipboardCheck, Printer
} from 'lucide-react';
import { Transaction, CashMovement, BusinessConfig, User, RoleDefinition, XReport } from '../types';

interface FinanceDashboardProps {
   transactions: Transaction[];
   cashMovements: CashMovement[];
   xReports?: XReport[];
   config: BusinessConfig;
   currentUser: User | null;
   roles: RoleDefinition[];
   /** false desactiva el bloque Reporte X (gobernado desde ERP `session.allowPartialXReport`). */
   allowPartialXReport?: boolean;
   terminalId?: string;
   initialCashMovementType?: 'IN' | 'OUT' | 'X_REPORT';
   onClose: () => void;
   onRegisterMovement: (type: 'IN' | 'OUT', amount: number, reason: string) => void;
   onCloseXReport?: (cashCounted: number, notes?: string, reportData?: { denominationBreakdown?: Record<string, Array<{ denomination: number; quantity: number; total: number }>> }) => Promise<void> | void;
   onPrintXReport?: (report: XReport) => Promise<void> | void;
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
      else if (key === '.') { if (!amount.includes('.')) setAmount(prev => prev + key); }
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
                     className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${reason === r
                        ? `${themeClass} border-current ring-1 ring-current`
                        : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
                        }`}
                  >
                     {r}
                  </button>
               ))}
            </div>
            <div className="grid grid-cols-3 gap-3 mb-6">
               {[1, 2, 3, 4, 5, 6, 7, 8, 9, '.', 0].map(n => (
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

const XCloseModal: React.FC<{
   currency: string;
   currencyCode: string;
   expectedCash: number;
   forceDenominationCount: boolean;
   onClose: () => void;
   onConfirm: (cashCounted: number, notes?: string, reportData?: { denominationBreakdown?: Record<string, Array<{ denomination: number; quantity: number; total: number }>> }) => void | Promise<void>;
}> = ({ currency, currencyCode, expectedCash, forceDenominationCount, onClose, onConfirm }) => {
   const [amount, setAmount] = useState('');
   const [denominationCounts, setDenominationCounts] = useState<Record<string, string>>({});
   const [isProcessing, setIsProcessing] = useState(false);

   const denominations = currencyCode === 'USD'
      ? [100, 50, 20, 10, 5, 2, 1, 0.25, 0.10, 0.05, 0.01]
      : currencyCode === 'EUR'
         ? [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.50, 0.20, 0.10, 0.05, 0.02, 0.01]
         : [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1];
   const denominationLines = denominations
      .map(denomination => {
         const quantity = Number(denominationCounts[String(denomination)] || 0);
         return {
            denomination,
            quantity: Number.isFinite(quantity) ? quantity : 0,
            total: Number.isFinite(quantity) ? denomination * quantity : 0,
         };
      })
      .filter(line => line.quantity > 0);
   const denominationTotal = denominationLines.reduce((sum, line) => sum + line.total, 0);

   const handleNumPad = (key: string) => {
      if (key === 'BACK') setAmount(prev => prev.slice(0, -1));
      else if (key === '.') { if (!amount.includes('.')) setAmount(prev => prev + key); }
      else setAmount(prev => prev + key);
   };

   const parsedAmount = forceDenominationCount ? denominationTotal : parseFloat(amount);
   const isValid = forceDenominationCount
      ? denominationLines.length > 0
      : Number.isFinite(parsedAmount) && parsedAmount >= 0;

   const handleConfirm = async () => {
      if (!isValid) return;
      setIsProcessing(true);
      try {
         await onConfirm(parsedAmount, 'Cierre X / arqueo parcial', forceDenominationCount ? {
            denominationBreakdown: { [currencyCode]: denominationLines },
         } : undefined);
         onClose();
      } finally {
         setIsProcessing(false);
      }
   };

   return (
      <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
         <div className="bg-white w-full max-w-md rounded-t-[2.5rem] p-6 shadow-2xl animate-in slide-in-from-bottom-full duration-300">
            <div className="mb-6 flex items-center justify-between">
               <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-500">Arqueo parcial</p>
                  <h2 className="text-2xl font-black text-gray-900">Cierre X</h2>
                  <p className="mt-1 text-xs font-bold text-gray-500">No limpia ventas ni movimientos.</p>
               </div>
               <button onClick={onClose} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"><X size={20} /></button>
            </div>

            <div className="mb-5 rounded-2xl border border-blue-100 bg-blue-50 p-4">
               <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">Efectivo teórico</p>
               <p className="mt-1 text-3xl font-black text-blue-900">{currency}{expectedCash.toFixed(2)}</p>
            </div>

            {forceDenominationCount ? (
               <div className="mb-6">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Conteo por denominación</p>
                  <div className="max-h-[42vh] overflow-y-auto rounded-2xl border border-gray-100 bg-gray-50">
                     {denominations.map(denomination => (
                        <label key={denomination} className="grid grid-cols-[1fr_100px] items-center gap-3 border-b border-gray-100 bg-white px-4 py-2 last:border-0">
                           <span className="text-lg font-black text-gray-800">{currency}{denomination.toFixed(denomination % 1 === 0 ? 0 : 2)}</span>
                           <input
                              type="number"
                              inputMode="numeric"
                              min="0"
                              step="1"
                              value={denominationCounts[String(denomination)] || ''}
                              onChange={(event) => setDenominationCounts(previous => ({
                                 ...previous,
                                 [String(denomination)]: event.target.value.replace(/[^\d]/g, ''),
                              }))}
                              placeholder="Cant."
                              className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-right text-lg font-black outline-none focus:border-blue-500"
                           />
                        </label>
                     ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between rounded-2xl bg-blue-600 px-4 py-3 text-white">
                     <span className="text-xs font-black uppercase tracking-wide">Total contado</span>
                     <span className="text-xl font-black">{currency}{denominationTotal.toFixed(2)}</span>
                  </div>
               </div>
            ) : <div className="mb-6 text-center">
               <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Efectivo contado</p>
               <div className="flex items-center justify-center text-5xl font-black text-gray-800">
                  <span className="mr-1 mt-2 text-2xl text-gray-400">{currency}</span>
                  {amount || '0.00'}
               </div>
               <button
                  type="button"
                  onClick={() => setAmount(expectedCash.toFixed(2))}
                  className="mt-3 rounded-full bg-gray-100 px-4 py-2 text-xs font-black uppercase text-gray-500 hover:bg-gray-200"
               >
                  Usar teórico
               </button>
            </div>}

            {!forceDenominationCount && <div className="grid grid-cols-3 gap-3 mb-6">
               {[1, 2, 3, 4, 5, 6, 7, 8, 9, '.', 0].map(n => (
                  <button key={n} onClick={() => handleNumPad(n.toString())} className="py-4 bg-gray-50 rounded-xl text-xl font-bold text-gray-700 active:bg-gray-200 transition-colors">
                     {n}
                  </button>
               ))}
               <button onClick={() => handleNumPad('BACK')} className="py-4 bg-gray-50 rounded-xl text-gray-500 flex items-center justify-center active:bg-gray-200">
                  <ArrowLeft size={24} />
               </button>
            </div>}

            <button
               onClick={handleConfirm}
               disabled={!isValid || isProcessing}
               className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-lg font-bold text-white shadow-lg shadow-blue-100 transition-all active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
            >
               <ClipboardCheck size={22} />
               {isProcessing ? 'Generando...' : 'Generar Cierre X'}
            </button>
         </div>
      </div>
   );
};

const FinanceDashboard: React.FC<FinanceDashboardProps> = ({
   transactions,
   cashMovements,
   xReports = [],
   config,
   currentUser,
   roles,
   allowPartialXReport = true,
   terminalId,
   initialCashMovementType,
   onClose,
   onRegisterMovement,
   onCloseXReport,
   onPrintXReport,
   onOpenZReport
}) => {
   const [activeModal, setActiveModal] = useState<'IN' | 'OUT' | null>(null);
   const [showXCloseModal, setShowXCloseModal] = useState(false);
   const [isGeneratingXReport, setIsGeneratingXReport] = useState(false);

   useEffect(() => {
      if (initialCashMovementType) {
         if (initialCashMovementType === 'X_REPORT') {
            setActiveModal(null);
            setShowXCloseModal(true);
         } else {
            setShowXCloseModal(false);
            setActiveModal(initialCashMovementType);
         }
      }
   }, [initialCashMovementType]);

   // Permission checker
   const hasPermission = (permission: string): boolean => {
      if (!currentUser) return false;
      const roleId = currentUser.roleId || currentUser.role;
      const userRole = roles.find(r => r.id === roleId) || roles.find(r => r.id === currentUser.role);
      if (!userRole) return false;
      if (userRole.permissions.includes('ALL')) return true;
      return userRole.permissions.includes(permission as any);
   };

   // --- CALCS FOR X-REPORT ---
   // Robustly filter out any closed transactions (Double-check)
   const openTransactions = transactions.filter(t => !t.zReportId);
   const payments = openTransactions.flatMap(t => t.payments);
   const totalsByMethod = payments.reduce((acc: Record<string, number>, p) => {
      acc[p.method] = (acc[p.method] || 0) + p.amount;
      return acc;
   }, {} as Record<string, number>);

   const cashSalesTotal = totalsByMethod['CASH'] || 0;
   const creditSalesTotal = (totalsByMethod['CREDIT'] || 0) + (totalsByMethod['PENDIENTE'] || 0);
   const cashIn = cashMovements.filter(m => m.type === 'IN').reduce((acc, m) => acc + m.amount, 0);
   const cashOut = cashMovements.filter(m => m.type === 'OUT').reduce((acc, m) => acc + m.amount, 0);

   const expectedCashInDrawer = cashSalesTotal + cashIn - cashOut;
   const totalSales = (Object.values(totalsByMethod) as number[]).reduce((acc: number, val: number) => acc + val, 0);
   const recentXReports = useMemo(
      () => [...(xReports || [])].sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime()).slice(0, 3),
      [xReports]
   );
   const hasCashierActivity = openTransactions.length > 0 || cashMovements.length > 0;
   const canViewXReport = hasPermission('POS_VIEW_X_REPORT') || hasPermission('POS_CLOSE_X');
   const canCloseXReport = hasPermission('POS_CLOSE_X') && allowPartialXReport && hasCashierActivity && Boolean(onCloseXReport);
   const canCloseZReport = hasPermission('POS_CLOSE_Z');
   const activeTerminal = (config.terminals || []).find(terminal =>
      terminal.id === terminalId || terminal.config?.erpTerminalId === terminalId
   ) || config.terminals?.[0];
   const baseCurrency = (config.currencies || []).find(currency => currency.isBase) || config.currencies?.[0];
   const forceDenominationCount = Boolean(activeTerminal?.config?.workflow?.session?.forceDenominationCount);

   const handleGenerateXReport = async () => {
      if (!canCloseXReport || !onCloseXReport) return;
      setShowXCloseModal(true);
   };

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

               {hasPermission('CASH_IN_OUT') && (
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
               )}

               <div className="bg-white p-6 rounded-3xl shadow-sm border border-blue-100">
                  <h3 className="font-bold text-gray-700 mb-4 flex items-center gap-2">
                     <ClipboardCheck size={20} className="text-blue-500" /> Desglose para Cierre X
                  </h3>
                  <div className="space-y-3">
                     <div className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-3">
                        <span className="text-sm font-bold text-gray-600">Ventas abiertas</span>
                        <span className="font-black text-gray-900">{config.currencySymbol}{totalSales.toFixed(2)}</span>
                     </div>
                     <div className="flex items-center justify-between rounded-2xl bg-emerald-50 px-4 py-3">
                        <span className="text-sm font-bold text-emerald-700">Efectivo ventas</span>
                        <span className="font-black text-emerald-700">{config.currencySymbol}{cashSalesTotal.toFixed(2)}</span>
                     </div>
                     <div className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-3">
                        <span className="text-sm font-bold text-gray-600">Tarjetas</span>
                        <span className="font-black text-gray-900">{config.currencySymbol}{(totalsByMethod['CARD'] || 0).toFixed(2)}</span>
                     </div>
                     <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl bg-emerald-50 px-4 py-3">
                           <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Entradas</p>
                           <p className="mt-1 text-lg font-black text-emerald-700">{config.currencySymbol}{cashIn.toFixed(2)}</p>
                        </div>
                        <div className="rounded-2xl bg-red-50 px-4 py-3">
                           <p className="text-[10px] font-black uppercase tracking-widest text-red-500">Salidas</p>
                           <p className="mt-1 text-lg font-black text-red-700">{config.currencySymbol}{cashOut.toFixed(2)}</p>
                        </div>
                     </div>
                     <div className="flex items-center justify-between rounded-2xl bg-blue-600 px-4 py-3 text-white">
                        <span className="text-sm font-black uppercase tracking-wide">Efectivo esperado</span>
                        <span className="text-xl font-black">{config.currencySymbol}{expectedCashInDrawer.toFixed(2)}</span>
                     </div>
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
                        {cashMovements.slice().reverse().map((m, idx) => (
                           <div key={m.id || `move-${idx}`} className="flex justify-between items-center p-3 rounded-xl bg-gray-50 border border-gray-100 hover:bg-gray-100 transition-colors">
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
               {canViewXReport && (
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-blue-100">
                     <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-100">
                           <ClipboardCheck size={24} />
                        </div>
                        <div className="min-w-0 flex-1">
                           <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-500">Arqueo parcial</p>
                           <h3 className="mt-1 text-xl font-black text-gray-900">Cierre X</h3>
                           <p className="mt-1 text-xs font-bold text-gray-500">Emite resumen por medios de pago sin limpiar ventas ni movimientos.</p>
                        </div>
                     </div>

                     <button
                        onClick={() => void handleGenerateXReport()}
                        disabled={!canCloseXReport || isGeneratingXReport}
                        className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-4 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-blue-100 transition-all active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none"
                     >
                        <ClipboardCheck size={18} />
                        {isGeneratingXReport ? 'Generando X...' : 'Hacer Cierre X'}
                     </button>

                     {!canCloseXReport && (
                        <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-wide text-gray-400">
                           {!allowPartialXReport
                              ? 'Cierre X desactivado en esta terminal'
                              : hasCashierActivity
                                 ? 'Requiere permiso de cierre X'
                                 : 'Sin movimientos para este cajero'}
                        </p>
                     )}

                     {recentXReports.length > 0 && (
                        <div className="mt-4 rounded-2xl bg-gray-50 p-3">
                           <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Últimos X</p>
                           <div className="space-y-2">
                              {recentXReports.map(report => (
                                 <div key={report.id} className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-xs shadow-sm">
                                    <div className="min-w-0">
                                       <p className="font-black text-gray-800">{report.sequenceNumber}</p>
                                       <p className="font-bold text-gray-400">{new Date(report.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                    </div>
                                    {onPrintXReport && (
                                       <button
                                          type="button"
                                          onClick={() => onPrintXReport(report)}
                                          className="flex shrink-0 items-center gap-1 rounded-lg bg-blue-50 px-3 py-2 font-black uppercase tracking-wide text-blue-600 hover:bg-blue-100"
                                       >
                                          <Printer size={14} />
                                          Imprimir
                                       </button>
                                    )}
                                 </div>
                              ))}
                           </div>
                        </div>
                     )}
                  </div>
               )}

               {/* Control X: permiso + política ERP/POS (allowPartialXReport) */}
               {canViewXReport && (
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
                        {hasPermission('POS_VIEW_ACTIVE_CASH') && (
                           <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                              <p className="text-xs text-gray-400 uppercase font-bold mb-1">Efectivo Teórico</p>
                              <p className="text-2xl font-bold text-emerald-400">{config.currencySymbol}{expectedCashInDrawer.toFixed(2)}</p>
                           </div>
                        )}
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
                        <div className="flex justify-between items-center text-sm border-b border-white/10 pb-2">
                           <span className="flex items-center gap-2 text-gray-300"><CreditCard size={14} /> Crédito</span>
                           <span className="font-bold">{config.currencySymbol}{creditSalesTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                           <span className="flex items-center gap-2 text-gray-300"><Smartphone size={14} /> Digital / QR</span>
                           <span className="font-bold">{config.currencySymbol}{(totalsByMethod['QR'] || 0).toFixed(2)}</span>
                        </div>
                     </div>

                  </div>
               )}

               {/* Z-Report Action */}
               {canCloseZReport && (
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
               )}

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

         {showXCloseModal && (
            <XCloseModal
               currency={config.currencySymbol}
               currencyCode={baseCurrency?.code || 'DOP'}
               expectedCash={expectedCashInDrawer}
               forceDenominationCount={forceDenominationCount}
               onClose={() => setShowXCloseModal(false)}
               onConfirm={async (cashCounted, notes, reportData) => {
                  setIsGeneratingXReport(true);
                  try {
                     await onCloseXReport?.(cashCounted, notes, reportData);
                  } finally {
                     setIsGeneratingXReport(false);
                  }
               }}
            />
         )}

      </div>
   );
};

export default FinanceDashboard;
