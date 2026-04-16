import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowLeft, Download, Printer, Filter, Calendar,
    ChevronDown, Search, ArrowUp, ArrowDown,
    BarChart, Table as TableIcon,
    Truck, Users, Clock, FileText, Calculator, PieChart as PieChartIcon,
    ChevronRight
} from 'lucide-react';
import {
    AnalyticsCategory,
    BusinessConfig,
    CashMovement,
    Customer,
    InventoryCountSession,
    InventoryLedgerEntry,
    PurchaseOrder,
    Product,
    ProductStock,
    Reception,
    Supplier,
    Transaction,
    Warehouse,
    ZReport
} from '../types';
import {
    calculateCashDiscrepancy,
    InventoryAnalyticsRow,
    InventoryStatusFilter,
    queryInventoryAnalytics
} from './AnalyticsLogic';
import { useCustomerAnalytics } from '../hooks/useCustomerAnalytics';
import { formatFiscalExcel } from '../utils/fiscalExcel';
import { getPaymentAppliedBaseAmount } from '../utils/paymentSettlement';

interface InventoryReportContext {
    products: Product[];
    warehouses: Warehouse[];
    suppliers: Supplier[];
    productStocks: ProductStock[];
    inventoryLedger: InventoryLedgerEntry[];
    inventoryCounts: InventoryCountSession[];
}

interface CustomerReportContext {
    customers: Customer[];
    transactions: Transaction[];
    warehouses: Warehouse[];
}

interface OperationsReportContext {
    transactions: Transaction[];
    cashMovements: CashMovement[];
    zReports: ZReport[];
}

interface FiscalReportContext {
    transactions: Transaction[];
    transactionHistory: Transaction[];
    purchaseOrders: PurchaseOrder[];
    receptions: Reception[];
    suppliers: Supplier[];
}

interface ReportViewerProps {
    category: AnalyticsCategory;
    config: BusinessConfig;
    data: any[];
    inventoryContext?: InventoryReportContext;
    customerContext?: CustomerReportContext;
    operationsContext?: OperationsReportContext;
    fiscalContext?: FiscalReportContext;
    onBack: () => void;
}

type DatePreset =
    | 'LAST_7_DAYS'
    | 'LAST_30_DAYS'
    | 'LAST_90_DAYS'
    | 'THIS_MONTH'
    | 'PREVIOUS_MONTH'
    | 'YTD'
    | 'ALL_TIME'
    | 'CUSTOM';

const startOfDay = (date: Date): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

const endOfDay = (date: Date): Date => {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
};

const formatDateInput = (date: Date): string => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const EPSILON = 0.01;
const PAYMENT_METHOD_ORDER = ['CASH', 'CARD', 'STORE_CREDIT', 'TRANSFER'] as const;
type PaymentMethodKey = typeof PAYMENT_METHOD_ORDER[number];

const PAYMENT_METHOD_LABELS: Record<PaymentMethodKey, string> = {
    CASH: 'Efectivo',
    CARD: 'Tarjeta',
    STORE_CREDIT: 'Vale Nota de Crédito',
    TRANSFER: 'Transferencia'
};

const PAYMENT_METHOD_COLORS: Record<PaymentMethodKey, string> = {
    CASH: '#16a34a',
    CARD: '#2563eb',
    STORE_CREDIT: '#f97316',
    TRANSFER: '#64748b'
};

const toNumber = (value: unknown): number => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeTerminalId = (terminalId?: string): string => String(terminalId || 'T1').trim().toLowerCase();

const toMs = (value: unknown): number => new Date(String(value || '')).getTime();

const sumRecordValues = (record: Record<string, number> | undefined): number =>
    Object.values(record || {}).reduce((sum, current) => sum + toNumber(current), 0);

const normalizePaymentMethod = (method: unknown): PaymentMethodKey | null => {
    const normalized = String(method || '').trim().toUpperCase();
    if (!normalized) return null;
    if (normalized === 'CASH') return 'CASH';
    if (['CARD', 'CREDIT_CARD', 'DEBIT_CARD'].includes(normalized)) return 'CARD';
    if (['STORE_CREDIT', 'CREDIT_NOTE', 'VALE_NC'].includes(normalized)) return 'STORE_CREDIT';
    if (['TRANSFER', 'BANK_TRANSFER', 'WIRE', 'ACH'].includes(normalized)) return 'TRANSFER';
    return null;
};

const isRefundLikeTransaction = (tx: Transaction): boolean => {
    return tx.documentType === 'REFUND'
        || tx.ncfType === 'B04'
        || tx.status === 'REFUNDED'
        || tx.status === 'PARTIAL_REFUND'
        || toNumber(tx.total) < 0;
};

const getSignedTaxAmount = (tx: Transaction, taxRate: number): number => {
    const storedTax = toNumber(tx.taxAmount);
    const net = toNumber(tx.netAmount);
    const total = toNumber(tx.total);

    let tax = 0;
    if (storedTax > 0) {
        tax = storedTax;
    } else if (net > 0 && total > 0 && total >= net) {
        tax = total - net;
    } else if (tx.isTaxIncluded && total > 0) {
        const normalizedRate = taxRate > 0 ? taxRate : 0.18;
        tax = total - (total / (1 + normalizedRate));
    }

    if (tax <= 0) return 0;
    return isRefundLikeTransaction(tx) ? -Math.abs(tax) : Math.abs(tax);
};

