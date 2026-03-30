
import React, { useState, useEffect, useMemo } from 'react';
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

const createPaymentId = (): string => {
   if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
   }
   return `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
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

   const getCreditPaymentsTotal = (entries: PaymentEntry[]): number =>
      entries
         .filter((payment) => payment.method === 'CREDIT')
         .reduce((acc, payment) => acc + payment.amount, 0);

   const canBypassCreditLimit = isOverrideActive || hasPermission('POS_CREDIT_OVERRIDE');

   const enforceCreditRules = (projectedCreditTotal: number): boolean => {
      if (projectedCreditTotal <= 0) return true;

      if (!customer?.id) {
         setFinalizeError('Las ventas a crédito pendientes requieren un cliente asociado antes de guardar el ticket.');
         return false;
      }

      if (!canBypassCreditLimit) {
         const limit = customer.creditLimit || 0;
         const currentDebt = customer.currentDebt || 0;
         if (limit > 0 && (currentDebt + projectedCreditTotal) > limit) {
            setFinalizeError(`Límite de crédito excedido (${currencySymbol}${limit.toFixed(2)}). Requiere autorización.`);
            setShowSupervisorModal(true);
            return false;
         }
      }

      return true;
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

      if (activePaymentMethod.type === 'CREDIT') {
         const projectedCreditTotal = getCreditPaymentsTotal(payments) + amountInBase;
         if (!enforceCreditRules(projectedCreditTotal)) {
            return;
         }
      }

      const newPayment: PaymentEntry = {
         id: createPaymentId(),
         method: activePaymentMethod.type,
         methodId: activePaymentMethod.id,
         methodLabel: activePaymentMethod.label,
         methodIcon: activePaymentMethod.iconName,
         creditOverrideApproved: activePaymentMethod.type === 'CREDIT' && canBypassCreditLimit ? true : undefined,
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

            if (activePaymentMethod.type === 'CREDIT') {
               const projectedCreditTotal = getCreditPaymentsTotal(payments) + typedAmountInBase;
               if (!enforceCreditRules(projectedCreditTotal)) {
                  setIsFinalizing(false);
                  return;
               }
            }

            const autoPayment: PaymentEntry = {
               id: createPaymentId(),
               method: activePaymentMethod.type,
               methodId: activePaymentMethod.id,
               methodLabel: activePaymentMethod.label,
               methodIcon: activePaymentMethod.iconName,
               creditOverrideApproved: activePaymentMethod.type === 'CREDIT' && canBypassCreditLimit ? true : undefined,
               amount: typedAmountInBase,
               timestamp: new Date(),
               currencyCode: selectedCurrency.code,
               amountOriginal: typedAmount,
               exchangeRate: selectedCurrency.rate
            };
            paymentsToConfirm = [...payments, autoPayment];
            setPayments(paymentsToConfirm);
         }

         const totalCreditCommitted = getCreditPaymentsTotal(paymentsToConfirm);
         if (totalCreditCommitted > 0) {
            if (!enforceCreditRules(totalCreditCommitted)) {
               setIsFinalizing(false);
               return;
            }

            paymentsToConfirm = paymentsToConfirm.map((payment) =>
               payment.method === 'CREDIT'
                  ? { ...payment, creditOverrideApproved: payment.creditOverrideApproved || canBypassCreditLimit }
                  : payment
            );
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
                  <div className="flex items-end justify-between gap-4 mb-2">
                     <span className="text-lg md:text-xl font-black text-gray-700">Cobrado</span>
                     <span className="text-3xl md:text-4xl font-black text-gray-900">{currencySymbol}{totalPaid.toFixed(2)}</span>
                  </div>
                  {change > 0 && <div className="flex justify-between items-center pt-2 border-t border-gray-200 mt-2"><span className="text-green-600 font-bold">Cambio</span><span className="font-black text-green-600 text-2xl">{currencySymbol}{change.toFixed(2)}</span></div>}
               </div>
               <div className="w-full space-y-3">
                  <div className="flex gap-3">
                     <button
                        onClick={async () => {
                           if (!config || !completedTransaction) return;
                           await printTicket(completedTransaction, config);
                           onClose();
                        }}
                        className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-700 flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
                     >
                        <Printer size={18} /> Ticket
                     </button>

                     <button
                        onClick={handleSendEmail}
                        disabled={isSendingEmail}
                        className="flex-1 py-3 rounded-xl bg-gray-100 font-bold text-gray-700 flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
                     >
                        {isSendingEmail ? 'Enviando...' : 'Email'}
                        <Mail size={18} />
                     </button>
                  </div>
                  {hasPermission('POS_NEW_SALE') && (
                     <button onClick={onClose} className={`w-full py-4 rounded-xl font-bold text-white shadow-xl flex items-center justify-center gap-2 ${themeBgClass}`}><Repeat size={20} /> Nueva Venta</button>
                  )}
               </div>
            </div>
         </div>
      );
   }

   return (
      <div className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center bg-black/60 backdrop-blur-sm">
         <div className="bg-white w-full max-w-6xl h-[100dvh] lg:h-[85vh] lg:rounded-[2.5rem] shadow-2xl flex flex-col lg:flex-row overflow-hidden">

            {/* SUMMARY SECTION (Collapsible/Header on mobile, Sidebar on desktop) */}
            <div className="flex lg:w-[35%] w-full bg-gray-50 border-b lg:border-b-0 lg:border-r border-gray-200 flex-col p-4 md:p-6 lg:p-8 shrink-0">
               <div className="flex justify-between items-center mb-4 lg:mb-8">
                  <button onClick={onClose} className="p-2 -ml-2 text-gray-400 hover:bg-gray-200 rounded-full transition-colors"><X size={24} /></button>
                  <div className="flex md:hidden gap-1">
                     {currencies.filter(c => c.isEnabled).map(c => (
                        <button
                           key={c.code}
                           onClick={() => setSelectedCurrency(c)}
                           className={`px-3 py-1 rounded-lg text-[10px] font-black transition-all border ${selectedCurrency.code === c.code ? `border-blue-600 text-blue-600 bg-white` : 'border-transparent text-gray-400 bg-gray-100'}`}
                        >
                           {c.code}
                        </button>
                     ))}
                  </div>
               </div>

               <div className="mb-4 md:mb-8 flex flex-col md:block items-center md:items-start text-center md:text-left">
                  <p className={`font-medium uppercase text-[10px] md:text-xs tracking-widest mb-1 ${isRefund ? 'text-rose-500' : 'text-gray-500'}`}>
                     {isRefund ? 'Monto a Devolver' : 'Total a Cobrar'}
                  </p>
                  <h1 className={`text-3xl md:text-5xl font-black leading-none ${isRefund ? 'text-rose-600' : 'text-gray-900'}`}>
                     {currencySymbol}{absTotal.toFixed(2)}
                  </h1>

                  <div className="hidden lg:flex mt-6 gap-2">
                     {currencies.filter(c => c.isEnabled).map(c => (
                        <button
                           key={c.code}
                           onClick={() => setSelectedCurrency(c)}
                           className={`px-3 py-2 rounded-xl text-xs font-black transition-all border-2 ${selectedCurrency.code === c.code ? `border-current ${themeTextClass} bg-white shadow-sm` : 'border-transparent text-gray-400 bg-gray-100'}`}
                        >
                           {c.code}
                        </button>
                     ))}
                  </div>
               </div>

               {/* Payments List (Compact on mobile) */}
               <div className="flex-1 overflow-y-auto space-y-2 md:space-y-3 no-scrollbar max-h-[22vh] lg:max-h-full">
                  {payments.map(p => {
                     const EntryIcon = getEntryIcon(p);
                     return (
                        <div key={p.id} className="flex justify-between items-center bg-white p-3 md:p-4 rounded-xl md:rounded-2xl shadow-sm border border-gray-100 animate-in slide-in-from-left-2">
                           <div className="flex items-center gap-2 md:gap-3">
                              <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-blue-50 flex items-center justify-center text-slate-700 border border-blue-100">
                                 <EntryIcon size={16} strokeWidth={2.2} />
                              </div>
                              <div>
                                 <span className="font-bold text-[10px] md:text-xs text-gray-800 block">{getEntryLabel(p)}</span>
                                 {p.currencyCode !== baseCurrency.code && (
                                    <span className="text-[9px] md:text-[10px] text-gray-400 font-bold">{p.amountOriginal} {p.currencyCode}</span>
                                 )}
                              </div>
                           </div>
                           <div className="flex items-center gap-2 md:gap-4">
                              <span className="font-bold text-sm md:text-gray-900">{currencySymbol}{p.amount.toFixed(2)}</span>
                              <button
                                 onClick={() => handleRemovePayment(p.id)}
                                 className="p-1.5 rounded-full bg-red-50 border border-red-100 text-red-500 hover:bg-red-100 transition-colors"
                                 aria-label="Eliminar forma de pago"
                              >
                                 <Trash2 size={14} strokeWidth={2.4} />
                              </button>
                           </div>
                        </div>
                     );
                  })}
               </div>

               <div className="p-3 md:p-4 bg-white border-t border-gray-200 rounded-xl md:rounded-2xl mt-4 shadow-inner shrink-0">
                  {finalizeError && (
                     <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
                        {finalizeError}
                     </div>
                  )}
                  <div className="flex justify-between items-end mb-3 md:mb-4">
                     {change > 0 ? (
                        <div className="w-full text-right">
                           <p className="text-[9px] md:text-[10px] font-bold text-emerald-600 uppercase tracking-widest">{isRefund ? 'Diferencia a Favor' : 'Cambio'}</p>
                           <p className="text-xl md:text-3xl font-black text-emerald-600">{currencySymbol}{change.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                        </div>
                     ) : (
                        <div>
                           <p className="text-[9px] md:text-[10px] font-bold text-gray-400 uppercase tracking-widest">Restante</p>
                           <p className={`text-xl md:text-3xl font-black ${remaining > 0 ? (isRefund ? 'text-rose-500' : 'text-amber-500') : 'text-emerald-500'}`}>{currencySymbol}{remaining.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                        </div>
                     )}
                  </div>
                  <button
                     onClick={handleFinalize}
                     disabled={!canFinalize || isFinalizing}
                     className={`w-full py-3 md:py-4 rounded-xl md:rounded-2xl font-black text-sm md:text-base text-white transition-all shadow-lg ${!canFinalize || isFinalizing ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : `${isRefund ? 'bg-rose-600 hover:bg-rose-700' : `${themeBgClass} hover:brightness-110`}`}`}
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
            </div>

            {/* INPUT SECTION */}
            <div className="flex-1 flex flex-col bg-white overflow-y-auto min-h-0">
               {/* Payment Methods */}
               <div className="flex flex-wrap p-3 md:p-4 gap-3 md:gap-4 shrink-0">
                  {configuredMethods.map(method => {
                     const isExceeded = method.type === 'CREDIT' && isDelinquent && !isOverrideActive;
                     return (
                        <button
                           key={method.key}
                           onClick={() => setActiveMethodKey(method.key)}
                           className={`min-w-[calc(50%-0.375rem)] lg:min-w-[calc(33.333%-0.75rem)] xl:min-w-[120px] flex-1 py-3 md:py-4 rounded-2xl md:rounded-3xl border-2 flex flex-col items-center justify-center gap-1 md:gap-2 transition-all bg-white ${activePaymentMethod?.key === method.key ? `border-current ${themeTextClass} shadow-sm` : 'border-gray-200 text-slate-500 hover:border-gray-300 hover:bg-white'} ${isExceeded ? 'bg-red-50/50 border-red-200' : ''}`}
                        >
                           <method.Icon size={24} className="md:w-8 md:h-8" strokeWidth={2.4} />
                           <span className="font-black text-[9px] md:text-[10px] uppercase tracking-widest">{method.label}</span>
                           {isExceeded && (
                              <span className="text-[7px] text-red-600 font-bold">LÍMITE EXCEDIDO</span>
                           )}
                        </button>
                     );
                  })}
               </div>

               {isDelinquent && !isOverrideActive && (
                  <div className="mx-4 mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between">
                     <div className="flex items-center gap-2 text-red-700 text-[10px] md:text-xs font-bold">
                        <ShieldAlert size={16} />
                        <span>CLIENTE EN MORA - CRÉDITO RESTRINGIDO</span>
                     </div>
                     <button
                        onClick={() => setShowSupervisorModal(true)}
                        className="px-3 py-1 bg-red-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-red-700 transition-colors"
                     >
                        Override
                     </button>
                  </div>
               )}

               {/* Amount Input */}
               <div className="px-4 md:px-8 mt-1 shrink-0">
                  <div className="bg-gray-100 rounded-2xl md:rounded-[2rem] p-4 md:p-6 flex justify-between items-center border border-gray-200 shadow-inner">
                     <span className="text-xl md:text-3xl text-gray-400 font-black">{selectedCurrency.symbol}</span>
                     <input
                        type="text"
                        readOnly
                        value={inputAmount}
                        className="bg-transparent text-right text-3xl md:text-5xl font-mono font-black text-gray-800 w-full outline-none"
                        placeholder="0.00"
                     />
                  </div>

                  {activeMethod === 'CASH' && (
                     <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3 md:mt-4">
                        {denominations.map(d => (
                           <button
                              key={d}
                              onClick={() => handleAddPayment(d)}
                              className="py-2 bg-white border border-gray-200 rounded-lg md:rounded-xl text-[10px] md:text-xs font-black text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-all shadow-sm"
                           >
                              {selectedCurrency.symbol}{d}
                           </button>
                        ))}
                     </div>
                  )}

                  {activeMethod === 'WALLET' && customer?.wallet && (
                     <div className="mt-4 p-4 bg-purple-50 rounded-2xl border border-purple-100">
                        <div className="flex justify-between items-center mb-2">
                           <span className="text-xs font-bold text-purple-600 uppercase tracking-wider">Saldo Disponible</span>
                           <span className="text-xl font-black text-purple-700">{currencySymbol}{customer.wallet.balance.toFixed(2)}</span>
                        </div>
                        {customer.wallet.balance < parseFloat(inputAmount || '0') && (
                           <div className="text-[10px] font-bold text-red-500 flex items-center gap-1">
                              <ShieldAlert size={12} /> Saldo insuficiente
                           </div>
                        )}
                     </div>
                  )}
               </div>

               {/* Numpad - Responsive grid */}
               <div className="flex-1 p-3 md:p-6 lg:p-8 grid grid-cols-4 gap-2 md:gap-3 content-stretch min-h-[32vh]">
                  {[1, 2, 3].map(n => <button key={n} onClick={() => handleNumPad(n.toString())} className="bg-white border border-gray-100 rounded-xl md:rounded-2xl text-2xl md:text-3xl font-black text-gray-700 active:bg-gray-50 active:scale-95 transition-all shadow-sm">{n}</button>)}

                  <button
                     onClick={() => handleAddPayment()}
                     className={`row-span-2 rounded-2xl md:rounded-[2rem] font-black text-white shadow-xl flex flex-col items-center justify-center gap-1 md:gap-2 ${themeBgClass} active:scale-95 hover:brightness-110`}
                  >
                     <Plus size={28} className="md:w-8 md:h-8" />
                     <span className="text-[10px] tracking-widest uppercase">Agregar</span>
                  </button>

                  {[4, 5, 6].map(n => <button key={n} onClick={() => handleNumPad(n.toString())} className="bg-white border border-gray-100 rounded-xl md:rounded-2xl text-2xl md:text-3xl font-black text-gray-700 active:bg-gray-50 active:scale-95 transition-all shadow-sm">{n}</button>)}
                  {[7, 8, 9].map(n => <button key={n} onClick={() => handleNumPad(n.toString())} className="bg-white border border-gray-100 rounded-xl md:rounded-2xl text-2xl md:text-3xl font-black text-gray-700 active:bg-gray-50 active:scale-95 transition-all shadow-sm">{n}</button>)}

                  <button onClick={() => handleNumPad('BACK')} className="rounded-xl md:rounded-2xl bg-red-50 text-red-500 flex items-center justify-center active:scale-95 border border-red-100"><Trash2 size={24} className="md:w-7 md:h-7" /></button>
                  <button onClick={() => handleNumPad('C')} className="rounded-xl md:rounded-2xl bg-gray-200 text-gray-600 font-black text-lg md:text-xl active:scale-95 transition-all shadow-inner">C</button>
                  <button onClick={() => handleNumPad('0')} className="rounded-xl md:rounded-2xl bg-white border border-gray-100 text-2xl md:text-3xl font-black text-gray-700 active:bg-gray-50 active:scale-95 transition-all shadow-sm">0</button>
                  <button onClick={() => handleNumPad('.')} className="rounded-xl md:rounded-2xl bg-white border border-gray-100 text-2xl md:text-3xl font-black text-gray-700 active:bg-gray-50 active:scale-95 transition-all shadow-sm">.</button>
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
