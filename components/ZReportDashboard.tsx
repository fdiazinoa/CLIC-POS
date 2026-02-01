
import React, { useState, useRef, useEffect } from 'react';
import {
   ArrowLeft, Receipt, CheckCircle, Banknote, Calendar,
   AlertTriangle, Lock, RefreshCw, Printer, Mail, Loader2
} from 'lucide-react';
import { Transaction, BusinessConfig, CashMovement, User, RoleDefinition } from '../types';
import { sendZReportEmail } from '../utils/email';
import ZReportHistory from './ZReportHistory';
import { calculateZReportStats } from '../utils/analytics';
import { ThermalPrinterService } from '../services/printer/ThermalPrinterService';

interface ZReportDashboardProps {
   transactions: Transaction[];
   cashMovements: CashMovement[];
   config: BusinessConfig;
   userName: string;
   currentUser: User | null;
   roles: RoleDefinition[];
   onClose: () => void;
   onConfirmClose: (cashCounted: number, notes: string, reportData?: any) => void;
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

const ZReportDashboard: React.FC<ZReportDashboardProps> = ({ transactions, cashMovements, config, userName, currentUser, roles, onClose, onConfirmClose }) => {
   const [cashCountedByCurrency, setCashCountedByCurrency] = useState<Record<string, string>>({});
   const [notes, setNotes] = useState('');

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
      const userRole = roles.find(r => r.id === currentUser.role);
      if (!userRole) return false;
      if (userRole.permissions.includes('ALL')) return true;
      return userRole.permissions.includes(permission as any);
   };

   // Identificar terminal activa (asumimos la primera en este contexto POS local)
   const activeTerminal = config.terminals?.[0];
   const activeTerminalConfig = activeTerminal?.config;