const formatDateTime = (value: string): string => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'N/A';
    return date.toLocaleString('es-DO', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const formatHourLabel = (hour: number): string => `${hour.toString().padStart(2, '0')}:00`;

interface OperationClosureRow {
    id: string;
    dateTime: string;
    terminalId: string;
    cashierId: string;
    cashierName: string;
    expected: number;
    counted: number | null;
    difference: number | null;
    status: 'CERRADO' | 'ABIERTO';
    totalSales: number;
    totalTax: number;
    transactionCount: number;
    note: string;
}

interface CashierAuditRow {
    cashierId: string;
    cashierName: string;
    shifts: number;
    surplus: number;
    shortage: number;
    netDifference: number;
    lastClosures: OperationClosureRow[];
}

interface PaymentBreakdownRow {
    method: PaymentMethodKey;
    label: string;
    color: string;
    total: number;
    tax: number;
    share: number;
}

interface HourlyBehaviorRow {
    hour: string;
    count: number;
    total: number;
    avgTicket: number;
}

type OperationsTab = 'Z_HISTORY' | 'DISCREPANCY_AUDIT' | 'PAYMENT_ANALYSIS' | 'HOURLY_BEHAVIOR';
type FiscalExportFormatOption = '607' | '606' | '608' | 'TODOS';
type FiscalExportFormat = '607' | '606' | '608';
type FiscalReportMode = 'NCF_DETAIL' | 'TAX_SUMMARY';

interface FiscalExportFeedback {
    title: string;
    summaries: string[];
    warnings: string[];
    isError?: boolean;
}

const FISCAL_EXPORT_OPTIONS: Array<{ value: FiscalExportFormatOption; label: string }> = [
    { value: '607', label: '607 - Ventas' },
    { value: '606', label: '606 - Compras' },
    { value: '608', label: '608 - Anulaciones' },
    { value: 'TODOS', label: 'Todos (607, 606 y 608)' }
];

const resolveFiscalFormats = (selection: FiscalExportFormatOption): FiscalExportFormat[] => {
    if (selection === 'TODOS') return ['607', '606', '608'];
    return [selection];
};

interface FiscalTaxSummaryRow {
    taxLabel: string;
    taxRatePercent: number;
    lineCount: number;
    taxableBase: number;
    taxAmount: number;
    total: number;
}

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeTaxRatePercent = (rawRate: unknown): number => {
    const rate = toNumber(rawRate);
    if (rate <= 0) return 0;
    return rate <= 1 ? rate * 100 : rate;
};

const formatTaxRateLabel = (ratePercent: number): string => {
    if (Math.abs(ratePercent) <= EPSILON) return '0% (Exento)';
    if (Number.isInteger(ratePercent)) return `${ratePercent}%`;
    return `${ratePercent.toFixed(2)}%`;
};

const SALES_NCF_REGEX = /^B(01|02|04|14|15)/;

const ReportViewer: React.FC<ReportViewerProps> = ({
    category,
    config,
    data,
    inventoryContext,
    customerContext,
    operationsContext,
    fiscalContext,
    onBack
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const [viewType, setViewType] = useState<'TABLE' | 'CHART'>('TABLE');
    const [datePreset, setDatePreset] = useState<DatePreset>(() =>
        category === 'CUSTOMERS' ? 'ALL_TIME' : 'LAST_30_DAYS'
    );
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');
    const [operationsTab, setOperationsTab] = useState<OperationsTab>('Z_HISTORY');
    const [selectedCashierId, setSelectedCashierId] = useState<string | null>(null);

    // Inventory-specific filters
    const [warehouseFilter, setWarehouseFilter] = useState('ALL');
    const [departmentFilter, setDepartmentFilter] = useState('ALL');
    const [sectionFilter, setSectionFilter] = useState('ALL');
    const [familyFilter, setFamilyFilter] = useState('ALL');
    const [subfamilyFilter, setSubfamilyFilter] = useState('ALL');
    const [brandFilter, setBrandFilter] = useState('ALL');
    const [supplierFilter, setSupplierFilter] = useState('ALL');
    const [stockStateFilter, setStockStateFilter] = useState<InventoryStatusFilter>('ALL');
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [includeVariantsInExport, setIncludeVariantsInExport] = useState(true);
    const [fiscalTerminalFilter, setFiscalTerminalFilter] = useState('ALL');
    const [isFiscalExportModalOpen, setIsFiscalExportModalOpen] = useState(false);
    const [fiscalExportFormat, setFiscalExportFormat] = useState<FiscalExportFormatOption>('607');
    const [fiscalExportError, setFiscalExportError] = useState('');
    const [isFiscalExporting, setIsFiscalExporting] = useState(false);
    const [fiscalExportFeedback, setFiscalExportFeedback] = useState<FiscalExportFeedback | null>(null);
    const [fiscalReportMode, setFiscalReportMode] = useState<FiscalReportMode>('NCF_DETAIL');

    const isInventoryView = category === 'INVENTORY' && !!inventoryContext;
    const isCustomersView = category === 'CUSTOMERS' && !!customerContext;
    const isOperationsView = category === 'OPERATIONS' && !!operationsContext;
    const isFiscalView = category === 'FISCAL' && !!fiscalContext;
    const inventoryProducts = inventoryContext?.products || [];
    const inventoryWarehouses = inventoryContext?.warehouses || [];
    const inventorySuppliers = inventoryContext?.suppliers || [];
    const customerWarehouses = customerContext?.warehouses || [];
    const operationsTransactions = operationsContext?.transactions || [];
    const operationsCashMovements = operationsContext?.cashMovements || [];
    const operationsZReports = operationsContext?.zReports || [];

    useEffect(() => {
        if (category !== 'OPERATIONS') return;
        setOperationsTab('Z_HISTORY');
        setSelectedCashierId(null);
    }, [category]);

    const datePresetOptions: Array<{ value: DatePreset; label: string }> = [
        { value: 'LAST_7_DAYS', label: 'Últimos 7 días' },
        { value: 'LAST_30_DAYS', label: 'Últimos 30 días' },
        { value: 'LAST_90_DAYS', label: 'Últimos 90 días' },
        { value: 'THIS_MONTH', label: 'Este mes' },
        { value: 'PREVIOUS_MONTH', label: 'Mes pasado' },
        { value: 'YTD', label: 'Año actual' },
        { value: 'ALL_TIME', label: 'Todo el historial' },
        { value: 'CUSTOM', label: 'Rango personalizado' }
    ];

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
            case 'FISCAL':
                if (fiscalReportMode === 'TAX_SUMMARY') {
                    return [
                        { key: 'taxLabel', label: 'Tasa Impuesto', type: 'text' },
                        { key: 'lineCount', label: 'Líneas', type: 'number' },
                        { key: 'taxableBase', label: 'Base Imponible', type: 'currency' },
                        { key: 'taxAmount', label: 'Impuesto', type: 'currency' },
                        { key: 'total', label: 'Total Gravado', type: 'currency' },
                    ];
                }
                return [
                    { key: 'ncf', label: 'NCF', type: 'text' },
                    { key: 'ticketNo', label: 'Ticket No.', type: 'text' },
                    { key: 'ncfType', label: 'Tipo NCF', type: 'text' },
                    { key: 'terminalId', label: 'Terminal', type: 'text' },
                    { key: 'status', label: 'Estado', type: 'status' },
                    { key: 'total', label: 'Total', type: 'currency' },
                    { key: 'date', label: 'Fecha', type: 'date' },
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
    }, [category, fiscalReportMode]);

    const classificationMaps = useMemo(() => {
        const toMap = (items?: { id: string; name: string }[]) => {
            const map = new Map<string, string>();
            (items || []).forEach(item => map.set(item.id, item.name));
            return map;
        };
        return {
            departments: toMap(config.departments),
            sections: toMap(config.sections),
            families: toMap(config.families),
            subfamilies: toMap(config.subfamilies),
            brands: toMap(config.brands),
            suppliers: toMap(inventorySuppliers.map(supplier => ({ id: supplier.id, name: supplier.name }))),
            warehouses: toMap(inventoryWarehouses.map(warehouse => ({ id: warehouse.id, name: warehouse.name })))
        };
    }, [
        config.departments,
        config.sections,
        config.families,
        config.subfamilies,
        config.brands,
        inventorySuppliers,
        inventoryWarehouses
    ]);

    const hierarchyFilteredProducts = useMemo(() => {
        return inventoryProducts.filter(product => {
            if (departmentFilter !== 'ALL' && product.departmentId !== departmentFilter) return false;
            if (sectionFilter !== 'ALL' && product.sectionId !== sectionFilter) return false;
            if (familyFilter !== 'ALL' && product.familyId !== familyFilter) return false;
            if (subfamilyFilter !== 'ALL' && product.subfamilyId !== subfamilyFilter) return false;
            return true;
        });
    }, [
        inventoryProducts,
        departmentFilter,
        sectionFilter,
        familyFilter,
        subfamilyFilter
    ]);

    const departmentOptions = useMemo(() => {
        const used = new Set(
            inventoryProducts.map(p => p.departmentId).filter(Boolean) as string[]
        );
        return (config.departments || []).filter(item => used.has(item.id));
    }, [inventoryProducts, config.departments]);

    const sectionOptions = useMemo(() => {
        const used = new Set(
            inventoryProducts
                .filter(p => departmentFilter === 'ALL' || p.departmentId === departmentFilter)
                .map(p => p.sectionId)
                .filter(Boolean) as string[]
        );
        return (config.sections || []).filter(section => {
            if (!used.has(section.id)) return false;
            if (departmentFilter === 'ALL') return true;
            return !section.parentId || section.parentId === departmentFilter;
        });
    }, [inventoryProducts, config.sections, departmentFilter]);

    const familyOptions = useMemo(() => {
        const used = new Set(
            inventoryProducts
                .filter(p => (departmentFilter === 'ALL' || p.departmentId === departmentFilter))
                .filter(p => (sectionFilter === 'ALL' || p.sectionId === sectionFilter))
                .map(p => p.familyId)
                .filter(Boolean) as string[]
        );
        return (config.families || []).filter(family => {
            if (!used.has(family.id)) return false;
            if (sectionFilter === 'ALL') return true;
            return !family.parentId || family.parentId === sectionFilter;
        });
    }, [inventoryProducts, config.families, departmentFilter, sectionFilter]);

    const subfamilyOptions = useMemo(() => {
        const used = new Set(
            inventoryProducts
                .filter(p => (departmentFilter === 'ALL' || p.departmentId === departmentFilter))
                .filter(p => (sectionFilter === 'ALL' || p.sectionId === sectionFilter))
                .filter(p => (familyFilter === 'ALL' || p.familyId === familyFilter))
                .map(p => p.subfamilyId)
                .filter(Boolean) as string[]
        );
        return (config.subfamilies || []).filter(subfamily => {
            if (!used.has(subfamily.id)) return false;
            if (familyFilter === 'ALL') return true;
            return !subfamily.parentId || subfamily.parentId === familyFilter;
        });
    }, [inventoryProducts, config.subfamilies, departmentFilter, sectionFilter, familyFilter]);

    const brandOptions = useMemo(() => {
        const used = new Set(
            hierarchyFilteredProducts.map(p => p.brandId).filter(Boolean) as string[]
        );
        return (config.brands || []).filter(item => used.has(item.id));
    }, [hierarchyFilteredProducts, config.brands]);

    const supplierOptions = useMemo(() => {
        const used = new Set(
            hierarchyFilteredProducts.map(p => p.primarySupplierId).filter(Boolean) as string[]
        );
        return inventorySuppliers.filter(item => used.has(item.id));
    }, [hierarchyFilteredProducts, inventorySuppliers]);

    useEffect(() => {
        setSectionFilter('ALL');
        setFamilyFilter('ALL');
        setSubfamilyFilter('ALL');
    }, [departmentFilter]);

    useEffect(() => {
        setFamilyFilter('ALL');
        setSubfamilyFilter('ALL');
    }, [sectionFilter]);

    useEffect(() => {
        setSubfamilyFilter('ALL');
    }, [familyFilter]);

    useEffect(() => {
        if (datePreset !== 'CUSTOM') return;
        if (customStartDate && customEndDate) return;
        const now = new Date();
        const start = new Date(now);
        start.setDate(now.getDate() - 29);
        setCustomStartDate(formatDateInput(startOfDay(start)));
        setCustomEndDate(formatDateInput(endOfDay(now)));
    }, [datePreset, customStartDate, customEndDate]);

    const dateRange = useMemo(() => {
        const now = new Date();
        const todayStart = startOfDay(now);
        const todayEnd = endOfDay(now);

        if (datePreset === 'ALL_TIME') {
            return {
                startMs: null as number | null,
                endMs: null as number | null
            };
        }

        if (datePreset === 'CUSTOM') {
            let start = customStartDate ? startOfDay(new Date(`${customStartDate}T00:00:00`)) : null;
            let end = customEndDate ? endOfDay(new Date(`${customEndDate}T00:00:00`)) : null;
            if (start && end && start.getTime() > end.getTime()) {
                const tmp = start;
                start = startOfDay(end);
                end = endOfDay(tmp);
            }
            return {
                startMs: start && Number.isFinite(start.getTime()) ? start.getTime() : null,
                endMs: end && Number.isFinite(end.getTime()) ? end.getTime() : null
            };
        }

        if (datePreset === 'LAST_7_DAYS') {
            const start = new Date(todayStart);
            start.setDate(start.getDate() - 6);
            return { startMs: start.getTime(), endMs: todayEnd.getTime() };
        }

        if (datePreset === 'LAST_30_DAYS') {
            const start = new Date(todayStart);
            start.setDate(start.getDate() - 29);
            return { startMs: start.getTime(), endMs: todayEnd.getTime() };
        }

        if (datePreset === 'LAST_90_DAYS') {
            const start = new Date(todayStart);
            start.setDate(start.getDate() - 89);
            return { startMs: start.getTime(), endMs: todayEnd.getTime() };
        }

        if (datePreset === 'THIS_MONTH') {
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            return { startMs: startOfDay(start).getTime(), endMs: todayEnd.getTime() };
        }

        if (datePreset === 'PREVIOUS_MONTH') {
            const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const end = new Date(now.getFullYear(), now.getMonth(), 0);
            return { startMs: startOfDay(start).getTime(), endMs: endOfDay(end).getTime() };
        }

        const start = new Date(now.getFullYear(), 0, 1);
        return { startMs: startOfDay(start).getTime(), endMs: todayEnd.getTime() };
    }, [datePreset, customStartDate, customEndDate]);

    const isWithinDateRange = (value: unknown): boolean => {
        if (dateRange.startMs === null && dateRange.endMs === null) return true;
        if (!value) return false;
        const time = new Date(String(value)).getTime();
        if (!Number.isFinite(time)) return false;
        if (dateRange.startMs !== null && time < dateRange.startMs) return false;
        if (dateRange.endMs !== null && time > dateRange.endMs) return false;
        return true;
    };

    const rowMatchesDateRange = (row: any): boolean => {
        if (dateRange.startMs === null && dateRange.endMs === null) return true;
        const candidates = [
            row?.date,
            row?.createdAt,
            row?.updatedAt,
            row?.lastVisit,
            row?.actualDate,
            row?.promisedDate,
            row?.lastClock
        ];
        const hasValidDate = candidates.some(candidate => Number.isFinite(new Date(String(candidate)).getTime()));
        if (!hasValidDate) return true;
        return candidates.some(candidate => isWithinDateRange(candidate));
    };

    const isFiscalTerminalMatch = (terminalId?: string): boolean => {
        if (fiscalTerminalFilter === 'ALL') return true;
        return normalizeTerminalId(terminalId) === normalizeTerminalId(fiscalTerminalFilter);
    };

    const filteredData = useMemo(() => {
        let result = [...data];
        result = result.filter(rowMatchesDateRange);
        if (isFiscalView && fiscalTerminalFilter !== 'ALL') {
            result = result.filter((row: any) => isFiscalTerminalMatch(row?.terminalId));
        }
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
    }, [data, searchTerm, sortConfig, dateRange.startMs, dateRange.endMs, isFiscalView, fiscalTerminalFilter]);

    const fiscalTaxSummaryRows = useMemo<FiscalTaxSummaryRow[]>(() => {
        if (!isFiscalView || !fiscalContext || fiscalReportMode !== 'TAX_SUMMARY') return [];

        const dedupedTransactions = new Map<string, Transaction>();
        [...fiscalContext.transactions, ...fiscalContext.transactionHistory].forEach(tx => {
            if (!tx?.id) return;
            dedupedTransactions.set(tx.id, tx);
        });

        const salesTransactions = Array.from(dedupedTransactions.values()).filter(tx => {
            if (!isWithinDateRange(tx.date)) return false;
            if (!isFiscalTerminalMatch(tx.terminalId)) return false;
            return SALES_NCF_REGEX.test(String(tx.ncf || '').toUpperCase());
        });

        const taxesById = new Map((config.taxes || []).map(tax => [tax.id, tax]));
        const buckets = new Map<string, FiscalTaxSummaryRow>();

        const ensureBucket = (taxRatePercent: number): FiscalTaxSummaryRow => {
            const key = taxRatePercent.toFixed(4);
            if (!buckets.has(key)) {
                buckets.set(key, {
                    taxLabel: formatTaxRateLabel(taxRatePercent),
                    taxRatePercent,
                    lineCount: 0,
                    taxableBase: 0,
                    taxAmount: 0,
                    total: 0
                });
            }
            return buckets.get(key)!;
        };

        salesTransactions.forEach(tx => {
            const items = Array.isArray(tx.items) ? tx.items : [];
            if (items.length === 0) return;

            const grossLineTotal = items.reduce(
                (sum, item) => sum + Math.max(0, toNumber((item as any).price) * toNumber((item as any).quantity)),
                0
            );
            const discountAmount = Math.max(0, toNumber(tx.discountAmount));
            const sign = isRefundLikeTransaction(tx) ? -1 : 1;

            items.forEach((item) => {
                const quantity = toNumber((item as any).quantity);
                const price = toNumber((item as any).price);
                const lineGross = Math.max(0, price * quantity);
                if (lineGross <= EPSILON) return;

                const itemRatio = grossLineTotal > 0 ? lineGross / grossLineTotal : 0;
                const lineDiscount = discountAmount * itemRatio;
                const lineBaseAfterDiscount = Math.max(0, lineGross - lineDiscount);

                const taxIds = Array.isArray((item as any).appliedTaxIds)
                    ? ((item as any).appliedTaxIds as string[])
                    : [];
                const taxes = taxIds.map(taxId => taxesById.get(taxId)).filter(Boolean);

                if (taxes.length === 0) {
                    const bucket = ensureBucket(0);
                    bucket.lineCount += 1;
                    bucket.taxableBase += sign * lineBaseAfterDiscount;
                    bucket.total += sign * lineBaseAfterDiscount;
                    return;
                }

                const totalTaxRatePercent = taxes.reduce(
                    (sum, tax) => sum + normalizeTaxRatePercent(tax?.rate),
                    0
                );
                const totalTaxRate = totalTaxRatePercent / 100;
                const lineNet = tx.isTaxIncluded && totalTaxRate > 0
                    ? lineBaseAfterDiscount / (1 + totalTaxRate)
                    : lineBaseAfterDiscount;

                taxes.forEach((tax) => {
                    const taxRatePercent = normalizeTaxRatePercent(tax?.rate);
                    const taxRate = taxRatePercent / 100;
                    const taxAmount = lineNet * taxRate;

                    const bucket = ensureBucket(taxRatePercent);
                    bucket.lineCount += 1;
                    bucket.taxableBase += sign * lineNet;
                    bucket.taxAmount += sign * taxAmount;
                    bucket.total += sign * (lineNet + taxAmount);
                });
            });
        });

        let rows = Array.from(buckets.values()).map(row => ({
            ...row,
            lineCount: Math.max(0, Math.round(row.lineCount)),
            taxableBase: round2(row.taxableBase),
            taxAmount: round2(row.taxAmount),
            total: round2(row.total)
        }));

        if (searchTerm.trim()) {
            const query = searchTerm.trim().toLowerCase();
            rows = rows.filter(row =>
                [row.taxLabel, row.lineCount, row.taxableBase, row.taxAmount, row.total]
                    .some(value => String(value).toLowerCase().includes(query))
            );
        }

        if (sortConfig) {
            rows.sort((a: any, b: any) => {
                const aVal = a[sortConfig.key];
                const bVal = b[sortConfig.key];
                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        } else {
            rows.sort((a, b) => b.taxRatePercent - a.taxRatePercent);
        }

        return rows;
    }, [
        isFiscalView,
        fiscalContext,
        fiscalReportMode,
        config.taxes,
        dateRange.startMs,
        dateRange.endMs,
        fiscalTerminalFilter,
        searchTerm,
        sortConfig
    ]);

    const operationsSearch = searchTerm.trim().toLowerCase();
    const taxRate = toNumber((config as any).taxRate) || 0.18;
    const matchesOperationsSearch = (values: unknown[]): boolean => {
        if (!operationsSearch) return true;
        return values.some(value => String(value ?? '').toLowerCase().includes(operationsSearch));
    };

    const operationsTransactionsInRange = useMemo(() => {
        return operationsTransactions.filter(tx => isWithinDateRange(tx.date));
    }, [operationsTransactions, dateRange.startMs, dateRange.endMs]);

    const operationsZReportsInRange = useMemo(() => {
        return operationsZReports.filter(report => isWithinDateRange(report.closedAt));
    }, [operationsZReports, dateRange.startMs, dateRange.endMs]);

    const operationsClosureRows = useMemo<OperationClosureRow[]>(() => {
        if (!isOperationsView) return [];

        const transactionsByZReport = new Map<string, Transaction[]>();
        operationsTransactions.forEach(tx => {
            if (!tx.zReportId) return;
            if (!transactionsByZReport.has(tx.zReportId)) {
                transactionsByZReport.set(tx.zReportId, []);
            }
            transactionsByZReport.get(tx.zReportId)!.push(tx);
        });

        const closedRows = operationsZReportsInRange.map(report => {
            const terminalKey = normalizeTerminalId(report.terminalId);
            const openedAtMs = toMs(report.openedAt);
            const closedAtMs = toMs(report.closedAt);

            const reportTransactions = transactionsByZReport.get(report.id) || operationsTransactions.filter(tx => {
                const txMs = toMs(tx.date);
                if (!Number.isFinite(txMs)) return false;
                if (normalizeTerminalId(tx.terminalId) !== terminalKey) return false;
                if (Number.isFinite(openedAtMs) && txMs < openedAtMs) return false;
                if (Number.isFinite(closedAtMs) && txMs > closedAtMs) return false;
                return true;
            });

            const expected = sumRecordValues(report.cashExpected);
            const hasCounted = Object.keys(report.cashCounted || {}).length > 0;
            const counted = hasCounted ? sumRecordValues(report.cashCounted) : null;
            const difference = counted === null ? null : counted - expected;

            return {
                id: report.id,
                dateTime: report.closedAt,
                terminalId: report.terminalId || 'T1',
                cashierId: report.closedByUserId || report.closedByUserName || 'unknown',
                cashierName: report.closedByUserName || 'Sin Cajero',
                expected,
                counted,
                difference,
                status: 'CERRADO' as const,
                totalSales: sumRecordValues(report.totalsByMethod),
                totalTax: reportTransactions.reduce((sum, tx) => sum + getSignedTaxAmount(tx, taxRate), 0),
                transactionCount: toNumber(report.transactionCount) || reportTransactions.length,
                note: report.notes || ''
            };
        });

        const terminalIds = new Set<string>();
        (config.terminals || []).forEach(terminal => terminalIds.add(terminal.id));
        operationsTransactions.forEach(tx => {
            if (tx.terminalId) terminalIds.add(tx.terminalId);
        });
        operationsCashMovements.forEach(movement => {
            if (movement.terminalId) terminalIds.add(movement.terminalId);
        });
        if (terminalIds.size === 0) terminalIds.add('T1');

        const openRows: OperationClosureRow[] = [];
        const allReports = [...operationsZReports];

        terminalIds.forEach(terminalId => {
            const terminalKey = normalizeTerminalId(terminalId);
            const latestCloseTs = allReports
                .filter(report => normalizeTerminalId(report.terminalId) === terminalKey)
                .map(report => toMs(report.closedAt))
                .filter(time => Number.isFinite(time))
                .reduce((max, time) => time > max ? time : max, 0);

            const pendingTransactions = operationsTransactions.filter(tx => {
                if (tx.zReportId) return false;
                if (normalizeTerminalId(tx.terminalId) !== terminalKey) return false;
                const txMs = toMs(tx.date);
                if (!Number.isFinite(txMs)) return latestCloseTs <= 0;
                return latestCloseTs <= 0 || txMs > latestCloseTs;
            });

            const pendingCashMovements = operationsCashMovements.filter(movement => {
                if (normalizeTerminalId(movement.terminalId) !== terminalKey) return false;
                const movementMs = toMs(movement.timestamp);
                if (!Number.isFinite(movementMs)) return latestCloseTs <= 0;
                return latestCloseTs <= 0 || movementMs > latestCloseTs;
            });

            if (pendingTransactions.length === 0 && pendingCashMovements.length === 0) return;

            const latestTxMs = pendingTransactions
                .map(tx => toMs(tx.date))
                .filter(time => Number.isFinite(time))
                .reduce((max, time) => time > max ? time : max, 0);
            const latestMovementMs = pendingCashMovements
                .map(movement => toMs(movement.timestamp))
                .filter(time => Number.isFinite(time))
                .reduce((max, time) => time > max ? time : max, 0);

            const latestActivityMs = Math.max(latestTxMs, latestMovementMs, Date.now());
            const dateTime = new Date(latestActivityMs).toISOString();
            if (!isWithinDateRange(dateTime)) return;

            const discrepancy = calculateCashDiscrepancy({
                transactions: pendingTransactions,
                cashTransactions: pendingCashMovements,
                countedCash: null
            });

            const latestTransaction = [...pendingTransactions]
                .sort((a, b) => toMs(b.date) - toMs(a.date))[0];
            const latestMovement = [...pendingCashMovements]
                .sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp))[0];
            const latestTransactionMs = latestTransaction ? toMs(latestTransaction.date) : -1;
            const latestMovementRecordMs = latestMovement ? toMs(latestMovement.timestamp) : -1;
            const latestSource = latestTransactionMs >= latestMovementRecordMs ? latestTransaction : latestMovement;
            const cashierName = latestSource?.userName || 'Sin Cajero';
            const cashierId = latestSource?.userId || terminalId;

            openRows.push({
                id: `OPEN-${terminalId}`,
                dateTime,
                terminalId,
                cashierId,
                cashierName,
                expected: discrepancy.expectedCash,
                counted: null,
                difference: null,
                status: 'ABIERTO' as const,
                totalSales: pendingTransactions
                    .filter(tx => !isRefundLikeTransaction(tx))
                    .reduce((sum, tx) => sum + toNumber(tx.total), 0),
                totalTax: pendingTransactions.reduce((sum, tx) => sum + getSignedTaxAmount(tx, taxRate), 0),
                transactionCount: pendingTransactions.length,
                note: 'Turno abierto en curso'
            });
        });

        return [...closedRows, ...openRows]
            .sort((a, b) => toMs(b.dateTime) - toMs(a.dateTime));
    }, [
        isOperationsView,
        operationsTransactions,
        operationsCashMovements,
        operationsZReports,
        operationsZReportsInRange,
        config.terminals,
        dateRange.startMs,
        dateRange.endMs,
        taxRate
    ]);

    const operationsClosureRowsFiltered = useMemo(() => {
        return operationsClosureRows.filter(row => matchesOperationsSearch([
            row.dateTime,
            row.terminalId,
            row.cashierName,
            row.status,
            row.note
        ]));
    }, [operationsClosureRows, operationsSearch]);

    const operationsKpis = useMemo(() => {
        return {
            totalSales: operationsClosureRowsFiltered.reduce((sum, row) => sum + row.totalSales, 0),
            totalLosses: operationsClosureRowsFiltered.reduce((sum, row) => {
                if (row.difference === null || row.difference >= 0) return sum;
                return sum + Math.abs(row.difference);
            }, 0),
            totalTax: operationsClosureRowsFiltered.reduce((sum, row) => sum + row.totalTax, 0)
        };
    }, [operationsClosureRowsFiltered]);

    const operationsCashierAuditRows = useMemo<CashierAuditRow[]>(() => {
        const grouped = new Map<string, CashierAuditRow>();
        operationsClosureRowsFiltered
            .filter(row => row.status === 'CERRADO')
            .forEach(row => {
                const key = `${row.cashierId || ''}::${row.cashierName || ''}`;
                if (!grouped.has(key)) {
                    grouped.set(key, {
                        cashierId: row.cashierId,
                        cashierName: row.cashierName,
                        shifts: 0,
                        surplus: 0,
                        shortage: 0,
                        netDifference: 0,
                        lastClosures: []
                    });
                }

                const current = grouped.get(key)!;
                current.shifts += 1;
                if (row.difference !== null && row.difference > 0) current.surplus += row.difference;
                if (row.difference !== null && row.difference < 0) current.shortage += Math.abs(row.difference);
                if (row.difference !== null) current.netDifference += row.difference;
                current.lastClosures.push(row);
            });

        return Array.from(grouped.values())
            .map(row => ({
                ...row,
                lastClosures: [...row.lastClosures]
                    .sort((a, b) => toMs(b.dateTime) - toMs(a.dateTime))
                    .slice(0, 5)
            }))
            .sort((a, b) => Math.abs(b.netDifference) - Math.abs(a.netDifference));
    }, [operationsClosureRowsFiltered]);

    useEffect(() => {
        if (operationsTab !== 'DISCREPANCY_AUDIT') return;
        if (!selectedCashierId && operationsCashierAuditRows.length > 0) {
            setSelectedCashierId(operationsCashierAuditRows[0].cashierId);
            return;
        }

        if (selectedCashierId && !operationsCashierAuditRows.some(row => row.cashierId === selectedCashierId)) {
            setSelectedCashierId(operationsCashierAuditRows[0]?.cashierId || null);
        }
    }, [operationsTab, selectedCashierId, operationsCashierAuditRows]);

    const selectedCashierAudit = useMemo(() => {
        if (!selectedCashierId) return null;
        return operationsCashierAuditRows.find(row => row.cashierId === selectedCashierId) || null;
    }, [selectedCashierId, operationsCashierAuditRows]);

    const operationsPaymentRows = useMemo<PaymentBreakdownRow[]>(() => {
        const buckets: Record<PaymentMethodKey, { total: number; tax: number }> = {
            CASH: { total: 0, tax: 0 },
            CARD: { total: 0, tax: 0 },
            STORE_CREDIT: { total: 0, tax: 0 },
            TRANSFER: { total: 0, tax: 0 }
        };

        operationsTransactionsInRange.forEach(tx => {
            const scopedPayments = (tx.payments || [])
                .map(payment => {
                    const method = normalizePaymentMethod(payment?.method);
                    if (!method) return null;
                    return {
                        method,
                        amount: Math.abs(getPaymentAppliedBaseAmount(payment))
                    };
                })
                .filter(Boolean) as Array<{ method: PaymentMethodKey; amount: number }>;

            if (scopedPayments.length === 0) return;
            const paymentTotal = scopedPayments.reduce((sum, payment) => sum + payment.amount, 0);
            const signedTax = getSignedTaxAmount(tx, taxRate);

            scopedPayments.forEach(payment => {
                buckets[payment.method].total += payment.amount;
                if (paymentTotal > 0) {
                    buckets[payment.method].tax += signedTax * (payment.amount / paymentTotal);
                }
            });
        });

        const grandTotal = PAYMENT_METHOD_ORDER.reduce((sum, method) => sum + buckets[method].total, 0);
        return PAYMENT_METHOD_ORDER.map(method => ({
            method,
            label: PAYMENT_METHOD_LABELS[method],
            color: PAYMENT_METHOD_COLORS[method],
            total: buckets[method].total,
            tax: buckets[method].tax,
            share: grandTotal > 0 ? (buckets[method].total / grandTotal) * 100 : 0
        })).filter(row => matchesOperationsSearch([row.label, row.method]));
    }, [operationsTransactionsInRange, operationsSearch, taxRate]);

    const operationsHourlyRows = useMemo<HourlyBehaviorRow[]>(() => {
        const rows = Array.from({ length: 24 }, (_, index) => ({
            hour: formatHourLabel(index),
            count: 0,
            total: 0,
            avgTicket: 0
        }));

        operationsTransactionsInRange.forEach(tx => {
            if (isRefundLikeTransaction(tx)) return;
            const txMs = toMs(tx.date);
            if (!Number.isFinite(txMs)) return;
            const hour = new Date(txMs).getHours();
            rows[hour].count += 1;
            rows[hour].total += toNumber(tx.total);
        });

        return rows.map(row => ({
            ...row,
            avgTicket: row.count > 0 ? row.total / row.count : 0
        }));
    }, [operationsTransactionsInRange]);

    const operationsHourlyRowsFiltered = useMemo(() => {
        return operationsHourlyRows.filter(row => matchesOperationsSearch([row.hour]));
    }, [operationsHourlyRows, operationsSearch]);

    const terminalWarehouseMap = useMemo(() => {
        const map: Record<string, string> = {};
        (config.terminals || []).forEach(terminal => {
            const terminalId = terminal?.id;
            const warehouseId = terminal?.config?.inventoryScope?.defaultSalesWarehouseId;
            if (terminalId && warehouseId) {
                map[terminalId] = warehouseId;
            }
        });
        return map;
    }, [config.terminals]);
    const customerFallbackWarehouseId = useMemo(() => {
        const configuredDefault = (config.terminals || [])
            .map(terminal => terminal?.config?.inventoryScope?.defaultSalesWarehouseId)
            .find(Boolean);
        if (configuredDefault) return configuredDefault;
        return customerWarehouses[0]?.id;
    }, [config.terminals, customerWarehouses]);

    const {
        rows: customerRows,
        summary: customerSummary,
        isLoading: isCustomersLoading
    } = useCustomerAnalytics({
        customers: customerContext?.customers || [],
        transactions: customerContext?.transactions || [],
        filters: {
            warehouseId: warehouseFilter,
            startMs: dateRange.startMs,
            endMs: dateRange.endMs,
            searchTerm
        },
        terminalWarehouseMap,
        fallbackWarehouseId: customerFallbackWarehouseId
    });

    const sortedCustomerRows = useMemo(() => {
        if (!isCustomersView) return [];
        const rows = [...customerRows];
        if (!sortConfig) {
            return rows.sort((a, b) => b.monetary - a.monetary);
        }

        rows.sort((a, b) => {
            const aVal = a[sortConfig.key as keyof typeof a] as unknown;
            const bVal = b[sortConfig.key as keyof typeof b] as unknown;

            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
            }

            const aText = String(aVal ?? '');
            const bText = String(bVal ?? '');
            return sortConfig.direction === 'asc'
                ? aText.localeCompare(bText)
                : bText.localeCompare(aText);
        });

        return rows;
    }, [isCustomersView, customerRows, sortConfig]);

    const inventoryRows = useMemo(() => {
        if (!isInventoryView || !inventoryContext) return [];
        return queryInventoryAnalytics({
            products: inventoryContext.products,
            productStocks: inventoryContext.productStocks,
            warehouses: inventoryContext.warehouses,
            inventoryLedger: inventoryContext.inventoryLedger,
            filters: {
                warehouseId: warehouseFilter,
                departmentId: departmentFilter,
                sectionId: sectionFilter,
                familyId: familyFilter,
                subfamilyId: subfamilyFilter,
                brandId: brandFilter,
                supplierId: supplierFilter,
                stockState: stockStateFilter,
                searchTerm
            }
        });
    }, [
        isInventoryView,
        inventoryContext,
        warehouseFilter,
        departmentFilter,
        sectionFilter,
        familyFilter,
        subfamilyFilter,
        brandFilter,
        supplierFilter,
        stockStateFilter,
        searchTerm
    ]);

    const sortedInventoryRows = useMemo(() => {
        const rows = [...inventoryRows];
        if (!sortConfig) return rows;

        rows.sort((a, b) => {
            const aVal = a[sortConfig.key as keyof InventoryAnalyticsRow] as unknown;
            const bVal = b[sortConfig.key as keyof InventoryAnalyticsRow] as unknown;

            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
            }

            const aText = String(aVal ?? '');
            const bText = String(bVal ?? '');
            return sortConfig.direction === 'asc'
                ? aText.localeCompare(bText)
                : bText.localeCompare(aText);
        });

        return rows;
    }, [inventoryRows, sortConfig]);

    const inventoryKPIs = useMemo(() => {
        if (!isInventoryView || !inventoryContext) {
            return {
                totalValue: 0,
                outOfStockCount: 0,
                auditedCoverage: 0,
                auditedProducts: 0,
                visibleProducts: 0
            };
        }

        const totalValue = sortedInventoryRows.reduce((sum, row) => sum + row.value, 0);
        const outOfStockCount = sortedInventoryRows.filter(row => row.quantity <= 0).length;

        const recentSessions = (inventoryContext.inventoryCounts || []).filter(session => {
            const sessionTime = new Date(session.finalizedAt || session.createdAt).getTime();
            if (!Number.isFinite(sessionTime)) return false;
            if (dateRange.startMs !== null && sessionTime < dateRange.startMs) return false;
            if (dateRange.endMs !== null && sessionTime > dateRange.endMs) return false;
            if (warehouseFilter !== 'ALL' && session.warehouseId !== warehouseFilter) return false;
            return !session.status || session.status === 'FINALIZED';
        });

        const auditedProductIds = new Set<string>();
        recentSessions.forEach(session => {
            (session.items || []).forEach(item => auditedProductIds.add(item.productId));
        });

        const auditedProducts = sortedInventoryRows.filter(row => auditedProductIds.has(row.id)).length;
        const visibleProducts = sortedInventoryRows.length;
        const auditedCoverage = visibleProducts > 0 ? (auditedProducts / visibleProducts) * 100 : 0;

        return {
            totalValue,
            outOfStockCount,
            auditedCoverage,
            auditedProducts,
            visibleProducts
        };
    }, [isInventoryView, inventoryContext, sortedInventoryRows, warehouseFilter, dateRange.startMs, dateRange.endMs]);

    const getStatusLabel = (status: Exclude<InventoryStatusFilter, 'ALL'>): string => {
        if (status === 'OUT_OF_STOCK') return 'Agotado';
        if (status === 'LOW_STOCK') return 'Bajo Mínimo';
        return 'Con Stock';
    };

    const handleSort = (key: string) => {
        setSortConfig(prev => ({
            key, direction: prev?.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const toggleRow = (id: string) => {
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleRunFiscalExport = async () => {
        if (!isFiscalView || !fiscalContext) return;

        setFiscalExportError('');
        setIsFiscalExporting(true);

        try {
            const selectedFormats = resolveFiscalFormats(fiscalExportFormat);
            if (selectedFormats.length === 0) {
                setFiscalExportError('Debe seleccionar al menos un formato.');
                setIsFiscalExporting(false);
                return;
            }

            const consolidateB02 = false;

            const periodDate = dateRange.endMs !== null ? new Date(dateRange.endMs) : new Date();
            const period = `${periodDate.getFullYear()}${String(periodDate.getMonth() + 1).padStart(2, '0')}`;

            const txInRange = fiscalContext.transactions.filter(tx =>
                isWithinDateRange(tx.date) && isFiscalTerminalMatch(tx.terminalId)
            );
            const historyInRange = fiscalContext.transactionHistory.filter(tx =>
                isWithinDateRange(tx.date) && isFiscalTerminalMatch(tx.terminalId)
            );
            const purchaseOrdersInRange = fiscalContext.purchaseOrders.filter(order =>
                isWithinDateRange(order.date) && isFiscalTerminalMatch((order as any).terminalId)
            );
            const receptionsInRange = fiscalContext.receptions.filter(reception =>
                isWithinDateRange(reception.date) && isFiscalTerminalMatch(reception.terminalId)
            );

            const exportSummaries: string[] = [];
            const allWarnings: string[] = [];
            const terminalSuffix = fiscalTerminalFilter === 'ALL'
                ? 'todas_cajas'
                : normalizeTerminalId(fiscalTerminalFilter);
            const terminalScopeLabel = fiscalTerminalFilter === 'ALL'
                ? 'Todas las cajas'
                : `Terminal ${normalizeTerminalId(fiscalTerminalFilter)}`;

            for (const formatType of selectedFormats) {
                const result = await formatFiscalExcel({
                    config,
                    transactions: txInRange,
                    transactionHistory: historyInRange,
                    purchaseOrders: purchaseOrdersInRange,
                    receptions: receptionsInRange,
                    suppliers: fiscalContext.suppliers,
                    period,
                    consolidateB02,
                    formatType,
                    suggestedFileName: `DGII_${formatType}_${period}_${terminalSuffix}.xlsx`
                });

                const locationSuffix = result.locationDescription ? ` • ${result.locationDescription}` : '';
                exportSummaries.push(`${formatType}: ${result.fileName} (${terminalScopeLabel})${locationSuffix}`);
                allWarnings.push(...result.warnings.map(w => `[${formatType}] ${w}`));
            }

            const warningsPreview = allWarnings.slice(0, 8);
            if (allWarnings.length > 8) {
                warningsPreview.push(`... y ${allWarnings.length - 8} advertencias adicionales.`);
            }

            setIsFiscalExportModalOpen(false);
            setFiscalExportFeedback({
                title: allWarnings.length > 0 ? 'Exportación completada con advertencias' : 'Exportación completada',
                summaries: exportSummaries,
                warnings: warningsPreview
            });
        } catch (error: any) {
            setIsFiscalExportModalOpen(false);
            setFiscalExportFeedback({
                title: 'Error al generar el Excel fiscal DGII',
                summaries: [error?.message || 'Ocurrió un error inesperado durante la exportación.'],
                warnings: [],
                isError: true
            });
        } finally {
            setIsFiscalExporting(false);
        }
    };

    const handleExportExcel = () => {
        const toCsvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const downloadCsv = (headers: string[], rows: (string | number)[][], filename: string) => {
            const csvRows = [headers, ...rows].map(row => row.map(toCsvCell).join(',')).join('\n');
            const csvContent = `data:text/csv;charset=utf-8,${csvRows}`;
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement('a');
            link.setAttribute('href', encodedUri);
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };
        const downloadCsvMatrix = (matrix: (string | number)[][], filename: string) => {
            const csvRows = matrix.map(row => row.map(toCsvCell).join(',')).join('\n');
            const csvContent = `data:text/csv;charset=utf-8,${csvRows}`;
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement('a');
            link.setAttribute('href', encodedUri);
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };

        if (isFiscalView && fiscalContext) {
            setFiscalExportError('');
            setFiscalExportFormat('607');
            setIsFiscalExportModalOpen(true);
            return;
        }

        if (isOperationsView) {
            const matrix: (string | number)[][] = [];
            matrix.push(['REPORTE CONSOLIDADO - OPERATIVA DE CAJA']);
            matrix.push(['Generado', new Date().toISOString()]);
            matrix.push([]);
            matrix.push(['KPIs']);
            matrix.push(['Venta Total del Periodo', operationsKpis.totalSales.toFixed(2)]);
            matrix.push(['Total Descuadres (Perdidas)', operationsKpis.totalLosses.toFixed(2)]);
            matrix.push(['Total Impuestos Recaudados', operationsKpis.totalTax.toFixed(2)]);
            matrix.push([]);

            matrix.push(['TAB 1 - HISTORIAL DE CIERRES Z']);
            matrix.push(['Fecha/Hora', 'Terminal', 'Cajero', 'Monto Esperado', 'Monto Contado', 'Diferencia', 'Estado', 'Motivo']);
            operationsClosureRowsFiltered.forEach(row => {
                matrix.push([
                    formatDateTime(row.dateTime),
                    row.terminalId,
                    row.cashierName,
                    row.expected.toFixed(2),
                    row.counted === null ? '' : row.counted.toFixed(2),
                    row.difference === null ? '' : row.difference.toFixed(2),
                    row.status,
                    row.note
                ]);
            });
            matrix.push([]);

            matrix.push(['TAB 2 - AUDITORIA DE DESCUADRES']);
            matrix.push(['Cajero', 'Cant. Turnos', 'Suma Sobrantes', 'Suma Faltantes', 'Neto Diferencia']);
            operationsCashierAuditRows.forEach(row => {
                matrix.push([
                    row.cashierName,
                    row.shifts,
                    row.surplus.toFixed(2),
                    row.shortage.toFixed(2),
                    row.netDifference.toFixed(2)
                ]);
            });
            operationsCashierAuditRows.forEach(row => {
                matrix.push([]);
                matrix.push([`Detalle Ultimos 5 Cierres - ${row.cashierName}`]);
                matrix.push(['Fecha/Hora', 'Terminal', 'Esperado', 'Contado', 'Diferencia', 'Motivo']);
                row.lastClosures.forEach(detail => {
                    matrix.push([
                        formatDateTime(detail.dateTime),
                        detail.terminalId,
                        detail.expected.toFixed(2),
                        detail.counted === null ? '' : detail.counted.toFixed(2),
                        detail.difference === null ? '' : detail.difference.toFixed(2),
                        detail.note || 'Sin observacion'
                    ]);
                });
            });
            matrix.push([]);

            matrix.push(['TAB 3 - ANALISIS DE MEDIOS DE PAGO']);
            matrix.push(['Medio', 'Total', '% Participacion', 'ITBIS Recaudado']);
            operationsPaymentRows.forEach(row => {
                matrix.push([
                    row.label,
                    row.total.toFixed(2),
                    row.share.toFixed(2),
                    row.tax.toFixed(2)
                ]);
            });
            matrix.push([]);

            matrix.push(['TAB 4 - COMPORTAMIENTO POR HORA']);
            matrix.push(['Hora', 'Cant. Tickets', 'Total Ventas', 'Ticket Promedio']);
            operationsHourlyRows.forEach(row => {
                matrix.push([
                    row.hour,
                    row.count,
                    row.total.toFixed(2),
                    row.avgTicket.toFixed(2)
                ]);
            });

            downloadCsvMatrix(
                matrix,
                `reporte_operativa_caja_consolidado_${new Date().toISOString().split('T')[0]}.csv`
            );
            return;
        }

        if (isInventoryView) {
            const warehouseLabel = warehouseFilter === 'ALL'
                ? 'Consolidado'
                : (classificationMaps.warehouses.get(warehouseFilter) || warehouseFilter);

            const headers = [
                'Tipo',
                'Articulo',
                'Existencia',
                'Costo Prom.',
                'Valor Total',
                'Estado',
                'Almacen',
                'Departamento',
                'Seccion',
                'Familia',
                'Subfamilia',
                'Marca',
                'Proveedor'
            ];

            const rows: (string | number)[][] = [];
            sortedInventoryRows.forEach((row: InventoryAnalyticsRow) => {
                const department = classificationMaps.departments.get(row.departmentId || '') || '';
                const section = classificationMaps.sections.get(row.sectionId || '') || '';
                const family = classificationMaps.families.get(row.familyId || '') || '';
                const subfamily = classificationMaps.subfamilies.get(row.subfamilyId || '') || '';
                const brand = classificationMaps.brands.get(row.brandId || '') || '';
                const supplier = classificationMaps.suppliers.get(row.supplierId || '') || '';

                rows.push([
                    'PRODUCTO',
                    row.name,
                    row.quantity,
                    row.avgCost.toFixed(2),
                    row.value.toFixed(2),
                    getStatusLabel(row.status),
                    warehouseLabel,
                    department,
                    section,
                    family,
                    subfamily,
                    brand,
                    supplier
                ]);

                if (includeVariantsInExport) {
                    row.variants.forEach(variant => {
                        rows.push([
                            'VARIANTE',
                            `${row.name} / ${variant.variantLabel}`,
                            variant.quantity,
                            variant.avgCost.toFixed(2),
                            variant.value.toFixed(2),
                            '',
                            warehouseLabel,
                            department,
                            section,
                            family,
                            subfamily,
                            brand,
                            supplier
                        ]);
                    });
                }
            });

            downloadCsv(
                headers,
                rows,
                `reporte_inventory_${new Date().toISOString().split('T')[0]}.csv`
            );
            return;
        }

        if (isCustomersView) {
            const headers = [
                'Cliente',
                'RNC/Cedula',
                'Telefono',
                'Recencia (dias)',
                'Frecuencia',
                'Monetario',
                'Ultima Visita'
            ];
            const rows = sortedCustomerRows.map(row => [
                row.name,
                row.taxId,
                row.phone,
                row.recency,
                row.frequency,
                row.monetary.toFixed(2),
                new Date(row.lastVisit).toLocaleDateString()
            ]);
            downloadCsv(
                headers,
                rows,
                `reporte_customers_${new Date().toISOString().split('T')[0]}.csv`
            );
            return;
        }

        const headers = columns.map(c => c.label);
        const rows = filteredData.map(row =>
            columns.map(c => row[c.key] ?? '')
        );
        downloadCsv(
            headers,
            rows,
            `reporte_${category.toLowerCase()}_${new Date().toISOString().split('T')[0]}.csv`
        );
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
                                    {item.name || item.hour || item.label || item.taxLabel || item.ncf || 'Item'}
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

    const OperationsPieChart = ({ rows }: { rows: PaymentBreakdownRow[] }) => {
        const total = rows.reduce((sum, row) => sum + row.total, 0);
        if (total <= 0) {
            return <p className="text-sm text-gray-400 text-center py-10">Sin datos de medios de pago para el periodo seleccionado.</p>;
        }

        const radius = 90;
        const center = 120;
        let cumulative = 0;

        return (
            <div className="flex flex-col items-center gap-4">
                <svg viewBox="0 0 240 240" className="w-full max-w-[260px]">
                    {rows.map(row => {
                        const value = row.total;
                        if (value <= 0) return null;

                        const startAngle = (cumulative / total) * Math.PI * 2 - Math.PI / 2;
                        cumulative += value;
                        const endAngle = (cumulative / total) * Math.PI * 2 - Math.PI / 2;

                        const x1 = center + radius * Math.cos(startAngle);
                        const y1 = center + radius * Math.sin(startAngle);
                        const x2 = center + radius * Math.cos(endAngle);
                        const y2 = center + radius * Math.sin(endAngle);
                        const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

                        const d = [
                            `M ${center} ${center}`,
                            `L ${x1} ${y1}`,
                            `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
                            'Z'
                        ].join(' ');

                        return (
                            <path
                                key={row.method}
                                d={d}
                                fill={row.color}
                                stroke="#ffffff"
                                strokeWidth="2"
                            />
                        );
                    })}
                    <circle cx={center} cy={center} r="48" fill="#ffffff" />
                    <text x={center} y={center - 4} textAnchor="middle" className="fill-slate-700 text-[11px] font-black">TOTAL</text>
                    <text x={center} y={center + 16} textAnchor="middle" className="fill-slate-900 text-[13px] font-black">
                        {config.currencySymbol}{total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </text>
                </svg>
                <div className="w-full space-y-2">
                    {rows.map(row => (
                        <div key={row.method} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                                <span className="font-bold text-slate-700">{row.label}</span>
                            </div>
                            <span className="font-black text-slate-900">{row.share.toFixed(1)}%</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const OperationsLineChart = ({ rows }: { rows: HourlyBehaviorRow[] }) => {
        const width = 860;
        const height = 260;
        const padding = 28;
        const maxY = Math.max(...rows.map(row => row.count), 1);
        const stepX = rows.length > 1 ? (width - (padding * 2)) / (rows.length - 1) : 0;
        const points = rows.map((row, index) => {
            const x = padding + (index * stepX);
            const y = height - padding - ((row.count / maxY) * (height - (padding * 2)));
            return { x, y, row };
        });

        const path = points.map((point, index) =>
            `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
        ).join(' ');

        return (
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
                <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#d1d5db" strokeWidth="1" />
                <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#d1d5db" strokeWidth="1" />
                <path d={path} fill="none" stroke="#f97316" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                {points.filter((_, index) => index % 3 === 0).map(point => (
                    <g key={point.row.hour}>
                        <circle cx={point.x} cy={point.y} r="4" fill="#f97316" />
                        <text x={point.x} y={height - 8} textAnchor="middle" className="fill-slate-500 text-[9px] font-black">
                            {point.row.hour.slice(0, 2)}
                        </text>
                    </g>
                ))}
            </svg>
        );
    };

    const operationsTabs: Array<{ key: OperationsTab; label: string }> = [
        { key: 'Z_HISTORY', label: 'Historial Cierres Z' },
        { key: 'DISCREPANCY_AUDIT', label: 'Auditoria Descuadres' },
        { key: 'PAYMENT_ANALYSIS', label: 'Medios de Pago' },
        { key: 'HOURLY_BEHAVIOR', label: 'Comportamiento por Hora' }
    ];

    const renderOperationsContent = () => {
        if (!isOperationsView) {
            return (
                <div className="bg-white rounded-3xl border border-gray-100 p-8 text-sm text-slate-500">
                    No hay contexto operativo disponible para este reporte.
                </div>
            );
        }

        if (operationsTab === 'Z_HISTORY') {
            return (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="bg-white rounded-2xl border border-gray-100 p-4">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Venta Total del Periodo</p>
                            <p className="text-2xl font-black text-slate-900 mt-1">{config.currencySymbol}{operationsKpis.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div className="bg-white rounded-2xl border border-gray-100 p-4">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Descuadres (Perdidas)</p>
                            <p className="text-2xl font-black text-red-600 mt-1">{config.currencySymbol}{operationsKpis.totalLosses.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div className="bg-white rounded-2xl border border-gray-100 p-4">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Impuestos Recaudados</p>
                            <p className="text-2xl font-black text-blue-600 mt-1">{config.currencySymbol}{operationsKpis.totalTax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                    </div>
                    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100">
                                        <th className="px-3 py-3 text-left font-black text-slate-400 uppercase tracking-widest">Fecha/Hora</th>
                                        <th className="px-3 py-3 text-left font-black text-slate-400 uppercase tracking-widest">Terminal</th>
                                        <th className="px-3 py-3 text-left font-black text-slate-400 uppercase tracking-widest">Cajero</th>
                                        <th className="px-3 py-3 text-right font-black text-slate-400 uppercase tracking-widest">Monto Esperado</th>
                                        <th className="px-3 py-3 text-right font-black text-slate-400 uppercase tracking-widest">Monto Contado</th>
                                        <th className="px-3 py-3 text-right font-black text-slate-400 uppercase tracking-widest">Diferencia</th>
                                        <th className="px-3 py-3 text-left font-black text-slate-400 uppercase tracking-widest">Estado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {operationsClosureRowsFiltered.map(row => {
                                        const difference = row.difference;
                                        const isBalanced = difference !== null && Math.abs(difference) <= EPSILON;
                                        const hasDiscrepancy = difference !== null && Math.abs(difference) > EPSILON;
                                        return (
                                            <tr key={row.id} className="hover:bg-orange-50/40">
                                                <td className="px-3 py-2.5 font-bold text-slate-700">{formatDateTime(row.dateTime)}</td>
                                                <td className="px-3 py-2.5 font-bold text-slate-700">{row.terminalId}</td>
                                                <td className="px-3 py-2.5 font-bold text-slate-700">{row.cashierName}</td>
                                                <td className="px-3 py-2.5 text-right font-black text-slate-800">{config.currencySymbol}{row.expected.toFixed(2)}</td>
                                                <td className="px-3 py-2.5 text-right font-black text-slate-800">{row.counted === null ? '--' : `${config.currencySymbol}${row.counted.toFixed(2)}`}</td>
                                                <td className={`px-3 py-2.5 text-right font-black ${hasDiscrepancy ? 'text-red-600' : 'text-emerald-600'}`}>
                                                    {difference === null ? '--' : `${difference > 0 ? '+' : ''}${config.currencySymbol}${difference.toFixed(2)}`}
                                                </td>
                                                <td className="px-3 py-2.5">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${row.status === 'CERRADO' ? 'bg-slate-100 text-slate-700' : 'bg-blue-100 text-blue-700'}`}>
                                                            {row.status}
                                                        </span>
                                                        {row.status === 'CERRADO' && (
                                                            <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${isBalanced ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                                                {isBalanced ? 'Cuadrado' : 'Descuadre'}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {operationsClosureRowsFiltered.length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="px-3 py-12 text-center text-slate-400">Sin cierres para el rango seleccionado.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            );
        }

        if (operationsTab === 'DISCREPANCY_AUDIT') {
            return (
                <div className="grid grid-cols-1 xl:grid-cols-[1.4fr,1fr] gap-4">
                    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100">
                                        <th className="px-3 py-3 text-left font-black text-slate-400 uppercase tracking-widest">Cajero</th>
                                        <th className="px-3 py-3 text-right font-black text-slate-400 uppercase tracking-widest">Cant. Turnos</th>
                                        <th className="px-3 py-3 text-right font-black text-slate-400 uppercase tracking-widest">Suma Sobrantes</th>
                                        <th className="px-3 py-3 text-right font-black text-slate-400 uppercase tracking-widest">Suma Faltantes</th>
                                        <th className="px-3 py-3 text-right font-black text-slate-400 uppercase tracking-widest">Neto Diferencia</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {operationsCashierAuditRows.map(row => {
                                        const active = selectedCashierId === row.cashierId;
                                        const isBalanced = Math.abs(row.netDifference) <= EPSILON;
                                        return (
                                            <tr
                                                key={row.cashierId}
                                                onClick={() => setSelectedCashierId(row.cashierId)}
                                                className={`cursor-pointer hover:bg-orange-50/40 ${active ? 'bg-orange-50/70' : ''}`}
                                            >
                                                <td className="px-3 py-2.5 font-black text-slate-800">{row.cashierName}</td>
                                                <td className="px-3 py-2.5 text-right font-bold text-slate-700">{row.shifts}</td>
                                                <td className="px-3 py-2.5 text-right font-black text-emerald-600">{config.currencySymbol}{row.surplus.toFixed(2)}</td>
                                                <td className="px-3 py-2.5 text-right font-black text-red-600">{config.currencySymbol}{row.shortage.toFixed(2)}</td>
                                                <td className={`px-3 py-2.5 text-right font-black ${isBalanced ? 'text-emerald-600' : 'text-red-600'}`}>
                                                    {row.netDifference > 0 ? '+' : ''}{config.currencySymbol}{row.netDifference.toFixed(2)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {operationsCashierAuditRows.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-3 py-12 text-center text-slate-400">No hay descuadres en el periodo filtrado.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4">
                        <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-3">Ultimos 5 Cierres / Motivos</h3>
                        {selectedCashierAudit ? (
                            <div className="space-y-2">
                                {selectedCashierAudit.lastClosures.map(closure => {
                                    const hasDiscrepancy = closure.difference !== null && Math.abs(closure.difference) > EPSILON;
                                    return (
                                        <div key={closure.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50/70">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="text-xs font-black text-slate-800">{formatDateTime(closure.dateTime)}</p>
                                                <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${hasDiscrepancy ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                                    {hasDiscrepancy ? 'Descuadre' : 'Cuadrado'}
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-slate-500 mt-1">Terminal: {closure.terminalId}</p>
                                            <p className={`text-xs font-black mt-1 ${hasDiscrepancy ? 'text-red-600' : 'text-emerald-600'}`}>
                                                Diferencia: {closure.difference === null ? '--' : `${closure.difference > 0 ? '+' : ''}${config.currencySymbol}${closure.difference.toFixed(2)}`}
                                            </p>
                                            <p className="text-[11px] text-slate-600 mt-1">
                                                Motivo: {closure.note || 'Sin observacion de auditoria.'}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-sm text-slate-400">Selecciona un cajero para ver detalles.</p>
                        )}
                    </div>
                </div>
            );
        }

        if (operationsTab === 'PAYMENT_ANALYSIS') {
            return (
                <div className="grid grid-cols-1 xl:grid-cols-[360px,1fr] gap-4">
                    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4">
                        <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-3">Participacion por Medio</h3>
                        <OperationsPieChart rows={operationsPaymentRows} />
                    </div>
                    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100">
                                        <th className="px-3 py-3 text-left font-black text-slate-400 uppercase tracking-widest">Medio de Pago</th>
                                        <th className="px-3 py-3 text-right font-black text-slate-400 uppercase tracking-widest">Total</th>
                                        <th className="px-3 py-3 text-right font-black text-slate-400 uppercase tracking-widest">% Participacion</th>
                                        <th className="px-3 py-3 text-right font-black text-slate-400 uppercase tracking-widest">ITBIS Recaudado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {operationsPaymentRows.map(row => (
                                        <tr key={row.method} className="hover:bg-slate-50/70">
                                            <td className="px-3 py-2.5 font-black text-slate-800">
                                                <span className="inline-flex items-center gap-2">
                                                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                                                    {row.label}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2.5 text-right font-black text-slate-800">{config.currencySymbol}{row.total.toFixed(2)}</td>
                                            <td className="px-3 py-2.5 text-right font-black text-slate-700">{row.share.toFixed(1)}%</td>
                                            <td className={`px-3 py-2.5 text-right font-black ${row.tax < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                                                {row.tax < 0 ? '-' : ''}{config.currencySymbol}{Math.abs(row.tax).toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                    {operationsPaymentRows.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="px-3 py-12 text-center text-slate-400">No hay pagos registrados para el rango seleccionado.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="space-y-4">
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4">
                    <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-3">Tendencia de Flujo de Clientes</h3>
                    <OperationsLineChart rows={operationsHourlyRows} />
                </div>
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-100">
                                    <th className="px-3 py-3 text-left font-black text-slate-400 uppercase tracking-widest">Hora</th>
                                    <th className="px-3 py-3 text-right font-black text-slate-400 uppercase tracking-widest">Cant. Tickets</th>
                                    <th className="px-3 py-3 text-right font-black text-slate-400 uppercase tracking-widest">Total Ventas</th>
                                    <th className="px-3 py-3 text-right font-black text-slate-400 uppercase tracking-widest">Ticket Promedio</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {operationsHourlyRowsFiltered.map(row => (
                                    <tr key={row.hour} className="hover:bg-orange-50/30">
                                        <td className="px-3 py-2.5 font-black text-slate-800">{row.hour}</td>
                                        <td className="px-3 py-2.5 text-right font-bold text-slate-700">{row.count}</td>
                                        <td className="px-3 py-2.5 text-right font-black text-slate-800">{config.currencySymbol}{row.total.toFixed(2)}</td>
                                        <td className="px-3 py-2.5 text-right font-black text-blue-600">{config.currencySymbol}{row.avgTicket.toFixed(2)}</td>
                                    </tr>
                                ))}
                                {operationsHourlyRowsFiltered.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-3 py-12 text-center text-slate-400">No hay tickets para el rango seleccionado.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    };

    const warehouseOptions = isInventoryView
        ? inventoryWarehouses
        : isCustomersView
            ? customerWarehouses
            : [];
    const fiscalTerminalOptions = useMemo(() => {
        if (!isFiscalView || !fiscalContext) return [];
        const terminalMap = new Map<string, string>();
        (config.terminals || []).forEach(terminal => terminalMap.set(terminal.id, terminal.id));
        [...fiscalContext.transactions, ...fiscalContext.transactionHistory].forEach(tx => {
            if (tx.terminalId) terminalMap.set(tx.terminalId, tx.terminalId);
        });
        fiscalContext.receptions.forEach(reception => {
            if (reception.terminalId) terminalMap.set(reception.terminalId, reception.terminalId);
        });
        return Array.from(terminalMap.values()).sort((a, b) => a.localeCompare(b));
    }, [isFiscalView, fiscalContext, config.terminals]);
    const tableRows = isInventoryView
        ? sortedInventoryRows
        : isCustomersView
            ? sortedCustomerRows
            : isFiscalView && fiscalReportMode === 'TAX_SUMMARY'
                ? fiscalTaxSummaryRows
                : filteredData;
    const chartItems = isInventoryView
        ? sortedInventoryRows
        : isCustomersView
            ? sortedCustomerRows
            : isFiscalView && fiscalReportMode === 'TAX_SUMMARY'
                ? fiscalTaxSummaryRows
                : filteredData;

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
                    {!isOperationsView && (
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
                    )}
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
            <div className="p-8 pb-0 space-y-4 no-print filter-bar">
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

                    <div className="relative">
                        <Calendar size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none" />
                        <select
                            value={datePreset}
                            onChange={(e) => setDatePreset(e.target.value as DatePreset)}
                            className="appearance-none min-w-[210px] h-[50px] pl-10 pr-10 bg-white border border-gray-200 rounded-2xl text-sm font-black text-gray-700 shadow-sm hover:border-blue-400 transition-all outline-none"
                        >
                            {datePresetOptions.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>

                    {(isInventoryView || isCustomersView) ? (
                        <div className="relative">
                            <select
                                value={warehouseFilter}
                                onChange={(e) => setWarehouseFilter(e.target.value)}
                                className="appearance-none min-w-[220px] h-[50px] pl-4 pr-10 bg-white border border-gray-200 rounded-2xl text-sm font-black text-gray-700 shadow-sm hover:border-blue-400 transition-all outline-none"
                            >
                                <option value="ALL">Todos los Almacenes</option>
                                {warehouseOptions.map(warehouse => (
                                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                                ))}
                            </select>
                            <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                    ) : isFiscalView ? (
                        <>
                            <div className="relative">
                                <select
                                    value={fiscalTerminalFilter}
                                    onChange={(e) => setFiscalTerminalFilter(e.target.value)}
                                    className="appearance-none min-w-[220px] h-[50px] pl-4 pr-10 bg-white border border-gray-200 rounded-2xl text-sm font-black text-gray-700 shadow-sm hover:border-blue-400 transition-all outline-none"
                                >
                                    <option value="ALL">Todas las cajas (Master)</option>
                                    {fiscalTerminalOptions.map(terminalId => (
                                        <option key={terminalId} value={terminalId}>{terminalId}</option>
                                    ))}
                                </select>
                                <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                            </div>
                            <div className="relative">
                                <select
                                    value={fiscalReportMode}
                                    onChange={(e) => setFiscalReportMode(e.target.value as FiscalReportMode)}
                                    className="appearance-none min-w-[240px] h-[50px] pl-4 pr-10 bg-white border border-gray-200 rounded-2xl text-sm font-black text-gray-700 shadow-sm hover:border-blue-400 transition-all outline-none"
                                >
                                    <option value="NCF_DETAIL">Detalle de Comprobantes</option>
                                    <option value="TAX_SUMMARY">Resumen por Impuesto</option>
                                </select>
                                <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                            </div>
                        </>
                    ) : (
                        <div className="flex items-center gap-3 px-5 py-3 bg-white border border-gray-200 rounded-2xl text-sm font-black text-gray-600 shadow-sm cursor-pointer hover:border-blue-400 transition-all">
                            <Filter size={18} className="text-blue-500" />
                            <span>Almacenes</span>
                            <ChevronDown size={14} className="text-gray-400" />
                        </div>
                    )}

                    {isInventoryView && (
                        <button
                            onClick={() => setShowAdvancedFilters(prev => !prev)}
                            className="flex items-center gap-2 px-5 py-3 bg-white border border-gray-200 rounded-2xl text-sm font-black text-gray-700 shadow-sm hover:border-blue-400 transition-all"
                        >
                            <Filter size={16} className="text-blue-500" />
                            Filtros Avanzados
                            <ChevronDown size={14} className={`text-gray-400 transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
                        </button>
                    )}
                </div>

                {datePreset === 'CUSTOM' && (
                    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row gap-3 sm:items-center">
                        <label className="text-[11px] font-black text-gray-500 uppercase tracking-wider">Desde</label>
                        <input
                            type="date"
                            value={customStartDate}
                            onChange={(e) => setCustomStartDate(e.target.value)}
                            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none focus:border-blue-400"
                        />
                        <label className="text-[11px] font-black text-gray-500 uppercase tracking-wider">Hasta</label>
                        <input
                            type="date"
                            value={customEndDate}
                            onChange={(e) => setCustomEndDate(e.target.value)}
                            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none focus:border-blue-400"
                        />
                    </div>
                )}

                {isInventoryView && showAdvancedFilters && (
                    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm animate-in fade-in slide-in-from-top-2">
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                            <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none focus:border-blue-400">
                                <option value="ALL">Departamento</option>
                                {departmentOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>

                            <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none focus:border-blue-400">
                                <option value="ALL">Sección</option>
                                {sectionOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>

                            <select value={familyFilter} onChange={(e) => setFamilyFilter(e.target.value)} className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none focus:border-blue-400">
                                <option value="ALL">Familia</option>
                                {familyOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>

                            <select value={subfamilyFilter} onChange={(e) => setSubfamilyFilter(e.target.value)} className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none focus:border-blue-400">
                                <option value="ALL">Subfamilia</option>
                                {subfamilyOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>

                            <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none focus:border-blue-400">
                                <option value="ALL">Marca</option>
                                {brandOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>

                            <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none focus:border-blue-400">
                                <option value="ALL">Proveedor</option>
                                {supplierOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>

                            <select value={stockStateFilter} onChange={(e) => setStockStateFilter(e.target.value as InventoryStatusFilter)} className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none focus:border-blue-400">
                                <option value="ALL">Estado</option>
                                <option value="WITH_STOCK">Solo con Stock</option>
                                <option value="OUT_OF_STOCK">Agotados</option>
                                <option value="LOW_STOCK">Bajo Mínimo</option>
                            </select>

                            <label className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={includeVariantsInExport}
                                    onChange={(e) => setIncludeVariantsInExport(e.target.checked)}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                Incluir variantes en EXCEL
                            </label>
                        </div>
                    </div>
                )}
            </div>

            {/* CONTENT AREA */}
            <div className="flex-1 overflow-auto p-8">
                {isOperationsView ? (
                    <div className="space-y-4">
                        <div className="bg-white rounded-2xl border border-gray-100 p-2 flex flex-wrap gap-2">
                            {operationsTabs.map(tab => (
                                <button
                                    key={tab.key}
                                    onClick={() => setOperationsTab(tab.key)}
                                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wide transition-all ${operationsTab === tab.key
                                        ? 'bg-orange-500 text-white shadow-md'
                                        : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                                        }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                        {renderOperationsContent()}
                    </div>
                ) : (
                    <>
                {isInventoryView && (
                    <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-5 bg-white rounded-3xl border border-gray-100 shadow-sm">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Valorización Total</p>
                            <p className="text-2xl font-black text-slate-800">
                                {config.currencySymbol}{inventoryKPIs.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                        </div>
                        <div className="p-5 bg-white rounded-3xl border border-gray-100 shadow-sm">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Items Agotados</p>
                            <p className="text-2xl font-black text-red-600">{inventoryKPIs.outOfStockCount}</p>
                        </div>
                        <div className="p-5 bg-white rounded-3xl border border-gray-100 shadow-sm">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Exactitud</p>
                            <p className="text-2xl font-black text-blue-600">{inventoryKPIs.auditedCoverage.toFixed(1)}%</p>
                            <p className="text-[10px] font-bold text-gray-400 mt-1">
                                {inventoryKPIs.auditedProducts}/{inventoryKPIs.visibleProducts} auditados recientemente
                            </p>
                        </div>
                    </div>
                )}

                {isCustomersView && (
                    <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-5 bg-white rounded-3xl border border-gray-100 shadow-sm">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Ticket Promedio</p>
                            <p className="text-2xl font-black text-slate-800">
                                {config.currencySymbol}{customerSummary.ticketAverage.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                        </div>
                        <div className="p-5 bg-white rounded-3xl border border-gray-100 shadow-sm">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Cliente Top</p>
                            <p className="text-2xl font-black text-blue-600 truncate">{customerSummary.topCustomerName || '-'}</p>
                        </div>
                        <div className="p-5 bg-white rounded-3xl border border-gray-100 shadow-sm">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Nuevos Clientes</p>
                            <p className="text-2xl font-black text-emerald-600">{customerSummary.newCustomers}</p>
                        </div>
                    </div>
                )}

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

                                {isInventoryView ? (
                                    <tbody className="divide-y divide-slate-50">
                                        {sortedInventoryRows.map(row => {
                                            const isExpanded = expandedRows.has(row.id);
                                            const rowStatusClass = row.status === 'OUT_OF_STOCK'
                                                ? 'text-red-600'
                                                : row.status === 'LOW_STOCK'
                                                    ? 'text-orange-600'
                                                    : 'text-slate-700';

                                            return (
                                                <React.Fragment key={row.id}>
                                                    <tr className="hover:bg-blue-50/40 transition-colors group border-transparent">
                                                        <td className="px-8 py-5 font-bold text-slate-700">
                                                            <div className="flex items-center gap-3">
                                                                {row.hasVariants ? (
                                                                    <button
                                                                        onClick={() => toggleRow(row.id)}
                                                                        className="w-6 h-6 rounded-md border border-gray-200 bg-white text-gray-500 hover:text-blue-600 hover:border-blue-200 flex items-center justify-center transition-all"
                                                                        title={isExpanded ? 'Ocultar variantes' : 'Mostrar variantes'}
                                                                    >
                                                                        <ChevronRight size={14} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                                                    </button>
                                                                ) : (
                                                                    <span className="w-6 h-6" />
                                                                )}
                                                                <div>
                                                                    <p className="font-black text-slate-800">{row.name}</p>
                                                                    <p className="text-[10px] font-mono text-slate-400">{row.code || row.id} · {getStatusLabel(row.status)}</p>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className={`px-8 py-5 font-black ${rowStatusClass}`}>
                                                            {row.quantity.toLocaleString()}
                                                        </td>
                                                        <td className="px-8 py-5 font-bold text-slate-700">
                                                            {config.currencySymbol}{row.avgCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                        </td>
                                                        <td className="px-8 py-5 font-bold text-slate-700">
                                                            {config.currencySymbol}{row.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                        </td>
                                                    </tr>

                                                    {isExpanded && row.variants.map((variant) => (
                                                        <tr key={`${row.id}-${variant.variantId}`} className="bg-gray-50/80 border-t border-gray-100">
                                                            <td className="px-8 py-3 pl-20 text-xs font-bold text-slate-600">
                                                                {variant.variantLabel}
                                                            </td>
                                                            <td className="px-8 py-3 text-xs font-bold text-slate-700">
                                                                {variant.quantity.toLocaleString()}
                                                            </td>
                                                            <td className="px-8 py-3 text-xs font-bold text-slate-700">
                                                                {config.currencySymbol}{variant.avgCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                            </td>
                                                            <td className="px-8 py-3 text-xs font-bold text-slate-700">
                                                                {config.currencySymbol}{variant.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </React.Fragment>
                                            );
                                        })}

                                        {sortedInventoryRows.length === 0 && (
                                            <tr>
                                                <td colSpan={columns.length} className="px-8 py-20 text-center text-slate-300 italic">
                                                    No se han encontrado registros para mostrar.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                ) : isCustomersView ? (
                                    <tbody className="divide-y divide-slate-50">
                                        {isCustomersLoading && (
                                            <tr>
                                                <td colSpan={columns.length} className="px-8 py-20 text-center text-slate-300 italic">
                                                    Cargando...
                                                </td>
                                            </tr>
                                        )}

                                        {!isCustomersLoading && sortedCustomerRows.map(row => {
                                            const isExpanded = expandedRows.has(row.id);
                                            const recencyClass = row.recency > 90
                                                ? 'text-red-600'
                                                : row.recency > 60
                                                    ? 'text-orange-600'
                                                    : 'text-slate-700';

                                            return (
                                                <React.Fragment key={row.id}>
                                                    <tr
                                                        onClick={() => toggleRow(row.id)}
                                                        className="hover:bg-blue-50/40 transition-colors group border-transparent cursor-pointer"
                                                    >
                                                        <td className="px-8 py-5 font-bold text-slate-700">
                                                            <div className="flex items-start gap-3">
                                                                <div className="w-6 h-6 mt-0.5 rounded-md border border-gray-200 bg-white text-gray-500 flex items-center justify-center transition-all">
                                                                    <ChevronRight size={14} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                                                </div>
                                                                <div>
                                                                    <p className="font-black text-slate-800">{row.name}</p>
                                                                    <p className="text-[10px] text-gray-400 font-bold">{row.taxId || 'Sin RNC/Cédula'}</p>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className={`px-8 py-5 font-black ${recencyClass}`}>{row.recency}</td>
                                                        <td className="px-8 py-5 font-bold text-slate-700">{row.frequency.toLocaleString()}</td>
                                                        <td className="px-8 py-5 font-bold text-slate-700">
                                                            {config.currencySymbol}{row.monetary.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                        </td>
                                                        <td className="px-8 py-5 font-bold text-slate-700">
                                                            {new Date(row.lastVisit).toLocaleDateString()}
                                                        </td>
                                                    </tr>

                                                    {isExpanded && (
                                                        <tr className="bg-gray-50/80 border-t border-gray-100">
                                                            <td colSpan={columns.length} className="px-8 py-4">
                                                                <div className="pl-9">
                                                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">
                                                                        Últimos 5 Artículos Comprados
                                                                    </p>
                                                                    {row.lastItems.length === 0 ? (
                                                                        <p className="text-xs text-gray-400 italic">No hay compras registradas para mostrar.</p>
                                                                    ) : (
                                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                                            {row.lastItems.map((item, idx) => (
                                                                                <div key={`${row.id}-item-${idx}`} className="bg-white border border-gray-200 rounded-xl px-3 py-2 flex items-center justify-between">
                                                                                    <div>
                                                                                        <p className="text-xs font-black text-slate-700">{item.name}</p>
                                                                                        <p className="text-[10px] font-bold text-gray-400">{new Date(item.date).toLocaleDateString()}</p>
                                                                                    </div>
                                                                                    <div className="text-right">
                                                                                        <p className="text-xs font-black text-slate-700">x{item.quantity}</p>
                                                                                        <p className="text-[10px] font-bold text-blue-600">
                                                                                            {config.currencySymbol}{item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                                                        </p>
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}

                                        {!isCustomersLoading && sortedCustomerRows.length === 0 && (
                                            <tr>
                                                <td colSpan={columns.length} className="px-8 py-20 text-center text-slate-300 italic">
                                                    No se encontraron registros.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                ) : (
                                    <tbody className="divide-y divide-slate-50">
                                        {tableRows.map((row, i) => (
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
                                        {tableRows.length === 0 && (
                                            <tr>
                                                <td colSpan={columns.length} className="px-8 py-20 text-center text-slate-300 italic">
                                                    No se han encontrado registros para mostrar.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                )}
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="bg-white p-12 rounded-[3.5rem] shadow-xl shadow-gray-200/50 border border-gray-100 min-h-[500px] flex items-center justify-center">
                        <SVGBarChart items={chartItems} />
                    </div>
                )}
                    </>
                )}
            </div>

            {isFiscalExportModalOpen && (
                <div className="fixed inset-0 z-[70] no-print flex items-center justify-center p-4">
                    <button
                        type="button"
                        aria-label="Cerrar modal"
                        onClick={() => !isFiscalExporting && setIsFiscalExportModalOpen(false)}
                        className="absolute inset-0 bg-slate-900/45"
                    />
                    <div className="relative w-full max-w-xl bg-white rounded-3xl border border-gray-100 shadow-2xl p-6 sm:p-7">
                        <h3 className="text-lg font-black text-slate-900">Exportar Formatos DGII</h3>
                        <p className="mt-1 text-sm font-bold text-slate-500">
                            Seleccione el formato a generar para el periodo filtrado.
                        </p>

                        <div className="mt-5 space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-[11px] font-black text-slate-500 uppercase tracking-wider">Formato</label>
                                <select
                                    value={fiscalExportFormat}
                                    onChange={(e) => {
                                        const nextValue = e.target.value as FiscalExportFormatOption;
                                        setFiscalExportFormat(nextValue);
                                    }}
                                    className="w-full h-[44px] px-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-black text-slate-700 outline-none focus:border-blue-400"
                                >
                                    {FISCAL_EXPORT_OPTIONS.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>

                            {fiscalExportError && (
                                <p className="text-xs font-black text-red-600">{fiscalExportError}</p>
                            )}
                        </div>

                        <div className="mt-6 flex justify-end gap-2.5">
                            <button
                                onClick={() => setIsFiscalExportModalOpen(false)}
                                disabled={isFiscalExporting}
                                className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-black text-slate-600 hover:bg-gray-50 transition-colors disabled:opacity-60"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleRunFiscalExport}
                                disabled={isFiscalExporting}
                                className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-black hover:bg-emerald-700 transition-colors disabled:opacity-60"
                            >
                                {isFiscalExporting ? 'Exportando...' : 'Exportar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {fiscalExportFeedback && (
                <div className="fixed inset-0 z-[75] no-print flex items-center justify-center p-4">
                    <button
                        type="button"
                        aria-label="Cerrar modal"
                        onClick={() => setFiscalExportFeedback(null)}
                        className="absolute inset-0 bg-slate-900/45"
                    />
                    <div className="relative w-full max-w-2xl bg-white rounded-3xl border border-gray-100 shadow-2xl p-6 sm:p-7">
                        <h3 className={`text-lg font-black ${fiscalExportFeedback.isError ? 'text-red-700' : 'text-slate-900'}`}>
                            {fiscalExportFeedback.title}
                        </h3>
                        <div className="mt-4 space-y-2">
                            {fiscalExportFeedback.summaries.map((line, index) => (
                                <p key={`summary-${index}`} className="text-sm font-bold text-slate-700">{line}</p>
                            ))}
                        </div>
                        {fiscalExportFeedback.warnings.length > 0 && (
                            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                                <p className="text-[11px] font-black text-amber-700 uppercase tracking-wider mb-2">Advertencias</p>
                                <div className="space-y-1">
                                    {fiscalExportFeedback.warnings.map((line, index) => (
                                        <p key={`warning-${index}`} className="text-xs font-bold text-amber-700">{line}</p>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div className="mt-6 flex justify-end">
                            <button
                                onClick={() => setFiscalExportFeedback(null)}
                                className="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-black hover:bg-black transition-colors"
                            >
                                Entendido
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReportViewer;
