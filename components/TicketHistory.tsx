
import React, { useState, useMemo, useEffect } from 'react';
import {
   ArrowLeft, Search, Calendar, ChevronDown, ChevronUp,
   Printer, RotateCcw, AlertCircle, Check, X, FileText,
   User as UserIcon, DollarSign, Box, Filter, Gift, QrCode, StickyNote,
   MoreVertical, CreditCard, Banknote, Wallet, TrendingUp, Hash, Percent
} from 'lucide-react';
import { Transaction, BusinessConfig, CartItem, RoleDefinition, ZReport } from '../types';
import { validateTerminalDocument } from '../utils/validation';
import { printTicket } from '../utils/printer';
import { useSupervisorAuth } from '../hooks/useSupervisorAuth';
import SupervisorModal from './SupervisorModal';
import { User, DeviceRole } from '../types';
import { RefundModal } from './RefundModal';

interface TicketHistoryProps {
   transactions: Transaction[];
   config: BusinessConfig;
   currentUser: User | null;
   onUpdateConfig: (newConfig: BusinessConfig) => void;
   users: User[];
   roles: RoleDefinition[];
   onClose: () => void;
   initialSelectedId?: string | null; // NEW: For Smart Scan
   onRefundTransaction: (originalTx: Transaction, refundedItems: CartItem[], conditions: Map<string, 'SELLABLE' | 'DAMAGED'>, reason: string) => void;
}

type ReturnReason = 'DAMAGED' | 'DISLIKE' | 'ERROR' | 'EXPIRED';

const REASONS: { id: ReturnReason; label: string }[] = [
   { id: 'DAMAGED', label: 'Producto Dañado / Defectuoso' },
   { id: 'DISLIKE', label: 'No era lo que esperaba' },
   { id: 'ERROR', label: 'Error en Cobro / Digitacion' },
   { id: 'EXPIRED', label: 'Producto Vencido' },
];

// --- SUB-COMPONENTS ---

