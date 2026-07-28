
import React, { useState, useRef, useEffect } from 'react';
import {
   ArrowLeft, Receipt, CheckCircle, Banknote, Calendar,
   AlertTriangle, Lock, RefreshCw, Printer, Mail, Loader2
} from 'lucide-react';
import { Transaction, BusinessConfig, CashMovement, User, RoleDefinition, Collection, ZReport } from '../types';
import { sendZReportEmail } from '../utils/email';
import { db } from '../utils/db';
import ZReportHistory from './ZReportHistory';
import { calculateZReportStats } from '../utils/analytics';
import { ThermalPrinterService } from '../services/printer/ThermalPrinterService';
import {
   getPaymentAppliedBaseAmount,
   getPaymentChangeBaseAmount,
   getPaymentReceivedAmountForDrawer,
} from '../utils/paymentSettlement';

interface ZReportDashboardProps {
   transactions: Transaction[];
   cashMovements: CashMovement[];
   config: BusinessConfig;
   userName: string;
   currentUser: User | null;
   roles: RoleDefinition[];
   onClose: () => void;
   onConfirmClose: (cashCounted: number, notes: string, reportData?: any) => Promise<void> | void;
   terminalId?: string;
   collections: Collection[];
}

// --- HELPER: Slide To Action Button ---
const SlideButton: React.FC<{ onComplete: () => void; label: string; colorClass: string; disabled?: boolean }> = ({ onComplete, label, colorClass, disabled = false }) => {
   const [dragX, setDragX] = useState(0);
   const [isDragging, setIsDragging] = useState(false);
   const containerRef = useRef<HTMLDivElement>(null);
   const maxDrag = 250;

   const handlePointerMove = (e: React.PointerEvent) => {
      if (!isDragging || disabled) return;
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
         className={`relative w-full max-w-sm h-16 bg-gray-100 rounded-full overflow-hidden select-none touch-none shadow-inner border border-gray-200 ${disabled ? 'opacity-50 grayscale pointer-events-none' : ''}`}
         onPointerUp={reset}
         onPointerLeave={reset}
         onPointerMove={handlePointerMove}
      >
         <div className="absolute inset-0 flex items-center justify-center text-gray-400 font-bold uppercase tracking-widest text-sm pointer-events-none transition-opacity" style={{ opacity: 1 - (dragX / maxDrag) }}>
            {label}
         </div>
         <div className={`absolute left-0 top-0 bottom-0 ${colorClass} opacity-20`} style={{ width: dragX + 30 }}></div>
         <div
            onPointerDown={() => !disabled && setIsDragging(true)}
            className={`absolute top-1 bottom-1 w-14 rounded-full shadow-lg cursor-grab active:cursor-grabbing flex items-center justify-center transition-transform bg-white ${isDragging ? 'scale-105' : 'scale-100'}`}
            style={{ left: dragX, transform: `translateX(0)` }}
         >
            <Lock className="text-gray-600" size={24} />
         </div>
      </div>
   );
};

const DENOMINATIONS_BY_CURRENCY: Record<string, number[]> = {
   DOP: [2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1],
   USD: [100, 50, 20, 10, 5, 2, 1, 0.25, 0.1, 0.05, 0.01],
   EUR: [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01],
};

const getDenominationsForCurrency = (currencyCode: string) =>
   DENOMINATIONS_BY_CURRENCY[currencyCode] || [1000, 500, 200, 100, 50, 20, 10, 5, 1];

const formatDenomination = (value: number) => (
   Number.isInteger(value) ? value.toString() : value.toFixed(2)
);

