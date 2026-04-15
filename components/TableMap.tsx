import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Room, Table, User as UserType, ParkedTicket } from '../types';
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
    GitMerge,
    Divide,
    Move,
    FileText,
    Percent,
    TrendingUp,
    Search,
    ChevronRight,
    Map as MapIcon,
    Circle,
    Square as SquareIcon,
    Layout as LayoutIcon,
    Users
} from 'lucide-react';
import { LazyMotion, domAnimation, m, AnimatePresence, useReducedMotion } from 'framer-motion';
import TableOptionsModal from './TableOptionsModal';

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

const CANVAS_WIDTH = 1400;
const CANVAS_HEIGHT = 1000;
const SCALE_MIN = 0.45;
const SCALE_MAX = 2.5;
const DEFAULT_EXPECTED_STAY = 70;
const NO_ORDER_TOTAL_THRESHOLD = 0.01;
const EMPTY_TABLE_ALERT_AFTER_SECONDS = 18;

const TABLE_ENTRY_VARIANTS = {
    hidden: {
        opacity: 0,
        scale: 0.85,
        y: 10
    },
    visible: (index: number) => ({
        opacity: 1,
        scale: 1,
        y: 0,
        transition: {
            duration: 0.35,
            delay: Math.min(index * 0.012, 0.4),
            ease: [0.23, 1, 0.32, 1]
        }
    })
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

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

const statusConfig: Record<SmartStatus, {
    border: string;
    bg: string;
    glow: string;
    text: string;
    label: string;
    badgeBg: string;
    icon: React.ReactNode;
}> = {
    FREE: {
        border: 'border-emerald-500/60',
        bg: 'bg-emerald-500/10',
        glow: 'shadow-[0_0_15px_rgba(16,185,129,0.2)]',
        text: 'text-emerald-400',
        label: 'Disponible',
        badgeBg: 'bg-emerald-500/20',
        icon: <Check size={14} className="text-emerald-400" />
    },
    ATTENTION: {
        border: 'border-amber-400/80',
        bg: 'bg-amber-400/15',
        glow: 'shadow-[0_0_20px_rgba(251,191,36,0.3)]',
        text: 'text-amber-300',
        label: 'Atención requerida',
        badgeBg: 'bg-amber-400/20',
        icon: <AlertTriangle size={14} className="text-amber-300" />
    },
    OCCUPIED: {
        border: 'border-rose-500/80',
        bg: 'bg-rose-500/15',
        glow: 'shadow-[0_0_20px_rgba(244,63,94,0.3)]',
        text: 'text-rose-400',
        label: 'Ocupada',
        badgeBg: 'bg-rose-500/20',
        icon: <Users size={14} className="text-rose-400" />
    },
    CHECK_REQUESTED: {
        border: 'border-cyan-400/80',
        bg: 'bg-cyan-400/15',
        glow: 'shadow-[0_0_20px_rgba(34,211,238,0.3)]',
        text: 'text-cyan-300',
        label: 'Cuenta solicitada',
        badgeBg: 'bg-cyan-400/20',
        icon: <ReceiptText size={14} className="text-cyan-300" />
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
    onPrintPrecheck
}) => {
    const [activeRoomId, setActiveRoomId] = useState<string>(initialRoomId || rooms[0]?.id || '');
    const [selectedTable, setSelectedTable] = useState<Table | null>(null);
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);
    const [viewport, setViewport] = useState({ scale: 0.85, x: 0, y: 0 });
    const [isFullscreen, setIsFullscreen] = useState(false);
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
        setViewport({ scale: 0.8, x: 0, y: 0 });
    }, [activeRoomId]);

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

    const obstacleTables = useMemo(
        () => roomTables.filter(table => table.shape === 'OBSTACLE'),
        [roomTables]
    );

    const serviceTables = useMemo(
        () => roomTables.filter(table => table.shape !== 'OBSTACLE'),
        [roomTables]
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
                className="relative h-full w-full overflow-hidden bg-[#0a0f1d] text-slate-100 select-none font-sans"
            >
                {/* Background Grid */}
                <div 
                    className="absolute inset-0 pointer-events-none opacity-20"
                    style={{
                        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0)',
                        backgroundSize: '32px 32px'
                    }}
                />

                {/* Compact Room Selector */}
                <div className="absolute top-0 inset-x-0 min-h-12 z-40 bg-[#0f172a]/70 backdrop-blur-md border-b border-white/5 px-6 py-2.5">
                    <nav className="flex items-center gap-2 overflow-x-auto no-scrollbar">
                        {rooms.map(room => {
                            const isActive = room.id === activeRoomId;
                            return (
                                <button
                                    key={room.id}
                                    onClick={() => setActiveRoomId(room.id)}
                                    className={`px-4 h-9 rounded-lg text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                                        isActive
                                            ? 'text-sky-400 bg-sky-500/10 border border-sky-500/20 shadow-[0_0_20px_rgba(14,165,233,0.08)]'
                                            : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                                    }`}
                                >
                                    <LayoutIcon size={14} className={isActive ? 'text-sky-400' : 'text-slate-500'} />
                                    {room.name || room.nombre}
                                    {isActive && <div className="ml-1 w-1 h-1 rounded-full bg-sky-400" />}
                                </button>
                            );
                        })}
                    </nav>
                </div>

                <div className="flex h-full pt-14">
                    {/* Main Canvas Area */}
                    <main 
                        className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing"
                        ref={viewportRef}
                        onWheel={handleWheel}
                        onPointerDown={handleViewportPointerDown}
                        onPointerMove={handleViewportPointerMove}
                        onPointerUp={handleViewportPointerEnd}
                        onPointerCancel={handleViewportPointerEnd}
                    >
                        <div 
                            className="absolute will-change-transform"
                            style={{
                                transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`,
                                transformOrigin: '0 0',
                                left: '50%',
                                top: '50%',
                                marginTop: -(CANVAS_HEIGHT / 2) * viewport.scale,
                                marginLeft: -(CANVAS_WIDTH / 2) * viewport.scale
                            }}
                        >
                            <div 
                                className="relative rounded-[3rem] border border-white/5 bg-[#0f172a]/40 shadow-2xl"
                                style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
                            >
                                {/* Canvas Decorative Elements */}
                                <div className="absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none">
                                    <div className="absolute top-0 left-0 w-64 h-64 bg-sky-500/5 blur-[100px]" />
                                    <div className="absolute bottom-0 right-0 w-64 h-64 bg-rose-500/5 blur-[100px]" />
                                </div>

                                {obstacleTables.map(obstacle => (
                                    <div
                                        key={obstacle.id}
                                        className="absolute bg-[#1e293b]/50 border border-slate-700/50 rounded-xl"
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

                        {/* Zoom Controls */}
                        <div className="absolute bottom-10 right-10 flex flex-col gap-2 z-30">
                            <ControlBtn onClick={() => handleZoom(0.15)}><Plus size={20} /></ControlBtn>
                            <ControlBtn onClick={() => handleZoom(-0.15)}><Minus size={20} /></ControlBtn>
                            <div className="h-2" />
                            <ControlBtn onClick={() => setViewport({ scale: 0.85, x: 0, y: 0 })}><Search size={20} /></ControlBtn>
                        </div>
                    </main>

                    {/* Dashboard Sidebar */}
                    <aside className="w-[380px] h-full bg-[#0f172a]/60 backdrop-blur-xl border-l border-white/5 overflow-y-auto no-scrollbar pb-10">
                        <div className="p-8 space-y-8">
                            {/* Control Panel Section */}
                            <section>
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-xs uppercase tracking-[0.25em] font-black text-slate-500">Control de Sala</h3>
                                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                        <span className="text-[10px] font-black text-emerald-500 uppercase">Live</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-3">
                                    <ActionBtn icon={<GitMerge size={20} />} label="Unir Mesas" />
                                    <ActionBtn icon={<Divide size={20} />} label="Dividir Cuenta" />
                                    <ActionBtn icon={<Move size={20} />} label="Mover Mesa" />
                                    <ActionBtn icon={<LayoutIcon size={20} />} label="Editar Layout" />
                                    <ActionBtn icon={<FileText size={20} />} label="SubTotal" />
                                    <ActionBtn icon={<Percent size={20} />} label="Fraccionar" />
                                </div>
                            </section>

                            <div className="h-[1px] bg-white/5" />

                            {/* Gauges Section */}
                            <section className="grid grid-cols-2 gap-4">
                                <GaugeCard 
                                    label="Ocupación" 
                                    current={stats.occupied} 
                                    total={stats.total} 
                                    color="text-rose-500" 
                                    bg="bg-rose-500/10"
                                    percentage={Math.round((stats.occupied / (stats.total || 1)) * 100)}
                                />
                                <GaugeCard 
                                    label="Alertas" 
                                    current={stats.attention + stats.checkRequested} 
                                    total={stats.total} 
                                    color="text-amber-400" 
                                    bg="bg-amber-400/10"
                                    percentage={Math.round(((stats.attention + stats.checkRequested) / (stats.total || 1)) * 100)}
                                />
                            </section>

                            {/* Metrics Section */}
                            <section className="space-y-4">
                                <MetricSection 
                                    title="Ticket Promedio" 
                                    value={`${currencySymbol}${stats.averageTicket.toLocaleString()}`} 
                                    trend="+5.2%"
                                    sparkline
                                    subtitle={`Meta: ${currencySymbol}${minExpectedTicket}`}
                                />
                                <MetricSection 
                                    title="Eficiencia de Rotación" 
                                    value={`${stats.rotationEfficiency}%`} 
                                    subtitle={`Objetivo: ${expectedStayMinutes}m`}
                                />
                                
                                <div className="pt-4">
                                    <div className="rounded-[2rem] bg-gradient-to-br from-sky-600 to-indigo-700 p-6 shadow-xl shadow-sky-900/20">
                                        <p className="text-xs uppercase tracking-widest font-bold text-sky-100/70 mb-1">Total Sala</p>
                                        <div className="flex items-end justify-between">
                                            <h4 className="text-3xl font-black text-white">{currencySymbol}{stats.amount.toLocaleString()}</h4>
                                            <div className="text-right">
                                                <p className="text-xs font-bold text-sky-100/90">{stats.total} Mesas</p>
                                                <p className="text-[10px] text-sky-200/60 uppercase">9 activas</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        </div>
                    </aside>
                </div>

                {/* Tooltip rendering */}
                <AnimatePresence>
                    {tooltip && tooltipPosition && (
                        <m.div
                            key={tooltip.model.table.id}
                            initial={{ opacity: 0, scale: 0.9, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 10 }}
                            className="absolute z-[100] w-64 rounded-2xl border border-white/10 bg-[#1e293b]/90 backdrop-blur-xl p-4 shadow-2xl pointer-events-none"
                            style={{ left: tooltipPosition.x, top: tooltipPosition.y }}
                        >
                            <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-3">
                                <p className="font-black text-white">{tooltip.model.table.nombre || tooltip.model.table.name}</p>
                                <div className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${statusConfig[tooltip.model.smartStatus].badgeBg} ${statusConfig[tooltip.model.smartStatus].text}`}>
                                    {statusConfig[tooltip.model.smartStatus].label}
                                </div>
                            </div>
                            <div className="space-y-2 text-xs">
                                <InfoRow label="Mesero" value={tooltip.model.table.waiterName || 'Sin asignar'} />
                                <InfoRow label="Total" value={`${currencySymbol}${tooltip.model.total.toLocaleString()}`} />
                                <InfoRow label="Tiempo" value={tooltip.model.elapsedLabel} />
                                <InfoRow label="Servicio" value={tooltip.model.serviceStage.label} />
                            </div>
                        </m.div>
                    )}
                </AnimatePresence>

                {/* Table Options Modal */}
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
                                    setSelectedTable(null);
                                } else { alert('Error: ' + data.message); }
                            } catch (e) { console.error(e); }
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
                                } else { alert('Error: ' + data.message); }
                            } catch (e) { console.error(e); }
                        }}
                    />
                )}
            </div>
        </LazyMotion>
    );
};

