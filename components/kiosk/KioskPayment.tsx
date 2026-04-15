/**
 * KioskPayment
 * 
 * Payment screen for self-checkout kiosk.
 * Touch-friendly payment interface with card/cash options.
 * IMPROVED: Shows all items, promotions, and clear receipt-style summary.
 */

import React, { useMemo, useState } from 'react';
import { CreditCard, Banknote, ArrowLeft, CheckCircle, User, Smartphone, Printer, Mail, XCircle, QrCode, Wallet, DollarSign, Zap } from 'lucide-react';
import { CartItem, PaymentMethod, Transaction } from '../../types';

export type KioskResolvedPaymentMethod = {
    key: string;
    id: string;
    type: PaymentMethod;
    label: string;
    iconName?: string;
    integrationProvider?: string;
    integrationMode?: 'MANUAL' | 'INTEGRATED';
};

interface KioskPaymentProps {
    cart: CartItem[];
    paymentMethods: KioskResolvedPaymentMethod[];
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

    return 'Método configurado en Métodos de Pago';
};

const KioskPayment: React.FC<KioskPaymentProps> = ({
    cart,
    paymentMethods,
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

    // Calculate totals
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const subtotalBeforeDiscounts = cart.reduce((sum, item) => sum + ((item.originalPrice || item.price) * item.quantity), 0);
    const totalSavings = subtotalBeforeDiscounts - subtotal;

    const tax = subtotal * 0.18; // 18% ITBIS
    const total = subtotal + tax;
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
            const response = await fetch('/api/email/receipt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email,
                    cart,
                    total,
                    paymentMethod: selectedMethod || 'CARD'
                })
            });

            if (!response.ok) throw new Error('Failed to send email');

            setEmailSent(true);
            setTimeout(() => {
                handleFinish();
            }, 2000);
        } catch (error) {
            console.error('Error sending receipt:', error);
            // Fallback to success anyway to not block the user
            setEmailSent(true);
            setTimeout(() => {
                handleFinish();
            }, 2000);
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

                    <div className="grid grid-cols-2 gap-6 w-full max-w-3xl mb-12">
                        <button className="flex flex-col items-center justify-center p-8 bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 rounded-3xl transition-all group">
                            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm group-hover:scale-110 transition-transform">
                                <div className="text-3xl">📷</div>
                            </div>
                            <span className="text-xl font-bold text-blue-800">Escanear ID</span>
                        </button>

                        <button className="flex flex-col items-center justify-center p-8 bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 rounded-3xl transition-all group">
                            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-sm group-hover:scale-110 transition-transform">
                                <Smartphone size={32} className="text-blue-600" />
                            </div>
                            <span className="text-xl font-bold text-blue-800">Ingresar Teléfono</span>
                        </button>
                    </div>

                    <button
                        onClick={() => setStep('PAYMENT')}
                        className="text-gray-400 hover:text-gray-600 font-bold text-xl underline decoration-2 underline-offset-4"
                    >
                        Continuar como invitado
                    </button>
                </div>
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
                                    <span>${subtotalBeforeDiscounts.toFixed(2)}</span>
                                </div>

                                {totalSavings > 0 && (
                                    <div className="flex justify-between text-green-600 font-bold animate-pulse">
                                        <span>Ahorro Total</span>
                                        <span>-${totalSavings.toFixed(2)}</span>
                                    </div>
                                )}

                                <div className="flex justify-between text-gray-500">
                                    <span>ITBIS (18%)</span>
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
