import React, { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { Room, Table, User as UserType, ParkedTicket, CartItem } from '../types';
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
    ReceiptText,
    Link2,
    Scissors,
    ArrowRightLeft,
    Pencil,
    Sigma,
    PieChart
} from 'lucide-react';
import { LazyMotion, domAnimation, m, AnimatePresence, useReducedMotion } from 'framer-motion';
import TableOptionsModal from './TableOptionsModal';
import SplitTicketModal from './SplitTicketModal';

interface TableMapProps {
    rooms: Room[];
    currentRoomId?: string;
    tables: Table[];
    parkedTickets?: ParkedTicket[];
    onTableClick: (table: Table) => void;
    currencySymbol: string;
    currentUser: UserType;
    isAdmin?: boolean;
    bloqueoMeseros?: boolean;
    isRestaurantMode?: boolean;
    onOpenTable?: (table: Table) => Promise<Table | null>;
    onRefreshTables?: () => void;
    canViewBusinessMetrics?: boolean;
    onPrintPrecheck?: (table: Table) => void;
    /** Restaurante: persiste división de cuenta desde el mapa (órdenes en espera) */
    onParkedOrderSplitResult?: (orderId: string, remainingItems: CartItem[], newTicketItems: CartItem[]) => void | Promise<void>;
    /** Restaurante: abrir diseñador de plano de mesas */
    onOpenTableLayoutDesigner?: () => void;
}

type SmartStatus = 'FREE' | 'ATTENTION' | 'OCCUPIED' | 'CHECK_REQUESTED';
type TableArchetype = 'CIRCLE' | 'SQUARE' | 'BAR' | 'BOOTH';

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
    progress: number;
    serviceStage: {
        icon: string;
        label: string;
    };
    needsRevenueGlow: boolean;
    lastOrderHint: string;
}

interface TooltipState {
    model: SmartTableModel;
    clientX: number;
    clientY: number;
}

interface ParkedOrderSummary {
    itemCount: number;
    calculatedTotal: number;
    finalTotal: number;
    hasExplicitTotal: boolean;
}

const CANVAS_WIDTH = 1240;
const CANVAS_HEIGHT = 860;
const SCALE_MIN = 0.55;
const SCALE_MAX = 2.2;
/** Ancho del panel "Control de Sala" (w-[318px]) + márgenes; evita encimar mesas bajo el aside */
const RESTAURANT_SIDEBAR_RESERVE_PX = 400;
/** Zona inferior del selector de salas + margen */
const RESTAURANT_BOTTOM_BAR_RESERVE_PX = 112;
const DEFAULT_EXPECTED_STAY = 70;
const NO_ORDER_TOTAL_THRESHOLD = 0.01;
const EMPTY_TABLE_ALERT_AFTER_SECONDS = 18;

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

const getServiceStage = (progress: number): { icon: string; label: string } => {
    if (progress < 0.34) return { icon: '🥗', label: 'Entradas' };
    if (progress < 0.67) return { icon: '🥩', label: 'Plato fuerte' };
    return { icon: '🍰', label: 'Postre' };
};

const inferArchetype = (table: Table): TableArchetype => {
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
        (table.shape === 'CIRCLE' && capacity <= 1);

    if (looksLikeBarStool) return 'BAR';
    if (table.shape === 'CIRCLE') return 'CIRCLE';
    return 'SQUARE';
};

const getSmartStatus = (table: Table, elapsedMinutes: number, hasDigitizedItems: boolean): SmartStatus => {
    if (!table.status || table.status === 'FREE') return 'FREE';
    if (table.status === 'RESERVED') return 'CHECK_REQUESTED';
    const elapsedSeconds = elapsedMinutes * 60;

    if (!hasDigitizedItems) {
        // Empty opened table: allow a short grace period, then mark as attention instead of occupied/red.
        if (!table.timeSeated || elapsedSeconds >= EMPTY_TABLE_ALERT_AFTER_SECONDS) {
            return 'ATTENTION';
        }
    }

    return 'OCCUPIED';
};