/* --- Sub-Components --- */

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
    const config = statusConfig[model.smartStatus];
    const isOccupied = model.smartStatus !== 'FREE';

    return (
        <m.button
            data-table-node="true"
            type="button"
            custom={model.index}
            variants={TABLE_ENTRY_VARIANTS}
            initial="hidden"
            animate="visible"
            whileHover={{ scale: 1.05, y: -4 }}
            onClick={() => onSelect(model)}
            onMouseEnter={(e) => onTooltipOpen(model, e.clientX, e.clientY)}
            onMouseMove={(e) => onTooltipMove(model.table.id, e.clientX, e.clientY)}
            onMouseLeave={() => onTooltipClose(model.table.id)}
            className={`absolute group isolate transition-all duration-500 overflow-visible ${model.archetype === 'CIRCLE' ? 'rounded-full' : 'rounded-[2rem]'} border-2 ${config.border} ${config.bg} ${config.glow}`}
            style={{
                left: model.table.posX,
                top: model.table.posY,
                width: model.table.width,
                height: model.table.height,
                transform: `rotate(${model.table.rotation || 0}deg)`,
            }}
        >
            {/* Table Name Badge */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-slate-900 border border-white/10 shadow-xl z-20 transition-transform group-hover:scale-110">
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                    {config.icon}
                    <span className="text-[11px] font-black text-white uppercase tracking-tighter">
                        {model.table.nombre || model.table.name}
                    </span>
                </div>
            </div>

            {/* Capacity Indicators (Chairs) */}
            <Chairs archetype={model.archetype} capacity={model.table.capacity || 4} color={config.text} bg={config.badgeBg} />

            {/* Inner Content */}
            <div className="flex flex-col items-center justify-center h-full p-4 gap-1">
                <p className={`text-[10px] font-black uppercase tracking-widest ${config.text} opacity-80`}>
                    {config.label}
                </p>
                
                {isOccupied && (
                    <div className="mt-2 flex flex-col items-center">
                        <div className="flex items-center gap-2 text-white drop-shadow-md">
                            <Clock size={12} className="opacity-60" />
                            <span className="text-sm font-black">{model.elapsedLabel}</span>
                        </div>
                        <p className="text-[14px] font-black text-white mt-1">
                            {currencySymbol}{model.total.toLocaleString()}
                        </p>
                        
                        {/* Progress ring/mini-indicator removed for design fidelity, using clean text instead */}
                    </div>
                )}
            </div>

            {/* Lock Overlay */}
            {model.isLocked && (
                <div className="absolute inset-0 rounded-[inherit] bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center z-10">
                    <Lock size={24} className="text-white drop-shadow-xl" />
                </div>
            )}
        </m.button>
    );
});

