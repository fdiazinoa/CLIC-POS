/**
 * KioskPayment
 * 
 * Payment screen for self-checkout kiosk.
 * Touch-friendly payment interface with card/cash options.
 * IMPROVED: Shows all items, promotions, and clear receipt-style summary.
 */

import React, { useMemo, useState } from 'react';
import { CreditCard, Banknote, ArrowLeft, CheckCircle, User, Smartphone, Printer, Mail, XCircle, QrCode, Wallet, DollarSign, Zap, Search, Ticket, X } from 'lucide-react';
import { CartItem, Customer, PaymentMethod, RedeemedCouponRef, Transaction } from '../../types';
import { sendReceiptEmailViaErp } from '../../services/email/receiptEmailService';

export type KioskResolvedPaymentMethod = {
    key: string;
    id: string;
    type: PaymentMethod;
    label: string;
    iconName?: string;
    integrationProvider?: string;
    integrationMode?: 'MANUAL' | 'INTEGRATED';
};

export type KioskPaymentTotals = {
    subtotal: number;
    tax: number;
    total: number;
    subtotalBeforeDiscounts: number;
    totalSavings: number;
    discountAmount?: number;
    taxIncluded: boolean;
    taxLabel?: string;
};

type KioskLookupMode = 'ID' | 'PHONE' | 'COUPON';

export type KioskActionResult = {
    success: boolean;
    message: string;
};

interface KioskPaymentProps {
    cart: CartItem[];
    paymentMethods: KioskResolvedPaymentMethod[];
    totals?: KioskPaymentTotals;
    selectedCustomer?: Customer | null;
    redeemedCoupon?: RedeemedCouponRef | null;
    onLookupCustomerByCode?: (code: string) => KioskActionResult;
    onLookupCustomerByPhone?: (phone: string) => KioskActionResult;
    onRedeemCoupon?: (code: string) => KioskActionResult;
    onClearCustomer?: () => void;
    onClearCoupon?: () => void;
    onBack: () => void;
    onPaymentComplete: (paymentMethod: KioskResolvedPaymentMethod) => Promise<Transaction | null>;
    onPrintReceipt: (transaction: Transaction) => Promise<boolean>;
    onCancel: () => void;
}

const PAYMENT_ICON_BY_NAME = {
    Banknote,
    CreditCard,
    QrCode,
    Wallet,
    DollarSign,
    Smartphone,
    Zap,
    CardIcon: CreditCard
} as const;

const getPaymentIcon = (method: KioskResolvedPaymentMethod) => {
    if (method.iconName && method.iconName in PAYMENT_ICON_BY_NAME) {
        return PAYMENT_ICON_BY_NAME[method.iconName as keyof typeof PAYMENT_ICON_BY_NAME];
    }

    switch (method.type) {
        case 'CASH':
            return Banknote;
        case 'CARD':
        case 'CREDIT':
            return CreditCard;
        case 'QR':
            return QrCode;
        case 'WALLET':
        case 'STORE_CREDIT':
            return Wallet;
        default:
            return DollarSign;
    }
};

const getPaymentAccent = (method: KioskResolvedPaymentMethod) => {
    switch (method.type) {
        case 'CASH':
            return {
                hoverBg: 'hover:bg-green-50',
                border: 'border-green-100 hover:border-green-500',
                text: 'text-green-600',
                iconBg: 'bg-green-100',
            };
        case 'QR':
            return {
                hoverBg: 'hover:bg-violet-50',
                border: 'border-violet-100 hover:border-violet-500',
                text: 'text-violet-600',
                iconBg: 'bg-violet-100',
            };
        case 'WALLET':
        case 'STORE_CREDIT':
            return {
                hoverBg: 'hover:bg-amber-50',
                border: 'border-amber-100 hover:border-amber-500',
                text: 'text-amber-600',
                iconBg: 'bg-amber-100',
            };
        case 'CARD':
        case 'CREDIT':
        default:
            return {
                hoverBg: 'hover:bg-blue-50',
                border: 'border-blue-100 hover:border-blue-500',
                text: 'text-blue-600',
                iconBg: 'bg-blue-100',
            };
    }
};