const computeLastOrderHint = (model: Pick<SmartTableModel, 'smartStatus' | 'serviceStage' | 'hasDigitizedItems'>): string => {
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
    currencySymbol,
    currentUser,
    isAdmin,
    bloqueoMeseros,
    isRestaurantMode,
    onOpenTable,
    onRefreshTables,
    canViewBusinessMetrics,
    onPrintPrecheck,
    onParkedOrderSplitResult,
    onOpenTableLayoutDesigner
}) => {
    const [activeRoomId, setActiveRoomId] = useState<string>(initialRoomId || rooms[0]?.id || '');
    const [selectedTable, setSelectedTable] = useState<Table | null>(null);
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);
    const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [splitTicketForModal, setSplitTicketForModal] = useState<ParkedTicket | null>(null);
    const [mergePickOpen, setMergePickOpen] = useState(false);
    const [movePickOpen, setMovePickOpen] = useState(false);
    const [subtotalPickOpen, setSubtotalPickOpen] = useState(false);
    const [fractionPickOpen, setFractionPickOpen] = useState(false);
    const [splitPickOpen, setSplitPickOpen] = useState(false);
    const [mergePrimaryId, setMergePrimaryId] = useState('');
    const [mergeSecondaryId, setMergeSecondaryId] = useState('');
    const [moveFromId, setMoveFromId] = useState('');
    const [moveToId, setMoveToId] = useState('');
    const reduceMotion = useReducedMotion();

    const mapShellRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const panRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
    const viewportStateRef = useRef(viewport);

    const safeTables = Array.isArray(tables) ? tables : [];

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

    const roomTables = useMemo(
        () => safeTables.filter(table => table.roomId === activeRoomId),
        [safeTables, activeRoomId]
    );

    const fitRestaurantViewport = useCallback(() => {
        if (!isRestaurantMode) return;
        const el = viewportRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const sidebarReserve = RESTAURANT_SIDEBAR_RESERVE_PX;
        const bottomBarReserve = RESTAURANT_BOTTOM_BAR_RESERVE_PX;
        const edgePad = 28;
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
            const s = clamp(Math.min(usableW / CANVAS_WIDTH, usableH / CANVAS_HEIGHT) * 0.94, SCALE_MIN, SCALE_MAX);
            setViewport({ scale: s, x: -panBiasX, y: -panBiasY });
            return;
        }

        const pad = 72;
        const bw = maxX - minX + pad * 2;
        const bh = maxY - minY + pad * 2;
        const s = clamp(Math.min(usableW / bw, usableH / bh) * 0.96, SCALE_MIN, SCALE_MAX);
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        const cx = CANVAS_WIDTH / 2;
        const cy = CANVAS_HEIGHT / 2;
        const baseX = -s * (midX - cx);
        const baseY = -s * (midY - cy);
        setViewport({ scale: s, x: baseX - panBiasX, y: baseY - panBiasY });
    }, [isRestaurantMode, roomTables]);

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

    const occupiedForTools = useMemo(
        () => serviceTables.filter(t => t.status === 'OCCUPIED' || t.status === 'RESERVED'),
        [serviceTables]
    );

    const freeForTools = useMemo(
        () => serviceTables.filter(t => !t.status || t.status === 'FREE'),
        [serviceTables]
    );

    const occupiedLikeTables = useMemo(
        () => serviceTables.filter(table => table.status === 'OCCUPIED' || table.status === 'RESERVED'),
        [serviceTables]
    );

    const parkedSummaryByOrderId = useMemo(() => {
        const map = new Map<string, ParkedOrderSummary>();
        (parkedTickets || []).forEach(ticket => {
            const items = Array.isArray(ticket.items) ? ticket.items : [];
            const itemCount = items.reduce((acc, item) => acc + Math.max(0, Number(item.quantity || 0)), 0);
            const calculatedTotal = items.reduce((acc, item) => acc + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
            const hasExplicitTotal = typeof ticket.total === 'number';
            const finalTotal = hasExplicitTotal ? Number(ticket.total) : calculatedTotal;
            map.set(ticket.id, { itemCount, calculatedTotal, finalTotal, hasExplicitTotal });
        });
        return map;
    }, [parkedTickets]);

    const averageTicket = useMemo(() => {
        if (occupiedLikeTables.length === 0) return 0;
        const total = occupiedLikeTables.reduce((acc, table) => {
            const persistedTotal = Number(table.currentOrderTotal || 0);
            const parkedSummary = table.currentOrderId ? parkedSummaryByOrderId.get(table.currentOrderId) : undefined;
            const parkedTotal = parkedSummary
                ? (parkedSummary.hasExplicitTotal
                    ? parkedSummary.finalTotal
                    : (persistedTotal > NO_ORDER_TOTAL_THRESHOLD ? persistedTotal : parkedSummary.calculatedTotal))
                : 0;
            const resolvedTotal = parkedTotal > NO_ORDER_TOTAL_THRESHOLD ? parkedTotal : persistedTotal;
            return acc + resolvedTotal;
        }, 0);
        return total / occupiedLikeTables.length;
    }, [occupiedLikeTables, parkedSummaryByOrderId]);

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
        return serviceTables.map((table, index) => {
            const elapsedMinutes = getElapsedMinutes(table.timeSeated);
            const persistedTotal = Number(table.currentOrderTotal || 0);
            const parkedSummary = table.currentOrderId ? parkedSummaryByOrderId.get(table.currentOrderId) : undefined;
            const parkedItems = parkedSummary?.itemCount || 0;
            const parkedTotal = parkedSummary
                ? (parkedSummary.hasExplicitTotal
                    ? parkedSummary.finalTotal
                    : (persistedTotal > NO_ORDER_TOTAL_THRESHOLD ? persistedTotal : parkedSummary.calculatedTotal))
                : 0;
            const total = parkedTotal > NO_ORDER_TOTAL_THRESHOLD ? parkedTotal : persistedTotal;
            const hasDigitizedItems = total > NO_ORDER_TOTAL_THRESHOLD || parkedItems > 0;
            const smartStatus = getSmartStatus(table, elapsedMinutes, hasDigitizedItems);
            const isOccupiedLike = smartStatus !== 'FREE';
            const isLocked =
                isOccupiedLike &&
                Boolean(bloqueoMeseros) &&
                Boolean(table.waiterId) &&
                table.waiterId !== currentUser.id &&
                !isAdmin;

            const progress = isOccupiedLike ? clamp(elapsedMinutes / Math.max(1, expectedStayMinutes), 0, 1) : 0;
            const serviceStage = getServiceStage(progress);
            const needsRevenueGlow = isOccupiedLike && highRevenueThreshold > 0 && total >= highRevenueThreshold;

            const baseModel: SmartTableModel = {
                table,
                index,
                smartStatus,
                archetype: inferArchetype(table),
                isOccupiedLike,
                isLocked,
                elapsedMinutes,
                elapsedLabel: formatElapsed(elapsedMinutes),
                total,
                hasDigitizedItems,
                progress,
                serviceStage,
                needsRevenueGlow,
                lastOrderHint: ''
            };

            return {
                ...baseModel,
                lastOrderHint: computeLastOrderHint(baseModel)
            };
        });
    }, [serviceTables, bloqueoMeseros, currentUser.id, isAdmin, expectedStayMinutes, highRevenueThreshold, parkedSummaryByOrderId]);

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

    const handleTableAction = useCallback(async (table: Table) => {
        if (table.status === 'OCCUPIED' || table.status === 'RESERVED') {
            onTableClick(table);
            return;
        }

        if (isRestaurantMode) {
            if (onOpenTable) {
                const openedTable = await onOpenTable(table);
                if (openedTable) {
                    onRefreshTables?.();
                    onTableClick(openedTable);
                }
                return;
            }

            try {
                const res = await fetch('/api/mesas/abrir', {
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
                    onTableClick({ ...table, currentOrderId: data.orden_id, status: 'OCCUPIED' });
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
    }, [currentUser.id, currentUser.name, isRestaurantMode, onOpenTable, onRefreshTables, onTableClick]);

    const handleNodeSelect = useCallback(
        (model: SmartTableModel) => {
            if (model.isLocked) {
                alert(`Mesa bloqueada. Atendida por: ${model.table.waiterName || 'otro mesero'}`);
                return;
            }
            handleTableAction(model.table);
        },
        [handleTableAction]
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

    return (
        <LazyMotion features={domAnimation}>
            <div
                ref={mapShellRef}
                className="relative h-full w-full overflow-hidden bg-slate-950 text-slate-100 select-none"
            >
                <div className="absolute inset-0 bg-gradient-to-br from-[#030712] via-[#07122a] to-[#040816]" />

                <div
                    className="absolute inset-0 pointer-events-none opacity-45"
                    style={{
                        backgroundImage: [
                            'linear-gradient(rgba(148,163,184,0.13) 1px, transparent 1px)',
                            'linear-gradient(90deg, rgba(148,163,184,0.13) 1px, transparent 1px)',
                            'radial-gradient(circle at 25% 25%, rgba(56,189,248,0.18), transparent 45%)',
                            'radial-gradient(circle at 85% 12%, rgba(147,51,234,0.12), transparent 42%)'
                        ].join(','),
                        backgroundSize: `${34 * viewport.scale}px ${34 * viewport.scale}px, ${34 * viewport.scale}px ${34 * viewport.scale}px, 100% 100%, 100% 100%`,
                        backgroundPosition: `${viewport.x * 0.06}px ${viewport.y * 0.06}px, ${viewport.x * 0.06}px ${viewport.y * 0.06}px, center, center`
                    }}
                />

                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_18%,rgba(56,189,248,0.22),transparent_48%),radial-gradient(circle_at_82%_78%,rgba(168,85,247,0.16),transparent_42%)]" />

                <aside className="absolute top-6 right-6 z-30 w-[318px] rounded-3xl border border-white/10 bg-white/[0.08] backdrop-blur-xl shadow-[0_26px_70px_rgba(2,6,23,0.65)] overflow-hidden">
                    <div className="p-5 border-b border-white/10 bg-gradient-to-r from-white/[0.06] to-transparent">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.26em] font-black text-sky-200/70">Control de Sala</p>
                                <h3 className="text-lg font-black tracking-tight text-white mt-1">Centro en tiempo real</h3>
                            </div>
                            <div className="flex items-center gap-1 text-emerald-300 text-[11px] font-bold">
                                <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.8)] animate-pulse" />
                                LIVE
                            </div>
                        </div>
                    </div>

                    <div className="p-5 space-y-4">
                        {isRestaurantMode && (
                            <div className="grid grid-cols-2 gap-2.5">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMergePrimaryId(occupiedForTools[0]?.id || '');
                                        setMergeSecondaryId(occupiedForTools.find(t => t.id !== occupiedForTools[0]?.id)?.id || '');
                                        setMergePickOpen(true);
                                    }}
                                    className="rounded-xl bg-slate-500/95 hover:bg-slate-400/95 active:scale-[0.98] text-white text-[11px] font-bold py-3 px-2 border border-white/25 shadow-md flex flex-col items-center justify-center gap-1 min-h-[72px] transition-colors"
                                >
                                    <Link2 size={18} className="opacity-95" />
                                    Unir mesas
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSubtotalPickOpen(true)}
                                    className="rounded-xl bg-slate-500/95 hover:bg-slate-400/95 active:scale-[0.98] text-white text-[11px] font-bold py-3 px-2 border border-white/25 shadow-md flex flex-col items-center justify-center gap-1 min-h-[72px] transition-colors"
                                >
                                    <Sigma size={18} className="opacity-95" />
                                    Subtotal
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMoveFromId(occupiedForTools[0]?.id || '');
                                        setMoveToId(freeForTools[0]?.id || '');
                                        setMovePickOpen(true);
                                    }}
                                    className="rounded-xl bg-slate-500/95 hover:bg-slate-400/95 active:scale-[0.98] text-white text-[11px] font-bold py-3 px-2 border border-white/25 shadow-md flex flex-col items-center justify-center gap-1 min-h-[72px] transition-colors"
                                >
                                    <ArrowRightLeft size={18} className="opacity-95" />
                                    Mover mesa
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setFractionPickOpen(true)}
                                    className="rounded-xl bg-slate-500/95 hover:bg-slate-400/95 active:scale-[0.98] text-white text-[11px] font-bold py-3 px-2 border border-white/25 shadow-md flex flex-col items-center justify-center gap-1 min-h-[72px] transition-colors"
                                >
                                    <PieChart size={18} className="opacity-95" />
                                    Fraccionar
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const withOrders = occupiedForTools.filter(t => t.currentOrderId);
                                        if (withOrders.length === 0) {
                                            alert('No hay mesas ocupadas con cuenta en esta sala.');
                                            return;
                                        }
                                        if (withOrders.length === 1) {
                                            const ticket = parkedTickets?.find(p => p.id === withOrders[0].currentOrderId);
                                            if (ticket?.items?.length) {
                                                setSplitTicketForModal(ticket);
                                            } else {
                                                alert('La cuenta no tiene ítems cargados.');
                                            }
                                            return;
                                        }
                                        setSplitPickOpen(true);
                                    }}
                                    className="rounded-xl bg-slate-500/95 hover:bg-slate-400/95 active:scale-[0.98] text-white text-[11px] font-bold py-3 px-2 border border-white/25 shadow-md flex flex-col items-center justify-center gap-1 min-h-[72px] transition-colors"
                                >
                                    <Scissors size={18} className="opacity-95" />
                                    Dividir cuenta
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onOpenTableLayoutDesigner?.()}
                                    className="rounded-xl bg-slate-500/95 hover:bg-slate-400/95 active:scale-[0.98] text-white text-[11px] font-bold py-3 px-2 border border-white/25 shadow-md flex flex-col items-center justify-center gap-1 min-h-[72px] transition-colors"
                                >
                                    <Pencil size={18} className="opacity-95" />
                                    Editar layout
                                </button>
                            </div>
                        )}

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
                </aside>

                <div className="absolute bottom-6 right-6 z-30 flex flex-col gap-2">
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

                <div className="absolute bottom-7 left-1/2 z-30 -translate-x-1/2 w-[min(92vw,860px)]">
                    <div className="rounded-full border border-white/10 bg-white/[0.08] backdrop-blur-xl px-3 py-2 shadow-[0_16px_50px_rgba(2,6,23,0.5)] flex items-center gap-2 overflow-auto no-scrollbar">
                        {rooms.map(room => {
                            const isActive = room.id === activeRoomId;
                            const roomOccupied = safeTables.filter(table => table.roomId === room.id && table.status === 'OCCUPIED').length;

                            return (
                                <button
                                    key={room.id}
                                    onClick={() => setActiveRoomId(room.id)}
                                    className={`shrink-0 px-5 py-2 rounded-full border transition-all duration-200 text-sm font-bold flex items-center gap-2 ${
                                        isActive
                                            ? 'border-sky-300/60 bg-sky-400/20 text-sky-100 shadow-[0_0_24px_rgba(56,189,248,0.28)]'
                                            : 'border-white/10 bg-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.09]'
                                    }`}
                                >
                                    <LayoutGrid size={14} />
                                    {room.name || room.nombre}
                                    {roomOccupied > 0 && (
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/70 text-white">{roomOccupied}</span>
                                    )}
                                </button>
                            );
                        })}
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
                                className="relative rounded-[2.2rem] border border-white/10 bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(2,6,23,0.6),0_30px_80px_rgba(2,6,23,0.65)] overflow-hidden"
                                style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
                            >
                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_14%,rgba(56,189,248,0.18),transparent_46%),radial-gradient(circle_at_77%_76%,rgba(250,204,21,0.12),transparent_42%)]" />

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
                                <p><span className="text-slate-400">Total:</span> {currencySymbol}{tooltip.model.total.toLocaleString()}</p>
                                <p><span className="text-slate-400">Tiempo:</span> {tooltip.model.elapsedLabel}</p>
                            </div>
                        </m.div>
                    )}
                </AnimatePresence>

                {selectedTable && (
                    <TableOptionsModal
                        table={selectedTable}
                        room={activeRoom}
                        allTables={safeTables}
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
                                setSplitTicketForModal(ticket);
                                setSelectedTable(null);
                            } else {
                                alert('Sin cuenta activa para dividir pago.');
                            }
                        }}
                        onMoveTable={async (targetTableId) => {
                            try {
                                const res = await fetch('/api/mesas/mover', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ fromTableId: selectedTable.id, toTableId: targetTableId })
                                });
                                const data = await res.json();
                                if (data.success) {
                                    onRefreshTables?.();
                                    alert('Mesa movida correctamente');
                                    setSelectedTable(null);
                                } else {
                                    alert('Error moviendo mesa: ' + data.message);
                                }
                            } catch (error) {
                                console.error(error);
                                alert('Error de conexion');
                            }
                        }}
                        onMergeTables={async (targetTableIds) => {
                            try {
                                const res = await fetch('/api/mesas/unir', {
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
                                const res = await fetch('/api/mesas/liberar', {
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

                {isRestaurantMode && splitTicketForModal && (
                    <SplitTicketModal
                        originalItems={ensureCartIds(splitTicketForModal.items)}
                        currencySymbol={currencySymbol}
                        onClose={() => setSplitTicketForModal(null)}
                        onConfirm={(remainingItems, newTicketItems) => {
                            if (onParkedOrderSplitResult) {
                                void onParkedOrderSplitResult(splitTicketForModal.id, remainingItems, newTicketItems);
                            } else {
                                alert('No se pudo guardar la división: falta el manejador en la aplicación.');
                            }
                            setSplitTicketForModal(null);
                        }}
                    />
                )}

                {isRestaurantMode && mergePickOpen && (
                    <div
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
                        onClick={() => setMergePickOpen(false)}
                    >
                        <div
                            className="bg-slate-900 border border-white/15 rounded-2xl p-6 max-w-md w-full shadow-2xl"
                            onClick={e => e.stopPropagation()}
                        >
                            <h3 className="text-lg font-black text-white mb-1">Unir mesas</h3>
                            <p className="text-xs text-slate-400 mb-4">Seleccione dos cuentas ocupadas en esta sala.</p>
                            <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Mesa principal</label>
                            <select
                                value={mergePrimaryId}
                                onChange={e => setMergePrimaryId(e.target.value)}
                                className="w-full mb-3 bg-slate-800 text-white rounded-lg p-2.5 border border-white/10"
                            >
                                <option value="">—</option>
                                {occupiedForTools.map(t => (
                                    <option key={t.id} value={t.id}>
                                        {t.nombre || t.name}
                                    </option>
                                ))}
                            </select>
                            <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Mesa a unir</label>
                            <select
                                value={mergeSecondaryId}
                                onChange={e => setMergeSecondaryId(e.target.value)}
                                className="w-full mb-4 bg-slate-800 text-white rounded-lg p-2.5 border border-white/10"
                            >
                                <option value="">—</option>
                                {occupiedForTools
                                    .filter(t => t.id !== mergePrimaryId)
                                    .map(t => (
                                        <option key={t.id} value={t.id}>
                                            {t.nombre || t.name}
                                        </option>
                                    ))}
                            </select>
                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setMergePickOpen(false)}
                                    className="px-4 py-2 rounded-xl text-slate-300 hover:bg-white/10"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        if (!mergePrimaryId || !mergeSecondaryId || mergePrimaryId === mergeSecondaryId) {
                                            alert('Seleccione dos mesas distintas.');
                                            return;
                                        }
                                        try {
                                            const res = await fetch('/api/mesas/unir', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                    mainTableId: mergePrimaryId,
                                                    secondaryTableIds: [mergeSecondaryId]
                                                })
                                            });
                                            const data = await res.json().catch(() => ({}));
                                            if (res.ok && data.success !== false) {
                                                onRefreshTables?.();
                                                setMergePickOpen(false);
                                                alert(typeof data.message === 'string' ? data.message : 'Mesas unidas.');
                                            } else {
                                                alert(data?.message || 'No se pudo unir.');
                                            }
                                        } catch (e) {
                                            console.error(e);
                                            alert('Error de conexión.');
                                        }
                                    }}
                                    className="px-4 py-2 rounded-xl bg-sky-600 text-white font-bold hover:bg-sky-500"
                                >
                                    Unir
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {isRestaurantMode && movePickOpen && (
                    <div
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
                        onClick={() => setMovePickOpen(false)}
                    >
                        <div
                            className="bg-slate-900 border border-white/15 rounded-2xl p-6 max-w-md w-full shadow-2xl"
                            onClick={e => e.stopPropagation()}
                        >
                            <h3 className="text-lg font-black text-white mb-1">Mover pedido</h3>
                            <p className="text-xs text-slate-400 mb-4">De una mesa ocupada hacia una libre.</p>
                            <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Origen (ocupada)</label>
                            <select
                                value={moveFromId}
                                onChange={e => setMoveFromId(e.target.value)}
                                className="w-full mb-3 bg-slate-800 text-white rounded-lg p-2.5 border border-white/10"
                            >
                                <option value="">—</option>
                                {occupiedForTools.map(t => (
                                    <option key={t.id} value={t.id}>
                                        {t.nombre || t.name}
                                    </option>
                                ))}
                            </select>
                            <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Destino (libre)</label>
                            <select
                                value={moveToId}
                                onChange={e => setMoveToId(e.target.value)}
                                className="w-full mb-4 bg-slate-800 text-white rounded-lg p-2.5 border border-white/10"
                            >
                                <option value="">—</option>
                                {freeForTools.map(t => (
                                    <option key={t.id} value={t.id}>
                                        {t.nombre || t.name}
                                    </option>
                                ))}
                            </select>
                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setMovePickOpen(false)}
                                    className="px-4 py-2 rounded-xl text-slate-300 hover:bg-white/10"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        if (!moveFromId || !moveToId) {
                                            alert('Seleccione origen y destino.');
                                            return;
                                        }
                                        try {
                                            const res = await fetch('/api/mesas/mover', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ fromTableId: moveFromId, toTableId: moveToId })
                                            });
                                            const data = await res.json();
                                            if (data.success) {
                                                onRefreshTables?.();
                                                setMovePickOpen(false);
                                                alert('Mesa movida correctamente');
                                            } else {
                                                alert('Error: ' + (data.message || 'No se pudo mover'));
                                            }
                                        } catch (error) {
                                            console.error(error);
                                            alert('Error de conexión');
                                        }
                                    }}
                                    className="px-4 py-2 rounded-xl bg-sky-600 text-white font-bold hover:bg-sky-500"
                                >
                                    Mover
                                </button>
                            </div>
                        </div>
                    </div>
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
                                            {t.nombre || t.name}
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
                                                {t.nombre || t.name}
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
                                                if (onPrintPrecheck) onPrintPrecheck(t);
                                            }}
                                            className="w-full text-left px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold border border-white/10"
                                        >
                                            Pre-cuenta — {t.nombre || t.name}
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
            </div>
        </LazyMotion>
    );
};