const ZReportDashboard: React.FC<ZReportDashboardProps> = ({ transactions, cashMovements, config, userName, currentUser, roles, onClose, onConfirmClose, terminalId, collections }) => {
   const [cashCountedByCurrency, setCashCountedByCurrency] = useState<Record<string, string>>({});
   const [denominationCounts, setDenominationCounts] = useState<Record<string, Record<string, string>>>({});
   const [declaredCard, setDeclaredCard] = useState('');
   const [declaredOther, setDeclaredOther] = useState('');
   const [notes, setNotes] = useState('');
   const [replacementReport, setReplacementReport] = useState<ZReport | null>(null);
   const [replacementTransactions, setReplacementTransactions] = useState<Transaction[]>([]);

   // Closing workflow states
   const [isProcessing, setIsProcessing] = useState(false);
   const [showHistory, setShowHistory] = useState(false);
   const [currentStep, setCurrentStep] = useState<number>(0);
   const steps = [
      { label: 'Generando Reporte Z...', icon: Loader2 },
      { label: 'Enviando a Impresora...', icon: Printer },
      { label: 'Enviando Notificaciones...', icon: Mail },
      { label: 'Cierre Finalizado', icon: CheckCircle },
   ];

   // Permission checker
   const hasPermission = (permission: string): boolean => {
      if (!currentUser) return false;
      const userRole = roles.find(r => r.id === (currentUser.roleId || currentUser.role));
      if (!userRole) return false;
      if (userRole.permissions.includes('ALL')) return true;
      return userRole.permissions.includes(permission as any);
   };

   // Identificar terminal activa
   const activeTerminal = config.terminals?.find(t => t.id === terminalId) || config.terminals?.[0];
   const activeTerminalConfig = activeTerminal?.config;
   const currentTerminalId = activeTerminal?.id || 'T1';
   const useDenominationCount = Boolean(activeTerminalConfig?.workflow?.session?.forceDenominationCount);

   const getDeclaredCashForCurrency = (currencyCode: string): number => {
      if (!useDenominationCount) {
         return parseFloat(cashCountedByCurrency[currencyCode]) || 0;
      }

      const counts = denominationCounts[currencyCode] || {};
      return getDenominationsForCurrency(currencyCode).reduce((sum, denomination) => {
         const quantity = parseFloat(counts[String(denomination)] || '0');
         return sum + (Number.isFinite(quantity) ? quantity * denomination : 0);
      }, 0);
   };

   const hasDeclaredCashForCurrency = (currencyCode: string): boolean => {
      if (!useDenominationCount) {
         const value = cashCountedByCurrency[currencyCode];
         return value !== undefined && value !== '' && parseFloat(value) >= 0;
      }

      const counts = denominationCounts[currencyCode] || {};
      return Object.values(counts).some(value => value !== '' && Number(value) >= 0);
   };

   const buildDenominationBreakdown = () => {
      if (!useDenominationCount) return undefined;

      return currenciesRequiringCashCount.reduce<Record<string, { denomination: number; quantity: number; total: number }[]>>((acc, currencyCode) => {
         const counts = denominationCounts[currencyCode] || {};
         const lines = getDenominationsForCurrency(currencyCode)
            .map(denomination => {
               const quantity = Number(counts[String(denomination)] || 0);
               return {
                  denomination,
                  quantity: Number.isFinite(quantity) ? quantity : 0,
                  total: Number.isFinite(quantity) ? denomination * quantity : 0,
               };
            })
            .filter(line => line.quantity > 0);

         acc[currencyCode] = lines;
         return acc;
      }, {});
   };

   const buildCashCountedData = () => {
      const data: Record<string, number> = {};
      currenciesRequiringCashCount.forEach((currencyCode) => {
         data[currencyCode] = getDeclaredCashForCurrency(currencyCode);
      });
      return data;
   };

   // FILTER: Solo data pendiente de esta terminal.
   const normalizeTerminalId = (value?: string | null) => (value || '').trim().toLowerCase();
   const terminalKey = normalizeTerminalId(currentTerminalId);
   const isDefaultTerminal = terminalKey === 't1';
   const matchesCurrentTerminal = (value?: string | null) => normalizeTerminalId(value) === terminalKey;

   const transactionSource = replacementReport
      ? [
         ...transactions,
         ...replacementTransactions.filter(replacementTx =>
            !transactions.some(activeTx => activeTx.id === replacementTx.id)
         )
      ]
      : transactions;

   const filteredTransactions = transactionSource.filter(t =>
      (matchesCurrentTerminal(t.terminalId) || (!t.terminalId && isDefaultTerminal)) &&
      (!t.zReportId || t.zReportId === replacementReport?.id)
   );
   const filteredCashMovements = cashMovements.filter(m =>
      matchesCurrentTerminal(m.terminalId) || (!m.terminalId && isDefaultTerminal)
   );
   const filteredCollections = collections.filter(c =>
      matchesCurrentTerminal(c.terminalId) || (!c.terminalId && isDefaultTerminal)
   );
   const cashMovementDetails = filteredCashMovements.map(movement => ({
      id: movement.id,
      type: movement.type,
      amount: Number(movement.amount || 0),
      reason: movement.reason || 'Movimiento General',
      timestamp: movement.timestamp,
      userName: movement.userName,
      currencyCode: movement.currencyCode,
   }));

   const handleStartClosing = () => {
      const hasCashToCount = currenciesRequiringCashCount.length > 0;
      const hasAllCashCounted = currenciesRequiringCashCount.every(currencyCode => hasDeclaredCashForCurrency(currencyCode));

      if (hasCashToCount && !hasAllCashCounted) {
         alert("Por favor, ingresa el conteo físico de cada moneda antes de cerrar.");
         return;
      }

      if (requireCashFundOnZ && fixedCashFundAmount > 0) {
         const declaredBaseCash = getDeclaredCashForCurrency(baseCurrencyCode);
         if (declaredBaseCash < fixedCashFundAmount) {
            alert(`El conteo físico debe cubrir el fondo fijo de caja: ${baseCurrency?.symbol || baseCurrencyCode}${fixedCashFundAmount.toFixed(2)}.`);
            return;
         }
      }

      setIsProcessing(true);

      // Workflow Simulation
      const sequence = async () => {
         try {
            // Step 0: Generando
            setCurrentStep(0);
            await new Promise(r => setTimeout(r, 1500));

            // Step 1: Impresión
            setCurrentStep(1);
            if (activeTerminalConfig?.workflow?.session?.autoPrintZReport) {
               const previewCashCountedData = buildCashCountedData();
               // Construct temporary report object for printing
               const tempReport: any = {
                  sequenceNumber: 'PRE-CLOSE', // Will be updated on save, but good for preview
                  closedAt: new Date().toISOString(),
                  closedByUserName: userName,
                  terminalId: activeTerminal?.id || 'POS-01',
                  baseCurrency: baseCurrencyCode,
                  totalsByMethod: {}, // Calculated below
                  cashExpected: expectedCashByCurrency,
                  cashCounted: previewCashCountedData,
                  cashDiscrepancy: cashDiscrepancyByCurrency,
                  cashMovementDetails,
                  denominationBreakdown: buildDenominationBreakdown(),
                  transactionCount: filteredTransactions.length,
                  stats: calculateZReportStats(filteredTransactions, filteredCollections)
               };

               // Calculate totals by method
               const totalsByMethod: Record<string, number> = {};
               filteredTransactions.forEach(t => {
                  (t?.payments || []).forEach(p => {
                     if (p && p.method) {
                        totalsByMethod[p.method] = (totalsByMethod[p.method] || 0) + getPaymentAppliedBaseAmount(p);
                     }
                  });
               });
               tempReport.totalsByMethod = totalsByMethod;

               // Get hidden modules from current user role
               const userRole = roles.find(r => r.id === (currentUser?.roleId || currentUser?.role));
               const hiddenModules = userRole?.zReportConfig?.hiddenModules || [];

               try {
                  await Promise.race([
                     ThermalPrinterService.printZReport(tempReport, hiddenModules, config),
                     new Promise((_, reject) => setTimeout(() => reject(new Error('PRINT_TIMEOUT')), 12000))
                  ]);
               } catch (printError) {
                  console.warn('⚠️ Z-Report print step failed or timed out, continuing closure:', printError);
               }
            }
            await new Promise(r => setTimeout(r, 1000));

            // Convert declared cash to numbers. In denomination mode, totals are derived from bills/coins.
            const cashCountedData = buildCashCountedData();

            // Calculate final stats and totals once to ensure consistency
            const finalTotalsByMethod: Record<string, number> = {};
            filteredTransactions.forEach(t => {
               (t?.payments || []).forEach(p => {
                  if (p && p.method) {
                     finalTotalsByMethod[p.method] = (finalTotalsByMethod[p.method] || 0) + getPaymentAppliedBaseAmount(p);
                  }
               });
            });
            const finalStats = calculateZReportStats(filteredTransactions, filteredCollections);
            const finalTxCount = filteredTransactions.length;

            // Step 2: Emails
            setCurrentStep(2);
            // El email se envia en App.tsx despues de guardar el Z real, con secuencia definitiva.
            await new Promise(r => setTimeout(r, 1000));

            // Step 3: Finalizar
            setCurrentStep(3);
            await new Promise(r => setTimeout(r, 1000));

            // Pass base currency cash counted for backwards compatibility, plus full report data
            const reportData = {
               terminalId: currentTerminalId,
               replaceReportId: replacementReport?.id,
               replaceSequenceNumber: replacementReport?.sequenceNumber,
               transactionIds: filteredTransactions.map(t => t.id),
               cashMovementIds: filteredCashMovements.map(m => m.id),
               cashMovementDetails,
               cashCountedByCurrency: cashCountedData,
               expectedCashByCurrency,
               cashDiscrepancyByCurrency,
               cashSalesTotal,
               cashIn,
               cashOut,
               expectedCash: expectedCashInDrawer,
               requireCashFundOnZ,
               fixedCashFundAmount,
               cashToLeaveInDrawer,
               cashToWithdraw,
               declaredCardTotal: parseFloat(declaredCard) || 0,
               declaredOtherTotal: parseFloat(declaredOther) || 0,
               expectedCardTotal,
               expectedOtherTotal,
               totalsByMethod: finalTotalsByMethod,
               denominationBreakdown: buildDenominationBreakdown(),
               stats: finalStats,
               transactionCount: finalTxCount,
               collectionIds: filteredCollections.map(c => c.id)
            };

            Promise.resolve(onConfirmClose(getDeclaredCashForCurrency(baseCurrencyCode), notes, reportData))
               .catch((closeError) => {
                  // Non-blocking by design: App.tsx also handles/report errors.
                  console.error('❌ onConfirmClose background error:', closeError);
               });

            setIsProcessing(false);
            onClose();
         } catch (error) {
            console.error('❌ Z-Report closing workflow failed:', error);
            setIsProcessing(false);
            onClose();
            setTimeout(() => {
               alert('El cierre tardó más de lo esperado. Se regresó al POS y el proceso seguirá en segundo plano.');
            }, 50);
         }
      };

      sequence();
   };

   // --- MULTI-CURRENCY SETUP ---
   const activeCurrencies = config.currencies?.filter(c => c.isEnabled) || [];
   const baseCurrency = config.currencies?.find(c => c.isBase) || activeCurrencies[0];
   const baseCurrencyCode = baseCurrency?.code || 'DOP';
   const requireCashFundOnZ = Boolean(activeTerminalConfig?.workflow?.session?.requireCashFundOnZ);
   const fixedCashFundAmount = Math.max(0, Number(activeTerminalConfig?.workflow?.session?.fixedCashFundAmount || 0));

   // --- STATS CALCS (MULTI-CURRENCY) ---
   const payments = filteredTransactions.flatMap(t => t?.payments || []).filter(Boolean);

   // Group cash sales by currency
   const cashSalesByCurrency: Record<string, number> = {};
   payments.forEach(p => {
      if (p.method === 'CASH') {
         const currency = (p as any).currencyCode || baseCurrencyCode;
         cashSalesByCurrency[currency] = (cashSalesByCurrency[currency] || 0) + getPaymentReceivedAmountForDrawer(p, baseCurrencyCode);
      }
   });

   // Group cash movements by currency
   const cashInByCurrency: Record<string, number> = {};
   const cashOutByCurrency: Record<string, number> = {};
   filteredCashMovements.forEach(m => {
      const currency = m.currencyCode || baseCurrencyCode;
      if (m.type === 'IN') {
         cashInByCurrency[currency] = (cashInByCurrency[currency] || 0) + m.amount;
      } else {
         cashOutByCurrency[currency] = (cashOutByCurrency[currency] || 0) + m.amount;
      }
   });

   payments.forEach(p => {
      if (p.method !== 'CASH') return;
      const changeBase = getPaymentChangeBaseAmount(p);
      if (changeBase <= 0.0001) return;
      cashOutByCurrency[baseCurrencyCode] = (cashOutByCurrency[baseCurrencyCode] || 0) + changeBase;
   });

   // Calculate expected cash per currency
   const expectedCashByCurrency: Record<string, number> = {};
   const allCurrenciesInUse = new Set([
      ...Object.keys(cashSalesByCurrency),
      ...Object.keys(cashInByCurrency),
      ...Object.keys(cashOutByCurrency)
   ]);

   allCurrenciesInUse.forEach(currency => {
      const sales = cashSalesByCurrency[currency] || 0;
      const cashIn = cashInByCurrency[currency] || 0;
      const cashOut = cashOutByCurrency[currency] || 0;
      expectedCashByCurrency[currency] = sales + cashIn - cashOut;
   });

   const currenciesRequiringCashCount = Array.from(allCurrenciesInUse).filter(currency => {
      const expected = expectedCashByCurrency[currency] || 0;
      return Math.abs(expected) > 0.0001 || (requireCashFundOnZ && fixedCashFundAmount > 0 && currency === baseCurrencyCode);
   });

   // Calculate discrepancies per currency
   const cashDiscrepancyByCurrency: Record<string, number> = {};
   Object.keys(expectedCashByCurrency).forEach(currency => {
      const counted = getDeclaredCashForCurrency(currency);
      const expected = expectedCashByCurrency[currency] || 0;
      cashDiscrepancyByCurrency[currency] = counted - expected;
   });

   // Legacy single-currency values (for base currency)
   const cashSalesTotal = cashSalesByCurrency[baseCurrencyCode] || 0;
   const cashIn = cashInByCurrency[baseCurrencyCode] || 0;
   const cashOut = cashOutByCurrency[baseCurrencyCode] || 0;
   const expectedCashInDrawer = expectedCashByCurrency[baseCurrencyCode] || 0;
   const cashDiscrepancy = cashDiscrepancyByCurrency[baseCurrencyCode] || 0;
   const cashToLeaveInDrawer = requireCashFundOnZ ? fixedCashFundAmount : 0;
   const cashToWithdraw = requireCashFundOnZ
      ? Math.max(0, getDeclaredCashForCurrency(baseCurrencyCode) - fixedCashFundAmount)
      : Math.max(0, getDeclaredCashForCurrency(baseCurrencyCode));
   const expectedCardTotal = payments
      .filter(p => p.method === 'CARD')
      .reduce((sum, p) => sum + getPaymentAppliedBaseAmount(p), 0);
   const expectedOtherTotal = payments
      .filter(p => p.method !== 'CARD' && p.method !== 'CASH')
      .reduce((sum, p) => sum + getPaymentAppliedBaseAmount(p), 0);

   // Calculate Stats for Preview
   const stats = calculateZReportStats(filteredTransactions, filteredCollections);

   useEffect(() => {
      setDeclaredCard(prev => (prev === '' ? expectedCardTotal.toFixed(2) : prev));
   }, [expectedCardTotal]);

   useEffect(() => {
      setDeclaredOther(prev => (prev === '' ? expectedOtherTotal.toFixed(2) : prev));
   }, [expectedOtherTotal]);


   const handleRepeatReportFromHistory = async (report: ZReport) => {
      try {
         const archived = await (db.get('transactionHistory') as Promise<Transaction[]>);
         setReplacementReport(report);
         setReplacementTransactions((Array.isArray(archived) ? archived : []).filter(tx =>
            tx.zReportId === report.id ||
            (tx as any).zReportSequence === report.sequenceNumber
         ));
         setCashCountedByCurrency({});
         setDenominationCounts({});
         setDeclaredCard('');
         setDeclaredOther('');
         setNotes(`Repetición/Reemplazo de ${report.sequenceNumber}`);
         setShowHistory(false);
      } catch (error) {
         console.error('❌ No se pudo preparar repetición de Z:', error);
         alert('No se pudo cargar el detalle del Z para repetirlo.');
      }
   };

   if (showHistory) {
      return <ZReportHistory config={config} currentUser={currentUser} roles={roles} activeTerminalId={currentTerminalId} onRepeatReport={handleRepeatReportFromHistory} onClose={() => setShowHistory(false)} />;
   }

   return (
      <div className="fixed inset-0 z-[120] bg-gray-50 flex flex-col min-h-0 overflow-hidden animate-in slide-in-from-bottom-5">

         {/* PROCESSING OVERLAY */}
         {isProcessing && (
            <div className="absolute inset-0 z-[130] bg-slate-900/95 backdrop-blur-md flex flex-col items-center justify-center text-white p-6 text-center animate-in fade-in">
               <div className="relative mb-12">
                  <div className="w-24 h-24 rounded-full border-4 border-white/10 flex items-center justify-center">
                     {currentStep < 3 ? (
                        <Loader2 size={48} className="animate-spin text-blue-400" />
                     ) : (
                        <CheckCircle size={48} className="text-emerald-400" />
                     )}
                  </div>
                  {currentStep < 3 && (
                     <div className="absolute inset-0 w-24 h-24 rounded-full border-t-4 border-blue-500 animate-spin"></div>
                  )}
               </div>

               <div className="space-y-4">
                  <h3 className="text-3xl font-black tracking-tight">{steps[currentStep].label}</h3>
                  <div className="flex justify-center gap-3">
                     {steps.map((_, i) => (
                        <div
                           key={`step-${i}`}
                           className={`h-1.5 w-8 rounded-full transition-all duration-500 ${i === currentStep ? 'bg-blue-500 w-16' : (i < currentStep ? 'bg-emerald-500' : 'bg-white/10')}`}
                        />
                     ))}
                  </div>
               </div>

               <div className="mt-20 max-w-xs w-full bg-white/5 p-6 rounded-[2rem] border border-white/10">
                  {currentStep === 1 && (
                     <div className="animate-in slide-in-from-bottom-2">
                        <Printer className="mx-auto mb-3 text-blue-400" size={32} />
                        <p className="text-xs font-bold uppercase tracking-widest opacity-60">Impresora Asignada</p>
                        <p className="text-sm font-bold mt-1">{activeTerminalConfig?.hardware.receiptPrinterId || 'Defecto Sistema'}</p>
                     </div>
                  )}
                  {currentStep === 2 && (
                     <div className="animate-in slide-in-from-bottom-2">
                        <Mail className="mx-auto mb-3 text-indigo-400" size={32} />
                        <p className="text-xs font-bold uppercase tracking-widest opacity-60">Enviando a</p>
                        <p className="text-sm font-bold mt-1 truncate">{activeTerminalConfig?.workflow.session.zReportEmails || 'No configurado'}</p>
                     </div>
                  )}
               </div>
            </div>
         )}

         <div className="relative shrink-0 bg-white pt-6 pb-6 px-6 shadow-sm border-b border-gray-200">
            <div className="flex justify-between items-center mb-2">
               <div className="flex items-center gap-4">
                  <button onClick={onClose} className="p-2 -ml-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500">
                     <ArrowLeft size={24} />
                  </button>
                  <h1 className="text-2xl font-black text-gray-900 tracking-tight">Cierre de Caja (Z)</h1>
               </div>
               <div className="flex items-center gap-4">
                  <button
                     onClick={() => setShowHistory(true)}
                     className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-bold hover:bg-blue-100 transition-colors flex items-center gap-2"
                  >
                     <Calendar size={16} /> Historial
                  </button>
                  <div className="text-right">
                     <div className="flex items-center justify-end gap-2 text-sm text-gray-500">
                        <Calendar size={14} />
                        {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                     </div>
                  </div>
               </div>
            </div>
         </div>

         <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y p-4 md:p-6 space-y-6 max-w-6xl mx-auto w-full">

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

               {/* KPI Summary Card */}
               <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 md:col-span-2">
                  <h3 className="font-bold text-gray-500 uppercase text-xs tracking-wider mb-4 flex items-center gap-2">
                     <CheckCircle size={14} /> Resumen del Día
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                     <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <p className="text-[10px] text-gray-400 uppercase font-bold mb-1 tracking-wider">Ticket Promedio</p>
                        <p className="text-lg font-black text-gray-800">{baseCurrency?.symbol}{stats.averageTicket.toFixed(2)}</p>
                     </div>
                     <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <p className="text-[10px] text-gray-400 uppercase font-bold mb-1 tracking-wider">Items / Venta</p>
                        <p className="text-lg font-black text-gray-800">{stats.itemsPerSale.toFixed(1)}</p>
                     </div>
                     <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <p className="text-[10px] text-gray-400 uppercase font-bold mb-1 tracking-wider">Hora Pico</p>
                        <p className="text-lg font-black text-gray-800">{stats.peakHour}</p>
                     </div>
                     <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <p className="text-sm font-bold text-gray-800 truncate" title={stats.topProduct?.name || 'N/A'}>
                           {stats.topProduct?.name || 'N/A'}
                        </p>
                        <p className="text-[10px] text-gray-500">{stats.topProduct?.quantity || 0} unidades</p>
                     </div>
                     <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100/50">
                        <p className="text-[10px] text-blue-400 uppercase font-bold mb-1 tracking-wider">Anticipos / Gift Cards</p>
                        <p className="text-lg font-black text-blue-700">{baseCurrency?.symbol}{stats.advancementsTotal.toFixed(2)}</p>
                     </div>
                     <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100/50">
                        <p className="text-[10px] text-indigo-400 uppercase font-bold mb-1 tracking-wider">Cobros CxC (Recibos)</p>
                        <p className="text-lg font-black text-indigo-700">{baseCurrency?.symbol}{stats.collectionsTotal.toFixed(2)}</p>
                     </div>
                  </div>
               </div>

               {/* System Calculation - Only visible with POS_VIEW_ACTIVE_CASH permission */}
               {hasPermission('POS_VIEW_ACTIVE_CASH') && (
                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                     <h3 className="font-bold text-gray-500 uppercase text-xs tracking-wider mb-4">Balance Teórico (Sistema)</h3>

                     {currenciesRequiringCashCount.length > 0 ? (
                        <div className="space-y-6">
                           {currenciesRequiringCashCount.map((currencyCode) => {
                              const currencyInfo = activeCurrencies.find(c => c.code === currencyCode) || baseCurrency;
                              const symbol = currencyInfo?.symbol || currencyCode;
                              const sales = cashSalesByCurrency[currencyCode] || 0;
                              const cashInAmount = cashInByCurrency[currencyCode] || 0;
                              const cashOutAmount = cashOutByCurrency[currencyCode] || 0;
                              const expected = expectedCashByCurrency[currencyCode] || 0;

                              return (
                                 <div key={currencyCode} className="space-y-3 pb-4 border-b last:border-b-0 border-gray-100 last:pb-0">
                                    <div className="flex items-center gap-2 mb-2">
                                       <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                       <span className="font-black text-xs uppercase tracking-wider text-gray-700">{currencyCode}</span>
                                    </div>
                                    <div className="space-y-2 pl-4">
                                       <div className="flex justify-between items-center text-sm">
                                          <span className="text-gray-600">Ventas en Efectivo</span>
                                          <span className="font-bold text-gray-900">{symbol}{sales.toFixed(2)}</span>
                                       </div>
                                       <div className="flex justify-between items-center text-sm">
                                          <span className="text-emerald-600 font-medium">Total Entradas</span>
                                          <span className="font-bold text-emerald-600">+{symbol}{cashInAmount.toFixed(2)}</span>
                                       </div>
                                       <div className="flex justify-between items-center text-sm">
                                          <span className="text-red-600 font-medium">Total Salidas</span>
                                          <span className="font-bold text-red-600">-{symbol}{cashOutAmount.toFixed(2)}</span>
                                       </div>
                                       <div className="border-t border-dashed border-gray-200 pt-2 flex justify-between items-center">
                                          <span className="font-black text-gray-800 uppercase text-xs">Debe haber en caja</span>
                                          <span className="font-black text-xl text-blue-600">{symbol}{expected.toFixed(2)}</span>
                                       </div>
                                       {requireCashFundOnZ && currencyCode === baseCurrencyCode && (
                                          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                                             <div className="flex justify-between items-center text-sm">
                                                <span className="font-black text-amber-700 uppercase text-xs">Fondo fijo a dejar</span>
                                                <span className="font-black text-amber-700">{symbol}{fixedCashFundAmount.toFixed(2)}</span>
                                             </div>
                                             <div className="flex justify-between items-center text-sm">
                                                <span className="font-bold text-amber-700">Retirar / depositar estimado</span>
                                                <span className="font-black text-amber-900">{symbol}{cashToWithdraw.toFixed(2)}</span>
                                             </div>
                                          </div>
                                       )}
                                    </div>
                                 </div>
                              );
                           })}
                        </div>
                     ) : (
                        <p className="text-sm text-gray-400 text-center py-4">No hay movimientos de efectivo</p>
                     )}
                  </div>
               )}

               {/* Manual Count - Multi-Currency */}
               <div className={`bg-white ${useDenominationCount ? 'p-4' : 'p-6'} rounded-3xl shadow-sm border border-gray-100`}>
                  <div className="mb-4 flex items-start justify-between gap-3">
                     <div>
                        <h3 className="font-bold text-gray-800 flex items-center gap-2">
                           <Banknote size={18} className="text-gray-400" /> Conteo Físico
                        </h3>
                        {useDenominationCount && (
                           <p className="mt-1 text-[11px] font-bold text-gray-400">
                              Digita cantidades por billete/moneda. El total y el descuadre se calculan solos.
                           </p>
                        )}
                     </div>
                     {useDenominationCount && (
                        <span className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-blue-600">
                           Denominaciones
                        </span>
                     )}
                  </div>

                  {currenciesRequiringCashCount.length > 0 ? (
                     <div className="space-y-5">
                        {currenciesRequiringCashCount.map((currencyCode, index) => {
                           const currencyInfo = activeCurrencies.find(c => c.code === currencyCode) || baseCurrency;
                           const symbol = currencyInfo?.symbol || currencyCode;
                           const counted = cashCountedByCurrency[currencyCode] || '';
                           const denominationTotal = getDeclaredCashForCurrency(currencyCode);
                           const discrepancy = cashDiscrepancyByCurrency[currencyCode] || 0;
                           const hasValue = hasDeclaredCashForCurrency(currencyCode);

                           return (
                              <div key={currencyCode} className="space-y-2 pb-4 border-b last:border-b-0 border-gray-100 last:pb-0">
                                 <div className="flex items-center gap-2 mb-2">
                                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                    <span className="font-black text-xs uppercase tracking-wider text-gray-700">{currencyCode}</span>
                                 </div>
                                 {useDenominationCount ? (
                                    <div className="space-y-3">
                                       <div className="max-h-[42vh] overflow-y-auto rounded-2xl border border-gray-100 bg-gray-50">
                                          <div className="sticky top-0 z-10 grid grid-cols-[1fr_96px] gap-3 bg-gray-50 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-gray-400">
                                             <span>Denominación</span>
                                             <span className="text-right">Cantidad</span>
                                          </div>
                                          {getDenominationsForCurrency(currencyCode).map((denomination, denominationIndex) => {
                                             const denominationKey = String(denomination);
                                             const quantity = denominationCounts[currencyCode]?.[denominationKey] || '';

                                             return (
                                                <label key={`${currencyCode}-${denominationKey}`} className="grid grid-cols-[1fr_96px] items-center gap-3 border-t border-gray-100 bg-white px-3 py-1.5">
                                                   <span className="text-lg font-black text-gray-800">
                                                      {formatDenomination(denomination)}.
                                                   </span>
                                                   <input
                                                      autoFocus={index === 0 && denominationIndex === 0}
                                                      type="number"
                                                      inputMode="numeric"
                                                      min="0"
                                                      step="1"
                                                      value={quantity}
                                                      onChange={(e) => setDenominationCounts(prev => ({
                                                         ...prev,
                                                         [currencyCode]: {
                                                            ...(prev[currencyCode] || {}),
                                                            [denominationKey]: e.target.value.replace(/[^\d]/g, '')
                                                         }
                                                      }))}
                                                      placeholder="Cant."
                                                      className="w-full rounded-xl border-2 border-gray-200 px-3 py-1.5 text-right text-lg font-black outline-none transition-colors focus:border-blue-500"
                                                   />
                                                </label>
                                             );
                                          })}
                                       </div>
                                       <div className="grid grid-cols-2 gap-2">
                                          <div className="rounded-2xl bg-blue-50 border border-blue-100 px-4 py-3">
                                             <span className="block text-[10px] font-black uppercase tracking-wider text-blue-500">Total contado</span>
                                             <span className="text-xl font-black text-blue-700">{symbol}{denominationTotal.toFixed(2)}</span>
                                          </div>
                                          <div className={`rounded-2xl border px-4 py-3 ${!hasValue ? 'bg-gray-50 border-gray-100' : Math.abs(discrepancy) <= 0.01 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
                                             <span className={`block text-[10px] font-black uppercase tracking-wider ${!hasValue ? 'text-gray-400' : Math.abs(discrepancy) <= 0.01 ? 'text-emerald-600' : 'text-red-600'}`}>Diferencia</span>
                                             <span className={`text-xl font-black ${!hasValue ? 'text-gray-500' : Math.abs(discrepancy) <= 0.01 ? 'text-emerald-700' : 'text-red-700'}`}>{hasValue ? `${discrepancy > 0 ? '+' : ''}${symbol}${discrepancy.toFixed(2)}` : 'Pendiente'}</span>
                                          </div>
                                       </div>
                                    </div>
                                 ) : (
                                    <div className="relative">
                                       <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">{symbol}</span>
                                       <input
                                          autoFocus={index === 0}
                                          type="number"
                                          step="0.01"
                                          value={counted}
                                          onChange={(e) => setCashCountedByCurrency(prev => ({ ...prev, [currencyCode]: e.target.value }))}
                                          placeholder="0.00"
                                          className="w-full pl-16 pr-4 py-3 text-2xl font-bold border-2 border-gray-200 rounded-2xl focus:border-blue-500 outline-none transition-colors"
                                       />
                                    </div>
                                 )}

                                 {/* Per-currency discrepancy */}
                                 {hasValue && !useDenominationCount && (
                                    <div className={`mt-2 p-3 rounded-xl border flex items-center gap-2 ${discrepancy === 0 ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
                                       {discrepancy === 0 ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
                                       <div className="flex-1">
                                          <p className="font-bold text-xs uppercase">{discrepancy === 0 ? 'Cuadre Perfecto' : 'Descuadre'}</p>
                                          <p className="font-mono font-bold text-base">{discrepancy > 0 ? '+' : ''}{symbol}{discrepancy.toFixed(2)}</p>
                                       </div>
                                    </div>
                                 )}
                              </div>
                           );
                        })}
                        <p className="text-xs text-gray-400 mt-2">
                           {useDenominationCount
                              ? 'Ingresa la cantidad por denominación. El total se calcula automáticamente.'
                              : 'Ingresa el total de efectivo contado por cada moneda.'}
                        </p>
                     </div>
                  ) : (
                     <p className="text-sm text-gray-400 text-center py-4">No hay efectivo pendiente por contar. Puedes cerrar la caja directamente.</p>
                  )}
               </div>

               <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                  <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                     <Receipt size={18} className="text-gray-400" /> Declaración de medios no efectivos
                  </h3>
                  <div className="space-y-5">
                     <label className="block space-y-2">
                        <span className="text-sm font-semibold text-gray-600">Tarjeta / vouchers declarados</span>
                        <div className="relative">
                           <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">{baseCurrency?.symbol || baseCurrencyCode}</span>
                           <input
                              type="number"
                              step="0.01"
                              value={declaredCard}
                              onChange={(e) => setDeclaredCard(e.target.value)}
                              placeholder="0.00"
                              className="w-full pl-16 pr-4 py-3 text-xl font-bold border-2 border-gray-200 rounded-2xl focus:border-blue-500 outline-none transition-colors"
                           />
                        </div>
                        <p className="text-xs text-gray-400">Referencia del sistema: {(baseCurrency?.symbol || baseCurrencyCode)}{expectedCardTotal.toFixed(2)}</p>
                     </label>

                     <label className="block space-y-2">
                        <span className="text-sm font-semibold text-gray-600">Otros medios declarados</span>
                        <div className="relative">
                           <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">{baseCurrency?.symbol || baseCurrencyCode}</span>
                           <input
                              type="number"
                              step="0.01"
                              value={declaredOther}
                              onChange={(e) => setDeclaredOther(e.target.value)}
                              placeholder="0.00"
                              className="w-full pl-16 pr-4 py-3 text-xl font-bold border-2 border-gray-200 rounded-2xl focus:border-blue-500 outline-none transition-colors"
                           />
                        </div>
                        <p className="text-xs text-gray-400">Incluye transferencias, cheques u otros medios. Referencia del sistema: {(baseCurrency?.symbol || baseCurrencyCode)}{expectedOtherTotal.toFixed(2)}</p>
                     </label>
                  </div>
               </div>
            </div>

            {/* Automations Preview */}
            <div className="bg-blue-50 p-6 rounded-3xl border border-blue-100 space-y-4">
               <h3 className="text-sm font-black text-blue-900 uppercase tracking-widest flex items-center gap-2">
                  <RefreshCw size={16} /> Automatizaciones de Cierre
               </h3>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${activeTerminalConfig?.workflow.session.autoPrintZReport ? 'bg-white border-blue-200 text-blue-700' : 'bg-slate-100 border-transparent text-slate-400 opacity-60'}`}>
                     <Printer size={20} />
                     <div className="flex-1">
                        <p className="text-xs font-bold">Impresión Automática</p>
                        <p className="text-[10px] font-medium">{activeTerminalConfig?.workflow.session.autoPrintZReport ? `Habilitada: ${activeTerminalConfig.hardware.receiptPrinterId || 'Defecto'}` : 'Deshabilitada'}</p>
                     </div>
                     {activeTerminalConfig?.workflow.session.autoPrintZReport && <CheckCircle size={16} />}
                  </div>
                  <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${activeTerminalConfig?.workflow.session.zReportEmails ? 'bg-white border-blue-200 text-blue-700' : 'bg-slate-100 border-transparent text-slate-400 opacity-60'}`}>
                     <Mail size={20} />
                     <div className="flex-1">
                        <p className="text-xs font-bold">Notificación Email</p>
                        <p className="text-[10px] font-medium truncate max-w-[150px]">{activeTerminalConfig?.workflow.session.zReportEmails || 'No configurado'}</p>
                     </div>
                     {activeTerminalConfig?.workflow.session.zReportEmails && <CheckCircle size={16} />}
                  </div>
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
         <div className="shrink-0 p-6 bg-white border-t border-gray-200 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] flex flex-col items-center">
            <SlideButton
               label="Desliza para Cerrar Caja"
               disabled={currenciesRequiringCashCount.length > 0 && !currenciesRequiringCashCount.every(currencyCode => hasDeclaredCashForCurrency(currencyCode))}
               colorClass={config.themeColor === 'orange' ? 'bg-orange-500' : 'bg-blue-500'}
               onComplete={handleStartClosing}
            />
            <p className="text-xs text-gray-400 mt-4 text-center">Responsable: <strong>{userName}</strong></p>
         </div>

      </div>
   );
};

export default ZReportDashboard;
