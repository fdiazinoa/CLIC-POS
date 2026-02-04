
import React, { useState, useMemo, useEffect } from 'react';
import {
   ArrowLeft, Search, Calendar, ChevronDown, ChevronUp,
   Printer, RotateCcw, AlertCircle, Check, X, FileText,
   User as UserIcon, DollarSign, Box, Filter, Gift, QrCode, StickyNote
} from 'lucide-react';
import { Transaction, BusinessConfig, CartItem, RoleDefinition } from '../types';
import { validateTerminalDocument } from '../utils/validation';
import { printTicket } from '../utils/printer';
import { useSupervisorAuth } from '../hooks/useSupervisorAuth';
import SupervisorModal from './SupervisorModal';
import { User } from '../types';

interface TicketHistoryProps {
   transactions: Transaction[];
   config: BusinessConfig;
   currentUser: User | null;
   onUpdateConfig: (newConfig: BusinessConfig) => void;
   users: User[];
   roles: RoleDefinition[];
   onClose: () => void;
   onRefundTransaction: (originalTx: Transaction, refundedItems: CartItem[], reason: string) => void;
}

type ReturnReason = 'DAMAGED' | 'DISLIKE' | 'ERROR' | 'EXPIRED';

const REASONS: { id: ReturnReason; label: string }[] = [
   { id: 'DAMAGED', label: 'Producto Dañado / Defectuoso' },
   { id: 'DISLIKE', label: 'No era lo que esperaba' },
   { id: 'ERROR', label: 'Error en Cobro / Digitacion' },
   { id: 'EXPIRED', label: 'Producto Vencido' },
];