const Chairs = ({ archetype, capacity, color, bg }: { archetype: string, capacity: number, color: string, bg: string }) => {
    // Simplified chair visualization based on archetype
    if (archetype === 'CIRCLE') {
        return (
            <div className="absolute inset-0 pointer-events-none overflow-visible">
                {[...Array(Math.min(capacity, 8))].map((_, i) => (
                    <div 
                        key={i}
                        className={`absolute w-3 h-3 rounded-full border border-white/20 ${bg} shadow-sm`}
                        style={{
                            left: '50%',
                            top: '50%',
                            transform: `translate(-50%, -50%) rotate(${(360/Math.min(capacity, 8)) * i}deg) translateY(-540%)`
                        }}
                    />
                ))}
            </div>
        );
    }
    
    return (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-between px-[-4px]">
             <div className="flex flex-col gap-2 -ml-2">
                 <div className={`w-2 h-4 rounded-full ${bg} border border-white/10`} />
                 <div className={`w-2 h-4 rounded-full ${bg} border border-white/10`} />
             </div>
             <div className="flex flex-col gap-2 -mr-2">
                 <div className={`w-2 h-4 rounded-full ${bg} border border-white/10`} />
                 <div className={`w-2 h-4 rounded-full ${bg} border border-white/10`} />
             </div>
        </div>
    );
};

