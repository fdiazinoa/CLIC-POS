import React, { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { Room, Table, User as UserType, ParkedTicket, CartItem, RoleDefinition, Permission } from '../types';
import {
    Clock,
    User,
    Lock,
    Plus,
    Minus,
    Maximize2,
    Minimize2,
    LayoutGrid,
    Sparkles,
    Check,
    AlertTriangle,
    CircleHelp,
    ReceiptText,
    Link2,
    Scissors,
    ArrowRightLeft,
    Pencil,
    Sigma,
    PieChart,
    Activity,
    X
} from 'lucide-react';
import { LazyMotion, domAnimation, m, AnimatePresence, useReducedMotion } from 'framer-motion';
import TableOptionsModal from './TableOptionsModal';
import SplitTicketModal from './SplitTicketModal';
import TableMoveConfirmationModal from './TableMoveConfirmationModal';
import { createPaymentFractionPlan } from '../utils/paymentFractions';
import { getRenderableFloorTables } from '../utils/tableLayout';
import { hasPendingKdsDispatch } from '../utils/kdsPresentation';
import { resolveOperationalApiUrl } from '../utils/masterOperationalApi';

interface TableMapProps {
    rooms: Room[];
    currentRoomId?: string;
    tables: Table[];
    parkedTickets?: ParkedTicket[];
    onTableClick: (table: Table) => void;
    onBeforeTableOpen?: (table: Table) => boolean | Promise<boolean>;
    currencySymbol: string;
    currentUser: UserType;
    isAdmin?: boolean;
    bloqueoMeseros?: boolean;
    isRestaurantMode?: boolean;
    onOpenTable?: (table: Table) => Promise<Table | null>;
    onRefreshTables?: () => void;
    onUpdateTables?: (tables: Table[]) => void | Promise<void>;
    onUpdateParkedTickets?: (tickets: ParkedTicket[]) => void | Promise<void>;
    canViewBusinessMetrics?: boolean;
    roles?: RoleDefinition[];
    onPrintPrecheck?: (table: Table) => void;
    /** Restaurante: persiste división de cuenta desde el mapa (órdenes en espera) */
    onParkedOrderSplitResult?: (orderId: string, remainingItems: CartItem[], newTicketItems: CartItem[], extraNewTickets?: CartItem[][], splitCount?: number) => void | Promise<void>;
    /** Restaurante: abrir diseñador de plano de mesas */
    onOpenTableLayoutDesigner?: () => void;
    /** Conserva la sala seleccionada aunque el mapa se desmonte. */
    onChangeRoom?: (roomId: string) => void;
}

type SmartStatus = 'FREE' | 'ATTENTION' | 'OCCUPIED' | 'SUBTOTALIZED' | 'CHECK_REQUESTED';
type TableArchetype = 'CIRCLE' | 'SQUARE' | 'BAR' | 'BOOTH' | 'CHAISE_LONGUE';

interface SmartTableModel {
    table: Table;
    index: number;
    smartStatus: SmartStatus;
    archetype: TableArchetype;
    isOccupiedLike: boolean;
    isLocked: boolean;
    elapsedMinutes: number;
    elapsedLabel: string;
    total: number;
    hasDigitizedItems: boolean;
    isSubtotalized: boolean;
    isPartiallySubtotalized: boolean;
    subtotalizedTicketCount: number;
    ticketCount: number;
    progress: number;
    serviceStage: {
        icon: string;
        label: string;
    };
    needsRevenueGlow: boolean;
    hasPendingKitchenDispatch: boolean;
    lastOrderHint: string;
    firstCustomerName?: string;
}

interface TooltipState {
    model: SmartTableModel;
    clientX: number;
    clientY: number;
}

interface ParkedOrderSummary {
    orderId: string;
    tableId?: string;
    joinedTableIds: string[];
    itemCount: number;
    calculatedTotal: number;
    finalTotal: number;
    hasExplicitTotal: boolean;
    isSubtotalized: boolean;
    subtotalizedTicketCount: number;
    ticketCount: number;
}

type TableTransferMode = 'MOVE' | 'MERGE' | 'SPLIT' | 'FRACTION';

interface TableTransferSelection {
    mode: TableTransferMode;
    step: 'SOURCE' | 'TARGET';
    sourceTableId?: string;
}

interface PendingTableMove {
    sourceTableId: string;
    targetTableId: string;
}

interface TableNoticeState {
    title: string;
    message: string;
    primaryLabel?: string;
    tableToOpen?: Table;
}

const BarTabsModal: React.FC<{
    table: Table;
    tickets: ParkedTicket[];
    currencySymbol: string;
    onClose: () => void;
    onOpenTab: (ticket: ParkedTicket) => void;
    onCreateTab: (name: string) => void;
    allowCreate?: boolean;
    titleLabel?: string;
    accountMode?: boolean;
}> = ({ table, tickets, currencySymbol, onClose, onOpenTab, onCreateTab, allowCreate = true, titleLabel = 'Barra / Minutas', accountMode = false }) => {
    const [tabName, setTabName] = useState('');
    const nextName = `${accountMode ? 'Cuenta' : 'Minuta'} ${tickets.length + 1}`;
    const total = tickets.reduce((sum, ticket) => {
        const itemsTotal = (ticket.items || []).reduce((acc, item) => acc + Number(item.price || 0) * Number(item.quantity || 0), 0);
        return sum + Number(ticket.total ?? itemsTotal ?? 0);
    }, 0);

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-2xl rounded-[2rem] bg-white shadow-2xl overflow-hidden">
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
                    <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-500">{titleLabel}</p>
                        <h2 className="mt-1 text-3xl font-black text-slate-900">{table.nombre || table.name || 'Barra'}</h2>
                            <p className="mt-1 text-sm font-bold text-slate-500">
                            {tickets.length} cuenta(s) abierta(s) · {currencySymbol}{total.toLocaleString()}
                        </p>
                    </div>
                    <button onClick={onClose} className="rounded-full bg-slate-100 p-3 text-slate-500 hover:bg-slate-200">
                        <X size={22} />
                    </button>
                </div>

                <div className="grid gap-4 p-6 md:grid-cols-[1fr_280px]">
                    <div className="space-y-3 max-h-[52vh] overflow-y-auto pr-1">
                        {tickets.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                                <ReceiptText size={38} className="mx-auto mb-3 text-slate-300" />
                                <p className="font-black text-slate-700">No hay cuentas abiertas</p>
                                <p className="mt-1 text-sm font-semibold text-slate-400">No hay artículos pendientes en esta mesa.</p>
                            </div>
                        ) : (
                            tickets.map((ticket, index) => {
                                const ticketTotal = Number(ticket.total ?? (ticket.items || []).reduce((acc, item) => acc + Number(item.price || 0) * Number(item.quantity || 0), 0));
                                const label = ticket.barTabName || ticket.alias || ticket.name || `Cuenta ${index + 1}`;
                                const subtotalState = getTicketSubtotalization(ticket);
                                return (
                                    <button
                                        key={ticket.id}
                                        type="button"
                                        onClick={() => onOpenTab(ticket)}
                                        className={`flex w-full items-center justify-between gap-4 rounded-3xl border p-4 text-left shadow-sm transition-all ${subtotalState.isSubtotalized
                                            ? 'border-violet-300 bg-violet-50 hover:border-violet-400 hover:bg-violet-100'
                                            : 'border-slate-100 bg-white hover:border-blue-300 hover:bg-blue-50'
                                        }`}
                                    >
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="truncate text-lg font-black text-slate-900">{label}</p>
                                                {subtotalState.isSubtotalized && (
                                                    <span className="rounded-full bg-violet-600 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-white">
                                                        Subtotalizado
                                                    </span>
                                                )}
                                            </div>
                                            <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">
                                                {(ticket.items || []).length} línea(s) · {new Date(ticket.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </p>
                                            {subtotalState.isSubtotalized && subtotalState.subtotalizedAt && (
                                                <p className="mt-1 text-[10px] font-black text-violet-600">
                                                    Pre-cuenta {new Date(subtotalState.subtotalizedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    {subtotalState.subtotalizedBy ? ` · ${subtotalState.subtotalizedBy}` : ''}
                                                </p>
                                            )}
                                        </div>
                                        <span className={`shrink-0 text-xl font-black ${subtotalState.isSubtotalized ? 'text-violet-700' : 'text-emerald-600'}`}>
                                            {currencySymbol}{ticketTotal.toLocaleString()}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>

                    {allowCreate && <div className="rounded-3xl border border-blue-100 bg-blue-50 p-5">
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-500">{accountMode ? 'Nueva cuenta' : 'Nueva minuta'}</p>
                        <label className="mt-4 block text-xs font-bold text-slate-600">
                            Nombre opcional
                        </label>
                        <input
                            value={tabName}
                            onChange={(event) => setTabName(event.target.value)}
                            placeholder={nextName}
                            className="mt-2 w-full rounded-2xl border border-blue-100 bg-white px-4 py-4 text-lg font-black text-slate-900 outline-none focus:border-blue-500"
                        />
                        <button
                            type="button"
                            onClick={() => {
                                onCreateTab(tabName.trim() || nextName);
                                setTabName('');
                            }}
                            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-blue-100 active:scale-95"
                        >
                            <Plus size={18} />
                            {accountMode ? 'Crear cuenta' : 'Abrir minuta'}
                        </button>
                    </div>}
                </div>
            </div>
        </div>
    );
};

const CANVAS_WIDTH = 1240;
const CANVAS_HEIGHT = 860;
const SCALE_MIN = 0.35;
const SCALE_MAX = 2.2;
const TABLE_CONTROL_CENTER_PERMISSION: Permission = 'TABLE_CONTROL_CENTER';
/** Ancho del panel "Control de Sala" (w-[318px]) + márgenes; evita encimar mesas bajo el aside */
const RESTAURANT_SIDEBAR_RESERVE_PX = 400;
/** Dos filas de controles + separación para mantener las mesas visibles. */
const RESTAURANT_BOTTOM_BAR_RESERVE_PX = 174;
const RESTAURANT_FIT_FILL = 0.92;
const DEFAULT_EXPECTED_STAY = 70;
const NO_ORDER_TOTAL_THRESHOLD = 0.01;

const TABLE_ENTRY_VARIANTS = {
    hidden: {
        opacity: 0,
        scale: 0.88,
        y: 14
    },
    visible: (index: number) => ({
        opacity: 1,
        scale: 1,
        y: 0,
        transition: {
            duration: 0.28,
            delay: Math.min(index * 0.014, 0.42),
            ease: [0.22, 1, 0.36, 1]
        }
    })
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const ensureCartIds = (items: CartItem[]): CartItem[] =>
    items.map((it, idx) => ({
        ...it,
        cartId: it.cartId || `map-${idx}-${it.id || 'item'}`
    }));

const getRoomLabel = (room?: Room): string => room?.nombre || room?.name || 'Sala';
const getTableLabel = (table: Table): string => table.nombre || table.name || 'Mesa';
const getFirstNumber = (value: string): string => value.match(/\d+/)?.[0] || '';
const padLocationNumber = (value: string): string => value ? value.padStart(2, '0') : '';

const getElapsedMinutes = (timeSeated?: string): number => {
    if (!timeSeated) return 0;
    const start = new Date(timeSeated).getTime();
    if (!Number.isFinite(start)) return 0;
    return Math.max(0, Math.floor((Date.now() - start) / 60000));
};

const formatElapsed = (minutes: number): string => {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
};

const getTicketSubtotalization = (ticket: ParkedTicket): {
    isSubtotalized: boolean;
    subtotalizedAt?: string;
    subtotalizedBy?: string;
} => {
    const items = Array.isArray(ticket.items) ? ticket.items : [];
    if (items.length === 0 || !items.every(item => Boolean(item.subtotalizedAt))) {
        return { isSubtotalized: false };
    }
    const referenceItem = items.find(item => Boolean(item.subtotalizedAt));
    return {
        isSubtotalized: true,
        subtotalizedAt: referenceItem?.subtotalizedAt,
        subtotalizedBy: referenceItem?.subtotalizedBy
    };
};

const summarizeParkedTicket = (ticket: ParkedTicket): ParkedOrderSummary | null => {
    const items = Array.isArray(ticket.items) ? ticket.items : [];
    const itemCount = items.reduce((acc, item) => acc + Math.max(0, Number(item.quantity || 0)), 0);
    if (itemCount <= 0) return null;

    const calculatedTotal = items.reduce(
        (acc, item) => acc + (Number(item.price || 0) * Number(item.quantity || 0)),
        0
    );
    const hasExplicitTotal = typeof ticket.total === 'number';
    const finalTotal = hasExplicitTotal ? Number(ticket.total) : calculatedTotal;
    const subtotalState = getTicketSubtotalization(ticket);

    return {
        orderId: ticket.id,
        tableId: ticket.tableId !== undefined && ticket.tableId !== null ? String(ticket.tableId) : undefined,
        joinedTableIds: Array.isArray((ticket as any).joinedTableIds)
            ? (ticket as any).joinedTableIds.map((id: unknown) => String(id))
            : [],
        itemCount,
        calculatedTotal,
        finalTotal,
        hasExplicitTotal,
        isSubtotalized: subtotalState.isSubtotalized,
        subtotalizedTicketCount: subtotalState.isSubtotalized ? 1 : 0,
        ticketCount: 1
    };
};

const getServiceStage = (progress: number): { icon: string; label: string } => {
    if (progress < 0.34) return { icon: '🥗', label: 'Entradas' };
    if (progress < 0.67) return { icon: '🥩', label: 'Plato fuerte' };
    return { icon: '🍰', label: 'Postre' };
};

const inferArchetype = (table: Table): TableArchetype => {
    if (table.shape === 'BAR') return 'BAR';
    if (table.shape === 'BOOTH') return 'BOOTH';
    if (table.shape === 'CHAISE_LONGUE') return 'CHAISE_LONGUE';
    if (table.shape === 'CIRCLE') return 'CIRCLE';
    if (table.shape === 'SQUARE') return 'SQUARE';

    const label = `${table.nombre || ''} ${table.name || ''}`.toLowerCase();
    const ratio = table.width / Math.max(1, table.height);
    const capacity = table.capacity || 0;

    const looksLikeBooth =
        label.includes('booth') ||
        label.includes('sof') ||
        label.includes('vip') ||
        ratio > 1.4 ||
        capacity >= 6;

    if (looksLikeBooth) return 'BOOTH';

    const looksLikeBarStool =
        label.includes('bar') ||
        label.includes('barra') ||
        label.includes('stool') ||
        capacity <= 1;

    if (looksLikeBarStool) return 'BAR';
    return 'SQUARE';
};

const getSmartStatus = (table: Table, elapsedMinutes: number, hasDigitizedItems: boolean, isSubtotalized: boolean): SmartStatus => {
    if (isSubtotalized) return 'SUBTOTALIZED';
    if (hasDigitizedItems) return 'OCCUPIED';
    if (table.status === 'RESERVED') return 'CHECK_REQUESTED';
    return 'FREE';
};

const computeLastOrderHint = (model: Pick<SmartTableModel, 'smartStatus' | 'serviceStage' | 'hasDigitizedItems'>): string => {
    if (model.smartStatus === 'SUBTOTALIZED') return 'Pre-cuenta impresa';
    if (model.smartStatus === 'ATTENTION') return 'Sin pedido reciente (+10m)';
    if (!model.hasDigitizedItems) return 'Aun sin pedidos cargados';
    return `${model.serviceStage.label} en curso`;
};

const statusPalette: Record<
    SmartStatus,
    {
        shell: string;
        badge: string;
        icon: React.ReactNode;
        label: string;
    }
> = {
    FREE: {
        shell: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-50',
        badge: 'text-emerald-200',
        icon: <Check size={12} className="text-emerald-200" />,
        label: 'Libre'
    },
    ATTENTION: {
        shell: 'border-amber-300/60 bg-amber-500/15 text-amber-50',
        badge: 'text-amber-200',
        icon: <AlertTriangle size={14} className="text-amber-200" />,
        label: 'Atencion requerida'
    },
    OCCUPIED: {
        shell: 'border-rose-500/70 bg-gradient-to-br from-rose-600/85 via-red-600/80 to-red-700/85 text-white',
        badge: 'text-rose-100',
        icon: <Sparkles size={14} className="text-rose-100" />,
        label: 'Ocupada'
    },
    SUBTOTALIZED: {
        shell: 'border-violet-300/80 bg-gradient-to-br from-violet-600/90 via-purple-600/85 to-indigo-700/90 text-white',
        badge: 'text-violet-100',
        icon: <ReceiptText size={14} className="text-violet-100" />,
        label: 'Subtotalizada'
    },
    CHECK_REQUESTED: {
        shell: 'border-fuchsia-400/70 bg-gradient-to-br from-violet-600/75 to-fuchsia-600/75 text-white',
        badge: 'text-fuchsia-100',
        icon: <ReceiptText size={14} className="text-fuchsia-100" />,
        label: 'Cuenta solicitada'
    }
};

const TableMap: React.FC<TableMapProps> = ({
    rooms,
    currentRoomId: initialRoomId,
    tables,
    parkedTickets,
    onTableClick,
    onBeforeTableOpen,
    currencySymbol,
    currentUser,
    isAdmin,
    bloqueoMeseros,
    isRestaurantMode,
    onOpenTable,
    onRefreshTables,
    onUpdateTables,
    onUpdateParkedTickets,
    canViewBusinessMetrics,
    roles = [],
    onPrintPrecheck,
    onParkedOrderSplitResult,
    onOpenTableLayoutDesigner,
    onChangeRoom
}) => {
    const [activeRoomId, setActiveRoomId] = useState<string>(initialRoomId || rooms[0]?.id || '');
    const [selectedTable, setSelectedTable] = useState<Table | null>(null);
    const [selectedBarTable, setSelectedBarTable] = useState<Table | null>(null);
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);
    const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [splitTicketForModal, setSplitTicketForModal] = useState<ParkedTicket | null>(null);
    const [selectedAccountTable, setSelectedAccountTable] = useState<Table | null>(null);
    const [transferSelection, setTransferSelection] = useState<TableTransferSelection | null>(null);
    const [pendingTableMove, setPendingTableMove] = useState<PendingTableMove | null>(null);
    const [subtotalPickOpen, setSubtotalPickOpen] = useState(false);
    const [fractionPickOpen, setFractionPickOpen] = useState(false);
    const [splitPickOpen, setSplitPickOpen] = useState(false);
    const [fractionTicketForModal, setFractionTicketForModal] = useState<ParkedTicket | null>(null);
    const [fractionCount, setFractionCount] = useState(2);
    const [showRoomPicker, setShowRoomPicker] = useState(false);
    const [isControlCenterOpen, setIsControlCenterOpen] = useState(false);
    const [tableNotice, setTableNotice] = useState<TableNoticeState | null>(null);
    const reduceMotion = useReducedMotion();

    const mapShellRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const panRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
    const viewportStateRef = useRef(viewport);

    const safeTables = useMemo(
        () => getRenderableFloorTables(Array.isArray(tables) ? tables : []),
        [tables]
    );

    useEffect(() => {
        viewportStateRef.current = viewport;
    }, [viewport]);

    useEffect(() => {
        if (initialRoomId) {
            setActiveRoomId(initialRoomId);
        }
    }, [initialRoomId]);

    useEffect(() => {
        const roomStillExists = rooms.some(room => room.id === activeRoomId);
        if (!roomStillExists) {
            setActiveRoomId(initialRoomId || rooms[0]?.id || '');
        }
    }, [rooms, activeRoomId, initialRoomId]);

    useEffect(() => {
        const onFullscreenChange = () => {
            const active = Boolean(document.fullscreenElement && mapShellRef.current?.contains(document.fullscreenElement));
            setIsFullscreen(active);
        };

        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, []);

    const activeRoom = useMemo(() => rooms.find(r => r.id === activeRoomId), [rooms, activeRoomId]);
    const usesWhiteBackground = activeRoom?.data?.backgroundStyle === 'WHITE';
    const roomLabelById = useMemo(() => {
        return new Map(rooms.map(room => [room.id, getRoomLabel(room)]));
    }, [rooms]);
    const getTableRoomLabel = useCallback((table: Table): string => {
        const tableLabel = getTableLabel(table);
        const roomLabel = roomLabelById.get(table.roomId);
        const roomNumber = getFirstNumber(roomLabel || '');
        const tableNumber = getFirstNumber(tableLabel);
        if (roomNumber && tableNumber) {
            return `${padLocationNumber(roomNumber)}-${padLocationNumber(tableNumber)} · ${roomLabel} · ${tableLabel}`;
        }
        return roomLabel ? `${roomLabel} · ${tableLabel}`.slice(0, 48) : tableLabel.slice(0, 42);
    }, [roomLabelById]);

    const currentRolePermissions = useMemo<Permission[]>(() => {
        const roleId = currentUser.roleId || currentUser.role;
        const role = roles.find(r => r.id === roleId) || roles.find(r => r.id === currentUser.role);
        return role?.permissions || [];
    }, [currentUser.role, currentUser.roleId, roles]);

    const hasControlCenterAccess = Boolean(
        isAdmin ||
        currentRolePermissions.includes('ALL') ||
        currentRolePermissions.includes(TABLE_CONTROL_CENTER_PERMISSION)
    );

    const roomTables = useMemo(
        () => safeTables.filter(table => table.roomId === activeRoomId),
        [safeTables, activeRoomId]
    );

    const fitRestaurantViewport = useCallback(() => {
        if (!isRestaurantMode) return;
        const el = viewportRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const sidebarReserve = hasControlCenterAccess && isControlCenterOpen ? RESTAURANT_SIDEBAR_RESERVE_PX : 0;
        const bottomBarReserve = isRestaurantMode ? RESTAURANT_BOTTOM_BAR_RESERVE_PX : 0;
        const edgePad = 18;
        const usableW = Math.max(280, rect.width - sidebarReserve - edgePad);
        const usableH = Math.max(220, rect.height - bottomBarReserve - edgePad);

        // El mapa se centra en el viewport completo; el aside solo cubre la derecha. Desplazamos el
        // encuadre hacia la izquierda y arriba para que el centro visual quede en la zona libre.
        const panBiasX = sidebarReserve * 0.52;
        const panBiasY = bottomBarReserve * 0.42 + 12;

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        roomTables.forEach(t => {
            minX = Math.min(minX, t.posX);
            minY = Math.min(minY, t.posY);
            maxX = Math.max(maxX, t.posX + t.width);
            maxY = Math.max(maxY, t.posY + t.height);
        });

        if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
            const s = clamp(Math.min(usableW / CANVAS_WIDTH, usableH / CANVAS_HEIGHT) * RESTAURANT_FIT_FILL, SCALE_MIN, SCALE_MAX);
            setViewport({ scale: s, x: -panBiasX, y: -panBiasY });
            return;
        }

        const pad = 32;
        const bw = maxX - minX + pad * 2;
        const bh = maxY - minY + pad * 2;
        const s = clamp(Math.min(usableW / bw, usableH / bh) * RESTAURANT_FIT_FILL, SCALE_MIN, SCALE_MAX);
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        const cx = CANVAS_WIDTH / 2;
        const cy = CANVAS_HEIGHT / 2;
        const baseX = -s * (midX - cx);
        const baseY = -s * (midY - cy);
        setViewport({ scale: s, x: baseX - panBiasX, y: baseY - panBiasY });
    }, [hasControlCenterAccess, isControlCenterOpen, isRestaurantMode, roomTables]);

    useLayoutEffect(() => {
        if (!isRestaurantMode) {
            setViewport({ scale: 1, x: 0, y: 0 });
            return;
        }
        fitRestaurantViewport();
    }, [activeRoomId, isRestaurantMode, fitRestaurantViewport]);

    useEffect(() => {
        if (!isRestaurantMode) return;
        const el = viewportRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        let timer: number | undefined;
        const ro = new ResizeObserver(() => {
            if (timer) window.clearTimeout(timer);
            timer = window.setTimeout(() => fitRestaurantViewport(), 80);
        });
        ro.observe(el);
        return () => {
            if (timer) window.clearTimeout(timer);
            ro.disconnect();
        };
    }, [isRestaurantMode, fitRestaurantViewport]);

    useEffect(() => {
        if (!isRestaurantMode) return;
        const id = window.requestAnimationFrame(() => fitRestaurantViewport());
        return () => window.cancelAnimationFrame(id);
    }, [roomTables, isRestaurantMode, fitRestaurantViewport]);

    const obstacleTables = useMemo(
        () => roomTables.filter(table => table.shape === 'OBSTACLE'),
        [roomTables]
    );

    const serviceTables = useMemo(
        () => roomTables.filter(table => table.shape !== 'OBSTACLE'),
        [roomTables]
    );

    const allServiceTables = useMemo(
        () => safeTables.filter(table => table.shape !== 'OBSTACLE'),
        [safeTables]
    );

    const parkedSummaryByOrderId = useMemo(() => {
        const map = new Map<string, ParkedOrderSummary>();
        (parkedTickets || []).forEach(ticket => {
            const summary = summarizeParkedTicket(ticket);
            if (summary) map.set(String(ticket.id), summary);
        });
        return map;
    }, [parkedTickets]);

    const parkedSummaryByTableId = useMemo(() => {
        const map = new Map<string, ParkedOrderSummary>();
        (parkedTickets || []).forEach(ticket => {
            if (ticket.tableId === undefined || ticket.tableId === null) return;
            const summary = summarizeParkedTicket(ticket);
            if (!summary) return;
            const tableId = String(ticket.tableId);
            const existing = map.get(tableId);
            if (existing) {
                map.set(tableId, {
                    ...existing,
                    itemCount: existing.itemCount + summary.itemCount,
                    calculatedTotal: existing.calculatedTotal + summary.calculatedTotal,
                    finalTotal: existing.finalTotal + summary.finalTotal,
                    hasExplicitTotal: existing.hasExplicitTotal && summary.hasExplicitTotal,
                    isSubtotalized: existing.isSubtotalized && summary.isSubtotalized,
                    subtotalizedTicketCount: existing.subtotalizedTicketCount + summary.subtotalizedTicketCount,
                    ticketCount: existing.ticketCount + summary.ticketCount
                });
            } else {
                map.set(tableId, summary);
            }
        });
        return map;
    }, [parkedTickets]);

    const getTableTickets = useCallback(
        (table: Table): ParkedTicket[] => (parkedTickets || [])
            .filter(ticket => String(ticket.tableId ?? '') === String(table.id))
            .sort((a, b) => {
                if (String(a.id) === String(table.currentOrderId)) return -1;
                if (String(b.id) === String(table.currentOrderId)) return 1;
                return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
            }),
        [parkedTickets]
    );

    const getBarTickets = getTableTickets;

    const getParkedSummaryForTable = useCallback(
        (table: Table) => {
            const tableId = String(table.id);
            const byOrder = table.currentOrderId ? parkedSummaryByOrderId.get(String(table.currentOrderId)) : undefined;
            const orderBelongsToTable = Boolean(
                byOrder &&
                (
                    !byOrder.tableId ||
                    byOrder.tableId === tableId ||
                    byOrder.joinedTableIds.includes(tableId) ||
                    String((table as any).joinedTableId || '') === byOrder.tableId ||
                    String((table as any).joinedSourceTableId || '') === tableId
                )
            );
            return (orderBelongsToTable ? byOrder : undefined)
                || parkedSummaryByTableId.get(tableId);
        },
        [parkedSummaryByOrderId, parkedSummaryByTableId]
    );

    const isTableOccupiedFromTicket = useCallback(
        (table: Table) => Boolean(getParkedSummaryForTable(table)?.itemCount),
        [getParkedSummaryForTable]
    );

    const getVisualTableState = useCallback((table: Table): Table => {
        const parkedSummary = getParkedSummaryForTable(table);
        if (parkedSummary?.itemCount) return table;
        if (table.status === 'RESERVED') return table;
        if (table.status !== 'OCCUPIED' && !table.currentOrderId && !table.currentOrderTotal) return table;

        return {
            ...table,
            status: 'FREE',
            currentOrderId: undefined,
            currentOrderTotal: undefined,
            timeSeated: undefined,
            waiterId: undefined,
            waiterName: undefined
        } as Table;
    }, [getParkedSummaryForTable]);

    const enrichTableWithParkedTicket = useCallback((table: Table): Table => {
        const parkedSummary = getParkedSummaryForTable(table);
        if (!parkedSummary) return table;

        const persistedTotal = Number(table.currentOrderTotal || 0);
        const total = parkedSummary.hasExplicitTotal
            ? parkedSummary.finalTotal
            : (persistedTotal > NO_ORDER_TOTAL_THRESHOLD ? persistedTotal : parkedSummary.calculatedTotal);

        return {
            ...table,
            status: 'OCCUPIED',
            currentOrderId: parkedSummary.orderId,
            currentOrderTotal: total
        } as Table;
    }, [getParkedSummaryForTable]);

    const occupiedForTools = useMemo(
        () => allServiceTables
            .map(table => enrichTableWithParkedTicket(getVisualTableState(table)))
            .filter(t => t.status === 'OCCUPIED' || t.status === 'RESERVED'),
        [allServiceTables, enrichTableWithParkedTicket, getVisualTableState]
    );

    const freeForTools = useMemo(
        () => allServiceTables.filter(t => !isTableOccupiedFromTicket(t) && getVisualTableState(t).status === 'FREE'),
        [allServiceTables, getVisualTableState, isTableOccupiedFromTicket]
    );

    const occupiedLikeTables = useMemo(
        () => serviceTables.filter(table => {
            const visualTable = getVisualTableState(table);
            return visualTable.status === 'RESERVED' || isTableOccupiedFromTicket(table);
        }),
        [serviceTables, getVisualTableState, isTableOccupiedFromTicket]
    );

    const averageTicket = useMemo(() => {
        if (occupiedLikeTables.length === 0) return 0;
        const total = occupiedLikeTables.reduce((acc, table) => {
            const persistedTotal = Number(table.currentOrderTotal || 0);
            const parkedSummary = getParkedSummaryForTable(table);
            const parkedTotal = parkedSummary
                ? (parkedSummary.hasExplicitTotal
                    ? parkedSummary.finalTotal
                    : (persistedTotal > NO_ORDER_TOTAL_THRESHOLD ? persistedTotal : parkedSummary.calculatedTotal))
                : 0;
            const resolvedTotal = parkedTotal > NO_ORDER_TOTAL_THRESHOLD ? parkedTotal : persistedTotal;
            return acc + resolvedTotal;
        }, 0);
        return total / occupiedLikeTables.length;
    }, [occupiedLikeTables, getParkedSummaryForTable]);

    const expectedStayMinutes = useMemo(() => {
        const elapsed = occupiedLikeTables
            .map(table => getElapsedMinutes(table.timeSeated))
            .filter(minutes => minutes > 0);

        if (elapsed.length === 0) return DEFAULT_EXPECTED_STAY;

        const averageElapsed = elapsed.reduce((acc, value) => acc + value, 0) / elapsed.length;
        return clamp(Math.round(averageElapsed * 1.18), 45, 130);
    }, [occupiedLikeTables]);

    const highRevenueThreshold = useMemo(() => averageTicket * 1.5, [averageTicket]);

    const smartTables = useMemo<SmartTableModel[]>(() => {
        return serviceTables.map((rawTable, index) => {
            const table = getVisualTableState(rawTable);
            const elapsedMinutes = getElapsedMinutes(table.timeSeated);
            const parkedSummary = getParkedSummaryForTable(table);
            const parkedItems = parkedSummary?.itemCount || 0;
            const parkedTotal = parkedSummary
                ? (parkedSummary.hasExplicitTotal
                    ? parkedSummary.finalTotal
                    : parkedSummary.calculatedTotal)
                : 0;
            const total = parkedTotal > NO_ORDER_TOTAL_THRESHOLD ? parkedTotal : 0;
            const hasDigitizedItems = parkedItems > 0;
            const tableTickets = getTableTickets(table).filter(ticket => (ticket.items || []).length > 0);
            const subtotalizedTicketCount = tableTickets.filter(ticket => getTicketSubtotalization(ticket).isSubtotalized).length;
            const ticketCount = tableTickets.length;
            const isSubtotalized = ticketCount > 0 && subtotalizedTicketCount === ticketCount;
            const isPartiallySubtotalized = subtotalizedTicketCount > 0 && subtotalizedTicketCount < ticketCount;
            const smartStatus = getSmartStatus(table, elapsedMinutes, hasDigitizedItems, isSubtotalized);
            const displayTable = hasDigitizedItems && parkedSummary ? enrichTableWithParkedTicket(table) : table;
            const isOccupiedLike = smartStatus !== 'FREE';
            const isBeingEdited = Boolean(displayTable.editingLock);
            const isLocked = isBeingEdited || (
                isOccupiedLike &&
                Boolean(bloqueoMeseros) &&
                Boolean(displayTable.waiterId) &&
                displayTable.waiterId !== currentUser.id &&
                !isAdmin
            );

            const progress = isOccupiedLike ? clamp(elapsedMinutes / Math.max(1, expectedStayMinutes), 0, 1) : 0;
            const serviceStage = getServiceStage(progress);
            const needsRevenueGlow = isOccupiedLike && highRevenueThreshold > 0 && total >= highRevenueThreshold;
            const hasPendingKitchenDispatch = getTableTickets(displayTable).some(hasPendingKdsDispatch);
            const firstCustomerName = getTableTickets(displayTable)
                .map(ticket => String(ticket.customerSnapshot?.name || ticket.customerName || '').trim())
                .find(Boolean);

            const baseModel: SmartTableModel = {
                table: displayTable,
                index,
                smartStatus,
                archetype: inferArchetype(displayTable),
                isOccupiedLike,
                isLocked,
                elapsedMinutes,
                elapsedLabel: formatElapsed(elapsedMinutes),
                total,
                hasDigitizedItems,
                isSubtotalized,
                isPartiallySubtotalized,
                subtotalizedTicketCount,
                ticketCount,
                progress,
                serviceStage,
                needsRevenueGlow,
                hasPendingKitchenDispatch,
                lastOrderHint: '',
                firstCustomerName
            };

            return {
                ...baseModel,
                lastOrderHint: computeLastOrderHint(baseModel)
            };
        });
    }, [serviceTables, bloqueoMeseros, currentUser.id, isAdmin, expectedStayMinutes, highRevenueThreshold, getParkedSummaryForTable, enrichTableWithParkedTicket, getTableTickets, getVisualTableState]);

    const createTableAccount = useCallback(async (table: Table, requestedName?: string) => {
        const existingTickets = getTableTickets(table);
        const accountNumber = existingTickets.length + 1;
        const tableLabel = getTableLabel(table);
        const roomLabel = roomLabelById.get(table.roomId);
        const accountName = String(requestedName || '').trim() || `Cuenta ${accountNumber}`;
        const timestamp = new Date().toISOString();
        const ticket: ParkedTicket = {
            id: `TABLE-${table.id}-ACCOUNT-${Date.now()}-${accountNumber}`,
            name: `${tableLabel} - ${accountName}`,
            alias: accountName,
            items: [],
            total: 0,
            timestamp,
            tableId: table.id,
            tableDisplayLabel: tableLabel,
            tableRoomLabel: roomLabel,
        };
        const nextTickets = [...(parkedTickets || []), ticket];
        const nextTable = {
            ...table,
            status: 'OCCUPIED',
            currentOrderId: table.currentOrderId || ticket.id,
            currentOrderTotal: Number(table.currentOrderTotal || 0),
            waiterId: table.waiterId || currentUser.id,
            waiterName: table.waiterName || currentUser.name,
            timeSeated: table.timeSeated || timestamp,
        } as Table;
        const nextTables = (Array.isArray(tables) ? tables : []).map(candidate => candidate.id === table.id ? nextTable : candidate);

        await Promise.resolve(onUpdateParkedTickets?.(nextTickets));
        await Promise.resolve(onUpdateTables?.(nextTables));
        setSelectedAccountTable(nextTable);
        return ticket;
    }, [currentUser.id, currentUser.name, getTableTickets, onUpdateParkedTickets, onUpdateTables, parkedTickets, roomLabelById, tables]);

    const stats = useMemo(() => {
        const total = smartTables.length;
        const occupied = smartTables.filter(model => model.smartStatus !== 'FREE').length;
        const free = total - occupied;
        const totalAmount = smartTables
            .filter(model => model.smartStatus !== 'FREE')
            .reduce((acc, model) => acc + model.total, 0);

        const rotationEfficiency = occupied > 0
            ? Math.round(
                (smartTables.filter(model => model.smartStatus !== 'FREE' && model.elapsedMinutes <= expectedStayMinutes).length / occupied) * 100
            )
            : 100;

        return {
            total,
            free,
            occupied,
            amount: totalAmount,
            averageTicket: occupied > 0 ? totalAmount / occupied : 0,
            rotationEfficiency,
            attention: smartTables.filter(model => model.smartStatus === 'ATTENTION').length,
            checkRequested: smartTables.filter(model => model.smartStatus === 'CHECK_REQUESTED').length
        };
    }, [smartTables, expectedStayMinutes]);

    const hasRoomFinancialAccess = Boolean(
        canViewBusinessMetrics ||
        isAdmin ||
        /admin|gerente|supervisor/i.test(currentUser.role || '')
    );

    const minExpectedTicket = activeRoom?.consumo_minimo || 0;

    const resolveTicketForTable = useCallback((table: Table): ParkedTicket | undefined => {
        const tableId = String(table.id);
        const belongsToTable = (ticket: ParkedTicket) => {
            const ticketTableId = String(ticket.tableId ?? '');
            const joinedTableIds = (ticket as any).joinedTableIds;
            const joinedTableId = (table as any).joinedTableId;
            const joinedSourceTableId = (table as any).joinedSourceTableId;
            return ticketTableId === tableId
                || (Array.isArray(joinedTableIds) && joinedTableIds.some(id => String(id) === tableId))
                || String(joinedTableId ?? '') === ticketTableId
                || String(joinedSourceTableId ?? '') === tableId;
        };

        // currentOrderId puede quedar obsoleto después de liberar o mover una mesa.
        // Nunca debe convertir una mesa libre en ocupada si la orden ya pertenece a otra.
        return (parkedTickets || []).find(ticket => (
            table.currentOrderId
            && String(ticket.id) === String(table.currentOrderId)
            && belongsToTable(ticket)
        )) || (parkedTickets || []).find(belongsToTable);
    }, [parkedTickets]);

    const isTableMoveTargetOccupied = useCallback((table: Table): boolean => {
        const ticket = resolveTicketForTable(table);
        const visualStatus = getVisualTableState(table).status;
        // Las mesas creadas por el ERP pueden no traer status. En ese contrato,
        // ausencia de estado equivale a libre; solo OCCUPIED/RESERVED bloquean mover.
        return Boolean(ticket?.items?.length)
            || visualStatus === 'OCCUPIED'
            || visualStatus === 'RESERVED';
    }, [getVisualTableState, resolveTicketForTable]);

    const resetTableRuntimeState = useCallback((table: Table): Table => ({
        ...table,
        status: 'FREE',
        currentOrderId: undefined,
        currentOrderTotal: undefined,
        waiterId: undefined,
        waiterName: undefined,
        timeSeated: undefined,
        guests: undefined,
        joinedTableId: undefined,
        joinedTableName: undefined,
        joinedSourceTableId: undefined,
        joinedSourceTableName: undefined
    } as Table), []);

    const completeTableTransfer = useCallback(async (sourceTableId: string, targetTableId: string, mode: TableTransferMode, requestedItems?: CartItem[]) => {
        if (sourceTableId === targetTableId) {
            alert('Seleccione dos mesas distintas.');
            return;
        }

        const sourceTable = safeTables.find(table => table.id === sourceTableId);
        const targetTable = safeTables.find(table => table.id === targetTableId);
        if (!sourceTable || !targetTable) {
            alert('No se pudo ubicar una de las mesas seleccionadas.');
            return;
        }

        const sourceTicket = resolveTicketForTable(sourceTable);
        if (!sourceTicket?.items?.length) {
            alert('La mesa origen no tiene artículos para mover.');
            return;
        }

        const targetTicket = resolveTicketForTable(targetTable);
        const targetIsOccupied = isTableMoveTargetOccupied(targetTable);
        if (mode === 'MOVE' && targetIsOccupied) {
            alert('Para mover, seleccione una mesa destino libre. Si desea combinar cuentas use Unir mesas.');
            return;
        }

        if (mode === 'MERGE' && targetTicket && String(targetTicket.id) === String(sourceTicket.id)) {
            alert('Estas mesas ya pertenecen a la misma cuenta.');
            return;
        }

        if (mode === 'MOVE' && requestedItems) {
            const requestedById = new Map(requestedItems.map(item => [String(item.cartId || item.id), Number(item.quantity || 0)]));
            const movedItems = ensureCartIds(sourceTicket.items || []).map(item => ({
                ...item,
                quantity: Math.min(Number(item.quantity || 0), requestedById.get(String(item.cartId || item.id)) || 0)
            })).filter(item => item.quantity > 0);
            const movedQuantity = movedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
            const sourceItems = ensureCartIds(sourceTicket.items || []).map(item => {
                const moved = movedItems.find(candidate => String(candidate.cartId || candidate.id) === String(item.cartId || item.id));
                return { ...item, quantity: Number(item.quantity || 0) - Number(moved?.quantity || 0) };
            }).filter(item => item.quantity > 0);
            if (movedQuantity <= 0 || sourceItems.length === 0 && movedQuantity <= 0) {
                alert('Seleccione al menos un artículo para mover.');
                return;
            }

            const targetRoomLabel = roomLabelById.get(targetTable.roomId);
            const targetTableLabel = getTableLabel(targetTable);
            const sourceTableLabel = getTableLabel(sourceTable);
            const movedTicket: ParkedTicket = {
                ...sourceTicket,
                id: `move-${Date.now()}`,
                items: movedItems,
                total: movedItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0),
                tableId: targetTable.id,
                name: `Mesa: ${targetRoomLabel ? `${targetRoomLabel} · ${targetTableLabel}` : targetTableLabel}`,
                tableDisplayLabel: targetTableLabel,
                tableRoomLabel: targetRoomLabel,
                timestamp: new Date().toISOString()
            };
            const sourceNextTicket = {
                ...sourceTicket,
                items: sourceItems,
                total: sourceItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0)
            } as ParkedTicket;
            const nextParkedTickets = [
                ...(parkedTickets || []).filter(ticket => String(ticket.id) !== String(sourceTicket.id)),
                ...(sourceItems.length > 0 ? [sourceNextTicket] : []),
                movedTicket
            ];
            const nextTargetTable = {
                ...targetTable,
                status: 'OCCUPIED',
                currentOrderId: movedTicket.id,
                currentOrderTotal: movedTicket.total,
                waiterId: sourceTable.waiterId || currentUser.id,
                waiterName: sourceTable.waiterName || currentUser.name,
                timeSeated: sourceTable.timeSeated || movedTicket.timestamp
            } as Table;
            const nextSourceTable = sourceItems.length > 0 ? {
                ...sourceTable,
                status: 'OCCUPIED',
                currentOrderId: sourceNextTicket.id,
                currentOrderTotal: sourceNextTicket.total
            } as Table : resetTableRuntimeState(sourceTable);
            const nextTables = (Array.isArray(tables) ? tables : []).map(table => table.id === sourceTable.id ? nextSourceTable : table.id === targetTable.id ? nextTargetTable : table);
            await Promise.resolve(onUpdateParkedTickets?.(nextParkedTickets));
            await Promise.resolve(onUpdateTables?.(nextTables));
            setTableNotice({
                title: 'Parte de la cuenta movida',
                message: `${movedItems.length} artículo(s) fueron movidos de ${sourceTableLabel} a ${targetTableLabel}.`,
                primaryLabel: 'Entendido'
            });
            return;
        }

        const targetItems = mode === 'MERGE' && targetTicket?.items?.length ? targetTicket.items : [];
        const nextItems = [...ensureCartIds(sourceTicket.items || []), ...ensureCartIds(targetItems)];
        const nextTotal = nextItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
        const targetRoomLabel = roomLabelById.get(targetTable.roomId);
        const targetTableLabel = getTableLabel(targetTable);
        const sourceTableLabel = getTableLabel(sourceTable);
        const nextTicket: ParkedTicket = {
            ...sourceTicket,
            items: nextItems,
            total: nextTotal,
            tableId: targetTable.id,
            name: `Mesa: ${targetRoomLabel ? `${targetRoomLabel} · ${targetTableLabel}` : targetTableLabel}`,
            timestamp: sourceTicket.timestamp || new Date().toISOString(),
            tableDisplayLabel: targetTableLabel,
            tableRoomLabel: targetRoomLabel,
            orderNumber: sourceTicket.orderNumber || targetTicket?.orderNumber,
            ...(mode === 'MERGE' ? { joinedTableIds: [sourceTable.id, targetTable.id] } : { joinedTableIds: undefined }),
        } as ParkedTicket;

        const removedTicketIds = new Set([String(sourceTicket.id)]);
        if (targetTicket?.id) removedTicketIds.add(String(targetTicket.id));
        const nextParkedTickets = [
            ...(parkedTickets || []).filter(ticket => !removedTicketIds.has(String(ticket.id))),
            nextTicket
        ];

        const nextTargetTable = {
            ...targetTable,
            status: 'OCCUPIED',
            currentOrderId: nextTicket.id,
            currentOrderTotal: nextTotal,
            waiterId: sourceTable.waiterId || targetTable.waiterId || currentUser.id,
            waiterName: sourceTable.waiterName || targetTable.waiterName || currentUser.name,
            timeSeated: sourceTable.timeSeated || targetTable.timeSeated || nextTicket.timestamp,
            guests: targetTable.guests || sourceTable.guests,
            joinedTableId: mode === 'MERGE' ? sourceTable.id : undefined,
            joinedTableName: mode === 'MERGE' ? sourceTableLabel : undefined,
            joinedSourceTableId: mode === 'MERGE' ? sourceTable.id : undefined,
            joinedSourceTableName: mode === 'MERGE' ? sourceTableLabel : undefined
        } as Table;

        const nextSourceTable = mode === 'MERGE'
            ? {
                ...sourceTable,
                status: 'OCCUPIED',
                currentOrderId: nextTicket.id,
                currentOrderTotal: nextTotal,
                waiterId: sourceTable.waiterId || currentUser.id,
                waiterName: sourceTable.waiterName || currentUser.name,
                timeSeated: sourceTable.timeSeated || nextTicket.timestamp,
                guests: sourceTable.guests || targetTable.guests,
                joinedTableId: targetTable.id,
                joinedTableName: targetTableLabel,
                joinedSourceTableId: sourceTable.id,
                joinedSourceTableName: sourceTableLabel
            } as Table
            : resetTableRuntimeState(sourceTable);
        const nextTables = (Array.isArray(tables) ? tables : []).map(table => {
            if (table.id === sourceTable.id) return nextSourceTable;
            if (table.id === targetTable.id) return nextTargetTable;
            return table;
        });

        await Promise.resolve(onUpdateParkedTickets?.(nextParkedTickets));
        await Promise.resolve(onUpdateTables?.(nextTables));
        setTransferSelection(null);

        setTableNotice({
            title: mode === 'MERGE' ? 'Mesas unidas' : 'Mesa movida',
            message: mode === 'MERGE'
                ? `${targetTableLabel} quedó unida con ${sourceTableLabel}. Al abrir cualquiera de las dos mesas verás la misma cuenta.`
                : `${targetTableLabel} asumió la cuenta de ${sourceTableLabel}.`,
            primaryLabel: 'Entendido'
        });
    }, [
        currentUser.id,
        currentUser.name,
        getVisualTableState,
        onUpdateParkedTickets,
        onUpdateTables,
        parkedTickets,
        resetTableRuntimeState,
        resolveTicketForTable,
        roomLabelById,
        safeTables,
        tables
    ]);

    const handleTransferTableClick = useCallback((table: Table) => {
        if (!transferSelection) return false;

        if (transferSelection.step === 'SOURCE') {
            const sourceTicket = resolveTicketForTable(table);
            if (!sourceTicket?.items?.length) {
                alert('Seleccione una mesa origen con artículos.');
                return true;
            }
            if (transferSelection.mode === 'SPLIT') {
                setSplitTicketForModal(sourceTicket);
                setTransferSelection(null);
                return true;
            }
            if (transferSelection.mode === 'FRACTION') {
                setFractionTicketForModal(sourceTicket);
                setFractionCount(sourceTicket.paymentFraction?.count || 2);
                setTransferSelection(null);
                return true;
            }
            setTransferSelection({
                ...transferSelection,
                step: 'TARGET',
                sourceTableId: table.id
            });
            return true;
        }

        if (!transferSelection.sourceTableId) {
            setTransferSelection({ mode: transferSelection.mode, step: 'SOURCE' });
            return true;
        }

        if (transferSelection.mode === 'MOVE') {
            if (table.id === transferSelection.sourceTableId) {
                alert('Seleccione una mesa destino distinta.');
                return true;
            }
            const targetIsOccupied = isTableMoveTargetOccupied(table);
            if (targetIsOccupied) {
                alert('Seleccione una mesa destino libre.');
                return true;
            }
            setPendingTableMove({
                sourceTableId: transferSelection.sourceTableId,
                targetTableId: table.id
            });
            setTransferSelection(null);
            return true;
        }

        void completeTableTransfer(transferSelection.sourceTableId, table.id, transferSelection.mode);
        return true;
    }, [completeTableTransfer, isTableMoveTargetOccupied, resolveTicketForTable, transferSelection]);

    const handleTableAction = useCallback(async (table: Table) => {
        if (onBeforeTableOpen && !(await onBeforeTableOpen(table))) {
            return;
        }
        const tableTickets = getTableTickets(table);
        if (isRestaurantMode && table.shape !== 'BAR' && tableTickets.length > 0) {
            setSelectedAccountTable(table);
            return;
        }
        if (table.shape === 'BAR') {
            setSelectedBarTable(table);
            return;
        }

        const joinedTableName = String((table as any).joinedTableName || '').trim();
        if (isRestaurantMode && joinedTableName) {
            setTableNotice({
                title: 'Mesa unida',
                message: `${getTableLabel(table)} está unida con ${joinedTableName}. Ambas mesas comparten la misma cuenta.`,
                primaryLabel: 'Abrir cuenta',
                tableToOpen: table
            });
            return;
        }

        if (table.status === 'OCCUPIED' || table.status === 'RESERVED') {
            onTableClick(table);
            return;
        }

        if (isRestaurantMode) {
            if (onUpdateParkedTickets && onUpdateTables) {
                const ticket = await createTableAccount(table);
                setSelectedAccountTable(null);
                onTableClick({
                    ...table,
                    status: 'OCCUPIED',
                    currentOrderId: ticket.id,
                    currentOrderTotal: 0,
                    timeSeated: ticket.timestamp,
                    waiterId: table.waiterId || currentUser.id,
                    waiterName: table.waiterName || currentUser.name
                });
                return;
            }
            if (onOpenTable) {
                const openedTable = await onOpenTable(table);
                if (openedTable) {
                    onRefreshTables?.();
                    onTableClick(openedTable);
                }
                return;
            }

            try {
                const res = await fetch(resolveOperationalApiUrl('/api/mesas/abrir'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tableId: table.id,
                        waiterId: currentUser.id,
                        waiterName: currentUser.name
                    })
                });

                const data = await res.json();
                if (res.ok && data.status === 'success') {
                    onRefreshTables?.();
                    onTableClick({ ...table, currentOrderId: data.orden_id, status: 'FREE' });
                } else {
                    alert(data?.message || 'Error abriendo mesa');
                }
            } catch (error) {
                console.error(error);
                alert('Error de conexion con el servicio de mesas');
            }
            return;
        }

        setSelectedTable(table);
    }, [createTableAccount, currentUser.id, currentUser.name, getTableTickets, isRestaurantMode, onBeforeTableOpen, onOpenTable, onRefreshTables, onTableClick, onUpdateParkedTickets, onUpdateTables]);

    const handleNodeSelect = useCallback(
        (model: SmartTableModel) => {
            if (model.isLocked) {
                const editingOwner = model.table.editingLock?.userName || model.table.editingLock?.terminalId;
                alert(editingOwner
                    ? `Mesa en digitación por ${editingOwner}. Estará disponible cuando esa terminal vuelva al mapa de mesas.`
                    : `Mesa bloqueada. Atendida por: ${model.table.waiterName || 'otro mesero'}`);
                return;
            }
            if (handleTransferTableClick(model.table)) return;
            handleTableAction(model.table);
        },
        [handleTableAction, handleTransferTableClick]
    );

    const handleZoom = useCallback((delta: number) => {
        setViewport(prev => ({
            ...prev,
            scale: clamp(prev.scale + delta, SCALE_MIN, SCALE_MAX)
        }));
    }, []);

    const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
        event.preventDefault();

        const container = viewportRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;

        setViewport(prev => {
            const nextScale = clamp(prev.scale - event.deltaY * 0.0012, SCALE_MIN, SCALE_MAX);
            if (nextScale === prev.scale) return prev;

            const relativeX = pointerX - prev.x;
            const relativeY = pointerY - prev.y;
            const scaleFactor = nextScale / prev.scale;

            return {
                scale: nextScale,
                x: pointerX - relativeX * scaleFactor,
                y: pointerY - relativeY * scaleFactor
            };
        });
    }, []);

    const handleViewportPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest('[data-table-node="true"]')) return;
        if (event.pointerType !== 'touch' && event.button !== 0) return;

        const currentViewport = viewportStateRef.current;
        panRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: currentViewport.x,
            originY: currentViewport.y
        };

        event.currentTarget.setPointerCapture(event.pointerId);
    }, []);

    const handleViewportPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const panState = panRef.current;
        if (!panState || panState.pointerId !== event.pointerId) return;

        event.preventDefault();

        const dx = event.clientX - panState.startX;
        const dy = event.clientY - panState.startY;

        setViewport(prev => ({
            ...prev,
            x: panState.originX + dx,
            y: panState.originY + dy
        }));
    }, []);

    const handleViewportPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const panState = panRef.current;
        if (!panState || panState.pointerId !== event.pointerId) return;

        panRef.current = null;

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }, []);

    const toggleFullscreen = useCallback(async () => {
        try {
            if (!document.fullscreenElement) {
                await mapShellRef.current?.requestFullscreen?.();
            } else {
                await document.exitFullscreen();
            }
        } catch (error) {
            console.error('Unable to toggle fullscreen mode:', error);
        }
    }, []);

    const openTooltip = useCallback((model: SmartTableModel, clientX: number, clientY: number) => {
        setTooltip({ model, clientX, clientY });
    }, []);

    const moveTooltip = useCallback((modelId: string, clientX: number, clientY: number) => {
        setTooltip(prev => {
            if (!prev || prev.model.table.id !== modelId) return prev;
            return {
                ...prev,
                clientX,
                clientY
            };
        });
    }, []);

    const closeTooltip = useCallback((modelId: string) => {
        setTooltip(prev => {
            if (!prev || prev.model.table.id !== modelId) return prev;
            return null;
        });
    }, []);

    const tooltipPosition = useMemo(() => {
        if (!tooltip || !mapShellRef.current) return null;

        const rect = mapShellRef.current.getBoundingClientRect();
        const cardWidth = 260;
        const cardHeight = 126;

        let x = tooltip.clientX - rect.left + 16;
        let y = tooltip.clientY - rect.top + 16;

        if (x + cardWidth > rect.width - 8) {
            x = rect.width - cardWidth - 8;
        }
        if (y + cardHeight > rect.height - 8) {
            y = rect.height - cardHeight - 8;
        }

        x = Math.max(8, x);
        y = Math.max(8, y);

        return { x, y };
    }, [tooltip]);

    const renderTableControlActions = useCallback((variant: 'footer' | 'grid' = 'footer') => {
        if (!isRestaurantMode) return null;

        const buttonClass = variant === 'grid'
            ? 'min-w-0 min-h-14 rounded-xl bg-slate-500/95 hover:bg-slate-400/95 active:scale-[0.98] text-white text-[11px] font-bold py-2 px-2 border border-white/25 shadow-md flex items-center justify-center gap-2 transition-colors'
            : 'min-w-0 h-14 w-full rounded-2xl bg-white/[0.09] hover:bg-white/[0.16] active:scale-[0.98] text-slate-100 text-[10px] sm:text-xs font-black px-2 sm:px-3 border border-white/15 shadow-[0_10px_24px_rgba(2,6,23,0.32)] flex items-center justify-center gap-1.5 sm:gap-2 whitespace-normal text-center leading-tight transition-colors touch-manipulation';
        const iconSize = variant === 'grid' ? 18 : 20;

        return (
            <>
                <button
                    type="button"
                    onClick={() => {
                        if (occupiedForTools.length === 0) {
                            alert('No hay mesas ocupadas para unir.');
                            return;
                        }
                        setTransferSelection({ mode: 'MERGE', step: 'SOURCE' });
                    }}
                    className={buttonClass}
                >
                    <Link2 size={iconSize} className="opacity-95" />
                    Unir mesas
                </button>
                <button
                    type="button"
                    onClick={() => setSubtotalPickOpen(true)}
                    className={buttonClass}
                >
                    <Sigma size={iconSize} className="opacity-95" />
                    Subtotal
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (occupiedForTools.length === 0) {
                            alert('No hay mesas ocupadas para mover.');
                            return;
                        }
                        setTransferSelection({ mode: 'MOVE', step: 'SOURCE' });
                    }}
                    className={buttonClass}
                >
                    <ArrowRightLeft size={iconSize} className="opacity-95" />
                    Mover mesa
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (occupiedForTools.filter(t => t.currentOrderId).length === 0) {
                            alert('No hay mesas ocupadas con cuenta.');
                            return;
                        }
                        setTransferSelection({ mode: 'FRACTION', step: 'SOURCE' });
                    }}
                    className={buttonClass}
                >
                    <PieChart size={iconSize} className="opacity-95" />
                    Fraccionar
                </button>
                <button
                    type="button"
                    onClick={() => {
                        const withOrders = occupiedForTools.filter(t => t.currentOrderId);
                        if (withOrders.length === 0) {
                            alert('No hay mesas ocupadas con cuenta.');
                            return;
                        }
                        setTransferSelection({ mode: 'SPLIT', step: 'SOURCE' });
                    }}
                    className={buttonClass}
                >
                    <Scissors size={iconSize} className="opacity-95" />
                    Dividir cuenta
                </button>
                <button
                    type="button"
                    onClick={() => onOpenTableLayoutDesigner?.()}
                    className={buttonClass}
                >
                    <Pencil size={iconSize} className="opacity-95" />
                    Editar layout
                </button>
            </>
        );
    }, [
        freeForTools,
        isRestaurantMode,
        occupiedForTools,
        onOpenTableLayoutDesigner,
        parkedTickets
    ]);

    const splitTicketItems = useMemo(
        () => splitTicketForModal ? ensureCartIds(splitTicketForModal.items) : [],
        [splitTicketForModal]
    );
    const pendingMoveSource = useMemo(
        () => pendingTableMove
            ? safeTables.find(table => table.id === pendingTableMove.sourceTableId)
            : undefined,
        [pendingTableMove, safeTables]
    );
    const pendingMoveTarget = useMemo(
        () => pendingTableMove
            ? safeTables.find(table => table.id === pendingTableMove.targetTableId)
            : undefined,
        [pendingTableMove, safeTables]
    );
    const pendingMoveItems = useMemo(
        () => pendingMoveSource
            ? ensureCartIds(resolveTicketForTable(pendingMoveSource)?.items || [])
            : [],
        [pendingMoveSource, resolveTicketForTable]
    );

    return (
        <LazyMotion features={domAnimation}>
            <div
                ref={mapShellRef}
                className={`relative h-full w-full overflow-hidden select-none ${usesWhiteBackground ? 'bg-white text-slate-900' : 'bg-slate-950 text-slate-100'}`}
            >
                <div className={`absolute inset-0 ${usesWhiteBackground ? 'bg-white' : 'bg-gradient-to-br from-[#030712] via-[#07122a] to-[#040816]'}`} />

                <div
                    className={`absolute inset-0 pointer-events-none ${usesWhiteBackground ? 'opacity-70' : 'opacity-45'}`}
                    style={{
                        backgroundImage: [
                            `linear-gradient(${usesWhiteBackground ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.13)'} 1px, transparent 1px)`,
                            `linear-gradient(90deg, ${usesWhiteBackground ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.13)'} 1px, transparent 1px)`,
                            usesWhiteBackground ? 'none' : 'radial-gradient(circle at 25% 25%, rgba(56,189,248,0.18), transparent 45%)',
                            usesWhiteBackground ? 'none' : 'radial-gradient(circle at 85% 12%, rgba(147,51,234,0.12), transparent 42%)'
                        ].join(','),
                        backgroundSize: `${34 * viewport.scale}px ${34 * viewport.scale}px, ${34 * viewport.scale}px ${34 * viewport.scale}px, 100% 100%, 100% 100%`,
                        backgroundPosition: `${viewport.x * 0.06}px ${viewport.y * 0.06}px, ${viewport.x * 0.06}px ${viewport.y * 0.06}px, center, center`
                    }}
                />

                {!usesWhiteBackground && <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_18%,rgba(56,189,248,0.22),transparent_48%),radial-gradient(circle_at_82%_78%,rgba(168,85,247,0.16),transparent_42%)]" />}

                <AnimatePresence>
                    {transferSelection && (
                        <m.div
                            key={`${transferSelection.mode}-${transferSelection.step}`}
                            initial={{ opacity: 0, y: -12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -12 }}
                            transition={{ duration: 0.16 }}
                            className="absolute left-1/2 top-6 z-40 -translate-x-1/2 rounded-2xl border border-sky-200/25 bg-slate-950/78 px-5 py-3 text-center shadow-[0_18px_48px_rgba(2,6,23,0.62)] backdrop-blur-xl"
                        >
                            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-200">
                                {transferSelection.mode === 'MERGE' ? 'Unir mesas' : transferSelection.mode === 'SPLIT' ? 'Dividir cuenta' : 'Mover mesa'}
                            </p>
                            <p className="mt-1 text-sm font-black text-white">
                                {transferSelection.step === 'SOURCE'
                                    ? (transferSelection.mode === 'SPLIT' ? 'Toque en el mapa la mesa que desea dividir' : 'Mesa a mover: toque la mesa origen')
                                    : 'Mesa destino: toque la mesa que recibirá la cuenta'}
                            </p>
                            <button
                                type="button"
                                onClick={() => setTransferSelection(null)}
                                className="mt-2 text-[11px] font-bold text-slate-300 underline decoration-white/20 underline-offset-4 hover:text-white"
                            >
                                Cancelar
                            </button>
                        </m.div>
                    )}
                </AnimatePresence>

                <AnimatePresence>
                    {tableNotice && (
                        <m.div
                            key="table-notice"
                            className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setTableNotice(null)}
                        >
                            <m.div
                                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.96 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
                                transition={{ duration: 0.16, ease: 'easeOut' }}
                                className="w-full max-w-md rounded-3xl border border-white/12 bg-white p-6 text-slate-900 shadow-[0_24px_70px_rgba(2,6,23,0.48)]"
                                onClick={event => event.stopPropagation()}
                            >
                                <h3 className="text-xl font-black tracking-tight">{tableNotice.title}</h3>
                                <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{tableNotice.message}</p>
                                <div className="mt-6 flex justify-end gap-2">
                                    {tableNotice.tableToOpen && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const tableToOpen = tableNotice.tableToOpen;
                                                setTableNotice(null);
                                                if (tableToOpen) onTableClick(tableToOpen);
                                            }}
                                            className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white shadow-lg active:scale-[0.98]"
                                        >
                                            {tableNotice.primaryLabel || 'Abrir cuenta'}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setTableNotice(null)}
                                        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-black text-slate-700 active:scale-[0.98]"
                                    >
                                        {tableNotice.tableToOpen ? 'Cerrar' : (tableNotice.primaryLabel || 'Entendido')}
                                    </button>
                                </div>
                            </m.div>
                        </m.div>
                    )}
                </AnimatePresence>

                <AnimatePresence>
                    {hasControlCenterAccess && isControlCenterOpen && (
                        <m.aside
                            key="table-control-center"
                            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 32 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 32 }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                            className="absolute top-6 right-6 z-30 w-[318px] rounded-3xl border border-white/10 bg-white/[0.08] backdrop-blur-xl shadow-[0_26px_70px_rgba(2,6,23,0.65)] overflow-hidden"
                        >
                    <div className="p-5 border-b border-white/10 bg-gradient-to-r from-white/[0.06] to-transparent">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.26em] font-black text-sky-200/70">Control de Sala</p>
                                <h3 className="text-lg font-black tracking-tight text-white mt-1">Centro en tiempo real</h3>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1 text-emerald-300 text-[11px] font-bold">
                                    <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.8)] animate-pulse" />
                                    LIVE
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsControlCenterOpen(false)}
                                    className="h-8 w-8 rounded-full border border-white/10 bg-white/[0.08] text-slate-200 flex items-center justify-center hover:bg-white/[0.16]"
                                    title="Cerrar control de sala"
                                >
                                    <X size={15} />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="p-5 space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <DonutMetric
                                label="Ocupacion"
                                value={stats.occupied}
                                total={Math.max(stats.total, 1)}
                                color="from-rose-500 to-fuchsia-500"
                                caption={`${stats.free} libres`}
                            />
                            <DonutMetric
                                label="Alertas"
                                value={stats.attention + stats.checkRequested}
                                total={Math.max(stats.total, 1)}
                                color="from-amber-400 to-violet-500"
                                caption={`${stats.attention} atencion`}
                            />
                        </div>

                        <MetricCard
                            title="Ticket Promedio"
                            hint="Real vs Minimo esperado"
                            value={hasRoomFinancialAccess ? `${currencySymbol}${stats.averageTicket.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '••••'}
                            subValue={hasRoomFinancialAccess
                                ? `Min: ${currencySymbol}${minExpectedTicket.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                                : 'Visible por rol'}
                            accentClass="from-amber-300 via-orange-400 to-yellow-500"
                        />

                        <MetricCard
                            title="Eficiencia de Rotacion"
                            hint={`Objetivo base: ${expectedStayMinutes}m`}
                            value={hasRoomFinancialAccess ? `${stats.rotationEfficiency}%` : '••••'}
                            subValue={hasRoomFinancialAccess ? (stats.rotationEfficiency >= 75 ? 'Operacion saludable' : 'Requiere ajuste') : 'Visible por rol'}
                            accentClass="from-cyan-300 via-blue-400 to-indigo-500"
                        />

                        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 flex items-center justify-between">
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-300/80 font-bold">Total Sala</p>
                                <p className="text-xl font-black text-white mt-0.5">
                                    {hasRoomFinancialAccess ? `${currencySymbol}${stats.amount.toLocaleString()}` : '••••'}
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-[11px] text-slate-300">Mesas</p>
                                <p className="font-bold text-sky-200">{stats.total}</p>
                            </div>
                        </div>
                    </div>
                        </m.aside>
                    )}
                </AnimatePresence>

                <div className="absolute bottom-[11rem] right-4 z-30 flex flex-col gap-2 sm:right-6">
                    <GlassButton onClick={() => handleZoom(0.11)} title="Zoom +">
                        <Plus size={18} />
                    </GlassButton>
                    <GlassButton onClick={toggleFullscreen} title="Pantalla completa">
                        {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                    </GlassButton>
                    <GlassButton onClick={() => handleZoom(-0.11)} title="Zoom -">
                        <Minus size={18} />
                    </GlassButton>
                </div>

                <div className="absolute bottom-3 left-3 right-3 z-40 pointer-events-none sm:bottom-4 sm:left-4 sm:right-4">
                    <AnimatePresence>
                        {showRoomPicker && (
                            <m.div
                                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                                transition={{ duration: 0.16 }}
                                className="pointer-events-auto absolute bottom-[calc(100%+0.5rem)] left-0 max-h-[min(58vh,28rem)] w-[min(16rem,70vw)] rounded-[1.6rem] border border-white/10 bg-slate-950/80 backdrop-blur-xl px-2.5 py-3 shadow-[0_16px_50px_rgba(2,6,23,0.5)] flex flex-col gap-2 overflow-y-auto overflow-x-hidden no-scrollbar"
                            >
                                {rooms.map(room => {
                                    const isActive = room.id === activeRoomId;
                                    const roomOccupied = safeTables.filter(table => {
                                        if (table.roomId !== room.id) return false;
                                        const visualTable = getVisualTableState(table);
                                        return visualTable.status === 'RESERVED' || isTableOccupiedFromTicket(table);
                                    }).length;

                                    return (
                                        <button
                                            key={room.id}
                                            onClick={() => {
                                                setActiveRoomId(room.id);
                                                onChangeRoom?.(room.id);
                                                setShowRoomPicker(false);
                                            }}
                                            className={`w-full px-3 py-2.5 rounded-2xl border transition-all duration-200 text-sm font-bold flex items-center gap-2 text-left ${
                                                isActive
                                                    ? 'border-sky-300/60 bg-sky-400/20 text-sky-100 shadow-[0_0_24px_rgba(56,189,248,0.28)]'
                                                    : 'border-white/10 bg-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.09]'
                                            }`}
                                        >
                                            <LayoutGrid size={14} className="shrink-0" />
                                            <span className="min-w-0 flex-1 truncate">{room.name || room.nombre}</span>
                                            {roomOccupied > 0 && (
                                                <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-rose-500/70 text-white">{roomOccupied}</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </m.div>
                        )}
                    </AnimatePresence>

                    <div className="pointer-events-auto grid w-full grid-cols-4 gap-2 rounded-[1.5rem] border border-white/10 bg-slate-950/70 p-2 shadow-[0_16px_50px_rgba(2,6,23,0.5)] backdrop-blur-xl sm:gap-3 sm:p-3">
                        <GlassButton onClick={() => setShowRoomPicker(prev => !prev)} title="Salas" className="h-14 w-full min-w-0 px-2 sm:px-3">
                            <span className="flex min-w-0 items-center justify-center gap-1.5 sm:gap-2">
                                <LayoutGrid size={18} className="shrink-0" />
                                <span className="truncate text-[10px] font-black uppercase tracking-wide sm:text-xs">Salas</span>
                            </span>
                        </GlassButton>
                        {hasControlCenterAccess && (
                            <GlassButton onClick={() => setIsControlCenterOpen(prev => !prev)} title="Control" className="h-14 w-full min-w-0 px-2 sm:px-3">
                                <span className="flex min-w-0 items-center justify-center gap-1.5 sm:gap-2">
                                    <Activity size={18} className="shrink-0" />
                                    <span className="truncate text-[10px] font-black uppercase tracking-wide sm:text-xs">Control</span>
                                </span>
                            </GlassButton>
                        )}
                        {isRestaurantMode && renderTableControlActions('footer')}
                    </div>
                </div>

                <div
                    ref={viewportRef}
                    className="absolute inset-0 z-10 touch-none"
                    onWheel={handleWheel}
                    onPointerDown={handleViewportPointerDown}
                    onPointerMove={handleViewportPointerMove}
                    onPointerUp={handleViewportPointerEnd}
                    onPointerCancel={handleViewportPointerEnd}
                >
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                        <div
                            className="will-change-transform"
                            style={{
                                transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`,
                                transformOrigin: 'center center'
                            }}
                        >
                            <div
                                className="relative overflow-visible"
                                style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
                            >
                                {obstacleTables.map(obstacle => (
                                    <div
                                        key={obstacle.id}
                                        className="absolute bg-slate-900/70 border border-slate-700/80 rounded-lg"
                                        style={{
                                            left: obstacle.posX,
                                            top: obstacle.posY,
                                            width: obstacle.width,
                                            height: obstacle.height,
                                            transform: `rotate(${obstacle.rotation}deg)`
                                        }}
                                    />
                                ))}

                                {smartTables.map(model => (
                                    <SmartTableNode
                                        key={model.table.id}
                                        model={model}
                                        currencySymbol={currencySymbol}
                                        reduceMotion={Boolean(reduceMotion)}
                                        lightBackground={usesWhiteBackground}
                                        onSelect={handleNodeSelect}
                                        onTooltipOpen={openTooltip}
                                        onTooltipMove={moveTooltip}
                                        onTooltipClose={closeTooltip}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <AnimatePresence>
                    {tooltip && tooltipPosition && (
                        <m.div
                            key={tooltip.model.table.id}
                            initial={{ opacity: 0, y: 8, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 6, scale: 0.96 }}
                            transition={{ duration: 0.16, ease: 'easeOut' }}
                            className="absolute z-40 w-[260px] rounded-2xl border border-white/15 bg-slate-950/90 backdrop-blur-xl px-4 py-3 shadow-[0_20px_45px_rgba(2,6,23,0.72)] pointer-events-none"
                            style={{ left: tooltipPosition.x, top: tooltipPosition.y }}
                        >
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-black text-white tracking-tight">{tooltip.model.table.nombre || tooltip.model.table.name}</p>
                                <span className="text-[10px] uppercase tracking-[0.15em] text-slate-300">{statusPalette[tooltip.model.smartStatus].label}</span>
                            </div>
                            <div className="mt-2 space-y-1.5 text-xs text-slate-200/95">
                                <p><span className="text-slate-400">Ultimo pedido:</span> {tooltip.model.lastOrderHint}</p>
                                <p><span className="text-slate-400">Mesero:</span> {tooltip.model.table.waiterName || 'Sin asignar'}</p>
                                <p><span className="text-slate-400">Cliente:</span> {tooltip.model.firstCustomerName || 'Sin asignar'}</p>
                                <p><span className="text-slate-400">Total:</span> {currencySymbol}{tooltip.model.total.toLocaleString()}</p>
                                <p><span className="text-slate-400">Tiempo:</span> {tooltip.model.elapsedLabel}</p>
                                {tooltip.model.hasPendingKitchenDispatch && (
                                    <p className="font-black text-amber-300"><span className="text-amber-200/75">Cocina:</span> pendiente de recepción</p>
                                )}
                            </div>
                        </m.div>
                    )}
                </AnimatePresence>

                {pendingTableMove && pendingMoveSource && pendingMoveTarget && (
                    <TableMoveConfirmationModal
                        sourceLabel={getTableRoomLabel(pendingMoveSource)}
                        targetLabel={getTableRoomLabel(pendingMoveTarget)}
                        items={pendingMoveItems}
                        onClose={() => setPendingTableMove(null)}
                        onMoveAll={() => {
                            const selection = pendingTableMove;
                            setPendingTableMove(null);
                            void completeTableTransfer(
                                selection.sourceTableId,
                                selection.targetTableId,
                                'MOVE'
                            );
                        }}
                        onMovePartial={(items) => {
                            const selection = pendingTableMove;
                            setPendingTableMove(null);
                            void completeTableTransfer(
                                selection.sourceTableId,
                                selection.targetTableId,
                                'MOVE',
                                items
                            );
                        }}
                    />
                )}

                {selectedTable && (
                    <TableOptionsModal
                        table={selectedTable}
                        room={rooms.find(candidate => candidate.id === selectedTable.roomId) || activeRoom}
                        rooms={rooms}
                        allTables={safeTables.map(table => enrichTableWithParkedTicket(getVisualTableState(table)))}
                        moveTargetTableIds={safeTables
                            .filter(candidate => candidate.id !== selectedTable.id && !isTableMoveTargetOccupied(candidate))
                            .map(candidate => String(candidate.id))}
                        onClose={() => setSelectedTable(null)}
                        onAddOrder={() => {
                            onTableClick(selectedTable);
                            setSelectedTable(null);
                        }}
                        onPrintPrecheck={() => {
                            if (onPrintPrecheck) onPrintPrecheck(selectedTable);
                        }}
                        onSplitItems={() => {
                            const ticket = parkedTickets?.find(p => p.id === selectedTable.currentOrderId);
                            if (ticket?.items?.length) {
                                setSplitTicketForModal(ticket);
                                setSelectedTable(null);
                            } else {
                                alert('Sin cuenta con ítems para dividir.');
                            }
                        }}
                        onSplitPayment={() => {
                            const ticket = parkedTickets?.find(p => p.id === selectedTable.currentOrderId);
                            if (ticket?.items?.length) {
                                setFractionTicketForModal(ticket);
                                setFractionCount(ticket.paymentFraction?.count || 2);
                                setSelectedTable(null);
                            } else {
                                alert('Sin cuenta activa para dividir pago.');
                            }
                        }}
                        onMoveTable={(targetTableId) => {
                            void completeTableTransfer(selectedTable.id, targetTableId, 'MOVE');
                            setSelectedTable(null);
                        }}
                        sourceItems={ensureCartIds(resolveTicketForTable(selectedTable)?.items || [])}
                        onMoveTablePartial={(targetTableId, items) => {
                            void completeTableTransfer(selectedTable.id, targetTableId, 'MOVE', items);
                            setSelectedTable(null);
                        }}
                        onMergeTables={async (targetTableIds) => {
                            try {
                                const res = await fetch(resolveOperationalApiUrl('/api/mesas/unir'), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        mainTableId: selectedTable.id,
                                        secondaryTableIds: targetTableIds
                                    })
                                });
                                const data = await res.json().catch(() => ({}));
                                if (res.ok && data.success !== false) {
                                    onRefreshTables?.();
                                    setSelectedTable(null);
                                    alert(typeof data.message === 'string' ? data.message : 'Mesas unidas.');
                                } else {
                                    alert(data?.message || 'No se pudo unir las mesas.');
                                }
                            } catch (error) {
                                console.error(error);
                                alert('Error de conexión al unir mesas.');
                            }
                        }}
                        onFree={async () => {
                            try {
                                const res = await fetch(resolveOperationalApiUrl('/api/mesas/liberar'), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ tableId: selectedTable.id })
                                });
                                const data = await res.json();
                                if (data.success) {
                                    onRefreshTables?.();
                                    setSelectedTable(null);
                                } else {
                                    alert('Error liberando mesa: ' + data.message);
                                }
                            } catch (error) {
                                console.error(error);
                                alert('Error de conexion');
                            }
                        }}
                    />
                )}

                {selectedAccountTable && (
                    <BarTabsModal
                        table={selectedAccountTable}
                        tickets={getTableTickets(selectedAccountTable)}
                        currencySymbol={currencySymbol}
                        allowCreate
                        accountMode
                        titleLabel="Cuentas de la mesa"
                        onClose={() => setSelectedAccountTable(null)}
                        onOpenTab={(ticket) => {
                            const total = Number(ticket.total ?? (ticket.items || []).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0));
                            onTableClick({
                                ...selectedAccountTable,
                                status: 'OCCUPIED',
                                currentOrderId: ticket.id,
                                currentOrderTotal: total,
                                timeSeated: selectedAccountTable.timeSeated || ticket.timestamp
                            });
                            setSelectedAccountTable(null);
                        }}
                        onCreateTab={(name) => {
                            void createTableAccount(selectedAccountTable, name);
                        }}
                    />
                )}

                {selectedBarTable && (
                    <BarTabsModal
                        table={selectedBarTable}
                        tickets={getBarTickets(selectedBarTable)}
                        currencySymbol={currencySymbol}
                        onClose={() => setSelectedBarTable(null)}
                        onOpenTab={(ticket) => {
                            const label = ticket.barTabName || ticket.alias || ticket.name || 'Minuta';
                            const total = Number(ticket.total ?? (ticket.items || []).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0));
                            onTableClick({
                                ...selectedBarTable,
                                status: 'OCCUPIED',
                                currentOrderId: ticket.id,
                                currentOrderTotal: total,
                                timeSeated: selectedBarTable.timeSeated || ticket.timestamp,
                                barTabId: ticket.barTabId || ticket.id,
                                barTabName: label
                            });
                            setSelectedBarTable(null);
                        }}
                        onCreateTab={(name) => {
                            const orderId = `BAR-${selectedBarTable.id}-${Date.now()}`;
                            onTableClick({
                                ...selectedBarTable,
                                status: 'OCCUPIED',
                                currentOrderId: orderId,
                                currentOrderTotal: 0,
                                timeSeated: new Date().toISOString(),
                                waiterId: currentUser.id,
                                waiterName: currentUser.name,
                                barTabId: orderId,
                                barTabName: name
                            });
                            setSelectedBarTable(null);
                        }}
                    />
                )}

                {isRestaurantMode && splitTicketForModal && (
                    <SplitTicketModal
                        originalItems={splitTicketItems}
                        currencySymbol={currencySymbol}
                        onClose={() => setSplitTicketForModal(null)}
                        onConfirm={(remainingItems, newTicketItems, extraNewTickets, splitCount) => {
                            if (onParkedOrderSplitResult) {
                                void onParkedOrderSplitResult(splitTicketForModal.id, remainingItems, newTicketItems, extraNewTickets, splitCount);
                            } else {
                                alert('No se pudo guardar la división: falta el manejador en la aplicación.');
                            }
                            setSplitTicketForModal(null);
                        }}
                    />
                )}

                {isRestaurantMode && subtotalPickOpen && (
                    <div
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
                        onClick={() => setSubtotalPickOpen(false)}
                    >
                        <div
                            className="bg-slate-900 border border-white/15 rounded-2xl p-6 max-w-md w-full shadow-2xl"
                            onClick={e => e.stopPropagation()}
                        >
                            <h3 className="text-lg font-black text-white mb-4">Subtotal / Pre-cuenta</h3>
                            <p className="text-xs text-slate-400 mb-3">Mesa con cuenta abierta:</p>
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                                {occupiedForTools.filter(t => t.currentOrderId).length === 0 && (
                                    <p className="text-sm text-slate-500">No hay mesas con orden activa.</p>
                                )}
                                {occupiedForTools
                                    .filter(t => t.currentOrderId)
                                    .map(t => (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => {
                                                if (onPrintPrecheck) onPrintPrecheck(t);
                                                setSubtotalPickOpen(false);
                                            }}
                                            className="w-full text-left px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold border border-white/10"
                                        >
                                            {getTableRoomLabel(t)}
                                        </button>
                                    ))}
                            </div>
                            <button
                                type="button"
                                onClick={() => setSubtotalPickOpen(false)}
                                className="mt-4 w-full py-2 rounded-xl text-slate-400 hover:bg-white/5"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                )}

                {isRestaurantMode && splitPickOpen && (
                    <div
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
                        onClick={() => setSplitPickOpen(false)}
                    >
                        <div
                            className="bg-slate-900 border border-white/15 rounded-2xl p-6 max-w-md w-full shadow-2xl"
                            onClick={e => e.stopPropagation()}
                        >
                            <h3 className="text-lg font-black text-white mb-4">Dividir cuenta — elegir mesa</h3>
                            <div className="space-y-2 max-h-72 overflow-y-auto">
                                {occupiedForTools
                                    .filter(t => t.currentOrderId)
                                    .map(t => {
                                        const ticket = parkedTickets?.find(p => p.id === t.currentOrderId);
                                        return (
                                            <button
                                                key={t.id}
                                                type="button"
                                                disabled={!ticket?.items?.length}
                                                onClick={() => {
                                                    if (ticket?.items?.length) {
                                                        setSplitTicketForModal(ticket);
                                                        setSplitPickOpen(false);
                                                    }
                                                }}
                                                className="w-full text-left px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-semibold border border-white/10"
                                            >
                                                {getTableRoomLabel(t)}
                                                {!ticket?.items?.length ? ' (sin ítems)' : ''}
                                            </button>
                                        );
                                    })}
                            </div>
                            <button
                                type="button"
                                onClick={() => setSplitPickOpen(false)}
                                className="mt-4 w-full py-2 rounded-xl text-slate-400 hover:bg-white/5"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                )}

                {isRestaurantMode && fractionPickOpen && (
                    <div
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
                        onClick={() => setFractionPickOpen(false)}
                    >
                        <div
                            className="bg-slate-900 border border-white/15 rounded-2xl p-6 max-w-md w-full shadow-2xl"
                            onClick={e => e.stopPropagation()}
                        >
                            <h3 className="text-lg font-black text-white mb-2">Fraccionar cuenta</h3>
                            <p className="text-sm text-slate-400 mb-4">
                                Para dividir en partes iguales con cobro separado, abra la mesa en el POS y use la opción
                                Fraccionar en el ticket. Aquí puede enviar pre-cuenta por mesa ocupada.
                            </p>
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                                {occupiedForTools
                                    .filter(t => t.currentOrderId)
                                    .map(t => (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => {
                                                const ticket = parkedTickets?.find(p => p.id === t.currentOrderId);
                                                if (ticket?.items?.length) {
                                                    setSplitTicketForModal(ticket);
                                                    setFractionPickOpen(false);
                                                } else if (onPrintPrecheck) {
                                                    onPrintPrecheck(t);
                                                }
                                            }}
                                            className="w-full text-left px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold border border-white/10"
                                        >
                                            Pre-cuenta — {getTableRoomLabel(t)}
                                        </button>
                                    ))}
                            </div>
                            <button
                                type="button"
                                onClick={() => setFractionPickOpen(false)}
                                className="mt-4 w-full py-2 rounded-xl bg-white/10 text-white font-bold"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                )}

                {isRestaurantMode && fractionTicketForModal && (
                    <div
                        className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
                        onClick={() => setFractionTicketForModal(null)}
                    >
                        <div
                            className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900 p-6 text-white shadow-2xl"
                            onClick={event => event.stopPropagation()}
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-xs font-black uppercase tracking-widest text-sky-400">Cobro separado</p>
                                    <h3 className="mt-1 text-2xl font-black">Fraccionar cuenta</h3>
                                    <p className="mt-1 text-sm text-slate-400">Los artículos permanecen en una sola cuenta.</p>
                                </div>
                                <button type="button" onClick={() => setFractionTicketForModal(null)} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Cerrar">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="mt-6 rounded-xl border border-white/10 bg-slate-950/60 p-4">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="font-semibold text-slate-400">Total</span>
                                    <span className="text-xl font-black">{currencySymbol}{Number(fractionTicketForModal.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                                <div className="mt-4 flex items-center justify-center gap-4">
                                    <button type="button" onClick={() => setFractionCount(value => Math.max(2, value - 1))} disabled={fractionCount <= 2} className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 disabled:opacity-30" aria-label="Quitar una parte"><Minus size={20} /></button>
                                    <div className="min-w-28 text-center">
                                        <p className="text-4xl font-black">{fractionCount}</p>
                                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">partes</p>
                                    </div>
                                    <button type="button" onClick={() => setFractionCount(value => Math.min(20, value + 1))} disabled={fractionCount >= 20} className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 disabled:opacity-30" aria-label="Agregar una parte"><Plus size={20} /></button>
                                </div>
                                <p className="mt-4 text-center text-lg font-black text-sky-300">
                                    {currencySymbol}{(Number(fractionTicketForModal.total || 0) / fractionCount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} por persona
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={async () => {
                                    const paidParts = fractionTicketForModal.paymentFraction?.parts.filter(part => part.status === 'PAID') || [];
                                    if (paidParts.length > 0) {
                                        alert('Esta cuenta ya tiene cuotas cobradas y no puede volver a fraccionarse.');
                                        return;
                                    }
                                    const total = Number(fractionTicketForModal.total || 0);
                                    const nextTicket = {
                                        ...fractionTicketForModal,
                                        paymentFraction: createPaymentFractionPlan(total, fractionCount)
                                    };
                                    const nextTickets = (parkedTickets || []).map(ticket => ticket.id === nextTicket.id ? nextTicket : ticket);
                                    await Promise.resolve(onUpdateParkedTickets?.(nextTickets));
                                    setFractionTicketForModal(null);
                                    setTableNotice({
                                        title: 'Cuenta fraccionada',
                                        message: `Se generaron ${fractionCount} cuotas para cobro separado.`,
                                        primaryLabel: 'Entendido'
                                    });
                                }}
                                className="mt-5 w-full rounded-xl bg-sky-500 px-4 py-3.5 font-black text-slate-950 hover:bg-sky-400"
                            >
                                Crear {fractionCount} cuotas
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </LazyMotion>
    );
};

const SmartTableNode = React.memo(({
    model,
    currencySymbol,
    reduceMotion,
    lightBackground,
    onSelect,
    onTooltipOpen,
    onTooltipMove,
    onTooltipClose
}: {
    model: SmartTableModel;
    currencySymbol: string;
    reduceMotion: boolean;
    lightBackground: boolean;
    onSelect: (model: SmartTableModel) => void;
    onTooltipOpen: (model: SmartTableModel, x: number, y: number) => void;
    onTooltipMove: (modelId: string, x: number, y: number) => void;
    onTooltipClose: (modelId: string) => void;
}) => {
    const longPressTimeoutRef = useRef<number | null>(null);

    const clearLongPress = useCallback(() => {
        if (longPressTimeoutRef.current) {
            window.clearTimeout(longPressTimeoutRef.current);
            longPressTimeoutRef.current = null;
        }
    }, []);

    useEffect(() => () => clearLongPress(), [clearLongPress]);

    const ringRadius = 12;
    const ringCircumference = 2 * Math.PI * ringRadius;
    const ringOffset = ringCircumference * (1 - model.progress);
    const shapeClass =
        model.archetype === 'CIRCLE' || model.archetype === 'BAR'
            ? 'rounded-full'
            : model.archetype === 'BOOTH' || model.archetype === 'CHAISE_LONGUE'
                ? 'rounded-[1.3rem]'
                : 'rounded-2xl';
    const isFree = model.smartStatus === 'FREE';

    return (
        <m.button
            data-table-node="true"
            type="button"
            custom={model.index}
            variants={TABLE_ENTRY_VARIANTS}
            initial="hidden"
            animate="visible"
            whileHover={reduceMotion ? undefined : { scale: 1.035, y: -2 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25, mass: 0.6 }}
            onClick={() => onSelect(model)}
            onMouseEnter={(event) => onTooltipOpen(model, event.clientX, event.clientY)}
            onMouseMove={(event) => onTooltipMove(model.table.id, event.clientX, event.clientY)}
            onMouseLeave={() => {
                clearLongPress();
                onTooltipClose(model.table.id);
            }}
            onPointerDown={(event) => {
                if (event.pointerType === 'touch') {
                    clearLongPress();
                    const { clientX, clientY } = event;
                    longPressTimeoutRef.current = window.setTimeout(() => {
                        onTooltipOpen(model, clientX, clientY);
                    }, 320);
                }
            }}
            onPointerUp={() => clearLongPress()}
            onPointerCancel={() => clearLongPress()}
            className={`absolute isolate overflow-hidden border text-left transition-[box-shadow,border-color,background-color] duration-300 ${shapeClass} ${lightBackground && isFree ? 'border-emerald-500/50 bg-white text-slate-900 shadow-lg shadow-slate-200/70' : statusPalette[model.smartStatus].shell}`}
            style={{
                left: model.table.posX,
                top: model.table.posY,
                width: model.table.width,
                height: model.table.height,
                rotate: `${model.table.rotation || 0}deg`,
                willChange: 'transform, opacity'
            }}
        >
            {model.needsRevenueGlow && (
                <m.div
                    className="pointer-events-none absolute -inset-2 rounded-[inherit]"
                    style={{
                        background: 'radial-gradient(circle, rgba(251,191,36,0.42) 0%, rgba(245,158,11,0.24) 40%, rgba(245,158,11,0) 74%)'
                    }}
                    animate={reduceMotion ? { opacity: 0.35 } : { opacity: [0.3, 0.65, 0.3], scale: [0.98, 1.04, 0.98] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                />
            )}

            {model.smartStatus === 'ATTENTION' && (
                <m.div
                    className="pointer-events-none absolute inset-0 rounded-[inherit] border border-amber-300/80"
                    animate={
                        reduceMotion
                            ? { opacity: 0.8 }
                            : {
                                opacity: [0.36, 1, 0.36],
                                boxShadow: [
                                    '0 0 0 rgba(251,191,36,0.2)',
                                    '0 0 24px rgba(251,191,36,0.55)',
                                    '0 0 0 rgba(251,191,36,0.2)'
                                ]
                            }
                    }
                    transition={{ duration: 1.65, repeat: Infinity, ease: 'easeInOut' }}
                />
            )}

            {model.smartStatus === 'CHECK_REQUESTED' && (
                <m.div
                    className="pointer-events-none absolute -inset-[1px] rounded-[inherit] border border-fuchsia-300/80"
                    animate={
                        reduceMotion
                            ? { opacity: 0.9 }
                            : {
                                opacity: [0.5, 0.95, 0.5],
                                boxShadow: [
                                    '0 0 8px rgba(217,70,239,0.25)',
                                    '0 0 22px rgba(217,70,239,0.62)',
                                    '0 0 8px rgba(217,70,239,0.25)'
                                ]
                            }
                    }
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                />
            )}

            {model.isSubtotalized && (
                <div className="pointer-events-none absolute left-1/2 top-1.5 z-10 -translate-x-1/2 rounded-full border border-white/30 bg-violet-950/75 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.16em] text-white shadow-lg">
                    Subtotal
                </div>
            )}

            {model.isPartiallySubtotalized && (
                <div className="pointer-events-none absolute left-1/2 top-1.5 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-violet-300/60 bg-slate-950/85 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.1em] text-violet-200 shadow-lg">
                    {model.subtotalizedTicketCount} de {model.ticketCount} subtotalizados
                </div>
            )}

            {model.archetype === 'BOOTH' && (
                <>
                    <div className="pointer-events-none absolute inset-y-2 left-1 w-1 rounded-full bg-white/20" />
                    <div className="pointer-events-none absolute inset-y-2 right-1 w-1 rounded-full bg-white/20" />
                </>
            )}

            {model.archetype === 'BAR' && (
                <div className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-1 opacity-70">
                    <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
                    <span className="h-1.5 w-1.5 rounded-full bg-white/60" />
                    <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
                </div>
            )}

            {model.archetype === 'CHAISE_LONGUE' && (
                <div className="pointer-events-none absolute inset-x-3 bottom-2 h-1 rounded-full bg-white/25" />
            )}

            <div className="absolute inset-0 p-2 flex flex-col justify-between">
                {isFree ? (
                    <>
                        <div className="flex items-center justify-between">
                            <span className="h-2 w-2 rounded-full bg-emerald-300/85" />
                            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full border border-emerald-400/40 bg-emerald-400/10">
                                <Check size={10} className={lightBackground ? 'text-emerald-600' : 'text-emerald-200'} />
                            </span>
                        </div>

                        <div className="text-center leading-none">
                            <p className="text-base font-black tracking-tight truncate">
                                {model.table.nombre || model.table.name}
                            </p>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex items-start justify-between gap-2">
                            <div className="h-7 w-7 rounded-full border border-white/30 bg-black/20 backdrop-blur-md flex items-center justify-center text-[10px] font-black text-white overflow-hidden">
                                {model.table.waiterName ? model.table.waiterName.trim().charAt(0).toUpperCase() : <User size={12} />}
                            </div>

                            <div className="relative h-8 w-8">
                                <svg className="h-8 w-8 -rotate-90" viewBox="0 0 32 32">
                                    <circle cx="16" cy="16" r={ringRadius} stroke="rgba(255,255,255,0.25)" strokeWidth="3" fill="none" />
                                    <circle
                                        cx="16"
                                        cy="16"
                                        r={ringRadius}
                                        stroke="rgba(56,189,248,0.95)"
                                        strokeWidth="3"
                                        fill="none"
                                        strokeLinecap="round"
                                        strokeDasharray={ringCircumference}
                                        strokeDashoffset={ringOffset}
                                    />
                                </svg>
                                <span
                                    className={`absolute inset-0 flex items-center justify-center text-[10px] ${model.hasPendingKitchenDispatch ? 'rounded-full bg-amber-400 text-amber-950 shadow-[0_0_18px_rgba(251,191,36,0.8)]' : ''}`}
                                    title={model.hasPendingKitchenDispatch ? 'Pedido pendiente de recepción en cocina' : model.serviceStage.label}
                                >
                                    {model.hasPendingKitchenDispatch ? <CircleHelp size={19} strokeWidth={3} /> : model.serviceStage.icon}
                                </span>
                            </div>
                        </div>

                        <div className="text-center leading-none">
                            <p className="text-base font-black tracking-tight drop-shadow-[0_2px_6px_rgba(2,6,23,0.5)] truncate">
                                {model.table.nombre || model.table.name}
                            </p>
                        </div>

                        <div className="flex items-center justify-between text-[11px] font-semibold">
                            <span className="inline-flex items-center gap-1">
                                <Clock size={11} />
                                {model.elapsedLabel}
                            </span>
                            <span className="font-black">{currencySymbol}{model.total.toLocaleString()}</span>
                        </div>
                    </>
                )}
            </div>

            {model.isLocked && (
                <div className="absolute inset-0 rounded-[inherit] bg-slate-950/72 backdrop-blur-[1px] flex items-center justify-center">
                    <Lock size={18} className="text-white" />
                </div>
            )}
        </m.button>
    );
});

SmartTableNode.displayName = 'SmartTableNode';

const DonutMetric = React.memo(({
    label,
    value,
    total,
    color,
    caption
}: {
    label: string;
    value: number;
    total: number;
    color: string;
    caption: string;
}) => {
    const normalized = clamp(value / Math.max(total, 1), 0, 1);
    const percentage = Math.round(normalized * 100);

    return (
        <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 flex items-center gap-3">
            <div
                className="h-12 w-12 rounded-full p-[3px]"
                style={{
                    background: `conic-gradient(rgba(56,189,248,0.95) ${normalized * 360}deg, rgba(15,23,42,0.85) 0deg)`
                }}
            >
                <div className={`h-full w-full rounded-full bg-gradient-to-br ${color} flex items-center justify-center text-[10px] font-black text-slate-950`}>
                    {percentage}%
                </div>
            </div>
            <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-300/80 font-bold">{label}</p>
                <p className="text-sm font-black text-white">{value}/{total}</p>
                <p className="text-[10px] text-slate-300/70">{caption}</p>
            </div>
        </div>
    );
});

DonutMetric.displayName = 'DonutMetric';

const MetricCard = React.memo(({
    title,
    hint,
    value,
    subValue,
    accentClass
}: {
    title: string;
    hint: string;
    value: string;
    subValue: string;
    accentClass: string;
}) => {
    return (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 relative overflow-hidden">
            <div className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${accentClass}`} />
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-300/80 font-bold">{title}</p>
            <p className="text-lg font-black text-white mt-1">{value}</p>
            <p className="text-[11px] text-slate-300/80 mt-1">{subValue}</p>
            <p className="text-[10px] text-slate-400 mt-2">{hint}</p>
        </div>
    );
});

MetricCard.displayName = 'MetricCard';

const GlassButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', children, ...props }) => (
    <button
        {...props}
        className={`h-12 w-12 rounded-2xl border border-white/15 bg-white/[0.08] backdrop-blur-xl text-slate-100 shadow-[0_12px_26px_rgba(2,6,23,0.5)] hover:bg-white/[0.16] active:scale-95 transition-all flex items-center justify-center ${className}`}
    >
        {children}
    </button>
);

export default TableMap;
