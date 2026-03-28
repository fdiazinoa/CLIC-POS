
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
   X, CreditCard, Banknote, QrCode, CheckCircle2,
   Trash2, Plus, Wallet, Printer, Mail, ShieldAlert,
   Repeat, ArrowRightLeft, DollarSign, Zap, Smartphone
} from 'lucide-react';
import { PaymentEntry, PaymentMethod, BusinessConfig, CurrencyConfig, CartItem, Transaction, Customer, User, Permission, RoleDefinition } from '../types';
import { printTicket } from '../utils/printer';
import { networkSyncService } from '../services/sync/NetworkSyncService';

interface PaymentModalProps {
   total: number;
   items: CartItem[]; // Added items prop
   currencySymbol: string;
   config?: BusinessConfig;
   onClose: () => void;
   onConfirm: (payments: PaymentEntry[]) => Promise<Transaction | null>;
   themeColor: string;
   customer?: Customer | null;
   isDelinquent?: boolean;
   users: User[];
   isMaster?: boolean;
   currentUser?: User | null;
   roles?: RoleDefinition[];
}

type ResolvedPaymentMethod = {
   key: string;
   id: string;
   type: PaymentMethod;
   label: string;
   iconName?: string;
   Icon: React.ElementType;
};

const PAYMENT_ICON_BY_NAME: Record<string, React.ElementType> = {
   Banknote,
   CreditCard,
   QrCode,
   Wallet,
   DollarSign,
   Smartphone,
   Zap,
   CardIcon: CreditCard
};

const getDefaultIconByType = (type: PaymentMethod): React.ElementType => {
   switch (type) {
      case 'CASH':
         return Banknote;
      case 'CARD':
      case 'CREDIT':
         return CreditCard;
      case 'QR':
         return QrCode;
      case 'WALLET':
         return Wallet;
      case 'ADVANCE':
         return ArrowRightLeft;
      default:
         return Wallet;
   }
};