const SalesSummaryBar: React.FC<{ kpis: any; config: BusinessConfig }> = ({ kpis, config }) => (
   <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {[
         { label: 'Ventas Totales', value: kpis.totalSales, icon: <TrendingUp className="text-green-500" />, isCurrency: true },
         { label: 'Cantidad Tickets', value: kpis.ticketCount, icon: <Hash className="text-blue-500" />, isCurrency: false },
         { label: 'Ticket Promedio', value: kpis.avgTicket, icon: <Percent className="text-purple-500" />, isCurrency: true },
         { label: 'Devoluciones', value: kpis.refunds, icon: <RotateCcw className="text-red-500" />, isCurrency: true, isRed: true },
      ].map((stat, i) => (
         <div key={i} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center">
               {stat.icon}
            </div>
            <div>
               <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">{stat.label}</p>
               <p className={`text-lg font-black ${stat.isRed ? 'text-red-600' : 'text-gray-900'}`}>
                  {stat.isCurrency ? `${config.currencySymbol}${stat.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : stat.value}
               </p>
            </div>
         </div>
      ))}
   </div>
);


const SalesHistoryTable: React.FC<{
   transactions: Transaction[];
   config: BusinessConfig;
   onRowClick: (id: string) => void;
   themeBg: string;
   themeText: string;
   zReportMap?: Map<string, string>;
   zReports?: ZReport[];
}> = ({ transactions, config, onRowClick, themeBg, themeText, zReportMap, zReports }) => {
   const normalizeTerminalId = (value?: string | null) => (value || '').trim().toLowerCase();
   const toTimestamp = (value?: string) => {
      const ts = value ? new Date(value).getTime() : NaN;
      return Number.isFinite(ts) ? ts : null;
   };

   // Fallback for legacy data: infer missing Z sequence using report windows + transactionCount.
   const inferredZByTxId = useMemo(() => {
      const inferred = new Map<string, string>();
      if (!zReports || zReports.length === 0 || transactions.length === 0) return inferred;

      const reportsByTerminal = new Map<string, ZReport[]>();
      zReports.forEach((report) => {
         const terminalKey = normalizeTerminalId(report.terminalId);
         if (!terminalKey) return;
         const existing = reportsByTerminal.get(terminalKey) || [];
         existing.push(report);
         reportsByTerminal.set(terminalKey, existing);
      });

      reportsByTerminal.forEach((reports) => {
         reports.sort((a, b) => (toTimestamp(a.closedAt) || 0) - (toTimestamp(b.closedAt) || 0));
      });

      const explicitCountByReportId = new Map<string, number>();
      transactions.forEach((tx) => {
         if (tx.zReportId) {
            explicitCountByReportId.set(tx.zReportId, (explicitCountByReportId.get(tx.zReportId) || 0) + 1);
            return;
         }
         if (tx.zReportSequence) {
            const matched = zReports.find(r => r.sequenceNumber === tx.zReportSequence);
            if (matched) explicitCountByReportId.set(matched.id, (explicitCountByReportId.get(matched.id) || 0) + 1);
         }
      });

      const unresolvedByTerminal = new Map<string, Transaction[]>();
      transactions.forEach((tx) => {
         if (tx.zReportId || tx.zReportSequence) return;
         const terminalKey = normalizeTerminalId(tx.terminalId);
         if (!terminalKey) return;
         const existing = unresolvedByTerminal.get(terminalKey) || [];
         existing.push(tx);
         unresolvedByTerminal.set(terminalKey, existing);
      });

      unresolvedByTerminal.forEach((terminalTxs, terminalKey) => {
         const reports = reportsByTerminal.get(terminalKey);
         if (!reports || reports.length === 0) return;

         terminalTxs.sort((a, b) => (toTimestamp(a.date) || 0) - (toTimestamp(b.date) || 0));
         const pendingTxIds = new Set(terminalTxs.map(tx => tx.id));
         let previousClosedAt: number | null = null;

         reports.forEach((report) => {
            const closedAt = toTimestamp(report.closedAt);
            if (!closedAt) return;

            const openedAt = toTimestamp(report.openedAt);
            const explicitCount = explicitCountByReportId.get(report.id) || 0;
            const expectedCount = typeof report.transactionCount === 'number' ? report.transactionCount : 0;
            const missingCount = Math.max(expectedCount - explicitCount, 0);
            if (missingCount === 0) {
               previousClosedAt = closedAt;
               return;
            }

            const getCandidates = (lowerBound: number | null) => terminalTxs.filter((tx) => {
               if (!pendingTxIds.has(tx.id)) return false;
               const txDate = toTimestamp(tx.date);
               if (!txDate || txDate > closedAt) return false;
               if (lowerBound && txDate < lowerBound) return false;
               return true;
            });

            let candidates = getCandidates(openedAt ?? previousClosedAt);

            // Legacy rescue: if openedAt was saved too late, fall back to previous close boundary.
            if (candidates.length < missingCount && openedAt) {
               candidates = getCandidates(previousClosedAt);
            }

            candidates
               .sort((a, b) => (toTimestamp(b.date) || 0) - (toTimestamp(a.date) || 0))
               .slice(0, missingCount)
               .forEach((tx) => {
                  inferred.set(tx.id, report.sequenceNumber);
                  pendingTxIds.delete(tx.id);
               });

            previousClosedAt = closedAt;
         });
      });

      return inferred;
   }, [transactions, zReports]);

   const getStatusBadge = (tx: Transaction) => {
      if (tx.status === 'REFUNDED') return <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-[10px] font-bold">ANULADO</span>;
      if (tx.status === 'PARTIAL_REFUND') return <span className="px-2 py-0.5 bg-orange-100 text-orange-600 rounded-full text-[10px] font-bold">DEVUELTO</span>;
      if ((tx.pendingBalance || 0) > 0) return <span className="px-2 py-0.5 bg-amber-100 text-amber-600 rounded-full text-[10px] font-bold">PENDIENTE</span>;
      return <span className="px-2 py-0.5 bg-green-100 text-green-600 rounded-full text-[10px] font-bold">COMPLETADO</span>;
   };

   const getPaymentIcon = (method: string) => {
      switch (method?.toUpperCase()) {
         case 'CASH':
         case 'EFECTIVO': return <Banknote size={14} className="text-green-600" />;
         case 'CARD':
         case 'TARJETA': return <CreditCard size={14} className="text-blue-600" />;
         case 'CREDIT':
         case 'CRÉDITO':
         case 'CREDITO':
         case 'PENDIENTE': return <CreditCard size={14} className="text-cyan-600" />;
         case 'TRANSFER':
         case 'TRANSFERENCIA': return <Wallet size={14} className="text-purple-600" />;
         default: return <DollarSign size={14} className="text-gray-400" />;
      }
   };

   return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
         <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
               <thead className="bg-gray-50 sticky top-0 z-10 border-b border-gray-100">
                  <tr>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest">Estado</th>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest">Folio</th>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest">Fecha / Hora</th>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest">Cliente</th>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest text-center">Pago</th>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest text-center">Cierre</th>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest text-right">Total</th>
                     <th className="px-4 py-3 font-bold text-gray-400 uppercase text-[10px] tracking-widest text-right"></th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-gray-50">
                  {transactions.map((tx) => {
                     const inferredZSeq = inferredZByTxId.get(tx.id);
                     const zSeq = tx.zReportSequence || (tx.zReportId ? zReportMap?.get(tx.zReportId) : null) || inferredZSeq;
                     return (
                        <tr
                           key={tx.id}
                           onClick={() => onRowClick(tx.id)}
                           className={`transition-colors cursor-pointer group ${tx.documentType === 'REFUND' || tx.status === 'REFUNDED' || tx.status === 'PARTIAL_REFUND'
                              ? 'bg-red-50/50 hover:bg-red-100/50'
                              : 'hover:bg-gray-50'
                              }`}
                        >
                           <td className="px-4 py-3">{getStatusBadge(tx)}</td>
                           <td className="px-4 py-3 text-xs font-medium text-gray-500">{tx.displayId || tx.id.slice(-8).toUpperCase()}</td>
                           <td className="px-4 py-3">
                              <p className="font-bold text-gray-800">{new Date(tx.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                              <p className="text-[10px] text-gray-400 font-medium">{new Date(tx.date).toLocaleDateString()}</p>
                           </td>
                           <td className="px-4 py-3">
                              {tx.customerName && tx.customerName !== 'null' ? (
                                 <p className="font-bold text-gray-700">{tx.customerName}</p>
                              ) : (
                                 <p className="text-gray-400 italic">Cliente General</p>
                              )}
                           </td>
                           <td className="px-4 py-3 text-center">
                              <div className="flex justify-center">
                                 {getPaymentIcon(tx.payments?.[0]?.method || 'CASH')}
                              </div>
                           </td>
                           <td className="px-4 py-3 text-center">
                              {zSeq ? (
                                 <span
                                    title={!tx.zReportId && !tx.zReportSequence && inferredZSeq ? 'Cierre Z inferido por ventana horaria' : undefined}
                                    className="px-2 py-1 bg-purple-100 text-purple-700 rounded-lg text-[10px] font-bold border border-purple-200"
                                 >
                                    {zSeq}
                                 </span>
                              ) : tx.zReportId ? (
                                 <span
                                    title={`ID: ${tx.zReportId}`}
                                    className="px-2 py-1 bg-gray-100 text-gray-500 rounded-lg text-[10px] font-bold border border-gray-200 cursor-help"
                                 >
                                    {tx.zReportId.slice(0, 8)}...
                                 </span>
                              ) : (
                                 <span className="text-gray-300 text-[10px]">•</span>
                              )}
                           </td>
                           <td className="px-4 py-3 text-right font-mono font-bold text-gray-900">
                              {config.currencySymbol}{tx.total.toFixed(2)}
                           </td>
                           <td className="px-4 py-3 text-right">
                              <button className="p-1 hover:bg-gray-200 rounded-md transition-colors text-gray-400">
                                 <MoreVertical size={16} />
                              </button>
                           </td>
                        </tr>
                     );
                  })}
               </tbody>
            </table>
         </div>
      </div>
   );
};

const TicketDetailDrawer: React.FC<{
   tx: Transaction | null;
   config: BusinessConfig;
   onClose: () => void;
   onPrint: (tx: Transaction) => void;
   onRequestRefund: (tx: Transaction) => void;
   themeText: string;
   themeBg: string;
   users: User[];
}> = ({ tx, config, onClose, onPrint, onRequestRefund, themeText, themeBg, users }) => {
   // Removed internal return state




   if (!tx) return null;
   const cashierName = tx.userName || users.find(u => u.id === tx.userId)?.name || 'Sistema';
   const supervisorName = tx.authorizedByName || users.find(u => u.id === tx.authorizedById)?.name || null;
   const payments = Array.isArray(tx.payments) ? tx.payments : [];
   const paymentTotal = payments.reduce((acc, p: any) => acc + Number(p?.amount || 0), 0);

   const getPaymentMethodLabel = (payment: any): string => {
      const method = (payment?.method || '').toString().toUpperCase();
      if (payment?.methodLabel) return payment.methodLabel;
      switch (method) {
         case 'CASH':
         case 'EFECTIVO': return 'Efectivo';
         case 'CARD':
         case 'TARJETA': return 'Tarjeta';
         case 'QR': return 'QR / Digital';
         case 'TRANSFER':
         case 'TRANSFERENCIA': return 'Transferencia';
         case 'WALLET': return 'Wallet';
         case 'CREDIT':
         case 'CREDITO':
         case 'CRÉDITO':
         case 'PENDIENTE': return 'Crédito';
         case 'ADVANCE':
         case 'ANTICIPO': return 'Anticipo';
         default: return payment?.method || 'Otro';
      }
   };

   const getPaymentMethodIcon = (method?: string) => {
      const normalized = (method || '').toUpperCase();
      switch (normalized) {
         case 'CASH':
         case 'EFECTIVO': return <Banknote size={14} className="text-green-600" />;
         case 'CARD':
         case 'TARJETA': return <CreditCard size={14} className="text-blue-600" />;
         case 'QR': return <QrCode size={14} className="text-indigo-600" />;
         case 'TRANSFER':
         case 'TRANSFERENCIA': return <Wallet size={14} className="text-purple-600" />;
         case 'CREDIT':
         case 'CREDITO':
         case 'CRÉDITO':
         case 'PENDIENTE': return <CreditCard size={14} className="text-cyan-600" />;
         default: return <DollarSign size={14} className="text-gray-400" />;
      }
   };

   return (
      <div className="fixed inset-0 z-[100] overflow-hidden">
         <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
         <div className="absolute inset-y-0 right-0 max-w-md w-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            <header className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50">
               <div>
                  <h3 className="text-lg font-black text-gray-900">Detalle de Ticket</h3>
                  <p className="text-xs text-gray-400 font-medium tracking-wider">#{tx.displayId || tx.id}</p>
               </div>
               <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-all">
                  <X size={20} className="text-gray-500" />
               </button>
            </header>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
               <section className="space-y-4">
                  <div className="flex justify-between items-start p-4 rounded-2xl bg-gray-50 border border-gray-100">
                     <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Total Venta</p>
                        <p className="text-3xl font-black text-gray-900">{config.currencySymbol}{tx.total.toFixed(2)}</p>
                     </div>
                     <div className="text-right">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Estado</p>
                        <div className="mt-1 flex items-center gap-2">
                           {tx.status === 'REFUNDED' ? (
                              <span className="bg-red-100 text-red-600 px-3 py-1 rounded-full text-xs font-black italic">ANULADO</span>
                           ) : tx.status === 'PARTIAL_REFUND' ? (
                              <span className="bg-orange-100 text-orange-600 px-3 py-1 rounded-full text-xs font-black">DEVUELTO</span>
                           ) : (tx.pendingBalance || 0) > 0 ? (
                              <span className="bg-amber-100 text-amber-600 px-3 py-1 rounded-full text-xs font-black">PENDIENTE</span>
                           ) : (
                              <span className="bg-green-100 text-green-600 px-3 py-1 rounded-full text-xs font-black">PAGADO</span>
                           )}
                        </div>
                     </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                     <div className="p-3 bg-white border border-gray-100 rounded-xl">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Fecha / Hora</p>
                        <p className="text-xs font-bold text-gray-700">{new Date(tx.date).toLocaleString()}</p>
                     </div>
                     <div className="p-3 bg-white border border-gray-100 rounded-xl">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Cajero</p>
                        <p className="text-xs font-bold text-gray-700">{cashierName}</p>
                     </div>
                  </div>
               </section>

               <section>
                  <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-3">Artículos del Ticket</h4>
                  <div className="space-y-2">
                     {tx.items.map((item, i) => (
                        <div key={i} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                           <div className="flex-1">
                              <p className="text-sm font-bold text-gray-800">{item.name}</p>
                              <p className="text-xs text-gray-400 font-medium">{item.quantity} x {config.currencySymbol}{item.price.toFixed(2)}</p>
                           </div>
                           <p className="text-sm font-black text-gray-900">{config.currencySymbol}{(item.price * item.quantity).toFixed(2)}</p>
                        </div>
                     ))}
                  </div>
               </section>

               <section className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 space-y-2">
                  <div className="flex justify-between text-xs font-medium text-blue-600/60 uppercase tracking-wider">
                     <span>Subtotal</span>
                     <span>{config.currencySymbol}{(tx.total / (1 + config.taxRate)).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-medium text-blue-600/60 uppercase tracking-wider">
                     <span>Impuestos ({config.taxRate * 100}%)</span>
                     <span>{config.currencySymbol}{(tx.total - (tx.total / (1 + config.taxRate))).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-black text-blue-900 border-t border-blue-100 pt-2 mt-2">
                     <span>Total Final</span>
                     <span>{config.currencySymbol}{tx.total.toFixed(2)}</span>
                  </div>
               </section>

               <section className="bg-white p-4 rounded-2xl border border-gray-100 space-y-4">
                  <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-widest">Auditoría de Cobro</h4>

                  <div className="grid grid-cols-2 gap-3">
                     <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Cobrado por</p>
                        <p className="text-xs font-bold text-gray-800 truncate">{cashierName}</p>
                     </div>
                     <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Hora Cobro</p>
                        <p className="text-xs font-bold text-gray-800">{new Date(tx.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
                     </div>
                     <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Terminal</p>
                        <p className="text-xs font-bold text-gray-800">{tx.terminalId || 'N/D'}</p>
                     </div>
                     <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">NCF</p>
                        <p className="text-xs font-bold text-gray-800 truncate">{tx.ncf || 'N/A'}</p>
                     </div>
                  </div>

                  {supervisorName && (
                     <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <p className="text-[10px] font-bold text-gray-400 uppercase">Autorizado por</p>
                        <p className="text-xs font-bold text-gray-800 truncate">{supervisorName}</p>
                     </div>
                  )}

                  <div className="rounded-xl border border-gray-100 overflow-hidden">
                     <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Formas de Pago</p>
                     </div>
                     <div className="p-3 space-y-2">
                        {payments.length === 0 ? (
                           <p className="text-xs text-gray-400 italic">Sin información de pagos</p>
                        ) : (
                           payments.map((payment: any, index: number) => (
                              <div key={`${tx.id}-payment-${index}`} className="flex items-center justify-between rounded-lg bg-white border border-gray-100 px-3 py-2">
                                 <div className="flex items-center gap-2">
                                    {getPaymentMethodIcon(payment?.method)}
                                    <span className="text-xs font-bold text-gray-700">{getPaymentMethodLabel(payment)}</span>
                                 </div>
                                 <span className="text-xs font-black text-gray-900">
                                    {config.currencySymbol}{Number(payment?.amount || 0).toFixed(2)}
                                 </span>
                              </div>
                           ))
                        )}
                        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                           <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Total Recibido</span>
                           <span className="text-sm font-black text-gray-900">{config.currencySymbol}{paymentTotal.toFixed(2)}</span>
                        </div>
                     </div>
                  </div>
               </section>
            </div>

            {/* Actions Footer */}
            <footer className="p-6 border-t border-gray-100 bg-gray-50 grid grid-cols-2 gap-3">
               <>
                  <button
                     onClick={() => onPrint(tx)}
                     className="flex items-center justify-center gap-2 py-3 bg-white border border-gray-200 text-gray-700 rounded-2xl font-bold hover:bg-gray-100 transition-all shadow-sm"
                  >
                     <Printer size={18} /> Reimprimir
                  </button>
                  {tx.status !== 'REFUNDED' && (
                     <button
                        onClick={() => onRequestRefund(tx)}
                        className="flex items-center justify-center gap-2 py-3 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-lg"
                     >
                        <RotateCcw size={18} /> Devolución / Anular
                     </button>
                  )}
               </>
            </footer>
         </div>
      </div>
   );
};

const TicketHistory: React.FC<TicketHistoryProps> = ({ transactions, config, currentUser, onUpdateConfig, users, roles, onClose, onRefundTransaction, initialSelectedId }) => {
   const [searchTerm, setSearchTerm] = useState('');
   const [expandedId, setExpandedId] = useState<string | null>(null);
   const [showFilters, setShowFilters] = useState(false);

   // Filters State
   const [filterDateStart, setFilterDateStart] = useState('');
   const [filterDateEnd, setFilterDateEnd] = useState('');
   // ... (other state)

   // ... (keep loadHistory useEffect)

   // Handle Initial Selection (Smart Scan)
   useEffect(() => {
      if (initialSelectedId) {
         setSearchTerm(initialSelectedId); // Filter by ID
         setExpandedId(initialSelectedId); // Auto-expand details
         setSelectedTxId(initialSelectedId);
      }
   }, [initialSelectedId]);
   const [filterTerminal, setFilterTerminal] = useState('');
   const [filterCashier, setFilterCashier] = useState('');
   const [filterCustomer, setFilterCustomer] = useState('');
   const [filterNcfType, setFilterNcfType] = useState('');

   // Return Mode State
   const [returnModeId, setReturnModeId] = useState<string | null>(null);
   // Map of cartId -> quantity to return
   const [selectedItemsQty, setSelectedItemsQty] = useState<Map<string, number>>(new Map());
   const [returnReason, setReturnReason] = useState<ReturnReason>('ERROR');

   // Gift Receipt State
   const [giftReceiptTx, setGiftReceiptTx] = useState<Transaction | null>(null);

   const [historyTransactions, setHistoryTransactions] = useState<Transaction[]>([]);
   const [zReportMap, setZReportMap] = useState<Map<string, string>>(new Map()); // Map zReportId -> Sequence
   const [zReports, setZReports] = useState<ZReport[]>([]);
   const [selectedTxId, setSelectedTxId] = useState<string | null>(null);

   // Refund Modal State
   const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
   const [refundTx, setRefundTx] = useState<Transaction | null>(null);

   // Load History on Mount
   useEffect(() => {
      const loadHistory = async () => {
         try {
            // Load transactions directly from the 'transactions' collection (not 'transactionHistory')
            // ... (keep existing loading logic)
            const { db } = await import('../utils/db');
            const history = await db.get('transactions') as Transaction[];
            if (history && Array.isArray(history)) {
               const markedHistory = history.map(h => ({ ...h, _isArchived: true }));
               setHistoryTransactions(markedHistory);
            }
            // ... (keep ZReport loading)
            const zReports = await db.get('zReports') as any[];
            if (zReports) {
               const map = new Map<string, string>();
               zReports.forEach(r => map.set(r.id, r.sequenceNumber));
               setZReportMap(map);
               setZReports(zReports);
            }
         } catch (e) {
            console.error("Failed to load history:", e);
         }
      };
      loadHistory();
   }, []);

   // Handle Initial Selection (Smart Scan)
   useEffect(() => {
      if (initialSelectedId) {
         setSearchTerm(initialSelectedId); // Filter by ID
         // Attempt to find it immediately if loaded
         // Note: We might need to wait for history to load, but filtering by ID usually works 
         // as filteredTransactions recomputes.
         setExpandedId(initialSelectedId); // Auto-expand details if we had inline details
         // For Drawer:
         setSelectedTxId(initialSelectedId);
      }
   }, [initialSelectedId]);

   // --- SMART SEARCH LOGIC ---
   const filteredTransactions = useMemo(() => {
      // Merge current transactions (props) with history
      // Deduplicate by ID: Prioritize props (active state) over history cache
      const uniqueMap = new Map();
      historyTransactions.forEach(t => uniqueMap.set(t.id, t));
      transactions.forEach(t => uniqueMap.set(t.id, t));

      const isValidTicketRecord = (tx: any): boolean => {
         const rawId = typeof tx?.id === 'string' ? tx.id.trim() : '';
         const displayId = typeof tx?.displayId === 'string' ? tx.displayId.trim() : '';
         const documentType = typeof tx?.documentType === 'string' ? tx.documentType.trim().toUpperCase() : '';

         const hasDisplayId = displayId.length > 0;
         const isSalesDocument = documentType === 'TICKET' || documentType === 'REFUND';
         const isOpenTableOrder = rawId.startsWith('ORD-') && !hasDisplayId && !documentType;

         if (isOpenTableOrder) return false;
         return isSalesDocument || hasDisplayId;
      };

      let data = Array.from(uniqueMap.values())
         .filter(isValidTicketRecord)
         .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Newest first

      // 1. Apply Search Term / Predictive Tag
      const lowerTerm = searchTerm.toLowerCase().trim();
      if (lowerTerm) {
         if (lowerTerm === 'ayer' || lowerTerm === 'yesterday') {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            data = data.filter(t => new Date(t.date).toDateString() === yesterday.toDateString());
         } else if (lowerTerm === 'hoy' || lowerTerm === 'today') {
            const today = new Date();
            data = data.filter(t => new Date(t.date).toDateString() === today.toDateString());
         } else if (lowerTerm.startsWith('#')) {
            data = data.filter(t => (t.id || '').toLowerCase().includes(lowerTerm.replace('#', '')));
         } else {
            data = data.filter(t =>
               t.customerName?.toLowerCase().includes(lowerTerm) ||
               (t.userName || '').toLowerCase().includes(lowerTerm) ||
               (t.id || '').toLowerCase().includes(lowerTerm) ||
               t.displayId?.toLowerCase().includes(lowerTerm) ||
               t.total.toString().includes(lowerTerm)
            );
         }
      }

      // 2. Apply Dimensional Filters (Cumulative)
      if (filterDateStart) {
         const start = new Date(filterDateStart + 'T00:00:00');
         data = data.filter(t => new Date(t.date) >= start);
      }

      if (filterDateEnd) {
         const end = new Date(filterDateEnd + 'T23:59:59.999');
         data = data.filter(t => new Date(t.date) <= end);
      }

      if (filterTerminal) {
         data = data.filter(t => t.terminalId === filterTerminal);
      }

      if (filterCashier) {
         const term = filterCashier.toLowerCase();
         data = data.filter(t =>
            t.userId === filterCashier ||
            (t.userName || '').toLowerCase().includes(term)
         );
      }

      if (filterCustomer) {
         const term = filterCustomer.toLowerCase();
         data = data.filter(t =>
            (t.customerId || '').toLowerCase().includes(term) ||
            (t.customerName || '').toLowerCase().includes(term)
         );
      }

      if (filterNcfType && filterNcfType !== 'ALL') {
         data = data.filter(t => t.ncf?.startsWith(filterNcfType));
      }

      return data;
   }, [transactions, historyTransactions, searchTerm, filterDateStart, filterDateEnd, filterTerminal, filterCashier, filterCustomer, filterNcfType]);

   // --- KPI CALCULATIONS ---
   const kpis = useMemo(() => {
      const totalSales = filteredTransactions.reduce((acc, tx) => acc + (tx.status !== 'REFUNDED' ? tx.total : 0), 0);
      const ticketCount = filteredTransactions.length;
      const avgTicket = ticketCount > 0 ? totalSales / ticketCount : 0;
      const refunds = filteredTransactions.reduce((acc, tx) => {
         if (tx.status === 'REFUNDED' || tx.status === 'PARTIAL_REFUND') {
            return acc + tx.total;
         }
         return acc;
      }, 0);

      return { totalSales, ticketCount, avgTicket, refunds };
   }, [filteredTransactions]);

   const selectedTx = useMemo(() =>
      filteredTransactions.find(t => t.id === selectedTxId) || null
      , [filteredTransactions, selectedTxId]);

   // --- SUPERVISOR AUTH ---
   const { requestApproval, supervisorModalProps } = useSupervisorAuth({ config, currentUser, roles, onUpdateConfig });

   // --- HANDLERS ---
   const toggleExpand = (id: string) => {
      if (returnModeId) return; // Disable expand toggle during return mode
      setExpandedId(prev => prev === id ? null : id);
   };

   const startReturnMode = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setReturnModeId(id);
      setExpandedId(id); // Ensure it's open
      setSelectedItemsQty(new Map());
      setReturnReason('ERROR');
   };

   const cancelReturnMode = () => {
      setReturnModeId(null);
      setSelectedItemsQty(new Map());
   };

   const incrementReturnQty = (cartId: string, maxQty: number) => {
      const newMap = new Map(selectedItemsQty);
      const current = newMap.get(cartId) || 0;
      if (current < maxQty) {
         newMap.set(cartId, current + 1);
         setSelectedItemsQty(newMap);
      }
   };

   const decrementReturnQty = (cartId: string) => {
      const newMap = new Map(selectedItemsQty);
      const current = newMap.get(cartId) || 0;
      if (current > 1) {
         newMap.set(cartId, current - 1);
      } else {
         newMap.delete(cartId);
      }
      setSelectedItemsQty(newMap);
   };

   const confirmRefund = async (transaction: Transaction) => {
      if (selectedItemsQty.size === 0) return;

      // Validation: Check if terminal has REFUND document series assigned
      const terminalId = config.terminals?.[0]?.id || 'T1';
      const validation = validateTerminalDocument(config, terminalId, 'REFUND');
      if (!validation.isValid) {
         alert(validation.error);
         return;
      }

      // Supervisor Check for Voiding Paid Ticket
      const authorized = await requestApproval({
         permission: 'POS_VOID_PAID_TICKET',
         actionDescription: 'Anular/Devolver Factura Pagada',
         context: {
            ticketId: transaction.id,
            originalValue: currentRefundTotal
         }
      });
      if (!authorized) return;

      if (confirm("¿Confirmar devolución de los artículos seleccionados?")) {
         // Build items with adjusted quantities
         const itemsToRefund = transaction.items
            .filter(item => selectedItemsQty.has(item.cartId))
            .map(item => ({
               ...item,
               quantity: selectedItemsQty.get(item.cartId) || item.quantity
            }));

         // Legacy/Manual refund flow support
         const conditions = new Map<string, 'SELLABLE' | 'DAMAGED'>();
         itemsToRefund.forEach(i => conditions.set(i.cartId, 'SELLABLE'));

         onRefundTransaction(transaction, itemsToRefund, conditions, REASONS.find(r => r.id === returnReason)?.label || 'Devolución');
         setReturnModeId(null);
         setSelectedItemsQty(new Map());
      }
   };

   const handlePrintGiftReceipt = (e: React.MouseEvent, tx: Transaction) => {
      e.stopPropagation();
      setGiftReceiptTx(tx);
   };

   const handleConfirmRefundFromModal = async (
      originalTx: Transaction,
      refundItems: CartItem[],
      conditions: Map<string, 'SELLABLE' | 'DAMAGED'>,
      reason: string
   ) => {
      if (!originalTx || refundItems.length === 0) return;

      const terminalId = originalTx.terminalId || config.terminals?.[0]?.id || 'T1';
      const validation = validateTerminalDocument(config, terminalId, 'REFUND');
      if (!validation.isValid) {
         alert(validation.error);
         return;
      }

      const refundSubtotal = refundItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
      const refundTotal = originalTx.isTaxIncluded
         ? refundSubtotal
         : refundSubtotal * (1 + (config.taxRate || 0));

      const authorized = await requestApproval({
         permission: 'POS_VOID_PAID_TICKET',
         actionDescription: 'Anular/Devolver Factura Pagada',
         context: {
            ticketId: originalTx.id,
            originalValue: refundTotal
         }
      });

      if (!authorized) return;

      onRefundTransaction(originalTx, refundItems, conditions, reason || 'Devolución');
      setIsRefundModalOpen(false);
      setRefundTx(null);
      setSelectedTxId(null);
   };

   // Calculate Refund Total
   const currentRefundTotal = useMemo(() => {
      if (!returnModeId) return 0;
      const tx = transactions.find(t => t.id === returnModeId);
      if (!tx) return 0;

      return tx.items
         .filter(item => selectedItemsQty.has(item.cartId))
         .reduce((acc, item) => {
            const qtyToReturn = selectedItemsQty.get(item.cartId) || 0;
            return acc + (item.price * qtyToReturn);
         }, 0) * (1 + config.taxRate);
   }, [returnModeId, selectedItemsQty, transactions, config.taxRate]);


   // --- RENDER HELPERS ---
   const themeText = config.themeColor === 'orange' ? 'text-orange-600' : 'text-blue-600';
   const themeBg = config.themeColor === 'orange' ? 'bg-orange-600' : 'bg-blue-600';
   const themeRing = config.themeColor === 'orange' ? 'focus:ring-orange-500' : 'focus:ring-blue-500';

   return (
      <div className="h-screen w-full bg-gray-100 flex flex-col overflow-hidden relative">

         {/* Header & Compact Filters */}
         <header className="bg-white border-b border-gray-200 p-3 shadow-sm z-20">
            <div className="max-w-[1600px] mx-auto w-full flex flex-wrap items-center justify-between gap-3">
               <div className="flex items-center gap-3">
                  <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-all active:scale-95">
                     <ArrowLeft size={18} />
                  </button>
                  <h1 className="text-sm font-black text-gray-800 flex items-center gap-2 uppercase tracking-tighter">
                     <FileText size={16} className={themeText} />
                     Historial
                  </h1>
               </div>

               <div className="flex flex-1 items-center gap-2 min-w-[300px] max-w-4xl">
                  <div className="relative flex-1">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                     <input
                        type="text"
                        placeholder="Buscar ticket, cliente..."
                        className={`w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-100 rounded-lg focus:bg-white focus:ring-1 ${themeRing} outline-none transition-all text-sm text-gray-700 placeholder:text-gray-400`}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                     />
                  </div>

                  <div className="flex items-center gap-1.5">
                     <div className="flex items-center bg-gray-50 border border-gray-100 rounded-lg px-2 py-1.5">
                        <Calendar size={12} className="text-gray-400 mr-1.5" />
                        <input
                           type="date"
                           value={filterDateStart}
                           onChange={e => setFilterDateStart(e.target.value)}
                           className="bg-transparent border-none text-[11px] font-bold text-gray-600 outline-none w-28"
                        />
                     </div>
                     <select
                        value={filterTerminal}
                        onChange={e => setFilterTerminal(e.target.value)}
                        className="px-2 py-1.5 bg-gray-50 border border-gray-100 rounded-lg text-[11px] font-bold text-gray-600 outline-none hover:bg-white transition-colors"
                     >
                        <option value="">Terminal</option>
                        {(config.terminals || []).map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
                     </select>
                     <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`p-2 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors ${showFilters ? 'bg-blue-50 text-blue-600' : ''}`}
                     >
                        <Filter size={16} />
                     </button>
                  </div>
               </div>
            </div>

            {showFilters && (
               <div className="mt-2 p-3 bg-gray-50 rounded-xl border border-gray-100 flex flex-wrap gap-4 max-w-[1600px] mx-auto animate-in fade-in slide-in-from-top-1">
                  <div className="flex items-center gap-2">
                     <span className="text-[10px] font-bold text-gray-400 uppercase">Hasta:</span>
                     <input type="date" value={filterDateEnd} onChange={e => setFilterDateEnd(e.target.value)} className="px-2 py-1 bg-white border border-gray-200 rounded text-[11px] font-bold" />
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="text-[10px] font-bold text-gray-400 uppercase">Cajero:</span>
                     <select value={filterCashier} onChange={e => setFilterCashier(e.target.value)} className="px-2 py-1 bg-white border border-gray-200 rounded text-[11px] font-bold">
                        <option value="">Todos</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                     </select>
                  </div>
                  <div className="flex items-center gap-2">
                     <span className="text-[10px] font-bold text-gray-400 uppercase">NCF:</span>
                     <select value={filterNcfType} onChange={e => setFilterNcfType(e.target.value)} className="px-2 py-1 bg-white border border-gray-200 rounded text-[11px] font-bold">
                        <option value="ALL">Cualquiera</option>
                        <option value="B01">Crédito Fiscal</option>
                        <option value="B02">Consumo Final</option>
                     </select>
                  </div>
                  <button onClick={() => { setSearchTerm(''); setFilterDateStart(''); setFilterDateEnd(''); setFilterTerminal(''); setFilterCashier(''); setFilterNcfType(''); }} className="text-[10px] font-bold text-red-500 ml-auto hover:underline uppercase">Reset</button>
               </div>
            )}
         </header>

         <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto w-full">
            <SalesSummaryBar kpis={kpis} config={config} />

            <SalesHistoryTable
               transactions={filteredTransactions}
               config={config}
               onRowClick={(id) => setSelectedTxId(id)}
               themeBg={themeBg}
               themeText={themeText}
               zReportMap={zReportMap}
               zReports={zReports}
            />

            {filteredTransactions.length === 0 && (
               <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-200 mt-4">
                  <Box size={32} className="mx-auto mb-2 text-gray-300" />
                  <p className="text-gray-400 font-bold text-xs uppercase tracking-widest">Sin resultados</p>
               </div>
            )}
         </main>

         {/* Detail Drawer */}
         <TicketDetailDrawer
            tx={transactions.find(t => t.id === selectedTxId) || historyTransactions.find(t => t.id === selectedTxId) || null}
            config={config}
            onClose={() => setSelectedTxId(null)}
            onPrint={(tx) => printTicket(tx, config)}
            onRequestRefund={(tx) => {
               setRefundTx(tx);
               setIsRefundModalOpen(true);
            }}
            themeText={themeText}
            themeBg={themeBg}
            users={users}
         />

         {/* Gift Modal (Keep same structure but adjusted style) */}
         {giftReceiptTx && (
            <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs flex flex-col overflow-hidden animate-in zoom-in-95">
                  <div className="p-3 bg-gray-50 border-b flex justify-between items-center text-sm font-bold">
                     <span className="flex items-center gap-2"><Gift size={16} className="text-purple-600" /> Ticket Regalo</span>
                     <button onClick={() => setGiftReceiptTx(null)}><X size={16} /></button>
                  </div>
                  <div className="p-4 overflow-y-auto max-h-[50vh] font-mono text-[11px] text-gray-700 leading-tight">
                     <div className="text-center mb-4 uppercase">
                        <p className="font-bold">{config.companyInfo.name}</p>
                        <p className="opacity-50 tracking-tighter">* REGALO *</p>
                     </div>
                     <div className="border-y border-dashed py-2 mb-2">
                        {giftReceiptTx.items.map((item, i) => (
                           <div key={i} className="flex justify-between">
                              <span>{item.name}</span>
                              <span className="font-bold">x{item.quantity}</span>
                           </div>
                        ))}
                     </div>
                     <div className="text-center opacity-30 mt-4">
                        <QrCode size={40} className="mx-auto" />
                     </div>
                  </div>
                  <div className="p-3 bg-gray-50 border-t">
                     <button onClick={() => { alert("Imprimiendo..."); setGiftReceiptTx(null); }} className="w-full py-2 bg-purple-600 text-white rounded-lg font-bold text-sm">Imprimir</button>
                  </div>
               </div>
            </div>
         )}

         <RefundModal
            isOpen={isRefundModalOpen}
            onClose={() => {
               setIsRefundModalOpen(false);
               setRefundTx(null);
            }}
            transaction={refundTx}
            onConfirm={handleConfirmRefundFromModal}
            currencySymbol={config.currencySymbol}
         />

         <SupervisorModal {...supervisorModalProps} users={users} />
      </div>
   );
};

export default TicketHistory;
