
import React, { useState, useRef, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import {
   ArrowLeft, Receipt, CheckCircle, Banknote, Calendar,
   AlertTriangle, Lock, RefreshCw, Printer, Mail, Loader2
} from 'lucide-react';
import { Transaction, BusinessConfig, CashMovement, User, RoleDefinition, Collection, ZReport } from '../types';
import { sendZReportEmail } from '../utils/email';
import { db } from '../utils/db';
import ZReportHistory from './ZReportHistory';
import { calculateZReportStats } from '../utils/analytics';
import { buildServiceTypeReport, getOrderServiceTypeLabel } from '../utils/orderServiceType';
import {
   getPaymentAppliedBaseAmount,
   getPaymentChangeBaseAmount,
   getPaymentReceivedAmountForDrawer,
} from '../utils/paymentSettlement';
import { buildZReportPaymentMethodSummary } from '../utils/zReportPaymentSummary';
import AndroidNumericKeypadDialog from './AndroidNumericKeypadDialog';

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

type AndroidZKeypadTarget =
   | { kind: 'CASH'; currencyCode: string; title: string }
   | { kind: 'DENOMINATION'; currencyCode: string; denominationKey: string; title: string }
   | { kind: 'PAYMENT_METHOD'; methodKey: string; title: string };

const ZReportDashboard: React.FC<ZReportDashboardProps> = ({ transactions, cashMovements, config, userName, currentUser, roles, onClose, onConfirmClose, terminalId, collections }) => {
   const isAndroid = Capacitor.getPlatform() === 'android';
   const [cashCountedByCurrency, setCashCountedByCurrency] = useState<Record<string, string>>({});
   const [denominationCounts, setDenominationCounts] = useState<Record<string, Record<string, string>>>({});
   const [declaredPaymentMethods, setDeclaredPaymentMethods] = useState<Record<string, string>>({});
   const [selectedCashCurrency, setSelectedCashCurrency] = useState('');
   const [notes, setNotes] = useState('');
   const [replacementReport, setReplacementReport] = useState<ZReport | null>(null);
   const [replacementTransactions, setReplacementTransactions] = useState<Transaction[]>([]);
   const [androidKeypadTarget, setAndroidKeypadTarget] = useState<AndroidZKeypadTarget | null>(null);

   const androidKeypadValue = (() => {
      if (!androidKeypadTarget) return '';
      if (androidKeypadTarget.kind === 'CASH') return cashCountedByCurrency[androidKeypadTarget.currencyCode] || '';
      if (androidKeypadTarget.kind === 'DENOMINATION') {
         return denominationCounts[androidKeypadTarget.currencyCode]?.[androidKeypadTarget.denominationKey] || '';
      }
      return declaredPaymentMethods[androidKeypadTarget.methodKey] || '';
   })();

   const updateAndroidKeypadValue = (value: string) => {
      if (!androidKeypadTarget) return;
      if (androidKeypadTarget.kind === 'CASH') {
         setCashCountedByCurrency((previous) => ({ ...previous, [androidKeypadTarget.currencyCode]: value }));
         return;
      }
      if (androidKeypadTarget.kind === 'DENOMINATION') {
         setDenominationCounts((previous) => ({
            ...previous,
            [androidKeypadTarget.currencyCode]: {
               ...(previous[androidKeypadTarget.currencyCode] || {}),
               [androidKeypadTarget.denominationKey]: value.replace(/[^\d]/g, ''),
            },
         }));
         return;
      }
      setDeclaredPaymentMethods(previous => ({
         ...previous,
         [androidKeypadTarget.methodKey]: value,
      }));
   };

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
   const isBlindClose = Boolean(activeTerminalConfig?.workflow?.session?.blindClose);

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

      const hasAllConfiguredMethodsDeclared = paymentMethodsToDeclare.every(line => {
         const value = declaredPaymentMethods[getPaymentDeclarationKey(line)];
         return value !== undefined && value.trim() !== '' && Number.isFinite(Number(value));
      });
      if (!hasAllConfiguredMethodsDeclared) {
         alert('Declara el monto contado de cada forma de pago configurada antes de cerrar.');
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
            // App.tsx imprime el reporte definitivo solo después de persistirlo con
            // su secuencia, opciones y denominaciones. Nunca imprimir un borrador.
            await new Promise(r => setTimeout(r, 250));

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
               // Preserve the exact terminal settings shown in this modal. App.tsx
               // must not rediscover a different/stale terminal after the modal closes.
               autoPrintZReport: Boolean(activeTerminalConfig?.workflow?.session?.autoPrintZReport),
               preferredPrinterId:
                  activeTerminalConfig?.hardware?.printerAssignments?.TICKET ||
                  activeTerminalConfig?.hardware?.receiptPrinterId,
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
               declaredCardTotal: declaredTotalByType('CARD'),
               declaredOtherTotal: paymentMethodSummary
                  .filter(line => !['CASH', 'CARD'].includes(String(line.methodType)))
                  .reduce((sum, line) => sum + declaredAmountOrExpected(line), 0),
               expectedCardTotal,
               expectedOtherTotal,
               paymentMethodDeclarations: paymentMethodsToDeclare.map(line => {
                  const declared = Number(declaredPaymentMethods[getPaymentDeclarationKey(line)] || 0);
                  return {
                     ...line,
                     expected: line.amount,
                     declared,
                     difference: Math.round((declared - line.amount + Number.EPSILON) * 100) / 100,
                  };
               }),
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
   const visibleCashCurrency = currenciesRequiringCashCount.includes(selectedCashCurrency)
      ? selectedCashCurrency
      : currenciesRequiringCashCount[0];

   // Calculate discrepancies per currency
   const cashDiscrepancyByCurrency: Record<string, number> = {};
   Object.keys(expectedCashByCurrency).forEach(currency => {
      const counted = getDeclaredCashForCurrency(currency);
      const expected = expectedCashByCurrency[currency] || 0;
      cashDiscrepancyByCurrency[currency] = counted - expected;
   });

   // Legacy single-currency values (for base currency)
   const paymentMethodSummary = buildZReportPaymentMethodSummary(filteredTransactions, config);
   const paymentMethodSummaryTotal = paymentMethodSummary
      .reduce((sum, line) => sum + Number(line.amount || 0), 0);
   const cashSalesTotal = paymentMethodSummary
      .filter(line => line.methodType === 'CASH')
      .reduce((sum, line) => sum + line.amount, 0);
   const cashIn = cashInByCurrency[baseCurrencyCode] || 0;
   const cashOut = filteredCashMovements
      .filter(movement => movement.type === 'OUT' && (!movement.currencyCode || movement.currencyCode === baseCurrencyCode))
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
   const expectedCashInDrawer = expectedCashByCurrency[baseCurrencyCode] || 0;
   const cashDiscrepancy = cashDiscrepancyByCurrency[baseCurrencyCode] || 0;
   const cashToLeaveInDrawer = requireCashFundOnZ ? fixedCashFundAmount : 0;
   const cashToWithdraw = requireCashFundOnZ
      ? Math.max(0, getDeclaredCashForCurrency(baseCurrencyCode) - fixedCashFundAmount)
      : Math.max(0, getDeclaredCashForCurrency(baseCurrencyCode));
   const expectedCardTotal = paymentMethodSummary
      .filter(line => line.methodType === 'CARD')
      .reduce((sum, line) => sum + line.amount, 0);
   const expectedOtherTotal = paymentMethodSummary
      .filter(line => line.methodType !== 'CARD' && line.methodType !== 'CASH')
      .reduce((sum, line) => sum + line.amount, 0);
   const configuredDeclarationIds = activeTerminalConfig?.workflow?.session?.zReportDeclaredPaymentMethodIds || [];
   const paymentMethodsToDeclare = paymentMethodSummary.filter(line => (
      line.methodType !== 'CASH'
      && configuredDeclarationIds.some(id => id.toLowerCase() === String(line.methodId || '').toLowerCase())
   ));
   const getPaymentDeclarationKey = (line: typeof paymentMethodSummary[number]) => (
      line.methodId || `${line.methodType}:${line.name}`
   );
   const declaredAmountOrExpected = (line: typeof paymentMethodSummary[number]) => {
      const selected = paymentMethodsToDeclare.some(candidate => getPaymentDeclarationKey(candidate) === getPaymentDeclarationKey(line));
      if (!selected) return line.amount;
      return Number(declaredPaymentMethods[getPaymentDeclarationKey(line)] || 0);
   };
   const declaredTotalByType = (methodType: string) => paymentMethodSummary
      .filter(line => line.methodType === methodType)
      .reduce((sum, line) => sum + declaredAmountOrExpected(line), 0);

   // Calculate Stats for Preview
   const stats = calculateZReportStats(filteredTransactions, filteredCollections);
   const serviceTypeReport = buildServiceTypeReport(filteredTransactions);

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
         setDeclaredPaymentMethods({});
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

         <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y p-3 md:p-4 space-y-4 max-w-6xl mx-auto w-full">

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

               {/* KPI Summary Card */}
               {!isBlindClose && (
                  <div className="grid grid-cols-1 gap-6 md:col-span-2 lg:grid-cols-2">
                     <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                        <h3 className="font-bold text-gray-500 uppercase text-xs tracking-wider mb-4 flex items-center gap-2">
                           <CheckCircle size={14} /> Resumen
                        </h3>
                        <div className="space-y-3 text-sm">
                           <div className="flex items-center justify-between gap-4"><span className="text-gray-600">Ventas brutas</span><strong>{baseCurrency?.symbol}{stats.grossSales.toFixed(2)}</strong></div>
                           <div className="flex items-center justify-between gap-4"><span className="text-gray-600">Devoluciones</span><strong>{baseCurrency?.symbol}{stats.returnsTotal.toFixed(2)}</strong></div>
                           <div className="flex items-center justify-between gap-4 border-t border-gray-100 pt-3"><span className="font-black text-gray-800">Ventas netas</span><strong className="text-lg text-gray-900">{baseCurrency?.symbol}{stats.netSales.toFixed(2)}</strong></div>
                           <div className="flex items-center justify-between gap-4"><span className="text-gray-600">Transacciones</span><strong>{filteredTransactions.length}</strong></div>
                        </div>
                     </section>

                     <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                        <h3 className="font-bold text-gray-500 uppercase text-xs tracking-wider mb-4 flex items-center gap-2">
                           <Receipt size={14} /> Formas de pago
                        </h3>
                        <div className="space-y-3 text-sm">
                           {paymentMethodSummary.map(line => (
                              <div key={getPaymentDeclarationKey(line)} className="flex items-center justify-between gap-4">
                                 <span className="text-gray-600">{line.name}</span>
                                 <strong>{baseCurrency?.symbol}{line.amount.toFixed(2)}</strong>
                              </div>
                           ))}
                           <div className="flex items-center justify-between gap-4 border-t border-gray-100 pt-3">
                              <span className="font-black text-gray-800">Total formas de pago</span>
                              <strong className="text-lg text-gray-900">{baseCurrency?.symbol}{paymentMethodSummaryTotal.toFixed(2)}</strong>
                           </div>
                        </div>
                     </section>
                  </div>
               )}

               <div className="hidden bg-white p-6 rounded-3xl shadow-sm border border-gray-100 md:col-span-2">
                  <h3 className="font-bold text-gray-500 uppercase text-xs tracking-wider mb-4 flex items-center gap-2">
                     <Receipt size={14} /> Ventas por tipo de servicio
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                     {serviceTypeReport.summary.map((line) => (
                        <div key={line.serviceType} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                           <div className="flex items-center justify-between gap-3">
                              <p className="font-black text-slate-800">{getOrderServiceTypeLabel(line.serviceType)}</p>
                              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-500">{line.transactionCount}</span>
                           </div>
                           <p className="mt-3 text-xl font-black text-slate-900">{baseCurrency?.symbol}{line.total.toFixed(2)}</p>
                           <div className="mt-3 space-y-1 border-t border-slate-200 pt-2 text-xs font-bold text-slate-500">
                              <div className="flex justify-between"><span>Impuestos</span><span>{baseCurrency?.symbol}{line.taxAmount.toFixed(2)}</span></div>
                              <div className="flex justify-between"><span>Propina legal</span><span>{baseCurrency?.symbol}{line.serviceChargeAmount.toFixed(2)}</span></div>
                           </div>
                        </div>
                     ))}
                  </div>
               </div>

               {/* System Calculation - Only visible with POS_VIEW_ACTIVE_CASH permission */}
               {false && hasPermission('POS_VIEW_ACTIVE_CASH') && (
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
               <div className="order-2 bg-white p-4 rounded-3xl shadow-sm border border-gray-100">
                  <div className="mb-3 flex items-start justify-between gap-3">
                     <div>
                        <h3 className="font-bold text-gray-800 flex items-center gap-2">
                           <Banknote size={18} className="text-gray-400" /> Desglose de efectivo
                        </h3>
                        {useDenominationCount && (
                           <p className="mt-1 text-[11px] font-bold text-gray-400">
                              Digita las cantidades. El efectivo declarado se actualiza automáticamente.
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
                     <div className="space-y-3">
                        {currenciesRequiringCashCount.length > 1 && (
                           <div className="flex flex-wrap gap-2" aria-label="Moneda del desglose">
                              {currenciesRequiringCashCount.map(currencyCode => (
                                 <button
                                    key={currencyCode}
                                    type="button"
                                    onClick={() => setSelectedCashCurrency(currencyCode)}
                                    className={`rounded-full px-3 py-1.5 text-xs font-black transition-colors ${visibleCashCurrency === currencyCode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                                 >
                                    {currencyCode}
                                 </button>
                              ))}
                           </div>
                        )}
                        {currenciesRequiringCashCount.filter(currencyCode => currencyCode === visibleCashCurrency).map((currencyCode, index) => {
                           const currencyInfo = activeCurrencies.find(c => c.code === currencyCode) || baseCurrency;
                           const symbol = currencyInfo?.symbol || currencyCode;
                           const counted = cashCountedByCurrency[currencyCode] || '';
                           const discrepancy = cashDiscrepancyByCurrency[currencyCode] || 0;
                           const hasValue = hasDeclaredCashForCurrency(currencyCode);

                           return (
                              <div key={currencyCode} className="space-y-2 pb-4 border-b last:border-b-0 border-gray-100 last:pb-0">
                                 <div className="flex items-center gap-2 mb-2">
                                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                    <span className="font-black text-xs uppercase tracking-wider text-gray-700">{currencyCode}</span>
                                 </div>
                                 {useDenominationCount ? (
                                    <div>
                                       <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
                                          {getDenominationsForCurrency(currencyCode).map((denomination, denominationIndex) => {
                                             const denominationKey = String(denomination);
                                             const quantity = denominationCounts[currencyCode]?.[denominationKey] || '';
                                             const lineTotal = denomination * (Number(quantity) || 0);

                                             return (
                                                <label key={`${currencyCode}-${denominationKey}`} className="grid min-h-11 grid-cols-[64px_76px_1fr] items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-2 py-1">
                                                   <span className="text-sm font-black text-gray-800">
                                                      {formatDenomination(denomination)} ×
                                                   </span>
                                                   <input
                                                      autoFocus={!isAndroid && index === 0 && denominationIndex === 0}
                                                      type={isAndroid ? 'text' : 'number'}
                                                      inputMode={isAndroid ? 'none' : 'numeric'}
                                                      readOnly={isAndroid}
                                                      data-disable-native-soft-keyboard={isAndroid ? 'true' : undefined}
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
                                                      onClick={() => isAndroid && setAndroidKeypadTarget({
                                                         kind: 'DENOMINATION',
                                                         currencyCode,
                                                         denominationKey,
                                                         title: `${currencyCode} · ${formatDenomination(denomination)}`,
                                                      })}
                                                      placeholder="Cant."
                                                      className="w-full rounded-lg border-2 border-gray-200 bg-white px-2 py-1 text-center text-base font-black outline-none transition-colors focus:border-blue-500"
                                                   />
                                                   <span className="truncate text-right text-sm font-black text-blue-700">{symbol}{lineTotal.toFixed(2)}</span>
                                                </label>
                                             );
                                          })}
                                       </div>
                                    </div>
                                 ) : (
                                    <div className="relative">
                                       <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">{symbol}</span>
                                       <input
                                          autoFocus={!isAndroid && index === 0}
                                          type={isAndroid ? 'text' : 'number'}
                                          inputMode={isAndroid ? 'none' : 'decimal'}
                                          readOnly={isAndroid}
                                          data-disable-native-soft-keyboard={isAndroid ? 'true' : undefined}
                                          step="0.01"
                                          value={counted}
                                          onChange={(e) => setCashCountedByCurrency(prev => ({ ...prev, [currencyCode]: e.target.value }))}
                                          onClick={() => isAndroid && setAndroidKeypadTarget({ kind: 'CASH', currencyCode, title: `Efectivo contado · ${currencyCode}` })}
                                          placeholder="0.00"
                                          className="w-full pl-16 pr-4 py-3 text-2xl font-bold border-2 border-gray-200 rounded-2xl focus:border-blue-500 outline-none transition-colors"
                                       />
                                    </div>
                                 )}

                                 {/* Per-currency discrepancy */}
                                 {!isBlindClose && hasValue && !useDenominationCount && (
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

               <div className="order-1 bg-white p-4 rounded-3xl shadow-sm border border-gray-100">
                  <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                     <Receipt size={18} className="text-gray-400" /> Formas de pago a declarar
                  </h3>
                  {currenciesRequiringCashCount.length > 0 || paymentMethodsToDeclare.length > 0 ? (
                     <div className="space-y-3">
                        {currenciesRequiringCashCount.map(currencyCode => {
                           const currencyInfo = activeCurrencies.find(currency => currency.code === currencyCode) || baseCurrency;
                           const symbol = currencyInfo?.symbol || currencyCode;
                           const declaredCash = getDeclaredCashForCurrency(currencyCode);
                           const difference = cashDiscrepancyByCurrency[currencyCode] || 0;
                           const hasValue = hasDeclaredCashForCurrency(currencyCode);

                           return (
                              <button
                                 key={`cash-declared-${currencyCode}`}
                                 type="button"
                                 onClick={() => setSelectedCashCurrency(currencyCode)}
                                 className="w-full rounded-2xl border border-blue-100 bg-blue-50 p-3 text-left transition-colors hover:bg-blue-100"
                              >
                                 <div className="flex items-center justify-between gap-3">
                                    <div>
                                       <span className="block text-sm font-black text-gray-800">Efectivo · {currencyCode}</span>
                                       <span className="block text-[10px] font-bold text-blue-500">Calculado del desglose</span>
                                    </div>
                                    <strong className="text-xl text-blue-700" aria-live="polite">{symbol}{declaredCash.toFixed(2)}</strong>
                                 </div>
                                 {!isBlindClose && (
                                    <div className="mt-2 flex items-center justify-between border-t border-blue-100 pt-2 text-[11px]">
                                       <span className="text-gray-500">Esperado: {symbol}{(expectedCashByCurrency[currencyCode] || 0).toFixed(2)}</span>
                                       {hasValue && (
                                          <span className={Math.abs(difference) <= 0.01 ? 'font-bold text-emerald-600' : 'font-bold text-red-600'}>
                                             Diferencia: {difference > 0 ? '+' : ''}{symbol}{difference.toFixed(2)}
                                          </span>
                                       )}
                                    </div>
                                 )}
                              </button>
                           );
                        })}
                        {paymentMethodsToDeclare.map(line => {
                           const methodKey = getPaymentDeclarationKey(line);
                           const declaredValue = declaredPaymentMethods[methodKey] || '';
                           const declared = Number(declaredValue || 0);
                           const difference = Math.round((declared - line.amount + Number.EPSILON) * 100) / 100;
                           return (
                              <label key={methodKey} className="block space-y-1.5">
                                 <span className="text-sm font-semibold text-gray-600">{line.name}</span>
                                 <div className="relative">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">{baseCurrency?.symbol || baseCurrencyCode}</span>
                                    <input
                                       type={isAndroid ? 'text' : 'number'}
                                       inputMode={isAndroid ? 'none' : 'decimal'}
                                       readOnly={isAndroid}
                                       data-disable-native-soft-keyboard={isAndroid ? 'true' : undefined}
                                       step="0.01"
                                       value={declaredValue}
                                       onChange={(event) => setDeclaredPaymentMethods(previous => ({ ...previous, [methodKey]: event.target.value }))}
                                       onClick={() => isAndroid && setAndroidKeypadTarget({ kind: 'PAYMENT_METHOD', methodKey, title: `${line.name} declarado` })}
                                       placeholder="0.00"
                                       className="w-full pl-16 pr-4 py-2.5 text-lg font-bold border-2 border-gray-200 rounded-2xl focus:border-blue-500 outline-none transition-colors"
                                    />
                                 </div>
                                 {!isBlindClose && (
                                    <div className="flex items-center justify-between text-xs">
                                       <span className="text-gray-400">Esperado: {(baseCurrency?.symbol || baseCurrencyCode)}{line.amount.toFixed(2)}</span>
                                       {declaredValue !== '' && (
                                          <span className={Math.abs(difference) <= 0.01 ? 'font-bold text-emerald-600' : 'font-bold text-red-600'}>
                                             Diferencia: {difference > 0 ? '+' : ''}{baseCurrency?.symbol || baseCurrencyCode}{difference.toFixed(2)}
                                          </span>
                                       )}
                                    </div>
                                 )}
                              </label>
                           );
                        })}
                     </div>
                  ) : (
                     <p className="text-sm text-gray-400 text-center py-4">
                        No hay efectivo ni otras formas configuradas para declarar en este cierre.
                     </p>
                  )}
               </div>
            </div>

            {/* Automations Preview */}
            <div className="hidden bg-blue-50 p-6 rounded-3xl border border-blue-100 space-y-4">
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
            <div className="hidden bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
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
               disabled={
                  (currenciesRequiringCashCount.length > 0 && !currenciesRequiringCashCount.every(currencyCode => hasDeclaredCashForCurrency(currencyCode)))
                  || paymentMethodsToDeclare.some(line => !String(declaredPaymentMethods[getPaymentDeclarationKey(line)] || '').trim())
               }
               colorClass={config.themeColor === 'orange' ? 'bg-orange-500' : 'bg-blue-500'}
               onComplete={handleStartClosing}
            />
            <p className="text-xs text-gray-400 mt-4 text-center">Responsable: <strong>{userName}</strong></p>
         </div>

         {isAndroid && androidKeypadTarget && (
            <AndroidNumericKeypadDialog
               title={androidKeypadTarget.title}
               value={androidKeypadValue}
               onChange={updateAndroidKeypadValue}
               onClose={() => setAndroidKeypadTarget(null)}
               allowDecimal={androidKeypadTarget.kind !== 'DENOMINATION'}
            />
         )}

      </div>
   );
};

export default ZReportDashboard;