const createPaymentId = (): string => {
   if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
   }
   return `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

const getDefaultLabelByType = (type: PaymentMethod): string => {
   switch (type) {
      case 'CASH':
         return 'Efectivo';
      case 'CARD':
         return 'Tarjeta';
      case 'QR':
         return 'Digital';
      case 'WALLET':
         return 'Wallet';
      case 'CREDIT':
         return 'Crédito';
      case 'ADVANCE':
         return 'Anticipo';
      default:
         return 'Otro';
   }
};

import SupervisorAuthModal from './SupervisorAuthModal';

const UnifiedPaymentModal: React.FC<PaymentModalProps> = ({ total, items, currencySymbol, config, onClose, onConfirm, themeColor, customer, isDelinquent, users, isMaster, currentUser, roles }) => {
   const [payments, setPayments] = useState<PaymentEntry[]>([]);
   const [activeMethodKey, setActiveMethodKey] = useState<string>('');
   const [inputAmount, setInputAmount] = useState<string>('');
   const [isSuccessScreen, setIsSuccessScreen] = useState(false);
   const [completedTransaction, setCompletedTransaction] = useState<Transaction | null>(null);
   const [shouldClearInput, setShouldClearInput] = useState(true);
   const [isFinalizing, setIsFinalizing] = useState(false);
   const [finalizeError, setFinalizeError] = useState<string | null>(null);
   const [isOnline, setIsOnline] = useState(networkSyncService.getStatus().isOnline);
   const [isVerifyingWallet, setIsVerifyingWallet] = useState(false);
   const [verifiedBalance, setVerifiedBalance] = useState<number | null>(null);
   const [showSupervisorModal, setShowSupervisorModal] = useState(false);
   const [isOverrideActive, setIsOverrideActive] = useState(false);

   const userPermissions = useMemo(() => {
      if (!currentUser) return [];
      const rolesSource = roles || config?.roles || [];
      const role = rolesSource.find(r => r.id === currentUser.roleId || r.id === currentUser.role);
      return role?.permissions || [];
   }, [currentUser, config?.roles, roles]);

   const hasPermission = (perm: Permission) => userPermissions.includes('ALL') || userPermissions.includes(perm);

   useEffect(() => {
      const unsubscribe = networkSyncService.subscribe(status => {
         setIsOnline(status.isOnline);
      });
      return unsubscribe;
   }, []);

   // Effect to reset verified balance when customer or method changes
   useEffect(() => {
      setVerifiedBalance(null);
   }, [customer?.id, activeMethodKey]);

   const currencies = config?.currencies || [];
   const baseCurrency = currencies.find(c => c.isBase) || { code: 'DOP', symbol: 'RD$', rate: 1 };
   const [selectedCurrency, setSelectedCurrency] = useState<CurrencyConfig>(baseCurrency as CurrencyConfig);

   // Lock total/refund mode at modal open to avoid recalculating to 0 when parent clears cart.
   const [isRefund] = useState(() => total < 0);
   const [absTotal] = useState(() => Math.abs(total));
   const totalPaid = payments.reduce((acc, p) => acc + p.amount, 0);
   const remaining = Math.max(0, parseFloat((absTotal - totalPaid).toFixed(2)));
   const change = Math.max(0, parseFloat((totalPaid - absTotal).toFixed(2)));
   const typedAmount = parseFloat(inputAmount || '0');
   const typedAmountInBase = Number.isFinite(typedAmount) && typedAmount > 0
      ? parseFloat((typedAmount * selectedCurrency.rate).toFixed(2))
      : 0;
   const canFinalizeWithTypedAmount = remaining > 0.01 && typedAmountInBase >= (remaining - 0.01);
   const canFinalize = remaining <= 0.01 || canFinalizeWithTypedAmount;

   const configuredMethods = useMemo<ResolvedPaymentMethod[]>(() => {
      const enabledConfigMethods = (config?.paymentMethods || []).filter(m => m.isEnabled);

      const fromConfig = enabledConfigMethods.map((method, index) => {
         const IconFromName = method.icon ? PAYMENT_ICON_BY_NAME[method.icon] : undefined;
         return {
            key: `${method.id}-${index}`,
            id: method.id,
            type: method.type,
            label: method.name || getDefaultLabelByType(method.type),
            iconName: method.icon,
            Icon: IconFromName || getDefaultIconByType(method.type)
         };
      });

      const methods = fromConfig.length > 0 ? fromConfig : [
         { key: 'CASH', id: 'CASH', type: 'CASH' as PaymentMethod, label: 'Efectivo', iconName: 'Banknote', Icon: Banknote },
         { key: 'CARD', id: 'CARD', type: 'CARD' as PaymentMethod, label: 'Tarjeta', iconName: 'CreditCard', Icon: CreditCard },
         { key: 'QR', id: 'QR', type: 'QR' as PaymentMethod, label: 'Digital', iconName: 'QrCode', Icon: QrCode }
      ];

      const hasWalletMethod = methods.some(m => m.type === 'WALLET');
      if (customer?.wallet && !hasWalletMethod) {
         methods.push({
            key: 'WALLET',
            id: 'WALLET',
            type: 'WALLET',
            label: 'Saldo a Favor',
            iconName: 'Wallet',
            Icon: Wallet
         });
      }

      return methods;
   }, [config?.paymentMethods, customer?.wallet]);

   const activePaymentMethod = useMemo(
      () => configuredMethods.find(method => method.key === activeMethodKey) || configuredMethods[0] || null,
      [configuredMethods, activeMethodKey]
   );

   const activeMethod = activePaymentMethod?.type || 'CASH';

   const denominations = selectedCurrency.code === 'USD' ? [1, 5, 10, 20, 50, 100] : [50, 100, 200, 500, 1000, 2000];

   useEffect(() => {
      if (configuredMethods.length === 0) return;
      if (!configuredMethods.some(method => method.key === activeMethodKey)) {
         setActiveMethodKey(configuredMethods[0].key);
      }
   }, [configuredMethods, activeMethodKey]);

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

      // Permission Check: Credit requires POS_PAY_CREDIT
      if (activePaymentMethod.type === 'CREDIT' && !hasPermission('POS_PAY_CREDIT')) {
         setFinalizeError(`No tiene permisos para realizar ventas a crédito.`);
         return;
      }

      // Strict Online Check: Credit and Wallet require connection (unless Master)
      if (!isOnline && !isMaster && (activePaymentMethod.type === 'CREDIT' || activePaymentMethod.type === 'WALLET')) {
         setFinalizeError(`El pago con ${activePaymentMethod.label} requiere conexión con la Terminal Master.`);
         return;
      }

      const amountInBase = valInSelectedCurrency * selectedCurrency.rate;

      // Credit Limit Check (NEW)
      if (activePaymentMethod.type === 'CREDIT' && !isOverrideActive) {
         // Check if user has permission to override
         if (!hasPermission('POS_CREDIT_OVERRIDE')) {
            const limit = customer?.creditLimit || 0;
            const currentDebt = customer?.currentDebt || 0;
            if (limit > 0 && (currentDebt + amountInBase) > limit) {
               setFinalizeError(`Límite de crédito excedido (${currencySymbol}${limit.toFixed(2)}). Requiere autorización.`);
               setShowSupervisorModal(true);
               return;
            }
         }
      }

      const newPayment: PaymentEntry = {
         id: createPaymentId(),
         method: activePaymentMethod.type,
         methodId: activePaymentMethod.id,
         methodLabel: activePaymentMethod.label,
         methodIcon: activePaymentMethod.iconName,
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

   const handleFinalize = async () => {
      if (isFinalizing) return;
      if (!canFinalize) {
         alert("Monto insuficiente");
         return;
      }

      setFinalizeError(null);
      setIsFinalizing(true);
      try {
         let paymentsToConfirm = payments;

         // UX: If cashier typed an amount but didn't press "Agregar",
         // auto-create the payment entry so "Finalizar Venta" still works.
         if (canFinalizeWithTypedAmount) {
            if (!activePaymentMethod) {
               setFinalizeError('Seleccione un método de pago.');
               return;
            }

            // Permission Check: Credit requires POS_PAY_CREDIT during auto-finalize too
            if (activePaymentMethod.type === 'CREDIT' && !hasPermission('POS_PAY_CREDIT')) {
               setFinalizeError(`No tiene permisos para realizar ventas a crédito.`);
               setIsFinalizing(false);
               return;
            }

            // Strict Online Check: Credit and Wallet require connection during finalization too (unless Master)
            if (!isOnline && !isMaster && (activePaymentMethod.type === 'CREDIT' || activePaymentMethod.type === 'WALLET')) {
               setFinalizeError(`El pago con ${activePaymentMethod.label} requiere conexión con la Terminal Master.`);
               setIsFinalizing(false);
               return;
            }

            // Credit Limit Check for Auto-Finalize (NEW)
            if (activePaymentMethod.type === 'CREDIT' && !isOverrideActive) {
               // Check if user has permission to override
               if (!hasPermission('POS_CREDIT_OVERRIDE')) {
                  const limit = customer?.creditLimit || 0;
                  const currentDebt = customer?.currentDebt || 0;
                  if (limit > 0 && (currentDebt + typedAmountInBase) > limit) {
                     setFinalizeError(`Límite de crédito excedido (${currencySymbol}${limit.toFixed(2)}). Requiere autorización.`);
                     setShowSupervisorModal(true);
                     setIsFinalizing(false);
                     return;
                  }
               }
            }

            const autoPayment: PaymentEntry = {
               id: createPaymentId(),
               method: activePaymentMethod.type,
               methodId: activePaymentMethod.id,
               methodLabel: activePaymentMethod.label,
               methodIcon: activePaymentMethod.iconName,
               amount: typedAmountInBase,
               timestamp: new Date(),
               currencyCode: selectedCurrency.code,
               amountOriginal: typedAmount,
               exchangeRate: selectedCurrency.rate
            };
            paymentsToConfirm = [...payments, autoPayment];
            setPayments(paymentsToConfirm);
         }

         // Zero Price Check
         const hasZeroPriceItem = items.some(item => item.price === 0);
         if (hasZeroPriceItem && !hasPermission('POS_ALLOW_ZERO_PRICE') && !isOverrideActive) {
            setFinalizeError(`Venta contiene artículos con precio en $0.00. Requiere autorización.`);
            setShowSupervisorModal(true);
            setIsFinalizing(false);
            return;
         }

         // Final safety check: ensure no CREDIT or WALLET payments are sent while offline (unless Master)
         if (!isOnline && !isMaster) {
            const blockedPayment = paymentsToConfirm.find(p => p.method === 'CREDIT' || p.method === 'WALLET');
            if (blockedPayment) {
               setFinalizeError(`El pago con ${blockedPayment.methodLabel} requiere conexión con la Terminal Master.`);
               setIsFinalizing(false);
               return;
            }
         }

         let slowProcessTimer: number | undefined;
         try {
            slowProcessTimer = window.setTimeout(() => {
               setFinalizeError('El cobro está tardando más de lo esperado, espere unos segundos...');
            }, 15000);
            const txn = await onConfirm(paymentsToConfirm);

            if (txn) {
               setCompletedTransaction(txn);
               setIsSuccessScreen(true);
            } else {
               setFinalizeError('No se pudo completar la venta. Verifique secuencia fiscal y configuración de terminal.');
            }
         } finally {
            if (slowProcessTimer) window.clearTimeout(slowProcessTimer);
         }
      } catch (error) {
         console.error('❌ Payment finalization failed:', error);
         const message = error instanceof Error ? error.message : '';
         setFinalizeError(message ? `Error al finalizar: ${message}` : 'Ocurrió un error al finalizar. Intente nuevamente.');
      } finally {
         setIsFinalizing(false);
      }
   };

   const themeBgClass = { blue: 'bg-blue-600', orange: 'bg-orange-600', gray: 'bg-gray-800' }[themeColor] || 'bg-indigo-600';
   const themeTextClass = { blue: 'text-blue-600', orange: 'text-orange-600', gray: 'text-gray-800' }[themeColor] || 'text-indigo-600';

   const getEntryIcon = (payment: PaymentEntry): React.ElementType => {
      if (payment.methodIcon && PAYMENT_ICON_BY_NAME[payment.methodIcon]) {
         return PAYMENT_ICON_BY_NAME[payment.methodIcon];
      }
      return getDefaultIconByType(payment.method);
   };

   const getEntryLabel = (payment: PaymentEntry): string => {
      return payment.methodLabel || getDefaultLabelByType(payment.method);
   };

   const [showEmailInput, setShowEmailInput] = useState(false);
   const [emailInput, setEmailInput] = useState('');
   const [isSendingEmail, setIsSendingEmail] = useState(false);
   const isClosingSuccessRef = useRef(false);

   const handleCloseSuccess = () => {
      if (isClosingSuccessRef.current) return;
      isClosingSuccessRef.current = true;
      setShowEmailInput(false);
      setEmailInput('');
      onClose();
      window.setTimeout(() => {
         isClosingSuccessRef.current = false;
      }, 0);
   };

   const handleSendEmail = async () => {
      if (!completedTransaction) return;

      // 1. Check if customer has email
      const customerEmail = completedTransaction.customerSnapshot?.email || customer?.email;

      if (customerEmail) {
         await sendReceiptEmail(customerEmail);
      } else {
         // 2. Show input if no email
         setShowEmailInput(true);
      }
   };

   const sendReceiptEmail = async (email: string) => {
      setIsSendingEmail(true);
      console.log('Sending Receipt Email. Transaction:', completedTransaction);
      try {
         const response = await fetch('/api/email/receipt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
               email,
               cart: completedTransaction?.items || [],
               total: completedTransaction?.total || 0,
               paymentMethod: completedTransaction?.payments?.[0]?.method || 'CASH',
               // New fields for thermal ticket design
               transactionId: completedTransaction?.displayId || completedTransaction?.id || 'PENDING-ID',
               ncf: completedTransaction?.ncf,
               date: completedTransaction?.date,
               customerName: completedTransaction?.customerSnapshot?.name || completedTransaction?.customerName,
               companyInfo: config?.companyInfo,
               currencySymbol: currencySymbol,
               subtotal: (completedTransaction?.netAmount || 0) + (completedTransaction?.discountAmount || 0),
               tax: completedTransaction?.taxAmount,
               discount: completedTransaction?.discountAmount,
               totalSavings: (completedTransaction?.items || []).reduce((sum, item) =>
                  sum + ((item.originalPrice || item.price) - item.price) * item.quantity, 0) + (completedTransaction?.discountAmount || 0),
               showSavings: config?.receiptConfig?.showSavings || false
            })
         });

         const data = await response.json();
         if (data.success) {
            alert(`Ticket enviado a ${email}`);
            setShowEmailInput(false);
         } else {
            alert('Error al enviar: ' + data.message);
         }
      } catch (error) {
         console.error('Error sending email:', error);
         alert('Error de conexión al enviar el correo');
      } finally {
         setIsSendingEmail(false);
      }
   };

   if (isSuccessScreen) {
      return (
         <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/90 backdrop-blur-md p-4">
            <div className="bg-white rounded-[2.5rem] w-full max-w-lg p-8 shadow-2xl flex flex-col items-center text-center relative">

               {/* Email Input Modal Overlay */}
               {showEmailInput && (
                  <div className="absolute inset-0 z-10 bg-white/95 backdrop-blur-sm rounded-[2.5rem] flex flex-col items-center justify-center p-8 animate-in fade-in">
                     <h3 className="text-xl font-black text-gray-800 mb-4">Enviar Ticket por Correo</h3>
                     <input
                        autoFocus
                        type="email"
                        placeholder="cliente@ejemplo.com"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        className="w-full p-4 bg-gray-100 rounded-xl border-2 border-transparent focus:border-blue-500 focus:bg-white outline-none transition-all mb-4 text-center font-bold text-lg"
                        onKeyDown={(e) => e.key === 'Enter' && sendReceiptEmail(emailInput)}
                     />
                     <div className="flex gap-3 w-full">
                        <button
                           onClick={() => setShowEmailInput(false)}
                           className="flex-1 py-3 rounded-xl bg-gray-200 font-bold text-gray-600 hover:bg-gray-300"
                        >
                           Cancelar
                        </button>
                        <button
                           onClick={() => sendReceiptEmail(emailInput)}
                           disabled={!emailInput || isSendingEmail}
                           className="flex-1 py-3 rounded-xl bg-blue-600 font-bold text-white hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                           {isSendingEmail ? 'Enviando...' : 'Enviar'}
                           <Mail size={18} />
                        </button>
                     </div>
                  </div>
               )}

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
                     <button onClick={() => {
                        if (!config || !completedTransaction) return;
                        printTicket(completedTransaction, config);
                     }} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-700 flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"><Printer size={18} /> Ticket</button>

                     <button
                        onClick={handleSendEmail}
                        disabled={isSendingEmail}
                        className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-700 flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
                     >
                        {isSendingEmail ? 'Enviando...' : 'Email'}
                        <Mail size={18} />
                     </button>
                  </div>
                  <button
                     type="button"
                     onClick={handleCloseSuccess}
                     onPointerUp={handleCloseSuccess}
                     className={`w-full py-4 rounded-xl font-bold text-white shadow-xl flex items-center justify-center gap-2 ${themeBgClass}`}
                  >
                     <Repeat size={20} /> Nueva Venta
                  </button>
               </div>
            </div>
         </div>
      );
   }

   return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-0 md:p-4">
         <div className="w-full max-w-[420px] h-full md:h-[880px] bg-[#f8f9fc] md:rounded-[2.5rem] shadow-2xl md:border-[8px] md:border-gray-900 flex flex-col relative overflow-hidden animate-in fade-in zoom-in-95">
            
            {/* Top Bar / Header */}
            <div className="px-6 pt-6 flex justify-between items-center shrink-0">
               <button onClick={onClose} className="p-2 -ml-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors border border-transparent active:scale-95">
                  <X size={24} />
               </button>
               <div className="flex gap-2">
                  {currencies.filter(c => c.isEnabled).map(c => (
                     <button
                        key={c.code}
                        onClick={() => setSelectedCurrency(c)}
                        className={`px-3 py-1 rounded-lg text-[10px] font-black tracking-widest transition-all border ${selectedCurrency.code === c.code ? `border-current ${themeTextClass} bg-white shadow-sm` : 'border-slate-200 text-gray-400 bg-white hover:bg-gray-50'}`}
                     >
                        {c.code}
                     </button>
                  ))}
               </div>
            </div>

            {/* Total Display */}
            <div className="px-6 py-4 flex flex-col items-center shrink-0">
               <p className={`text-[11px] font-black uppercase tracking-[0.2em] mb-1.5 ${isRefund ? 'text-rose-500' : 'text-slate-400'}`}>
                  {isRefund ? 'Monto a Devolver' : 'Total a Cobrar'}
               </p>
               <h1 className={`text-[40px] font-black leading-none tracking-tight ${isRefund ? 'text-rose-600' : 'text-[#0f172a]'}`}>
                  {currencySymbol}{absTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
               </h1>
            </div>

            {/* Content Area (Scrollable Payments List) */}
            <div className="flex-1 overflow-y-auto px-6 py-2 space-y-3 no-scrollbar">
               {payments.length === 0 ? (
                  <div className="h-24 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-2xl bg-white/50">
                     <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sin pagos registrados</p>
                  </div>
               ) : (
                  payments.map(p => {
                     const EntryIcon = getEntryIcon(p);
                     return (
                        <div key={p.id} className="flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-slate-100 animate-in slide-in-from-bottom-2">
                           <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-500 border border-slate-100">
                                 <EntryIcon size={20} />
                              </div>
                              <div>
                                 <span className="font-bold text-[14px] text-[#0f172a] block">{getEntryLabel(p)}</span>
                                 {p.currencyCode !== baseCurrency.code && (
                                    <span className="text-[10px] text-slate-400 font-bold">{p.amountOriginal} {p.currencyCode}</span>
                                 )}
                              </div>
                           </div>
                           <div className="flex items-center gap-3">
                              <span className="font-black text-[15px] text-[#0f172a]">{currencySymbol}{p.amount.toFixed(2)}</span>
                              <button onClick={() => handleRemovePayment(p.id)} className="p-2 bg-red-50 text-red-400 hover:text-red-500 rounded-full transition-colors active:scale-90">
                                 <X size={16} />
                              </button>
                           </div>
                        </div>
                     );
                  })
               )}

               {finalizeError && (
                  <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-600 flex items-start gap-2 shadow-sm">
                     <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                     <span>{finalizeError}</span>
                  </div>
               )}
            </div>

            {/* Summary Banner (Remaining/Change & Complete) */}
            <div className="px-6 py-5 bg-white border-t border-slate-100 shrink-0">
               <div className="flex justify-between items-end mb-4">
                  {change > 0 ? (
                     <div>
                        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-0.5">{isRefund ? 'Diferencia AF' : 'Cambio'}</p>
                        <p className="text-3xl font-black text-emerald-600 leading-none">{currencySymbol}{change.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                     </div>
                  ) : (
                     <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Restante</p>
                        <p className={`text-3xl font-black leading-none ${remaining > 0 ? (isRefund ? 'text-rose-500' : 'text-amber-500') : 'text-emerald-500'}`}>{currencySymbol}{remaining.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                     </div>
                  )}
                  <div className="text-right">
                     {isRefund && (
                        <div className="px-3 py-1 bg-rose-50 border border-rose-100 rounded-full text-[9px] font-black text-rose-600 uppercase tracking-widest">
                           Modo Devolución
                        </div>
                     )}
                  </div>
               </div>
               
               <button
                  onClick={handleFinalize}
                  disabled={!canFinalize || isFinalizing}
                  className={`w-full py-5 rounded-[1.25rem] font-black text-base text-white transition-all shadow-lg active:scale-[0.98] ${!canFinalize || isFinalizing ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' : `${isRefund ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#3070f0] hover:bg-blue-600'}`}`}
               >
                  {isFinalizing
                     ? 'PROCESANDO...'
                     : !canFinalize
                        ? 'PAGO INCOMPLETO'
                        : isRefund
                           ? 'PROCESAR DEVOLUCIÓN'
                           : 'FINALIZAR VENTA'}
               </button>
            </div>

            {/* Input & Keypad Section */}
            <div className="bg-slate-50/80 border-t border-slate-100 p-6 pb-8 md:pb-10 flex flex-col gap-4 shrink-0">
               {/* Payment Methods Tabs */}
               <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
                  {configuredMethods.map(method => {
                     const isSelected = activePaymentMethod?.key === method.key;
                     const isExceeded = method.type === 'CREDIT' && isDelinquent && !isOverrideActive;
                     return (
                        <button
                           key={method.key}
                           onClick={() => setActiveMethodKey(method.key)}
                           className={`flex-1 min-w-[90px] py-4 flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 transition-all ${isSelected ? `border-[#3070f0] text-[#3070f0] bg-[#f4f7ff] shadow-sm` : 'border-slate-200 text-slate-400 bg-white hover:bg-slate-50'} ${isExceeded ? 'bg-red-50/50' : ''}`}
                        >
                           <method.Icon size={24} />
                           <span className="font-bold text-[10px] uppercase tracking-[0.1em]">{method.label}</span>
                        </button>
                     );
                  })}
               </div>

               {/* Amount Input Display */}
               <div className="bg-[#f1f5f9] rounded-2xl px-5 py-4 flex items-center justify-between border border-slate-200 shadow-inner">
                  <span className="text-xl font-bold text-slate-400">{selectedCurrency.symbol}</span>
                  <span className="text-4xl font-extrabold text-[#0f172a] font-mono">{inputAmount || '0.00'}</span>
               </div>

               {/* Numeric Keypad Grid */}
               <div className="grid grid-cols-4 gap-2.5 h-[280px]">
                  {[1, 2, 3].map(n => (
                     <button key={n} onClick={() => handleNumPad(n.toString())} className="bg-white border border-slate-200 rounded-xl text-[26px] font-black text-[#0f172a] shadow-sm hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center">{n}</button>
                  ))}
                  
                  <button
                     onClick={() => handleAddPayment()}
                     className="bg-[#3070f0] hover:bg-blue-600 text-white rounded-xl font-black text-[11px] uppercase tracking-widest flex flex-col items-center justify-center gap-2 shadow-lg row-span-2 transition-all active:scale-95"
                  >
                     <Plus size={24} strokeWidth={3} />
                     Agregar
                  </button>

                  {[4, 5, 6].map(n => (
                     <button key={n} onClick={() => handleNumPad(n.toString())} className="bg-white border border-slate-200 rounded-xl text-[26px] font-black text-[#0f172a] shadow-sm hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center">{n}</button>
                  ))}
                  
                  {[7, 8, 9].map(n => (
                     <button key={n} onClick={() => handleNumPad(n.toString())} className="bg-white border border-slate-200 rounded-xl text-[26px] font-black text-[#0f172a] shadow-sm hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center">{n}</button>
                  ))}

                  <button onClick={() => handleNumPad('BACK')} className="flex items-center justify-center text-red-400 hover:text-red-500 transition-colors active:scale-90">
                     <Trash2 size={28} />
                  </button>

                  <button onClick={() => handleNumPad('C')} className="bg-[#e2e8f0] border border-slate-200 rounded-xl text-xl font-black text-[#0f172a] shadow-sm hover:bg-slate-300 active:scale-95 transition-all flex items-center justify-center">C</button>
                  <button onClick={() => handleNumPad('0')} className="bg-white border border-slate-200 rounded-xl text-[26px] font-black text-[#0f172a] shadow-sm hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center">0</button>
                  <button onClick={() => handleNumPad('.')} className="bg-white border border-slate-200 rounded-xl text-[26px] font-black text-[#0f172a] shadow-sm hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center">.</button>
                  <div></div>
               </div>
            </div>
         </div>

         {showSupervisorModal && (
            <SupervisorAuthModal
               isOpen={showSupervisorModal}
               onClose={() => setShowSupervisorModal(false)}
               onSuccess={() => {
                  setIsOverrideActive(true);
                  setShowSupervisorModal(false);
               }}
               users={users}
               requiredPermission="POS_CREDIT_OVERRIDE"
            />
         )}
      </div>
   );
};

export default UnifiedPaymentModal;
