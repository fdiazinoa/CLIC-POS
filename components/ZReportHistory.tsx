import React, { useState, useEffect } from 'react';
import {
    ArrowLeft, Calendar, Clock, DollarSign, FileText,
    Printer, Mail, ChevronRight, Search, AlertTriangle,
    Banknote, CheckCircle
} from 'lucide-react';
import { ZReport, BusinessConfig } from '../types';
import { db } from '../utils/db';
import { ThermalPrinterService } from '../services/printer/ThermalPrinterService';

interface ZReportHistoryProps {
    config: BusinessConfig;
    onClose: () => void;
}

const ZReportHistory: React.FC<ZReportHistoryProps> = ({ config, onClose }) => {
    const [reports, setReports] = useState<ZReport[]>([]);
    const [selectedReport, setSelectedReport] = useState<ZReport | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    useEffect(() => {
        const loadReports = async () => {
            setIsLoading(true);
            try {
                const data = await db.get('zReports') as ZReport[];
                // Sort by closedAt descending (newest first)
                const sorted = (data || []).sort((a, b) =>
                    new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime()
                );
                setReports(sorted);
            } catch (error) {
                console.error("Error loading Z-Reports:", error);
            } finally {
                setIsLoading(false);
            }
        };
        loadReports();
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

    // --- DETAIL VIEW ---
    if (selectedReport) {
        const r = selectedReport;
        const cashDiscrepancy = r.cashDiscrepancy || {};
        const totalDiscrepancy = Object.values(cashDiscrepancy).reduce((a, b) => a + (b as number), 0);
        const hasDiscrepancy = Math.abs(totalDiscrepancy) > 0.01;

        return (
            <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setSelectedReport(null)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                            <ArrowLeft size={24} className="text-gray-600" />
                        </button>
                        <div>
                            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                                <FileText size={20} className="text-blue-600" />
                                Reporte {r.sequenceNumber}
                            </h2>
                            <p className="text-xs text-gray-500">
                                Cerrado por {r.closedByUserName} • {formatDate(r.closedAt)} {formatTime(r.closedAt)}
                            </p>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => ThermalPrinterService.printZReport(r)}
                            className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600"
                            title="Imprimir"
                        >
                            <Printer size={20} />
                        </button>
                        <button
                            onClick={async () => {
                                // Try to get emails from the first terminal's workflow config or fallback to default
                                const recipients = config.terminals?.[0]?.config?.workflow?.session?.zReportEmails || config.emailConfig?.defaultRecipient;
                                if (!recipients) {
                                    alert("No hay correos configurados para reportes Z.");
                                    return;
                                }

                                if (confirm(`¿Reenviar reporte a ${recipients}?`)) {
                                    try {
                                        await fetch('/smtp/z-report', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                to: recipients,
                                                reportData: {
                                                    ...r,
                                                    companyName: config.companyInfo.name
                                                }
                                            })
                                        });
                                        alert("Correo enviado exitosamente.");
                                    } catch (e) {
                                        alert("Error al enviar correo.");
                                        console.error(e);
                                    }
                                }
                            }}
                            className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600"
                            title="Reenviar Email"
                        >
                            <Mail size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-3xl mx-auto space-y-6">

                        {/* Summary Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                <p className="text-xs text-gray-500 uppercase font-bold mb-1">Ventas Totales</p>
                                <p className="text-2xl font-bold text-gray-800">
                                    {formatCurrency(Object.values(r.totalsByMethod || {}).reduce((a, b) => a + (b as number), 0), r.baseCurrency)}
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

                        {/* Payment Methods */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 font-bold text-gray-700 flex items-center gap-2">
                                <DollarSign size={18} /> Métodos de Pago
                            </div>
                            <div className="p-4 space-y-3">
                                {Object.entries(r.totalsByMethod || {}).map(([method, amount]) => (
                                    <div key={method} className="flex justify-between items-center border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                                        <span className="text-gray-600 font-medium">{method}</span>
                                        <span className="font-bold text-gray-800">{formatCurrency(amount, r.baseCurrency)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

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
        <div className="fixed inset-0 z-40 bg-gray-50 flex flex-col animate-in fade-in duration-200">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between shadow-sm">
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
            <div className="flex-1 overflow-y-auto p-4 md:p-8">
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

                            const totalSales = Object.values(totalsByMethod).reduce((a, b) => a + (b as number), 0);
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
                                            <p className="text-xs text-gray-500 flex items-center gap-1">
                                                <Calendar size={12} /> {formatDate(report.closedAt)} • {formatTime(report.closedAt)} • <span className="font-bold text-blue-600">{report.terminalId}</span>
                                            </p>
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