const getPaymentSupportText = (method: KioskResolvedPaymentMethod) => {
    if (method.type === 'CARD' && method.integrationMode === 'INTEGRATED' && method.integrationProvider) {
        return `Procesa con ${method.integrationProvider}`;
    }

    if (method.type === 'CARD') {
        return 'Tarjeta configurada en Métodos de Pago';
    }

    if (method.type === 'CASH') {
        return 'Efectivo configurado en Métodos de Pago';
    }

    if (method.type === 'WALLET' || method.type === 'STORE_CREDIT') {
        return 'Usa el saldo disponible del cliente identificado';
    }

    return 'Método configurado en Métodos de Pago';
};

const KioskPayment: React.FC<KioskPaymentProps> = ({
    cart,
    paymentMethods,
    totals,
    selectedCustomer,
    redeemedCoupon,
    onLookupCustomerByCode,
    onLookupCustomerByPhone,
    onRedeemCoupon,
    onClearCustomer,
    onClearCoupon,
    onBack,
    onPaymentComplete,
    onPrintReceipt,
    onCancel
}) => {
    const [step, setStep] = useState<'LOYALTY' | 'PAYMENT' | 'PROCESSING' | 'SUCCESS' | 'EMAIL_INPUT'>('LOYALTY');
    const [selectedMethod, setSelectedMethod] = useState<KioskResolvedPaymentMethod | null>(null);
    const [completedTransaction, setCompletedTransaction] = useState<Transaction | null>(null);
    const [isPrintingReceipt, setIsPrintingReceipt] = useState(false);
    const [email, setEmail] = useState('');
    const [sendingEmail, setSendingEmail] = useState(false);
    const [emailSent, setEmailSent] = useState(false);
    const [lookupMode, setLookupMode] = useState<KioskLookupMode | null>(null);
    const [lookupValue, setLookupValue] = useState('');
    const [lookupMessage, setLookupMessage] = useState('');

    // Calculate totals
    const cartGrossTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const rawSubtotalBeforeDiscounts = cart.reduce((sum, item) => sum + ((item.originalPrice || item.price) * item.quantity), 0);
    const subtotal = totals?.subtotal ?? cartGrossTotal;
    const totalSavings = totals?.totalSavings ?? Math.max(0, rawSubtotalBeforeDiscounts - cartGrossTotal);
    const tax = totals?.tax ?? cartGrossTotal * 0.18; // 18% ITBIS fallback
    const total = totals?.total ?? (cartGrossTotal + tax);
    const taxLabel = totals?.taxLabel || (totals?.taxIncluded ? 'ITBIS incluido' : 'ITBIS');
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    const availablePaymentMethods = useMemo(
        () => paymentMethods.length > 0
            ? paymentMethods
            : [
                { key: 'CARD', id: 'CARD', type: 'CARD' as PaymentMethod, label: 'Tarjeta' },
                { key: 'CASH', id: 'CASH', type: 'CASH' as PaymentMethod, label: 'Efectivo' },
            ],
        [paymentMethods]
    );
    const walletBalance = Number(selectedCustomer?.wallet?.balance || 0);
    const hasWallet = selectedCustomer?.wallet?.status === 'ACTIVE' && walletBalance > 0;

    const lookupConfig = {
        ID: {
            title: 'Escanear ID / Tarjeta',
            label: 'ID, tarjeta o QR',
            placeholder: 'Escanea o digita...',
            action: onLookupCustomerByCode,
        },
        PHONE: {
            title: 'Ingresar telefono',
            label: 'Telefono del cliente',
            placeholder: '809...',
            action: onLookupCustomerByPhone,
        },
        COUPON: {
            title: 'Escanear cupon',
            label: 'Codigo del cupon',
            placeholder: 'XXXX-XXXX',
            action: onRedeemCoupon,
        },
    } as const;

    const openLookup = (mode: KioskLookupMode) => {
        setLookupMode(mode);
        setLookupValue('');
        setLookupMessage('');
    };

    const closeLookup = () => {
        setLookupMode(null);
        setLookupValue('');
        setLookupMessage('');
    };

    const handleLookupSubmit = () => {
        if (!lookupMode || !lookupValue.trim()) return;
        const config = lookupConfig[lookupMode];
        const result = config.action?.(lookupValue.trim()) || {
            success: false,
            message: 'Esta opcion todavia no esta configurada.',
        };
        setLookupMessage(result.message);
        if (result.success) {
            setTimeout(closeLookup, 650);
        }
    };

    // Handle payment
    const handlePayment = async (method: KioskResolvedPaymentMethod) => {
        setSelectedMethod(method);
        setStep('PROCESSING');

        try {
            const transaction = await onPaymentComplete(method);
            if (!transaction) {
                throw new Error('No se pudo completar el pago.');
            }
            setCompletedTransaction(transaction);
            setStep('SUCCESS');
        } catch (error) {
            console.error('Error processing kiosk payment:', error);
            alert(error instanceof Error ? error.message : 'No se pudo completar el pago.');
            setSelectedMethod(null);
            setStep('PAYMENT');
        }
    };

    const handleFinish = () => {
        onCancel();
    };

    const handlePrint = async () => {
        if (!completedTransaction) {
            alert('No hay transacción lista para imprimir.');
            return;
        }

        setIsPrintingReceipt(true);
        try {
            const printed = await onPrintReceipt(completedTransaction);
            if (!printed) {
                throw new Error('No se pudo imprimir el recibo.');
            }
            handleFinish();
        } catch (error) {
            console.error('Error printing kiosk receipt:', error);
            alert(error instanceof Error ? error.message : 'No se pudo imprimir el recibo.');
        } finally {
            setIsPrintingReceipt(false);
        }
    };

    const handleSendEmail = async () => {
        if (!email) return;
        setSendingEmail(true);

        try {
            const result = await sendReceiptEmailViaErp({
                email,
                cart,
                total,
                paymentMethod: selectedMethod || 'CARD'
            });
            if (!result.success) {
                throw new Error(result.message || 'Resend no confirmo el envio.');
            }

            setEmailSent(true);
            setTimeout(() => {
                handleFinish();
            }, 2000);
        } catch (error) {
            console.error('Error sending receipt:', error);
            setEmailSent(false);
            alert(error instanceof Error ? error.message : 'No se pudo enviar el ticket.');
        } finally {
            setSendingEmail(false);
        }
    };

    // Loyalty Screen
    if (step === 'LOYALTY') {
        return (
            <div className="w-full h-full flex flex-col bg-white animate-in fade-in">
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                    <div className="w-32 h-32 bg-blue-100 rounded-full flex items-center justify-center mb-8">
                        <User size={64} className="text-blue-600" />
                    </div>

                    <h1 className="text-5xl font-black text-gray-800 mb-4 text-center">
                        ¿Eres socio Clic-Club?
                    </h1>
                    <p className="text-2xl text-gray-500 mb-12 text-center max-w-2xl">
                        Acumula puntos y obtén descuentos exclusivos en esta compra.
                    </p>

                    {(selectedCustomer || redeemedCoupon) && (
                        <div className="w-full max-w-3xl mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                            {selectedCustomer && (
                                <div className="rounded-2xl bg-emerald-50 border-2 border-emerald-200 p-4 text-left">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-xs font-black uppercase tracking-widest text-emerald-600">Cliente identificado</p>
                                            <p className="text-xl font-black text-emerald-900">{selectedCustomer.name}</p>
                                            {hasWallet && (
                                                <p className="text-sm font-bold text-emerald-700">Wallet disponible: ${walletBalance.toFixed(2)}</p>
                                            )}
                                        </div>
                                        {onClearCustomer && (
                                            <button onClick={onClearCustomer} className="p-2 rounded-xl bg-white/80 text-emerald-700">
                                                <X size={18} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {redeemedCoupon && (
                                <div className="rounded-2xl bg-blue-50 border-2 border-blue-200 p-4 text-left">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-xs font-black uppercase tracking-widest text-blue-600">Cupon aplicado</p>
                                            <p className="text-xl font-black text-blue-900">{redeemedCoupon.code}</p>
                                        </div>
                                        {onClearCoupon && (
                                            <button onClick={onClearCoupon} className="p-2 rounded-xl bg-white/80 text-blue-700">
                                                <X size={18} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl mb-12">
                        <button onClick={() => openLookup('ID')} className="flex flex-col items-center justify-center p-8 bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 rounded-3xl transition-all group">
                            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm group-hover:scale-110 transition-transform">
                                <Search size={32} className="text-blue-600" />
                            </div>
                            <span className="text-xl font-bold text-blue-800">Escanear ID</span>
                        </button>

                        <button onClick={() => openLookup('PHONE')} className="flex flex-col items-center justify-center p-8 bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 rounded-3xl transition-all group">
                            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm group-hover:scale-110 transition-transform">
                                <Smartphone size={32} className="text-blue-600" />
                            </div>
                            <span className="text-xl font-bold text-blue-800">Ingresar Teléfono</span>
                        </button>

                        <button onClick={() => openLookup('COUPON')} className="flex flex-col items-center justify-center p-8 bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 rounded-3xl transition-all group">
                            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm group-hover:scale-110 transition-transform">
                                <Ticket size={32} className="text-blue-600" />
                            </div>
                            <span className="text-xl font-bold text-blue-800">Escanear Cupón</span>
                        </button>
                    </div>

                    <button
                        onClick={() => setStep('PAYMENT')}
                        className="text-gray-400 hover:text-gray-600 font-bold text-xl underline decoration-2 underline-offset-4"
                    >
                        Continuar como invitado
                    </button>
                </div>

                {lookupMode && (
                    <div className="fixed inset-0 z-[170] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6">
                        <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl p-6 animate-in fade-in zoom-in-95">
                            <div className="flex items-center justify-between mb-5">
                                <h3 className="text-2xl font-black text-gray-800">{lookupConfig[lookupMode].title}</h3>
                                <button onClick={closeLookup} className="w-11 h-11 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center">
                                    <X size={20} />
                                </button>
                            </div>
                            <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-2">
                                {lookupConfig[lookupMode].label}
                            </label>
                            <input
                                autoFocus
                                value={lookupValue}
                                onChange={(event) => {
                                    setLookupValue(lookupMode === 'COUPON' ? event.target.value.toUpperCase() : event.target.value);
                                    setLookupMessage('');
                                }}
                                onKeyDown={(event) => event.key === 'Enter' && handleLookupSubmit()}
                                placeholder={lookupConfig[lookupMode].placeholder}
                                className="w-full text-center text-2xl font-black tracking-widest p-5 bg-gray-50 border-2 border-gray-200 rounded-2xl outline-none focus:border-blue-500 focus:bg-white transition-all placeholder-gray-300"
                            />
                            {lookupMessage && (
                                <p className={`mt-3 text-center font-bold ${lookupMessage.startsWith('OK') ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {lookupMessage.replace(/^OK:\s*/, '')}
                                </p>
                            )}
                            <button
                                onClick={handleLookupSubmit}
                                disabled={!lookupValue.trim()}
                                className="w-full min-h-[64px] mt-5 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-black text-lg flex items-center justify-center gap-2"
                            >
                                <CheckCircle size={20} />
                                Validar
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // Processing Screen
    if (step === 'PROCESSING') {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-blue-50">
                    <div className="animate-pulse mb-8">
                        <div className="w-32 h-32 bg-blue-600 rounded-full flex items-center justify-center shadow-2xl">
                        {selectedMethod ? React.createElement(getPaymentIcon(selectedMethod), { size: 64, className: 'text-white', strokeWidth: 2.5 }) : (
                            <CreditCard size={64} className="text-white" strokeWidth={2.5} />
                        )}
                        </div>
                    </div>
                <h2 className="text-3xl font-bold text-gray-800">Procesando pago...</h2>
                <p className="text-gray-500 mt-2">
                    {selectedMethod?.type === 'CARD' && selectedMethod.integrationMode === 'INTEGRATED'
                        ? `Conectando con ${selectedMethod.integrationProvider || 'el procesador'}`
                        : selectedMethod?.type === 'CARD'
                            ? 'Por favor no retires tu tarjeta'
                            : `Confirmando ${selectedMethod?.label || 'pago'}`}
                </p>

                <div className="flex gap-4 mt-8">
                    <div className="w-4 h-4 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-4 h-4 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-4 h-4 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
            </div>
        );
    }

    // Success Screen
    if (step === 'SUCCESS') {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-green-50 p-8">
                <div className="animate-in zoom-in-95 fade-in max-w-4xl w-full flex flex-col items-center">
                    <div className="w-32 h-32 bg-green-500 rounded-full flex items-center justify-center mb-6 shadow-xl">
                        <CheckCircle size={80} className="text-white" strokeWidth={3} />
                    </div>

                    <h1 className="text-5xl font-black text-gray-800 mb-2 text-center">
                        ¡Pago Exitoso!
                    </h1>

                        <div className="bg-white p-6 rounded-3xl shadow-lg text-center w-full max-w-md mb-12">
                        <div className="text-4xl font-black text-green-600 mb-1">
                            ${total.toFixed(2)}
                        </div>
                        <div className="text-gray-400 font-medium">
                            Total Pagado
                        </div>
                    </div>

                    <h3 className="text-2xl font-bold text-gray-700 mb-8">
                        ¿Cómo quieres tu recibo?
                    </h3>

                    <div className="grid grid-cols-3 gap-6 w-full">
                        <button
                            onClick={() => setStep('EMAIL_INPUT')}
                            className="flex flex-col items-center justify-center p-6 bg-white hover:bg-green-50 border-2 border-gray-200 hover:border-green-200 rounded-2xl transition-all shadow-sm hover:shadow-md"
                        >
                            <Mail size={40} className="text-gray-600 mb-3" />
                            <span className="font-bold text-gray-700">Enviar por Email</span>
                        </button>

                        <button
                            onClick={handlePrint}
                            disabled={isPrintingReceipt || !completedTransaction}
                            className="flex flex-col items-center justify-center p-6 bg-white hover:bg-green-50 border-2 border-gray-200 hover:border-green-200 rounded-2xl transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Printer size={40} className="text-gray-600 mb-3" />
                            <span className="font-bold text-gray-700">{isPrintingReceipt ? 'Imprimiendo...' : 'Imprimir'}</span>
                        </button>

                        <button
                            onClick={handleFinish}
                            className="flex flex-col items-center justify-center p-6 bg-white hover:bg-gray-50 border-2 border-gray-200 rounded-2xl transition-all shadow-sm hover:shadow-md"
                        >
                            <XCircle size={40} className="text-gray-400 mb-3" />
                            <span className="font-bold text-gray-500">No necesito</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Email Input Screen
    if (step === 'EMAIL_INPUT') {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-white p-8 animate-in fade-in">
                <div className="w-full max-w-lg text-center">
                    <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Mail size={48} className="text-blue-600" />
                    </div>

                    <h2 className="text-4xl font-black text-gray-800 mb-4">
                        {emailSent ? '¡Correo Enviado!' : 'Ingresa tu Email'}
                    </h2>

                    {!emailSent ? (
                        <>
                            <p className="text-xl text-gray-500 mb-8">
                                Te enviaremos tu recibo digital al instante.
                            </p>

                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="ejemplo@correo.com"
                                className="w-full p-6 bg-gray-50 border-2 border-gray-200 rounded-2xl text-2xl font-medium outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 mb-8 text-center"
                                autoFocus
                            />

                            <div className="flex gap-4">
                                <button
                                    onClick={() => setStep('SUCCESS')}
                                    className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-xl font-bold text-lg hover:bg-gray-200 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSendEmail}
                                    disabled={!email || sendingEmail}
                                    className="flex-1 py-4 bg-blue-600 text-white rounded-xl font-bold text-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {sendingEmail ? (
                                        <span className="animate-pulse">Enviando...</span>
                                    ) : (
                                        <>
                                            Enviar
                                            <ArrowLeft size={20} className="rotate-180" />
                                        </>
                                    )}
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="animate-in zoom-in-95">
                            <p className="text-xl text-gray-500 mb-8">
                                Revisa tu bandeja de entrada.
                            </p>
                            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto animate-bounce">
                                <CheckCircle size={32} />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Payment Selection Screen (Default)
    return (
        <div className="w-full h-full flex flex-col bg-gray-50">
            {/* Header */}
            <div className="bg-white p-6 shadow-sm flex items-center gap-4 z-10">
                <button
                    onClick={onBack}
                    className="p-3 hover:bg-gray-100 rounded-xl transition-colors"
                >
                    <ArrowLeft size={24} className="text-gray-600" />
                </button>
                <h1 className="text-2xl font-bold text-gray-800">Método de Pago</h1>
            </div>

            <div className="flex-1 p-8 overflow-y-auto">
                <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 h-full">

                    {/* Left Column: Summary */}
                    <div className="space-y-6">
                        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                            <h3 className="font-bold text-gray-500 mb-4 uppercase tracking-wider text-sm">Resumen de Compra</h3>
                            <div className="space-y-3 mb-6 max-h-60 overflow-y-auto pr-2">
                                {cart.map(item => (
                                    <div key={item.id} className="flex justify-between items-start text-gray-700">
                                        <div>
                                            <span className="font-bold">{item.quantity}x</span> {item.name}
                                        </div>
                                        <span className="font-medium">${(item.price * item.quantity).toFixed(2)}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="border-t-2 border-dashed border-gray-100 pt-4 space-y-2">
                                <div className="flex justify-between text-gray-500">
                                    <span>Subtotal</span>
                                    <span>${subtotal.toFixed(2)}</span>
                                </div>

                                {totalSavings > 0 && (
                                    <div className="flex justify-between text-green-600 font-bold animate-pulse">
                                        <span>Ahorro Total</span>
                                        <span>-${totalSavings.toFixed(2)}</span>
                                    </div>
                                )}

                                <div className="flex justify-between text-gray-500">
                                    <span>{taxLabel}</span>
                                    <span>${tax.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-3xl font-black text-gray-900 pt-2">
                                    <span>Total</span>
                                    <span>${total.toFixed(2)}</span>
                                </div>
                            </div>
                        </div>

                        {totalSavings > 0 && (
                            <div className="mb-6 animate-in slide-in-from-top">
                                <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl p-6 shadow-lg flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="bg-white/20 p-3 rounded-xl">
                                            <CheckCircle size={32} className="text-white" />
                                        </div>
                                        <div>
                                            <div className="font-black text-white text-xl">
                                                ¡Ahorro por Ofertas!
                                            </div>
                                            <div className="text-white/90 text-sm">
                                                Has ahorrado en esta compra
                                            </div>
                                        </div>
                                    </div>
                                    <span className="font-black text-white text-4xl">
                                        -${totalSavings.toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right Column: Payment Methods */}
                    <div className="space-y-4">
                        {(selectedCustomer || redeemedCoupon) && (
                            <div className="rounded-3xl bg-white border border-gray-100 p-5 shadow-sm">
                                {selectedCustomer && (
                                    <div className="flex items-center justify-between text-left">
                                        <div>
                                            <p className="text-xs font-black uppercase tracking-widest text-gray-400">Cliente</p>
                                            <p className="font-black text-gray-800">{selectedCustomer.name}</p>
                                        </div>
                                        {hasWallet && (
                                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-black text-emerald-700">
                                                Wallet ${walletBalance.toFixed(2)}
                                            </span>
                                        )}
                                    </div>
                                )}
                                {redeemedCoupon && (
                                    <div className={`${selectedCustomer ? 'mt-3 pt-3 border-t border-gray-100' : ''} flex items-center justify-between text-left`}>
                                        <div>
                                            <p className="text-xs font-black uppercase tracking-widest text-gray-400">Cupon</p>
                                            <p className="font-black text-gray-800">{redeemedCoupon.code}</p>
                                        </div>
                                        {totalSavings > 0 && (
                                            <span className="rounded-full bg-green-50 px-3 py-1 text-sm font-black text-green-700">
                                                Ahorro ${totalSavings.toFixed(2)}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {availablePaymentMethods.map((method) => {
                            const Icon = getPaymentIcon(method);
                            const accent = getPaymentAccent(method);
                            return (
                                <button
                                    key={method.key}
                                    onClick={() => handlePayment(method)}
                                    className={`w-full p-8 bg-white ${accent.hoverBg} border-2 ${accent.border} rounded-3xl shadow-sm hover:shadow-xl transition-all group text-left relative overflow-hidden`}
                                >
                                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                        <Icon size={120} className={accent.text} />
                                    </div>
                                    <div className="relative z-10">
                                        <div className={`w-16 h-16 ${accent.iconBg} rounded-2xl flex items-center justify-center mb-4 ${accent.text} group-hover:scale-110 transition-transform`}>
                                            <Icon size={32} />
                                        </div>
                                <h3 className="text-2xl font-black text-gray-800 mb-1">{method.label}</h3>
                                <p className="text-gray-500">{getPaymentSupportText(method)}</p>
                            </div>
                        </button>
                            );
                        })}

                        <button
                            onClick={onCancel}
                            className="w-full p-4 text-gray-400 hover:text-red-500 font-bold transition-colors"
                        >
                            Cancelar Compra
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default KioskPayment;
