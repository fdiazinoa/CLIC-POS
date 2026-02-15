import React, { useState, useMemo } from 'react';
import {
    ArrowLeft, Download, Printer, Filter, Calendar,
    ChevronDown, Search, ArrowUp, ArrowDown,
    BarChart, Table as TableIcon,
    Truck, Users, Clock, FileText, Calculator, PieChart as PieChartIcon
} from 'lucide-react';
import { BusinessConfig, AnalyticsCategory } from '../types';

interface ReportViewerProps {
    category: AnalyticsCategory;
    config: BusinessConfig;
    data: any[];
    onBack: () => void;
}

const ReportViewer: React.FC<ReportViewerProps> = ({ category, config, data, onBack }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const [viewType, setViewType] = useState<'TABLE' | 'CHART'>('TABLE');

    // Metadata for categories
    const categoryMeta = {
        SOURCING: { label: 'Analítica de Proveedores', icon: Truck, color: 'text-emerald-600' },
        INVENTORY: { label: 'Analítica de Inventario', icon: PieChartIcon, color: 'text-blue-600' },
        CUSTOMERS: { label: 'Analítica de Clientes', icon: Users, color: 'text-purple-600' },
        FISCAL: { label: 'Analítica Fiscal', icon: FileText, color: 'text-indigo-600' },
        OPERATIONS: { label: 'Operativa de Caja', icon: Calculator, color: 'text-orange-600' },
        CATALOG: { label: 'Inteligencia de Catálogo', icon: BarChart, color: 'text-rose-600' },
        HR: { label: 'Asistencia y RRHH', icon: Clock, color: 'text-sky-600' },
    }[category];

    // Table Configuration (Columns)
    const columns = useMemo(() => {
        switch (category) {
            case 'CUSTOMERS':
                return [
                    { key: 'name', label: 'Cliente', type: 'text' },
                    { key: 'recency', label: 'Recencia (días)', type: 'number' },
                    { key: 'frequency', label: 'Frecuencia', type: 'number' },
                    { key: 'monetary', label: 'Monetario', type: 'currency' },
                    { key: 'lastVisit', label: 'Última Visita', type: 'date' },
                ];
            case 'INVENTORY':
                return [
                    { key: 'name', label: 'Artículo', type: 'text' },
                    { key: 'quantity', label: 'Existencia', type: 'number' },
                    { key: 'avgCost', label: 'Costo Prom.', type: 'currency' },
                    { key: 'value', label: 'Valor Total', type: 'currency' },
                ];
            case 'SOURCING':
                return [
                    { key: 'id', label: 'Orden #', type: 'text' },
                    { key: 'supplierName', label: 'Proveedor', type: 'text' },
                    { key: 'promisedDate', label: 'Fecha Promesa', type: 'date' },
                    { key: 'actualDate', label: 'Fecha Real', type: 'date' },
                    { key: 'delayDays', label: 'Retraso (Días)', type: 'number' },
                    { key: 'status', label: 'Estado', type: 'status' },
                ];
            case 'CATALOG':
                return [
                    { key: 'name', label: 'Artículo', type: 'text' },
                    { key: 'qty', label: 'Unidades Vendidas', type: 'number' },
                    { key: 'total', label: 'Venta Total', type: 'currency' },
                    { key: 'share', label: 'Share (%)', type: 'percent' },
                    { key: 'classification', label: 'ABC', type: 'status' },
                ];
            case 'OPERATIONS':
                return [
                    { key: 'hour', label: 'Hora', type: 'text' },
                    { key: 'count', label: 'Tickets', type: 'number' },
                    { key: 'total', label: 'Total Ventas', type: 'currency' },
                ];
            case 'HR':
                return [
                    { key: 'name', label: 'Empleado', type: 'text' },
                    { key: 'hours', label: 'Horas Trabajadas', type: 'number' },
                    { key: 'lastClock', label: 'Último Fichaje', type: 'date' },
                ];
            default:
                return [
                    { key: 'id', label: 'ID', type: 'text' },
                    { key: 'label', label: 'Nombre', type: 'text' },
                    { key: 'value', label: 'Valor', type: 'currency' },
                ];
        }
    }, [category]);

    const filteredData = useMemo(() => {
        let result = [...data];
        if (searchTerm) {
            result = result.filter(item =>
                Object.values(item).some(val =>
                    String(val).toLowerCase().includes(searchTerm.toLowerCase())
                )
            );
        }
        if (sortConfig) {
            result.sort((a, b) => {
                const aVal = a[sortConfig.key];
                const bVal = b[sortConfig.key];
                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return result;
    }, [data, searchTerm, sortConfig]);

    const handleSort = (key: string) => {
        setSortConfig(prev => ({
            key, direction: prev?.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const handleExportExcel = () => {
        const headers = columns.map(c => c.label).join(',');
        const rows = filteredData.map(row =>
            columns.map(c => {
                const val = row[c.key];
                return typeof val === 'string' ? `"${val}"` : val;
            }).join(',')
        ).join('\n');
        const csvContent = `data:text/csv;charset=utf-8,${headers}\n${rows}`;
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `reporte_${category.toLowerCase()}_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // --- CHART COMPONENT ---
    const SVGBarChart = ({ items }: { items: any[] }) => {
        if (!items || items.length === 0) return null;
        const maxVal = Math.max(...items.map(i => i.total || i.monetary || i.value || 1));
        const chartData = items.slice(0, 12);

        return (
            <div className="w-full flex flex-col gap-8 animate-in fade-in duration-700">
                <div className="flex justify-between items-end h-64 gap-3 px-4">
                    {chartData.map((item, idx) => {
                        const val = item.total || item.monetary || item.value || 0;
                        const height = (val / maxVal) * 100;
                        return (
                            <div key={idx} className="flex-1 flex flex-col items-center gap-3 group h-full justify-end">
                                <div className="relative w-full flex justify-center h-full items-end">
                                    <div
                                        className={`w-full max-w-[42px] rounded-t-2xl transition-all duration-1000 ease-out shadow-lg hover:brightness-110 cursor-pointer ${category === 'CATALOG' && item.classification === 'A' ? 'bg-emerald-500 shadow-emerald-100' :
                                            category === 'CUSTOMERS' ? 'bg-purple-500 shadow-purple-100' :
                                                category === 'OPERATIONS' ? 'bg-orange-500 shadow-orange-100' :
                                                    'bg-blue-500 shadow-blue-100'
                                            }`}
                                        style={{ height: `${height}%` }}
                                    >
                                        <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-gray-900/90 backdrop-blur-sm text-white text-[10px] font-bold px-3 py-1.5 rounded-xl opacity-0 group-hover:opacity-100 transition-all scale-75 group-hover:scale-100 whitespace-nowrap z-20 shadow-2xl">
                                            {config.currencySymbol}{val.toLocaleString()}
                                        </div>
                                    </div>
                                </div>
                                <span className="text-[10px] font-black text-gray-400 truncate w-full text-center uppercase tracking-tighter">
                                    {item.name || item.hour || item.label || 'Item'}
                                </span>
                            </div>
                        );
                    })}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100 transition-all hover:bg-white hover:shadow-xl">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Total Analizado</p>
                        <p className="text-3xl font-black text-slate-800 tracking-tight">
                            {config.currencySymbol}{items.reduce((acc, i) => acc + (i.total || i.monetary || i.value || 0), 0).toLocaleString()}
                        </p>
                    </div>
                    <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100 transition-all hover:bg-white hover:shadow-xl">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Promedio por Item</p>
                        <p className="text-3xl font-black text-blue-600 tracking-tight">
                            {config.currencySymbol}{Math.round(items.reduce((acc, i) => acc + (i.total || i.monetary || i.value || 0), 0) / (items.length || 1)).toLocaleString()}
                        </p>
                    </div>
                    <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100 transition-all hover:bg-white hover:shadow-xl">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Items en Muestra</p>
                        <p className="text-3xl font-black text-emerald-600 tracking-tight">{items.length}</p>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-gray-50 animate-in slide-in-from-right duration-300 print:bg-white">
            <style>{`
                @media print {
                    .no-print { display: none !important; }
                    header { padding: 0 !important; border: none !important; margin-bottom: 2rem !important; }
                    .header-actions { display: none !important; }
                    .filter-bar { display: none !important; }
                    table { width: 100% !important; border-collapse: collapse !important; }
                    th, td { border: 1px solid #eee !important; padding: 12px !important; }
                    body { background: white !important; }
                    .report-container { overflow: visible !important; }
                }
            `}</style>
            {/* HEADER */}
            <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 p-6 flex items-center justify-between sticky top-0 z-30">
                <div className="flex items-center gap-4">
                    <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500">
                        <ArrowLeft size={24} />
                    </button>
                    <div className="flex items-center gap-3">
                        <div className={`p-3 rounded-2xl bg-gray-100 ${categoryMeta.color}`}>
                            <categoryMeta.icon size={26} strokeWidth={2.5} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black text-gray-900 leading-tight tracking-tight">{categoryMeta.label}</h2>
                            <p className="text-[10px] text-gray-400 font-black uppercase tracking-[0.2em] mt-0.5">Reporte de Auditoría & BI</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 no-print header-actions">
                    <div className="flex bg-gray-100 p-1 rounded-2xl">
                        <button
                            onClick={() => setViewType('TABLE')}
                            className={`p-2.5 rounded-xl transition-all ${viewType === 'TABLE' ? 'bg-white shadow-md text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            <TableIcon size={20} />
                        </button>
                        <button
                            onClick={() => setViewType('CHART')}
                            className={`p-2.5 rounded-xl transition-all ${viewType === 'CHART' ? 'bg-white shadow-md text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            <BarChart size={20} />
                        </button>
                    </div>
                    <button
                        onClick={handleExportExcel}
                        className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black text-sm hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100/50 active:scale-95"
                    >
                        <Download size={18} /> EXCEL
                    </button>
                    <button
                        onClick={() => window.print()}
                        className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-sm hover:bg-black transition-all shadow-xl shadow-slate-200 active:scale-95"
                    >
                        <Printer size={18} /> IMPRIMIR
                    </button>
                </div>
            </header>

            {/* FILTERS & SEARCH */}
            <div className="p-8 pb-0 space-y-6 no-print filter-bar">
                <div className="flex flex-wrap gap-4 items-center">
                    <div className="relative flex-1 max-w-lg group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                        <input
                            type="text"
                            placeholder="Filtro rápido de datos..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all outline-none shadow-sm"
                        />
                    </div>

                    <div className="flex items-center gap-3 px-5 py-3 bg-white border border-gray-200 rounded-2xl text-sm font-black text-gray-600 shadow-sm cursor-pointer hover:border-blue-400 transition-all">
                        <Calendar size={18} className="text-blue-500" />
                        <span>Últimos 30 días</span>
                    </div>

                    <div className="flex items-center gap-3 px-5 py-3 bg-white border border-gray-200 rounded-2xl text-sm font-black text-gray-600 shadow-sm cursor-pointer hover:border-blue-400 transition-all">
                        <Filter size={18} className="text-blue-500" />
                        <span>Almacenes</span>
                        <ChevronDown size={14} className="text-gray-400" />
                    </div>
                </div>
            </div>

            {/* CONTENT AREA */}
            <div className="flex-1 overflow-auto p-8">
                {viewType === 'TABLE' ? (
                    <div className="bg-white rounded-[2.5rem] shadow-xl shadow-gray-200/50 border border-gray-100 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100">
                                        {columns.map(col => (
                                            <th
                                                key={col.key}
                                                onClick={() => handleSort(col.key)}
                                                className="px-8 py-5 font-black text-slate-400 uppercase tracking-[0.2em] text-[10px] cursor-pointer hover:text-blue-600 transition-colors group"
                                            >
                                                <div className="flex items-center gap-2">
                                                    {col.label}
                                                    <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
                                                        {sortConfig?.key === col.key && sortConfig.direction === 'asc' ? <ArrowUp size={10} className="text-blue-600" /> : <ArrowDown size={10} />}
                                                    </div>
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {filteredData.map((row, i) => (
                                        <tr key={i} className="hover:bg-blue-50/40 transition-colors group border-transparent">
                                            {columns.map(col => (
                                                <td key={col.key} className="px-8 py-5 font-bold text-slate-700">
                                                    {col.type === 'currency' ? `${config.currencySymbol}${Number(row[col.key]).toLocaleString(undefined, { minimumFractionDigits: 2 })}` :
                                                        col.type === 'percent' ? (
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-12 h-2 bg-gray-100 rounded-full overflow-hidden">
                                                                    <div className="h-full bg-blue-500" style={{ width: `${Math.min(row[col.key], 100)}%` }} />
                                                                </div>
                                                                <span className="text-[10px] font-black">{Number(row[col.key]).toFixed(1)}%</span>
                                                            </div>
                                                        ) :
                                                            col.type === 'date' ? new Date(row[col.key]).toLocaleDateString() :
                                                                col.type === 'status' ? (
                                                                    <span className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest ${row[col.key] === 'A' || row[col.key] === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                                                                        row[col.key] === 'B' || row[col.key] === 'PARTIAL' ? 'bg-orange-100 text-orange-700 border border-orange-200' :
                                                                            'bg-red-100 text-red-700 border border-red-200'
                                                                        }`}>
                                                                        {row[col.key]}
                                                                    </span>
                                                                ) :
                                                                    row[col.key]}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                    {filteredData.length === 0 && (
                                        <tr>
                                            <td colSpan={columns.length} className="px-8 py-20 text-center text-slate-300 italic">
                                                No se han encontrado registros para mostrar.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="bg-white p-12 rounded-[3.5rem] shadow-xl shadow-gray-200/50 border border-gray-100 min-h-[500px] flex items-center justify-center">
                        <SVGBarChart items={filteredData} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReportViewer;