const SmartTableNode = React.memo(({
    model,
    currencySymbol,
    reduceMotion,
    onSelect,
    onTooltipOpen,
    onTooltipMove,
    onTooltipClose
}: {
    model: SmartTableModel;
    currencySymbol: string;
    reduceMotion: boolean;
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
            : model.archetype === 'BOOTH'
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
            className={`absolute isolate overflow-hidden border text-left transition-[box-shadow,border-color,background-color] duration-300 ${shapeClass} ${statusPalette[model.smartStatus].shell}`}
            style={{
                left: model.table.posX,
                top: model.table.posY,
                width: model.table.width,
                height: model.table.height,
                transform: `rotate(${model.table.rotation || 0}deg)`,
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

            <div className="absolute inset-0 p-2 flex flex-col justify-between">
                {isFree ? (
                    <>
                        <div className="flex items-center justify-between">
                            <span className="h-2 w-2 rounded-full bg-emerald-300/85" />
                            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full border border-emerald-300/30 bg-emerald-400/10">
                                <Check size={10} className="text-emerald-200" />
                            </span>
                        </div>

                        <div className="text-center leading-none">
                            <p className="text-base font-black tracking-tight truncate">
                                {model.table.nombre || model.table.name}
                            </p>
                            <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-200">
                                <Check size={10} />
                                Disponible
                            </div>
                        </div>

                        <div className="flex justify-center">
                            <span className="text-[10px] text-emerald-100/80 font-semibold">Mesa lista</span>
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
                                <span className="absolute inset-0 flex items-center justify-center text-[10px]">{model.serviceStage.icon}</span>
                            </div>
                        </div>

                        <div className="text-center leading-none">
                            <p className="text-base font-black tracking-tight drop-shadow-[0_2px_6px_rgba(2,6,23,0.5)] truncate">
                                {model.table.nombre || model.table.name}
                            </p>
                            <div className={`mt-1 inline-flex items-center gap-1 text-[11px] font-bold ${statusPalette[model.smartStatus].badge}`}>
                                {statusPalette[model.smartStatus].icon}
                                {statusPalette[model.smartStatus].label}
                            </div>
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