   const handleStartClosing = () => {
      // Check if at least one currency amount is entered
      const hasAnyCashCounted = Object.values(cashCountedByCurrency).some(val => val && parseFloat(val) >= 0);
      if (!hasAnyCashCounted) {
         alert("Por favor, ingresa el conteo físico antes de cerrar.");
         return;
      }

      setIsProcessing(true);

      // Workflow Simulation
      const sequence = async () => {
         // Step 0: Generando
         setCurrentStep(0);
         await new Promise(r => setTimeout(r, 1500));

         // Step 1: Impresión
         setCurrentStep(1);
         if (activeTerminalConfig?.workflow?.session?.autoPrintZReport) {
            // Construct temporary report object for printing
            const tempReport: any = {
               sequenceNumber: 'PRE-CLOSE', // Will be updated on save, but good for preview
               closedAt: new Date().toISOString(),
               closedByUserName: userName,
               terminalId: activeTerminal?.id || 'POS-01',
               baseCurrency: baseCurrencyCode,
               totalsByMethod: {}, // Calculated below
               cashExpected: expectedCashByCurrency,
               cashCounted: cashCountedByCurrency,
               cashDiscrepancy: cashDiscrepancyByCurrency,
               transactionCount: transactions.length,
               stats: calculateZReportStats(transactions)
            };

            // Calculate totals by method
            const totalsByMethod: Record<string, number> = {};
            transactions.forEach(t => {
               (t?.payments || []).forEach(p => {
                  if (p && p.method) {
                     totalsByMethod[p.method] = (totalsByMethod[p.method] || 0) + p.amount;
                  }
               });
            });
            tempReport.totalsByMethod = totalsByMethod;

            // Convert cash counted strings to numbers
            const cashCountedNums: Record<string, number> = {};
            Object.entries(cashCountedByCurrency).forEach(([k, v]) => cashCountedNums[k] = parseFloat(v) || 0);
            tempReport.cashCounted = cashCountedNums;

            // Get hidden modules from current user role
            const userRole = roles.find(r => r.id === currentUser?.role);
            const hiddenModules = userRole?.zReportConfig?.hiddenModules || [];

            await ThermalPrinterService.printZReport(tempReport, hiddenModules);
         }
         await new Promise(r => setTimeout(r, 1000));



         // Convert cashCountedByCurrency to numbers
         const cashCountedData: Record<string, number> = {};
         Object.entries(cashCountedByCurrency).forEach(([curr, val]) => {
            cashCountedData[curr] = parseFloat(val) || 0;
         });

         // Step 2: Emails
         setCurrentStep(2);
         // Use terminal specific email or fallback to global default
         const emails = activeTerminalConfig?.workflow?.session?.zReportEmails || config.emailConfig?.defaultRecipient;
         if (emails) {
            // Construct report data for email
            const emailReportData: any = {
               sequenceNumber: 'PRE-CLOSE', // Will be updated on save
               closedAt: new Date().toISOString(),
               closedByUserName: userName,
               terminalId: activeTerminal?.id || 'POS-01',
               baseCurrency: baseCurrencyCode,
               totalsByMethod: {},
               cashExpected: expectedCashByCurrency,
               cashCounted: cashCountedByCurrency,
               cashDiscrepancy: cashDiscrepancyByCurrency,
               transactionCount: transactions.length,
               stats: calculateZReportStats(transactions),
               companyName: config.companyInfo.name,
               notes: notes
            };

            // Calculate totals by method
            const totalsByMethod: Record<string, number> = {};
            transactions.forEach(t => {
               (t?.payments || []).forEach(p => {
                  if (p && p.method) {
                     totalsByMethod[p.method] = (totalsByMethod[p.method] || 0) + p.amount;
                  }
               });
            });
            emailReportData.totalsByMethod = totalsByMethod;

            // Convert cash counted strings to numbers
            const cashCountedNums: Record<string, number> = {};
            Object.entries(cashCountedByCurrency).forEach(([k, v]) => cashCountedNums[k] = parseFloat(v) || 0);
            emailReportData.cashCounted = cashCountedNums;

            try {
               await fetch('/smtp/z-report', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                     to: emails,
                     reportData: emailReportData
                  })
               });
               console.log(`[EMAIL] Reporte Z enviado a: ${emails}`);
            } catch (error) {
               console.error("Error enviando email:", error);
            }
         }
         await new Promise(r => setTimeout(r, 1000));

         // Step 3: Finalizar
         setCurrentStep(3);
         await new Promise(r => setTimeout(r, 1000));

         // Pass base currency cash counted for backwards compatibility, plus full report data
         const reportData = {
            cashCountedByCurrency: cashCountedData,
            expectedCashByCurrency,
            cashDiscrepancyByCurrency,
            cashSalesTotal,
            cashIn,
            cashOut,
            expectedCash: expectedCashInDrawer
         };
         onConfirmClose(parseFloat(cashCountedByCurrency[baseCurrencyCode]) || 0, notes, reportData);
      };

      sequence();
   };

   // --- MULTI-CURRENCY SETUP ---
   const activeCurrencies = config.currencies?.filter(c => c.isEnabled) || [];
   const baseCurrency = config.currencies?.find(c => c.isBase) || activeCurrencies[0];
   const baseCurrencyCode = baseCurrency?.code || 'DOP';

   // --- STATS CALCS (MULTI-CURRENCY) ---
   const payments = transactions.flatMap(t => t?.payments || []).filter(Boolean);

   // Group cash sales by currency
   const cashSalesByCurrency: Record<string, number> = {};
   payments.forEach(p => {
      if (p.method === 'CASH') {
         const currency = (p as any).currencyCode || baseCurrencyCode;
         cashSalesByCurrency[currency] = (cashSalesByCurrency[currency] || 0) + p.amount;
      }
   });

   // Group cash movements by currency
   const cashInByCurrency: Record<string, number> = {};
   const cashOutByCurrency: Record<string, number> = {};
   cashMovements.forEach(m => {
      const currency = m.currencyCode || baseCurrencyCode;
      if (m.type === 'IN') {
         cashInByCurrency[currency] = (cashInByCurrency[currency] || 0) + m.amount;
      } else {
         cashOutByCurrency[currency] = (cashOutByCurrency[currency] || 0) + m.amount;
      }
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

   // Calculate discrepancies per currency
   const cashDiscrepancyByCurrency: Record<string, number> = {};
   Object.keys(expectedCashByCurrency).forEach(currency => {
      const counted = parseFloat(cashCountedByCurrency[currency]) || 0;
      const expected = expectedCashByCurrency[currency] || 0;
      cashDiscrepancyByCurrency[currency] = counted - expected;
   });

   // Legacy single-currency values (for base currency)
   const cashSalesTotal = cashSalesByCurrency[baseCurrencyCode] || 0;
   const cashIn = cashInByCurrency[baseCurrencyCode] || 0;
   const cashOut = cashOutByCurrency[baseCurrencyCode] || 0;
   const expectedCashInDrawer = expectedCashByCurrency[baseCurrencyCode] || 0;
   const cashDiscrepancy = cashDiscrepancyByCurrency[baseCurrencyCode] || 0;

   // Calculate Stats for Preview
   const stats = calculateZReportStats(transactions);


   if (showHistory) {
      return <ZReportHistory config={config} onClose={() => setShowHistory(false)} />;
   }

   if (showHistory) {
      return <ZReportHistory config={config} onClose={() => setShowHistory(false)} />;
   }

   return (
      <div className="fixed inset-0 z-[120] bg-gray-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom-5">

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

         <div className="relative bg-white pt-6 pb-6 px-6 shadow-sm border-b border-gray-200">
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

         <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl mx-auto w-full">

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
                        <p className="text-[10px] text-gray-400 uppercase font-bold mb-1 tracking-wider">Prod. Estrella</p>
                        <p className="text-sm font-bold text-gray-800 truncate" title={stats.topProduct?.name || 'N/A'}>
                           {stats.topProduct?.name || 'N/A'}
                        </p>
                        <p className="text-[10px] text-gray-500">{stats.topProduct?.quantity || 0} unidades</p>
                     </div>
                  </div>
               </div>

               {/* System Calculation - Only visible with POS_VIEW_ACTIVE_CASH permission */}
               {hasPermission('POS_VIEW_ACTIVE_CASH') && (
                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                     <h3 className="font-bold text-gray-500 uppercase text-xs tracking-wider mb-4">Balance Teórico (Sistema)</h3>

                     {allCurrenciesInUse.size > 0 ? (
                        <div className="space-y-6">
                           {Array.from(allCurrenciesInUse).map((currencyCode) => {
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
               <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                  <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                     <Banknote size={18} className="text-gray-400" /> Conteo Físico
                  </h3>

                  {allCurrenciesInUse.size > 0 ? (
                     <div className="space-y-5">
                        {Array.from(allCurrenciesInUse).map((currencyCode, index) => {
                           const currencyInfo = activeCurrencies.find(c => c.code === currencyCode) || baseCurrency;
                           const symbol = currencyInfo?.symbol || currencyCode;
                           const counted = cashCountedByCurrency[currencyCode] || '';
                           const discrepancy = cashDiscrepancyByCurrency[currencyCode] || 0;
                           const hasValue = counted !== '';

                           return (
                              <div key={currencyCode} className="space-y-2 pb-4 border-b last:border-b-0 border-gray-100 last:pb-0">
                                 <div className="flex items-center gap-2 mb-2">
                                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                    <span className="font-black text-xs uppercase tracking-wider text-gray-700">{currencyCode}</span>
                                 </div>
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

                                 {/* Per-currency discrepancy */}
                                 {hasValue && (
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
                        <p className="text-xs text-gray-400 mt-2">Ingresa el total de efectivo contado por cada moneda.</p>
                     </div>
                  ) : (
                     <p className="text-sm text-gray-400 text-center py-4">No hay movimientos de efectivo para contar</p>
                  )}
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
         <div className="p-6 bg-white border-t border-gray-200 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] flex flex-col items-center">
            <SlideButton
               label="Desliza para Cerrar Caja"
               disabled={!Object.values(cashCountedByCurrency).some(val => val && parseFloat(val) >= 0)}
               colorClass={config.themeColor === 'orange' ? 'bg-orange-500' : 'bg-blue-500'}
               onComplete={handleStartClosing}
            />
            <p className="text-xs text-gray-400 mt-4 text-center">Responsable: <strong>{userName}</strong></p>
         </div>

      </div>
   );
};

export default ZReportDashboard;