const ActionBtn = ({ icon, label }: { icon: React.ReactNode, label: string }) => (
    <button className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.08] hover:border-white/10 transition-all group">
        <div className="text-slate-400 group-hover:text-sky-400 transition-colors">
            {icon}
        </div>
        <span className="text-[10px] font-bold text-slate-500 group-hover:text-slate-200 text-center leading-tight">
            {label}
        </span>
    </button>
);

const GaugeCard = ({ label, current, total, color, bg, percentage }: any) => (
    <div className="p-5 rounded-3xl bg-white/[0.03] border border-white/5 relative overflow-hidden group">
        <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest font-black text-slate-500 mb-2">{label}</span>
            <div className="flex items-end gap-2">
                <span className="text-2xl font-black text-white leading-none">{current}</span>
                <span className="text-sm font-bold text-slate-600 leading-none mb-1">/ {total}</span>
            </div>
        </div>
        
        {/* Simple Progress Bar */}
        <div className="mt-4 h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <m.div 
                initial={{ width: 0 }}
                animate={{ width: `${percentage}%` }}
                className={`h-full rounded-full ${color.replace('text', 'bg')}`}
            />
        </div>
        
        <div className={`absolute top-0 right-0 w-24 h-24 ${bg} rounded-full -mr-12 -mt-12 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity`} />
    </div>
);

const MetricSection = ({ title, value, trend, subtitle, sparkline }: any) => (
    <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-all">
        <div className="flex items-start justify-between mb-4">
            <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-1">{title}</p>
                <div className="flex items-center gap-3">
                    <h4 className="text-2xl font-black text-white">{value}</h4>
                    {trend && (
                        <div className="flex items-center gap-1 text-[10px] font-black text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">
                            <TrendingUp size={10} />
                            {trend}
                        </div>
                    )}
                </div>
            </div>
            {sparkline && (
                 <div className="w-16 h-8 flex items-end gap-0.5">
                    {[10, 15, 8, 20, 12, 18, 25].map((h, i) => (
                        <div key={i} className="flex-1 bg-sky-500/40 rounded-t-sm" style={{ height: `${h}%` }} />
                    ))}
                 </div>
            )}
        </div>
        <p className="text-[11px] font-medium text-slate-500">{subtitle}</p>
    </div>
);

const ControlBtn = ({ children, onClick }: any) => (
    <button 
        onClick={onClick}
        className="w-12 h-12 rounded-2xl bg-[#1e293b]/80 backdrop-blur-md border border-white/10 shadow-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-700/80 transition-all active:scale-90"
    >
        {children}
    </button>
);

const InfoRow = ({ label, value }: { label: string, value: string }) => (
    <div className="flex items-center justify-between">
        <span className="text-slate-500 font-medium uppercase tracking-tighter text-[10px]">{label}</span>
        <span className="text-slate-200 font-bold">{value}</span>
    </div>
);

export default TableMap;
