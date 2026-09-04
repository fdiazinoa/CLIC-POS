import React, { useState, useEffect } from 'react';
import {
    ArrowLeft, Calendar, Clock, DollarSign, FileText,
    Printer, Mail, ChevronRight, Search, AlertTriangle,
    Banknote, CheckCircle, RefreshCw
} from 'lucide-react';
import { ZReport, BusinessConfig, User, RoleDefinition, Transaction } from '../types';
import { db } from '../utils/db';
import { ThermalPrinterService } from '../services/printer/ThermalPrinterService';
import { ZReportRecoveryService } from '../services/recovery/ZReportRecoveryService';
import { sendZReportEmailViaErp } from '../services/email/zReportEmailService';
import { ALL_CLOSE_REPORT_SECTIONS, buildCloseReportDetails, resolveCloseReportSections } from '../utils/closeReportOptions';
import { getZReportPaymentMethodSummary, paymentMethodSummaryTotal } from '../utils/zReportPaymentSummary';

interface ZReportHistoryProps {
    config: BusinessConfig;
    currentUser?: User | null;
    roles?: RoleDefinition[];
    activeTerminalId?: string;
    onRepeatReport?: (report: ZReport) => void;
    onClose: () => void;
}

const ZReportHistory: React.FC<ZReportHistoryProps> = ({ config, currentUser, roles = [], activeTerminalId, onRepeatReport, onClose }) => {
    const [reports, setReports] = useState<ZReport[]>([]);
    const [selectedReport, setSelectedReport] = useState<ZReport | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [reprintingReportId, setReprintingReportId] = useState<string | null>(null);
    const [reprocessingReportId, setReprocessingReportId] = useState<string | null>(null);
    const [emailingReportId, setEmailingReportId] = useState<string | null>(null);

    const sortReportsByDate = (data: ZReport[]) =>
        [...(data || [])].sort((a, b) =>
            new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime()
        );

    const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
        let timeoutHandle: number | undefined;
        try {
            return await Promise.race([
                promise,
                new Promise<T>((_, reject) => {
                    timeoutHandle = window.setTimeout(() => {
                        reject(new Error(`${label}_TIMEOUT`));
                    }, timeoutMs);
                })
            ]);
        } finally {
            if (timeoutHandle) window.clearTimeout(timeoutHandle);
        }
    };

    useEffect(() => {
        let cancelled = false;

        const loadReports = async () => {
            setIsLoading(true);
            try {
                const data = await withTimeout(db.get('zReports') as Promise<ZReport[]>, 4000, 'LOAD_Z_REPORTS');
                if (!cancelled) {
                    setReports(sortReportsByDate(data || []));
                }

                // Recovery runs in background so UI never stays blocked in spinner.
                // It also restores missing single reports (not only empty-history scenarios).
                void (async () => {
                    try {
                        const recoveredCount = await ZReportRecoveryService.recoverOrphanedReports({
                            notifyUser: false,
                            runOncePerSession: true,
                            enrichHistory: false
                        });
                        if (recoveredCount > 0) {
                            const recovered = await withTimeout(db.get('zReports') as Promise<ZReport[]>, 4000, 'RELOAD_Z_REPORTS');
                            if (!cancelled) {
                                setReports(sortReportsByDate(recovered || []));
                            }
                        }
                    } catch (recoveryError) {
                        console.warn('⚠️ ZReportHistory: recovery failed', recoveryError);
                    }
                })();
            } catch (error) {
                console.error("Error loading Z-Reports:", error);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        loadReports();

        return () => {
            cancelled = true;
        };
    }, []);

    // Helper to get local date string YYYY-MM-DD
    const toLocalDateString = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const filteredReports = reports.filter(r => {
        const matchesSearch = (r.sequenceNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (r.closedByUserName || '').toLowerCase().includes(searchTerm.toLowerCase());

        if (!matchesSearch) return false;

        if (startDate) {
            const reportDate = new Date(r.closedAt);
            const start = new Date(startDate + 'T00:00:00');
            if (reportDate < start) return false;
        }

        if (endDate) {
            const reportDate = new Date(r.closedAt);
            const end = new Date(endDate + 'T23:59:59.999');
            if (reportDate > end) return false;
        }

        return true;
    });

    const formatDate = (isoString: string) => {
        return new Date(isoString).toLocaleDateString('es-DO', {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
        });
    };

    const formatTime = (isoString: string) => {
        return new Date(isoString).toLocaleTimeString('es-DO', {
            hour: '2-digit', minute: '2-digit'
        });
    };

    const formatCurrency = (amount: number, currency: string = config.currencySymbol) => {
        return `${currency}${amount.toFixed(2)}`;
    };

    const hasPermission = (permission: string): boolean => {
        if (!currentUser) return false;
        const roleId = currentUser.roleId || currentUser.role;
        const role = roles.find(r => r.id === roleId);
        if (!role) return false;
        return role.permissions.includes('ALL') || role.permissions.includes(permission as any);
    };

    const canRepeatZReport = hasPermission('POS_REPEAT_Z_REPORT');

    const resolveActivePrintTerminal = () => {
        const terminals = config.terminals || [];

        const activeMatch = terminals.find(terminal =>
            terminal.id === activeTerminalId ||
            terminal.config?.erpTerminalId === activeTerminalId ||
            (terminal.config as any)?.terminalId === activeTerminalId ||
            (terminal.config as any)?.localTerminalId === activeTerminalId
        );
        if (activeMatch) return activeMatch;

        const storedTerminalId =
            localStorage.getItem('active_terminal_id') ||
            localStorage.getItem('CLIC_POS_TERMINAL_ID') ||
            '';
        const storedMatch = terminals.find(terminal =>
            terminal.id === storedTerminalId ||
            terminal.config?.erpTerminalId === storedTerminalId ||
            (terminal.config as any)?.terminalId === storedTerminalId ||
            (terminal.config as any)?.localTerminalId === storedTerminalId
        );
        if (storedMatch) return storedMatch;

        const reportTerminal = terminals.find(terminal =>
            terminal.id === selectedReport?.terminalId ||
            terminal.config?.erpTerminalId === selectedReport?.terminalId
        );
        if (reportTerminal) return reportTerminal;

        const terminalWithReceiptPrinter = terminals.find(terminal =>
            Boolean(terminal.config?.hardware?.receiptPrinterId) ||
            Boolean(terminal.config?.hardware?.printerAssignments?.TICKET)
        );
        if (terminalWithReceiptPrinter) return terminalWithReceiptPrinter;

        return terminals[0];
    };

    const handleRepeatZReport = async (report: ZReport) => {
        if (reprocessingReportId) return;
        if (!onRepeatReport) {
            alert('No se pudo abrir el formulario para repetir este cierre Z.');
            return;
        }
        if (!await clicConfirm(`¿Repetir el cierre ${report.sequenceNumber}? Se abrirá el formulario para ingresar nuevamente los montos y reemplazar este Z.`)) return;
        setReprocessingReportId(report.id);
        try {
            onRepeatReport(report);
        } catch (error) {
            console.error('❌ Error repitiendo Z:', error);
            alert('No se pudo repetir el Z. Intenta nuevamente.');
        } finally {
            setReprocessingReportId(null);
        }
    };

    const handleReprintZReport = async (report: ZReport) => {
        if (reprintingReportId) return;
        setReprintingReportId(report.id);
        try {
            const roleId = currentUser?.roleId || currentUser?.role;
            const role = roles.find(r => r.id === roleId);
            const hiddenModules = role?.zReportConfig?.hiddenModules || [];
            const printTerminal = resolveActivePrintTerminal();
            const preferredPrinterId =
                printTerminal?.config?.hardware?.printerAssignments?.TICKET ||
                printTerminal?.config?.hardware?.receiptPrinterId;
            const archived = await (db.get('transactionHistory') as Promise<Transaction[]>);
            const reportTransactions = (Array.isArray(archived) ? archived : []).filter(tx =>
                tx.zReportId === report.id ||
                (tx as any).zReportSequence === report.sequenceNumber
            );
            const enabledSections = resolveCloseReportSections(
                config,
                printTerminal?.id || activeTerminalId || report.terminalId,
                currentUser?.id,
                'Z'
            );
            const printReport = {
                ...report,
                terminalId: printTerminal?.id || activeTerminalId || report.terminalId,
                enabledSections,
                reportDetails: {
                    ...buildCloseReportDetails(
                        reportTransactions,
                        config,
                        printTerminal?.config,
                        ALL_CLOSE_REPORT_SECTIONS
                    ),
                    ...(report.reportDetails || {}),
                },
            };
            const printed = await ThermalPrinterService.printZReport(printReport, hiddenModules, config, {
                preferredPrinterId,
                terminalId: printReport.terminalId,
                jobType: 'TICKET'
            });
            if (printed === false) {
                alert('No se pudo reimprimir el Z. Verifica la impresora configurada.');
                return;
            }
            alert(`Reporte ${report.sequenceNumber} enviado a impresión.`);
        } catch (error) {
            console.error('❌ Error reimprimiendo Z:', error);
            alert('No se pudo reimprimir el Z. Verifica la impresora configurada.');
        } finally {
            setReprintingReportId(null);
        }
    };

    // --- DETAIL VIEW ---
    if (selectedReport) {
        const r = selectedReport;
        const cashDiscrepancy = r.cashDiscrepancy || {};
        const totalDiscrepancy = Object.values(cashDiscrepancy).reduce((a, b) => a + (b as number), 0);
        const hasDiscrepancy = Math.abs(totalDiscrepancy) > 0.01;
        const denominationBreakdown = r.denominationBreakdown || (r as any).denomination_breakdown || {};
        const hasDenominationBreakdown = Object.values(denominationBreakdown).some((lines: any) => Array.isArray(lines) && lines.length > 0);
        const paymentMethodSummary = getZReportPaymentMethodSummary(r, config);

        return (
            <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col min-h-0 animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="shrink-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setSelectedReport(null)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                            <ArrowLeft size={24} className="text-gray-600" />
                        </button>
                        <div>
                            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                                <FileText size={20} className="text-blue-600" />
                                Reporte {r.sequenceNumber}
                            </h2>
                            <p className="text-xs text-gray-500 flex items-center gap-2">
                                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-black text-[10px] uppercase">
                                    Caja: {r.terminalId || 'N/A'}
                                </span>
                                <span>•</span>
                                <span>{r.closedByUserName}</span>
                                <span>•</span>
                                <span>{formatDate(r.closedAt)} {formatTime(r.closedAt)}</span>
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        {canRepeatZReport && (
                            <button
                                onClick={() => handleRepeatZReport(r)}
                                disabled={reprocessingReportId === r.id}
                                className="px-4 py-2 bg-amber-50 hover:bg-amber-600 hover:text-white rounded-xl text-amber-700 transition-all font-bold text-sm flex items-center gap-2 shadow-sm disabled:opacity-60 disabled:cursor-wait"
                                title="Repetir/Reprocesar cierre Z"
                            >
                                <RefreshCw size={18} className={reprocessingReportId === r.id ? 'animate-spin' : ''} />
                                <span className="hidden sm:inline">{reprocessingReportId === r.id ? 'Reprocesando...' : 'Repetir Z'}</span>
                            </button>
                        )}
                        {canRepeatZReport && (
                            <button
                                onClick={() => handleReprintZReport(r)}
                                disabled={reprintingReportId === r.id}
                                className="px-4 py-2 bg-blue-50 hover:bg-blue-600 hover:text-white rounded-xl text-blue-700 transition-all font-bold text-sm flex items-center gap-2 shadow-sm disabled:opacity-60 disabled:cursor-wait"
                                title="Reimprimir cierre Z"
                            >
                                <Printer size={18} className={reprintingReportId === r.id ? 'animate-pulse' : ''} />
                                <span className="hidden sm:inline">{reprintingReportId === r.id ? 'Imprimiendo...' : 'Reimprimir Z'}</span>
                            </button>
                        )}
                        <button
                            onClick={async () => {
                                const configuredTerminal = config.terminals?.find((terminal) => terminal.id === (activeTerminalId || r.terminalId))
                                    || config.terminals?.[0];
                                let recipients = configuredTerminal?.config?.workflow?.session?.zReportEmails || config.emailConfig?.defaultRecipient;
                                if (!recipients) {
                                    recipients = await clicPrompt('Ingrese el correo electrónico para enviar este cierre Z:', '') || '';
                                    recipients = recipients.trim();
                                    if (!recipients) return;
                                }

                                if (await clicConfirm(`¿Reenviar reporte a ${recipients}?`)) {
                                    setEmailingReportId(r.id);
                                    try {
                                        const result = await sendZReportEmailViaErp({ recipients, report: r, config });
                                        if (result.success) alert('Cierre Z enviado exitosamente.');
                                        else alert(`No se pudo enviar el cierre Z.\n\n${result.message || 'Error desconocido.'}`);
                                    } finally {
                                        setEmailingReportId(null);
                                    }
                                }
                            }}
                            disabled={emailingReportId === r.id}
                            className="px-4 py-2 bg-gray-100 hover:bg-indigo-600 hover:text-white rounded-xl text-gray-600 transition-all font-bold text-sm flex items-center gap-2 shadow-sm disabled:opacity-60 disabled:cursor-wait"
                            title="Reenviar Email"
                        >
                            <Mail size={18} className={emailingReportId === r.id ? 'animate-pulse' : ''} />
                            <span className="hidden sm:inline">{emailingReportId === r.id ? 'Enviando...' : 'Email'}</span>
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y p-6">
                    <div className="max-w-3xl mx-auto space-y-6">

                        {/* Summary Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                <p className="text-xs text-gray-500 uppercase font-bold mb-1">Ventas Netas</p>
                                <p className="text-2xl font-bold text-gray-800">
                                    {formatCurrency(r.stats?.netSales ?? paymentMethodSummaryTotal(paymentMethodSummary), r.baseCurrency)}
                                </p>
                            </div>
                            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                <p className="text-xs text-gray-500 uppercase font-bold mb-1">Transacciones</p>
                                <p className="text-2xl font-bold text-gray-800">{r.transactionCount}</p>
                            </div>
                            <div className={`p-4 rounded-xl border shadow-sm ${hasDiscrepancy ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'}`}>
                                <p className={`text-xs uppercase font-bold mb-1 ${hasDiscrepancy ? 'text-red-600' : 'text-emerald-600'}`}>
                                    Descuadre Total
                                </p>
                                <p className={`text-2xl font-bold ${hasDiscrepancy ? 'text-red-700' : 'text-emerald-700'}`}>
                                    {formatCurrency(totalDiscrepancy, r.baseCurrency)}
                                </p>
                            </div>

                            {/* KPI Summary (New) */}
                            {r.stats && (
                                <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                                    <h3 className="font-bold text-gray-500 uppercase text-xs tracking-wider mb-4 flex items-center gap-2">
                                        <CheckCircle size={14} /> Resumen del Día
                                    </h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                                            <p className="text-[10px] text-gray-400 uppercase font-bold mb-1 tracking-wider">Ticket Promedio</p>
                                            <p className="text-lg font-black text-gray-800">{formatCurrency(r.stats.averageTicket, r.baseCurrency)}</p>
                                        </div>
                                        <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                                            <p className="text-[10px] text-gray-400 uppercase font-bold mb-1 tracking-wider">Items / Venta</p>
                                            <p className="text-lg font-black text-gray-800">{r.stats.itemsPerSale.toFixed(1)}</p>
                                        </div>
                                        <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                                            <p className="text-[10px] text-gray-400 uppercase font-bold mb-1 tracking-wider">Hora Pico</p>
                                            <p className="text-lg font-black text-gray-800">{r.stats.peakHour}</p>
                                        </div>
                                        <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                                            <p className="text-[10px] text-gray-400 uppercase font-bold mb-1 tracking-wider">Prod. Estrella</p>
                                            <p className="text-sm font-bold text-gray-800 truncate" title={r.stats.topProduct?.name || 'N/A'}>
                                                {r.stats.topProduct?.name || 'N/A'}
                                            </p>
                                            <p className="text-[10px] text-gray-500">{r.stats.topProduct?.quantity || 0} unidades</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Cash Details */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 font-bold text-gray-700 flex items-center gap-2">
                                <Banknote size={18} /> Detalle de Efectivo
                            </div>
                            <div className="p-4">
                                <div className="grid grid-cols-4 gap-4 text-sm font-bold text-gray-500 mb-2 px-2">
                                    <div>Moneda</div>
                                    <div className="text-right">Esperado</div>
                                    <div className="text-right">Contado</div>
                                    <div className="text-right">Diferencia</div>
                                </div>
                                {Object.keys(r.cashExpected || {}).map(currency => {
                                    const expected = (r.cashExpected || {})[currency] || 0;
                                    const counted = (r.cashCounted || {})[currency] || 0;
                                    const diff = (r.cashDiscrepancy || {})[currency] || 0;
                                    const isDiff = Math.abs(diff) > 0.01;

                                    return (
                                        <div key={currency} className="grid grid-cols-4 gap-4 py-3 border-t border-gray-100 items-center px-2">
                                            <div className="font-bold text-gray-800">{currency}</div>
                                            <div className="text-right text-gray-600">{expected.toFixed(2)}</div>
                                            <div className="text-right text-gray-800 font-bold">{counted.toFixed(2)}</div>
                                            <div className={`text-right font-bold ${isDiff ? 'text-red-600' : 'text-emerald-600'}`}>
                                                {diff > 0 ? '+' : ''}{diff.toFixed(2)}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {hasDenominationBreakdown && (
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 font-bold text-gray-700 flex items-center gap-2">
                                    <Printer size={18} /> Desglose de Denominaciones
                                </div>
                                <div className="p-4 space-y-4">
                                    {Object.entries(denominationBreakdown).map(([currency, lines]) => (
                                        <div key={currency} className="space-y-2">
                                            <p className="text-xs font-black uppercase tracking-wider text-gray-500">{currency}</p>
                                            <div className="grid grid-cols-3 gap-3 text-xs font-bold text-gray-500 px-2">
                                                <span>Denominación</span>
                                                <span className="text-right">Cantidad</span>
                                                <span className="text-right">Total</span>
                                            </div>
                                            {(Array.isArray(lines) ? lines : []).map((line: any) => (
                                                <div key={`${currency}-${line.denomination}`} className="grid grid-cols-3 gap-3 py-2 border-t border-gray-100 px-2 text-sm">
                                                    <span className="font-bold text-gray-800">{Number(line.denomination).toFixed(Number.isInteger(Number(line.denomination)) ? 0 : 2)}</span>
                                                    <span className="text-right text-gray-600">{line.quantity}</span>
                                                    <span className="text-right font-bold text-gray-800">{Number(line.total || 0).toFixed(2)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Payment Methods */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 font-bold text-gray-700 flex items-center gap-2">
                                <DollarSign size={18} /> Formas de Pago
                            </div>
                            <div className="p-4 space-y-3">
                                {paymentMethodSummary.map(line => (
                                    <div key={line.methodId || `${line.methodType}-${line.name}`} className="flex justify-between items-center border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                                        <span className="text-gray-600 font-medium">{line.name}</span>
                                        <span className="font-bold text-gray-800">{formatCurrency(line.amount, r.baseCurrency)}</span>
                                    </div>
                                ))}
                                <div className="flex justify-between items-center border-t border-gray-200 pt-3 font-black">
                                    <span>Total formas de pago</span>
                                    <span>{formatCurrency(paymentMethodSummaryTotal(paymentMethodSummary), r.baseCurrency)}</span>
                                </div>
                            </div>
                        </div>

                        {(r.paymentMethodDeclarations || []).length > 0 && (
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 font-bold text-gray-700">Declaración de formas de pago</div>
                                <div className="p-4 space-y-3">
                                    {r.paymentMethodDeclarations!.map(line => (
                                        <div key={line.methodId || `${line.methodType}-${line.name}`} className="grid grid-cols-4 gap-2 border-b border-gray-100 pb-2 text-sm">
                                            <span className="font-bold text-gray-800">{line.name}</span>
                                            <span className="text-right text-gray-500">Esp. {formatCurrency(line.expected, r.baseCurrency)}</span>
                                            <span className="text-right text-gray-700">Dec. {formatCurrency(line.declared, r.baseCurrency)}</span>
                                            <span className={`text-right font-bold ${Math.abs(line.difference) <= 0.01 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(line.difference, r.baseCurrency)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Notes */}
                        {r.notes && (
                            <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-100 text-yellow-800 text-sm">
                                <p className="font-bold mb-1 flex items-center gap-2"><FileText size={14} /> Notas del Cajero:</p>
                                <p>{r.notes}</p>
                            </div>
                        )}

                    </div>
                </div>
            </div >
        );
    }

    // --- LIST VIEW ---
    return (
        <div className="fixed inset-0 z-40 bg-gray-50 flex flex-col min-h-0 animate-in fade-in duration-200">
            {/* Header */}
            <div className="shrink-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-4">
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <ArrowLeft size={24} className="text-gray-600" />
                    </button>
                    <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <Clock size={20} className="text-blue-600" />
                        Historial de Cierres Z
                    </h1>
                </div>
                <div className="flex items-center gap-2">
                    {/* Quick Filters */}
                    <div className="flex bg-gray-100 rounded-lg p-1 gap-1 mr-2">
                        <button
                            onClick={() => {
                                const today = toLocalDateString(new Date());
                                setStartDate(today);
                                setEndDate(today);
                            }}
                            className="px-3 py-1 text-xs font-bold text-gray-600 hover:bg-white hover:shadow-sm rounded-md transition-all"
                        >
                            Hoy
                        </button>
                        <button
                            onClick={() => {
                                const yesterday = new Date();
                                yesterday.setDate(yesterday.getDate() - 1);
                                const yStr = toLocalDateString(yesterday);
                                setStartDate(yStr);
                                setEndDate(yStr);
                            }}
                            className="px-3 py-1 text-xs font-bold text-gray-600 hover:bg-white hover:shadow-sm rounded-md transition-all"
                        >
                            Ayer
                        </button>
                        <button
                            onClick={() => {
                                const now = new Date();
                                const firstDay = new Date(now.setDate(now.getDate() - now.getDay() + 1)); // Monday
                                const lastDay = new Date(now.setDate(now.getDate() - now.getDay() + 7)); // Sunday
                                setStartDate(toLocalDateString(firstDay));
                                setEndDate(toLocalDateString(lastDay));
                            }}
                            className="px-3 py-1 text-xs font-bold text-gray-600 hover:bg-white hover:shadow-sm rounded-md transition-all"
                        >
                            Semana
                        </button>
                        <button
                            onClick={() => {
                                const now = new Date();
                                const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
                                const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                                setStartDate(toLocalDateString(firstDay));
                                setEndDate(toLocalDateString(lastDay));
                            }}
                            className="px-3 py-1 text-xs font-bold text-gray-600 hover:bg-white hover:shadow-sm rounded-md transition-all"
                        >
                            Mes
                        </button>
                    </div>

                    <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
                        <span className="text-xs font-bold text-gray-500 uppercase">Desde:</span>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="bg-transparent text-sm outline-none text-gray-700"
                        />
                    </div>
                    <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
                        <span className="text-xs font-bold text-gray-500 uppercase">Hasta:</span>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="bg-transparent text-sm outline-none text-gray-700"
                        />
                    </div>
                    <div className="relative">
                        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Buscar por # o usuario..."
                            className="pl-10 pr-4 py-2 bg-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y p-4 md:p-8">
                {isLoading ? (
                    <div className="flex justify-center items-center h-64">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                ) : filteredReports.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                        <FileText size={48} className="mb-4 opacity-20" />
                        <p>No se encontraron reportes</p>
                    </div>
                ) : (
                    <div className="max-w-5xl mx-auto grid gap-4">
                        {filteredReports.map(report => {
                            if (!report) return null; // Skip null reports

                            const totalsByMethod = report.totalsByMethod || {};
                            const cashDiscrepancy = report.cashDiscrepancy || {};

                            const totalSales = report.stats?.netSales ?? Object.values(totalsByMethod).reduce((a, b) => a + (b as number), 0);
                            const totalDiscrepancy = Object.values(cashDiscrepancy).reduce((a, b) => a + (b as number), 0);
                            const hasDiscrepancy = Math.abs(totalDiscrepancy) > 0.01;

                            return (
                                <div
                                    key={report.id}
                                    onClick={() => setSelectedReport(report)}
                                    className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${hasDiscrepancy ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                                            {hasDiscrepancy ? <AlertTriangle size={20} /> : <CheckCircle size={20} />}
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-gray-800">{report.sequenceNumber}</h3>
                                            <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                                <Calendar size={12} /> {formatDate(report.closedAt)} • {formatTime(report.closedAt)}
                                            </p>
                                            <div className="mt-1 flex gap-2">
                                                <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[9px] font-black uppercase tracking-wider">
                                                    Caja: {report.terminalId || 'POS-01'}
                                                </span>
                                                <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[9px] font-black uppercase tracking-wider">
                                                    {report.closedByUserName}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-8">
                                        <div className="text-right hidden md:block">
                                            <p className="text-xs text-gray-400 uppercase font-bold">Cajero</p>
                                            <p className="font-medium text-gray-700">{report.closedByUserName}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-gray-400 uppercase font-bold">Total Ventas</p>
                                            <p className="font-bold text-gray-800 text-lg">{formatCurrency(totalSales, report.baseCurrency)}</p>
                                        </div>
                                        <ChevronRight size={20} className="text-gray-300 group-hover:text-blue-500 transition-colors" />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ZReportHistory;