const TicketHistory: React.FC<TicketHistoryProps> = ({ transactions, config, currentUser, onUpdateConfig, users, roles, onClose, onRefundTransaction }) => {
   const [searchTerm, setSearchTerm] = useState('');
   const [expandedId, setExpandedId] = useState<string | null>(null);

   // Return Mode State
   const [returnModeId, setReturnModeId] = useState<string | null>(null);
   // Map of cartId -> quantity to return
   const [selectedItemsQty, setSelectedItemsQty] = useState<Map<string, number>>(new Map());
   const [returnReason, setReturnReason] = useState<ReturnReason>('ERROR');

   // Gift Receipt State
   const [giftReceiptTx, setGiftReceiptTx] = useState<Transaction | null>(null);

   const [historyTransactions, setHistoryTransactions] = useState<Transaction[]>([]);

   // Load History on Mount
   useEffect(() => {
      const loadHistory = async () => {
         try {
            // We use the db utility directly to fetch the history collection
            // Note: We need to import 'db' from utils/db if not available, but we can use a dynamic import or assume it's available.
            // Since TicketHistory is a component, we should probably pass 'db' or import it.
            // Let's import it at the top of the file.
            const { db } = await import('../utils/db');
            const history = await db.get('transactionHistory') as Transaction[];
            if (history && Array.isArray(history)) {
               // Mark all loaded history as archived so they are highlighted even if missing zReportId
               const markedHistory = history.map(h => ({ ...h, _isArchived: true }));
               setHistoryTransactions(markedHistory);
            }
         } catch (e) {
            console.error("Failed to load transaction history:", e);
         }
      };
      loadHistory();
   }, []);

   // --- SMART SEARCH LOGIC ---
   const filteredTransactions = useMemo(() => {
      // Merge current transactions (props) with history
      // Deduplicate by ID just in case
      const allTransactions = [...transactions, ...historyTransactions];
      const uniqueMap = new Map();
      allTransactions.forEach(t => uniqueMap.set(t.id, t));
      const merged = Array.from(uniqueMap.values());

      let data = merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Newest first
      const lowerTerm = searchTerm.toLowerCase().trim();

      if (!lowerTerm) return data;

      // Predictive Filters
      if (lowerTerm === 'ayer' || lowerTerm === 'yesterday') {
         const yesterday = new Date();
         yesterday.setDate(yesterday.getDate() - 1);
         return data.filter(t => new Date(t.date).toDateString() === yesterday.toDateString());
      }

      if (lowerTerm === 'hoy' || lowerTerm === 'today') {
         const today = new Date();
         return data.filter(t => new Date(t.date).toDateString() === today.toDateString());
      }

      if (lowerTerm.startsWith('#')) {
         return data.filter(t => (t.id || '').toLowerCase().includes(lowerTerm.replace('#', '')));
      }

      return data.filter(t =>
         t.customerName?.toLowerCase().includes(lowerTerm) ||
         (t.userName || '').toLowerCase().includes(lowerTerm) ||
         (t.id || '').toLowerCase().includes(lowerTerm) ||
         t.displayId?.toLowerCase().includes(lowerTerm) ||
         t.total.toString().includes(lowerTerm)
      );
   }, [transactions, historyTransactions, searchTerm]);

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
         onRefundTransaction(transaction, itemsToRefund, REASONS.find(r => r.id === returnReason)?.label || 'Devolución');
         setReturnModeId(null);
         setSelectedItemsQty(new Map());
      }
   };

   const handlePrintGiftReceipt = (e: React.MouseEvent, tx: Transaction) => {
      e.stopPropagation();
      setGiftReceiptTx(tx);
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
      <div className="h-screen w-full bg-gray-50 flex flex-col overflow-hidden relative">

         {/* Header */}
         <header className="bg-white border-b border-gray-200 p-4 shadow-sm z-20">
            <div className="flex items-center gap-4 mb-4">
               <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
                  <ArrowLeft size={24} />
               </button>
               <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <FileText size={20} className={themeText} />
                  Historial de Ventas
               </h1>
            </div>

            {/* Smart Search Bar */}
            <div className="relative max-w-2xl mx-auto">
               <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
               <input
                  type="text"
                  placeholder="Buscar 'Ayer', 'Juan Pérez', '#1234'..."
                  className={`w-full pl-12 pr-4 py-3 bg-gray-100 border-none rounded-2xl focus:bg-white focus:ring-2 ${themeRing} focus:shadow-md outline-none transition-all text-gray-700 placeholder:text-gray-400`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
               />
            </div>
         </header>

         {/* Transactions List */}
         <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 max-w-4xl mx-auto w-full">
            {filteredTransactions.length === 0 ? (
               <div className="text-center py-20 opacity-50">
                  <Box size={48} className="mx-auto mb-2 text-gray-400" />
                  <p className="text-gray-500 font-medium">No se encontraron tickets</p>
               </div>
            ) : (
               filteredTransactions.map((tx, idx) => {
                  const isExpanded = expandedId === tx.id;
                  const isReturnActive = returnModeId === tx.id;
                  const isRefunded = tx.status === 'REFUNDED' || tx.status === 'PARTIAL_REFUND';
                  const isClosed = !!tx.zReportId || !!(tx as any)._isArchived;

                  return (
                     <div
                        key={tx.id || `tx-${idx}`}
                        className={`bg-white rounded-2xl shadow-sm border transition-all duration-300 overflow-hidden ${isReturnActive ? 'ring-2 ring-red-400 border-red-200 shadow-xl scale-[1.01] z-10' : 'border-gray-100 hover:shadow-md'
                           } ${isClosed ? 'bg-gray-100 border-gray-300' : ''}`}
                     >
                        {/* Card Header */}
                        <div
                           onClick={() => toggleExpand(tx.id)}
                           className="p-5 flex items-center justify-between cursor-pointer active:bg-gray-50"
                        >
                           <div className="flex items-center gap-4">
                              <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-white shadow-sm ${isRefunded ? 'bg-red-500' : isClosed ? 'bg-gray-500' : themeBg}`}>
                                 {isRefunded ? <RotateCcw size={20} /> : isClosed ? <Check size={24} strokeWidth={3} className="opacity-75" /> : <Check size={24} strokeWidth={3} />}
                              </div>
                              <div>
                                 <div className="flex items-center gap-2">
                                    <h3 className={`font-bold text-lg ${isClosed ? 'text-gray-600' : 'text-gray-900'}`}>Ticket #{tx.displayId || tx.id}</h3>
                                    {isRefunded && (
                                       <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-md ${tx.status === 'PARTIAL_REFUND' ? 'bg-orange-100 text-orange-600' : 'bg-red-100 text-red-600'
                                          }`}>
                                          {tx.status === 'PARTIAL_REFUND' ? 'Parcialmente Reembolsado' : 'Reembolsado'}
                                       </span>
                                    )}
                                    {isClosed && <span className="px-2 py-0.5 bg-gray-200 text-gray-600 text-[10px] font-bold uppercase rounded-md border border-gray-300">Cerrado</span>}
                                 </div>
                                 <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
                                    <span className="flex items-center gap-1"><Calendar size={14} /> {new Date(tx.date).toLocaleDateString()}</span>
                                    <span className="flex items-center gap-1"><UserIcon size={14} /> {tx.customerName || 'Cliente General'}</span>
                                    <span className="flex items-center gap-1 bg-gray-100 px-1.5 rounded text-[10px] uppercase font-bold text-gray-500 border border-gray-200">
                                       Terminal {tx.terminalId || 'N/A'}
                                    </span>
                                 </div>
                              </div>
                           </div>
                           <div className="text-right">
                              <p className={`text-xl font-black ${isRefunded ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                                 {config.currencySymbol}{tx.total.toFixed(2)}
                              </p>
                              {isRefunded && (
                                 <p className="text-[10px] font-black text-red-500 bg-red-50 px-1.5 py-0.5 rounded-md border border-red-100 mt-1">
                                    Reembolsado: {config.currencySymbol}{((tx.relatedTransactions || []).reduce((acc, relId) => acc + (transactions.find(t => t.id === relId)?.total || 0), 0)).toFixed(2)}
                                 </p>
                              )}
                              <p className="text-xs text-gray-400 font-medium">{new Date(tx.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                           </div>
                        </div>

                        {/* Expanded Content */}
                        {(isExpanded || isReturnActive) && (
                           <div className="border-t border-gray-100 bg-gray-50/50 animate-in slide-in-from-top-2 duration-200">
                              <div className="p-3 space-y-1">
                                 {tx.items.map((item, idx) => {
                                    const isSelected = selectedItemsQty.has(item.cartId);
                                    const returnQty = selectedItemsQty.get(item.cartId) || 0;
                                    return (
                                       <div
                                          key={item.cartId || `item-${idx}`}
                                          className={`p-3 rounded-xl transition-all ${isReturnActive ? 'border border-transparent' : ''}
                                          ${isSelected ? 'bg-red-50 border-red-200 shadow-sm' : ''}`}
                                       >
                                          <div className="flex justify-between items-start">
                                             <div className="flex items-center gap-3 flex-1">
                                                {isReturnActive && (
                                                   <div className="flex items-center gap-2">
                                                      <button
                                                         onClick={() => decrementReturnQty(item.cartId)}
                                                         className="w-7 h-7 rounded-lg bg-white border-2 border-gray-300 hover:border-red-500 hover:bg-red-50 text-gray-600 hover:text-red-600 font-black flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                                                         disabled={!isSelected}
                                                      >
                                                         −
                                                      </button>
                                                      <div className="w-10 text-center font-black text-lg text-gray-800">
                                                         {returnQty}
                                                      </div>
                                                      <button
                                                         onClick={() => incrementReturnQty(item.cartId, item.quantity)}
                                                         className="w-7 h-7 rounded-lg bg-red-500 border-2 border-red-500 text-white font-black flex items-center justify-center hover:bg-red-600 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                                                         disabled={returnQty >= item.quantity}
                                                      >
                                                         +
                                                      </button>
                                                   </div>
                                                )}
                                                <div>
                                                   <p className="font-bold text-gray-800 text-sm leading-tight">{item.name}</p>
                                                   <p className="text-[10px] text-gray-500 font-bold uppercase mt-1">
                                                      {item.quantity}x {config.currencySymbol}{item.price.toFixed(2)}
                                                   </p>
                                                   {item.salespersonId && (
                                                      <p className="text-[10px] text-blue-500 font-bold uppercase mt-0.5">
                                                         Vendedor: {users.find(u => u.id === item.salespersonId)?.name || 'Desconocido'}
                                                      </p>
                                                   )}
                                                   {item.note && (
                                                      <div className="mt-1 flex items-start gap-1 text-[10px] text-yellow-700 font-medium italic">
                                                         <StickyNote size={10} className="mt-0.5" />
                                                         <span>Nota: {item.note}</span>
                                                      </div>
                                                   )}
                                                   {/* Properties visiblity in history */}
                                                   {item.modifiers && item.modifiers.length > 0 && (
                                                      <div className="flex gap-1 mt-1">
                                                         {item.modifiers.map((m, mi) => (
                                                            <span key={mi} className="text-[9px] font-black uppercase text-blue-500 bg-blue-50 px-1 rounded border border-blue-100">{m}</span>
                                                         ))}
                                                      </div>
                                                   )}
                                                </div>
                                             </div>
                                             <div className="text-right">
                                                <span className="font-bold text-gray-700 text-sm">{config.currencySymbol}{(item.price * item.quantity).toFixed(2)}</span>
                                                {isReturnActive && isSelected && (
                                                   <p className="text-[10px] font-black text-red-600 mt-1">
                                                      A devolver: {config.currencySymbol}{(item.price * returnQty).toFixed(2)}
                                                   </p>
                                                )}
                                             </div>
                                          </div>
                                       </div>
                                    );
                                 })}
                              </div>

                              {/* Linked Documents Section */}
                              {tx.relatedTransactions && tx.relatedTransactions.length > 0 && (
                                 <div className="mx-3 mt-1 mb-3 p-3 bg-white rounded-xl border border-gray-100 shadow-sm">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                                       <FileText size={10} /> Documentos Vinculados
                                    </p>
                                    <div className="space-y-2">
                                       {tx.relatedTransactions.map(relId => {
                                          const relTx = (transactions || []).find(t => t.id === relId);
                                          if (!relTx) return null;
                                          return (
                                             <div key={relId} className="flex items-center justify-between text-xs">
                                                <div className="flex items-center gap-2 text-gray-700">
                                                   <span className="text-gray-400">📄</span>
                                                   <span className="font-bold">Nota de Crédito #{relTx.displayId || relTx.id}</span>
                                                   {relTx.ncf && <span className="text-[10px] text-gray-400 bg-gray-50 px-1 rounded border border-gray-100 font-mono">{relTx.ncf}</span>}
                                                </div>
                                                <span className="font-black text-red-500">-{config.currencySymbol}{relTx.total.toFixed(2)}</span>
                                             </div>
                                          );
                                       })}
                                    </div>
                                 </div>
                              )}

                              {/* Controls Footer */}
                              <div className="p-4 bg-white border-t border-gray-200 flex justify-between items-center gap-4">
                                 {!isReturnActive ? (
                                    <div className="flex gap-2 w-full">
                                       <button onClick={() => printTicket(tx, config)} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors">
                                          <Printer size={16} /> Re-imprimir
                                       </button>
                                       <button onClick={(e) => handlePrintGiftReceipt(e, tx)} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-50 text-purple-600 border border-purple-100 rounded-xl font-bold text-sm hover:bg-purple-100 transition-colors">
                                          <Gift size={16} /> Regalo
                                       </button>
                                       {!isRefunded && (
                                          <button onClick={(e) => startReturnMode(e, tx.id)} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 border border-red-100 rounded-xl font-bold text-sm hover:bg-red-100 transition-colors">
                                             <RotateCcw size={16} /> Devolución
                                          </button>
                                       )}
                                    </div>
                                 ) : (
                                    <div className="w-full">
                                       <div className="flex items-center justify-between mb-4 bg-red-50 p-4 rounded-2xl border border-red-100">
                                          <div className="flex items-center gap-2 text-red-700 font-bold text-sm"><AlertCircle size={18} /><span>Reembolso Activo</span></div>
                                          <div className="text-right"><p className="text-[10px] text-red-400 uppercase font-bold tracking-widest">A Devolver</p><p className="text-2xl font-black text-red-600">{config.currencySymbol}{currentRefundTotal.toFixed(2)}</p></div>
                                       </div>
                                       <div className="grid grid-cols-2 gap-3">
                                          <button onClick={cancelReturnMode} className="py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200">Cancelar</button>
                                          <button onClick={() => confirmRefund(tx)} disabled={selectedItemsQty.size === 0} className="py-3 bg-red-600 text-white rounded-xl font-bold shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"><Check size={18} /> Confirmar</button>
                                       </div>
                                    </div>
                                 )}
                              </div>
                           </div>
                        )}
                     </div>
                  );
               })
            )}
         </div>

         {/* GIFT RECEIPT MODAL */}
         {
            giftReceiptTx && (
               <div className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                  <div className="bg-white rounded-2xl shadow-2xl overflow-hidden w-full max-w-sm flex flex-col">
                     <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                        <h3 className="font-bold text-gray-800 flex items-center gap-2"><Gift className="text-purple-600" size={20} /> Ticket Regalo</h3>
                        <button onClick={() => setGiftReceiptTx(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                     </div>
                     <div className="p-6 bg-white overflow-y-auto max-h-[60vh] font-mono text-sm leading-relaxed text-gray-700">
                        <div className="text-center mb-6"><h2 className="font-bold text-lg uppercase">{config.companyInfo.name}</h2><p className="text-xs">{config.companyInfo.address}</p><p className="text-xs mt-2 font-bold">*** TICKET DE REGALO ***</p></div>
                        <div className="border-b-2 border-dashed border-gray-300 pb-2 mb-2 text-xs"><p>Fecha: {new Date(giftReceiptTx.date).toLocaleString()}</p><p>Ref: {giftReceiptTx.displayId || giftReceiptTx.id}</p></div>
                        <table className="w-full text-xs mb-4">
                           <thead><tr className="border-b border-gray-800"><th className="text-left py-1">Cant</th><th className="text-left py-1">Descripción</th></tr></thead>
                           <tbody>
                              {giftReceiptTx.items.map((item, i) => (
                                 <tr key={i}><td className="py-1 align-top w-8">{item.quantity}</td><td className="py-1 align-top">{item.name} {item.modifiers && <span className="text-[9px] uppercase opacity-50 block">{item.modifiers.join(' • ')}</span>}</td></tr>
                              ))}
                           </tbody>
                        </table>
                        <div className="border-t-2 border-dashed border-gray-300 pt-4 text-center space-y-4">
                           <p className="text-xs">Válido para cambios por 30 días.</p>
                           <div className="flex flex-col items-center"><QrCode size={64} className="text-gray-800" /><span className="text-[10px] mt-1">{giftReceiptTx.displayId || giftReceiptTx.id}</span></div>
                        </div>
                     </div>
                     <div className="p-4 bg-gray-50 border-t border-gray-200">
                        <button onClick={() => { alert("Imprimiendo..."); setGiftReceiptTx(null); }} className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold shadow-lg hover:bg-purple-700 transition-transform active:scale-95 flex items-center justify-center gap-2"><Printer size={20} /> Imprimir Ticket</button>
                     </div>
                  </div>
               </div>
            )
         }

         {/* Supervisor Modal */}
         <SupervisorModal {...supervisorModalProps} users={users} />

      </div>
   );
};

export default TicketHistory;
