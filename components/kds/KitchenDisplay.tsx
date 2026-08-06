import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
    Users,
    ChefHat,
    LayoutGrid,
    ListOrdered,
    CheckCircle2,
    Timer,
    Copy,
    Monitor,
    Wifi,
    WifiOff,
    RefreshCw
} from 'lucide-react';
import { formatKdsIdentityLabel } from '../../utils/kdsPresentation';

interface KDSItem {
    id: string;
    producto_id: string;
    nombre: string;
    cantidad: number;
    modificadores: string[] | null;
    estado_cocina: 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO' | 'DEVUELTO';
    hora_inicio_preparacion: string | null;
}

interface KDSOrder {
    id: string;
    displayId?: string;
    orderNumber?: string;
    date: string;
    userName: string;
    customerId: string;
    customerName: string;
    sourceTerminal?: {
        id?: string;
        code?: string;
        name?: string;
    } | null;
    table?: {
        id?: string;
        name?: string;
        nombre?: string;
        displayLabel?: string | null;
        roomId?: string | null;
        roomName?: string | null;
        guests?: number | null;
    } | null;
    area?: {
        id?: string;
        name?: string;
        nombre?: string;
        warningMinutes?: number;
        criticalMinutes?: number;
    } | null;
    kdsTiming?: {
        warningMinutes?: number;
        criticalMinutes?: number;
    } | null;
    items: KDSItem[];
}

interface KDSNetworkInfo {
    host: string | null;
    port: string;
    url: string | null;
    ips: string[];
    source: 'native' | 'browser' | 'unavailable';
    serverRunning: boolean;
    message?: string;
}

const DEFAULT_KDS_PORT = '8001';
const DEFAULT_WARNING_MINUTES = 10;
const DEFAULT_CRITICAL_MINUTES = 20;
const KDS_REQUEST_TIMEOUT_MS = 4500;
const KDS_NETWORK_WATCHDOG_MS = 15000;

const fetchWithTimeout = async (url: string, options?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), KDS_REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, {
            ...options,
            cache: 'no-store',
            signal: controller.signal
        });
    } finally {
        window.clearTimeout(timeout);
    }
};

const getOrderSignature = (order: KDSOrder): string => {
    const itemSignature = (order.items || [])
        .map(item => `${item.id}:${item.cantidad}:${item.estado_cocina}`)
        .join('|');
    return `${order.id}:${itemSignature}`;
};

const normalizeIp = (value: unknown): string | null => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;

    const withoutProtocol = trimmed.replace(/^https?:\/\//i, '').split('/')[0];
    const host = withoutProtocol.includes(':') ? withoutProtocol.split(':')[0] : withoutProtocol;

    if (!host || host === '0.0.0.0' || host === '127.0.0.1' || host.toLowerCase() === 'localhost') {
        return null;
    }

    return host;
};

const resolveKdsPort = (): string => {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const paramPort = params.get('kdsPort');
        const storedPort = window.localStorage.getItem('CLIC_POS_KDS_PORT') || window.localStorage.getItem('KDS_PORT');
        const candidate = String(paramPort || storedPort || DEFAULT_KDS_PORT).trim();
        return /^\d{2,5}$/.test(candidate) ? candidate : DEFAULT_KDS_PORT;
    } catch {
        return DEFAULT_KDS_PORT;
    }
};

const resolveKdsLocalBaseUrl = (): string => `http://localhost:${resolveKdsPort()}`;

const resolveKitchenTerminalIdentity = () => {
    try {
        const params = new URLSearchParams(window.location.search);
        const name = params.get('terminalName')
            || window.localStorage.getItem('CLIC_POS_TERMINAL_NAME')
            || window.localStorage.getItem('clic_erp_sync_terminal_name')
            || window.localStorage.getItem('terminalName')
            || window.localStorage.getItem('kdsTerminalName')
            || '';
        const id = params.get('terminalId')
            || window.localStorage.getItem('CLIC_POS_TERMINAL_ID')
            || window.localStorage.getItem('terminalId')
            || window.localStorage.getItem('kdsTerminalId')
            || '';
        const explicitCode = params.get('terminalCode')
            || window.localStorage.getItem('CLIC_POS_TERMINAL_CODE')
            || window.localStorage.getItem('terminalCode')
            || window.localStorage.getItem('kdsTerminalCode')
            || '';
        const technicalId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) || id.length > 18;
        return {
            name: name.trim() || 'Terminal cocina',
            id: id.trim(),
            code: explicitCode.trim() || (technicalId ? '' : id.trim())
        };
    } catch {
        return { name: 'Terminal cocina', id: '', code: '' };
    }
};

const resolveKdsNetworkInfo = async (): Promise<KDSNetworkInfo> => {
    const port = resolveKdsPort();
    const runtimeWindow = window as any;

    try {
        if (typeof runtimeWindow.ClicPOSNativePrinter?.getDeviceInfo === 'function') {
            const serverStatus = typeof runtimeWindow.ClicPOSNativePrinter?.startKdsServer === 'function'
                ? await runtimeWindow.ClicPOSNativePrinter.startKdsServer({ port: Number(port) })
                : null;
            const deviceInfo = await runtimeWindow.ClicPOSNativePrinter.getDeviceInfo();
            const ips = Array.from(new Set([
                normalizeIp(serverStatus?.localIp),
                normalizeIp(deviceInfo?.localIp),
                ...((Array.isArray(serverStatus?.localIps) ? serverStatus.localIps : []).map(normalizeIp)),
                ...((Array.isArray(deviceInfo?.localIps) ? deviceInfo.localIps : []).map(normalizeIp))
            ].filter(Boolean) as string[]));
            const host = ips[0] || null;
            const activePort = String(serverStatus?.port || port);
            const serverRunning = Boolean(serverStatus?.running || serverStatus?.success);
            return {
                host,
                port: activePort,
                url: host ? `http://${host}:${activePort}` : null,
                ips,
                source: host ? 'native' : 'unavailable',
                serverRunning,
                message: serverStatus?.message
            };
        }
    } catch (error) {
        console.warn('[KDS] No se pudo leer la IP local del dispositivo:', error);
    }

    const browserHost = normalizeIp(window.location.hostname);
    return {
        host: browserHost,
        port,
        url: browserHost ? `http://${browserHost}:${port}` : null,
        ips: browserHost ? [browserHost] : [],
        source: browserHost ? 'browser' : 'unavailable',
        serverRunning: Boolean(browserHost)
    };
};

const KitchenDisplay: React.FC = () => {
    const [orders, setOrders] = useState<KDSOrder[]>([]);
    const [showSummary, setShowSummary] = useState(false);
    const [loading, setLoading] = useState(true);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [networkInfo, setNetworkInfo] = useState<KDSNetworkInfo>({
        host: null,
        port: DEFAULT_KDS_PORT,
        url: null,
        ips: [],
        source: 'unavailable',
        serverRunning: false
    });
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
    const [connectionState, setConnectionState] = useState<'connecting' | 'online' | 'offline'>('connecting');
    const [connectionMessage, setConnectionMessage] = useState('Iniciando servicio de cocina...');
    const terminalIdentity = useMemo(() => resolveKitchenTerminalIdentity(), []);
    const audioContextRef = useRef<AudioContext | null>(null);
    const networkInfoRef = useRef(networkInfo);
    const knownOrderSignaturesRef = useRef<Set<string>>(new Set());
    const didPrimeOrdersRef = useRef(false);
    const fetchInFlightRef = useRef(false);
    const reconnectInFlightRef = useRef(false);

    const ensureAudioContext = useCallback(() => {
        const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextCtor) return null;
        if (!audioContextRef.current) {
            audioContextRef.current = new AudioContextCtor();
        }
        if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume().catch(() => undefined);
        }
        return audioContextRef.current;
    }, []);

    const playKitchenAlert = useCallback(() => {
        try {
            const context = ensureAudioContext();
            if (!context) {
                navigator.vibrate?.([180, 80, 180]);
                return;
            }
            const now = context.currentTime;
            [0, 0.18, 0.36].forEach((offset) => {
                const oscillator = context.createOscillator();
                const gain = context.createGain();
                oscillator.type = 'square';
                oscillator.frequency.setValueAtTime(880, now + offset);
                gain.gain.setValueAtTime(0.0001, now + offset);
                gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.12);
                oscillator.connect(gain);
                gain.connect(context.destination);
                oscillator.start(now + offset);
                oscillator.stop(now + offset + 0.13);
            });
            navigator.vibrate?.([120, 60, 120]);
        } catch (error) {
            console.warn('[KDS] No se pudo reproducir alerta sonora:', error);
            navigator.vibrate?.([180, 80, 180]);
        }
    }, [ensureAudioContext]);

    useEffect(() => {
        const interval = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const unlockAudio = () => {
            ensureAudioContext();
        };
        window.addEventListener('pointerdown', unlockAudio, { once: true });
        window.addEventListener('keydown', unlockAudio, { once: true });
        return () => {
            window.removeEventListener('pointerdown', unlockAudio);
            window.removeEventListener('keydown', unlockAudio);
        };
    }, [ensureAudioContext]);

    const fetchOrders = useCallback(async (): Promise<boolean> => {
        if (fetchInFlightRef.current) return false;
        fetchInFlightRef.current = true;
        try {
            const response = await fetchWithTimeout(`${resolveKdsLocalBaseUrl()}/api/cocina/ordenes-activas`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            const nextOrders = Array.isArray(data) ? data : [];
            const previousSignatures = knownOrderSignaturesRef.current;
            const nextSignatures = new Set(nextOrders.map(getOrderSignature));
            const hasNewOrder = didPrimeOrdersRef.current
                && nextOrders.some((order) => !previousSignatures.has(getOrderSignature(order)));
            const ordersChanged = !didPrimeOrdersRef.current
                || previousSignatures.size !== nextSignatures.size
                || Array.from(nextSignatures).some((signature) => !previousSignatures.has(signature));
            knownOrderSignaturesRef.current = nextSignatures;
            didPrimeOrdersRef.current = true;
            if (ordersChanged) setOrders(nextOrders);
            if (networkInfoRef.current.host && networkInfoRef.current.serverRunning) {
                setConnectionState('online');
                setConnectionMessage('Servicio KDS conectado');
            } else {
                setConnectionState('offline');
                setConnectionMessage('Servicio local activo, pero la red no tiene una IP disponible');
            }
            if (hasNewOrder) playKitchenAlert();
            return true;
        } catch (error) {
            setConnectionState('offline');
            setConnectionMessage(error instanceof Error && error.name === 'AbortError'
                ? 'El servicio KDS no respondió a tiempo'
                : 'Sin comunicación con el servicio KDS');
            console.warn('[KDS] No se pudieron consultar las órdenes:', error);
            return false;
        } finally {
            fetchInFlightRef.current = false;
            setLoading(false);
        }
    }, [playKitchenAlert]);

    const reconnectKds = useCallback(async (
        forceRestart = false,
        options: { silent?: boolean } = {},
    ) => {
        if (reconnectInFlightRef.current) return;
        reconnectInFlightRef.current = true;
        if (!options.silent) {
            setConnectionState('connecting');
            setConnectionMessage('Reconectando servicio KDS...');
        }
        try {
            const nativeBridge = (window as any).ClicPOSNativePrinter;
            if (forceRestart && typeof nativeBridge?.stopKdsServer === 'function') {
                await nativeBridge.stopKdsServer({});
            }

            const info = await resolveKdsNetworkInfo();
            networkInfoRef.current = info;
            setNetworkInfo(info);
            const ordersAvailable = await fetchOrders();
            if (!info.serverRunning || !info.host || !ordersAvailable) {
                setConnectionState('offline');
                setConnectionMessage(info.message || (!info.host
                    ? 'Conecta Ethernet o Wi-Fi y pulsa reconectar'
                    : 'El servicio KDS todavía no está disponible'));
                return;
            }

            setConnectionState('online');
            setConnectionMessage('Servicio KDS conectado');
            console.info('[KDS] Conexión renovada', {
                url: info.url,
                ips: info.ips,
                forced: forceRestart
            });
        } catch (error) {
            setConnectionState('offline');
            setConnectionMessage('No fue posible reconectar el servicio KDS');
            console.warn('[KDS] Falló la reconexión:', error);
        } finally {
            reconnectInFlightRef.current = false;
        }
    }, [fetchOrders]);

    useEffect(() => {
        const handleOnline = () => void reconnectKds(true);
        const handleOffline = () => {
            const offlineInfo = {
                ...networkInfoRef.current,
                host: null,
                url: null,
                ips: [],
                serverRunning: false
            };
            networkInfoRef.current = offlineInfo;
            setNetworkInfo(offlineInfo);
            setConnectionState('offline');
            setConnectionMessage('Red desconectada. Esperando reconexión...');
        };
        const handleResume = () => {
            if (!document.hidden) void reconnectKds(true);
        };

        void reconnectKds(false);
        const orderPolling = window.setInterval(() => void fetchOrders(), 5000);
        const networkWatchdog = window.setInterval(
            () => void reconnectKds(false, { silent: true }),
            KDS_NETWORK_WATCHDOG_MS,
        );
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        document.addEventListener('visibilitychange', handleResume);

        const appPlugin = (window as any).Capacitor?.Plugins?.App;
        const resumeListener = appPlugin?.addListener?.('resume', () => void reconnectKds(true));
        const stateListener = appPlugin?.addListener?.('appStateChange', (state: { isActive?: boolean }) => {
            if (state?.isActive) void reconnectKds(true);
        });

        return () => {
            window.clearInterval(orderPolling);
            window.clearInterval(networkWatchdog);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            document.removeEventListener('visibilitychange', handleResume);
            resumeListener?.remove?.();
            stateListener?.remove?.();
        };
    }, [fetchOrders, reconnectKds]);

    const handleCopyEndpoint = async () => {
        if (!networkInfo.url) return;

        try {
            await navigator.clipboard.writeText(networkInfo.url);
            setCopyState('copied');
        } catch (error) {
            console.warn('[KDS] No se pudo copiar la URL del KDS:', error);
            setCopyState('failed');
        }

        window.setTimeout(() => setCopyState('idle'), 1800);
    };

    const handleUpdateStatus = async (id: string, newStatus: string, type: 'item' | 'order') => {
        try {
            const payload = type === 'item'
                ? { item_id: id, nuevo_estado: newStatus }
                : { orden_id: id, nuevo_estado: newStatus };
            const response = await fetchWithTimeout(`${resolveKdsLocalBaseUrl()}/api/cocina/cambiar-estado`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            setOrders(prevOrders => prevOrders
                .map(order => {
                    if (type === 'order' && order.id === id) {
                        return {
                            ...order,
                            items: order.items.map(item => ({ ...item, estado_cocina: newStatus as KDSItem['estado_cocina'] }))
                        };
                    }
                    if (type === 'item') {
                        return {
                            ...order,
                            items: order.items.map(item => item.id === id ? { ...item, estado_cocina: newStatus as KDSItem['estado_cocina'] } : item)
                        };
                    }
                    return order;
                })
                .filter(order => order.items.some(item => item.estado_cocina === 'PENDIENTE' || item.estado_cocina === 'EN_PREPARACION'))
            );
        } catch (error) {
            console.error("Error updating KDS status:", error);
        }
    };

    // Production Summary Logic
    const productionSummary = useMemo(() => {
        const summary: Record<string, number> = {};
        orders.forEach(order => {
            order.items.forEach(item => {
                if (item.estado_cocina !== 'LISTO' && item.estado_cocina !== 'DEVUELTO') {
                    summary[item.nombre] = (summary[item.nombre] || 0) + item.cantidad;
                }
            });
        });
        return Object.entries(summary).sort((a, b) => b[1] - a[1]);
    }, [orders]);

    if (loading && orders.length === 0) {
        return (
            <div className="h-screen w-full bg-gray-900 flex items-center justify-center text-gray-400">
                <ChefHat className="animate-bounce mr-4" size={48} />
                <span className="text-2xl font-bold">Cargando Cocina...</span>
            </div>
        );
    }

    return (
        <div className="h-screen w-full bg-gray-950 text-gray-100 flex flex-col overflow-hidden font-sans">
            <header className="bg-gray-800 border-b border-gray-700 px-5 py-3 flex items-center justify-between shadow-xl z-10">
                <div className="flex items-center gap-3 min-w-0">
                    <span className="text-3xl leading-none">👨‍🍳</span>
                    <div className="min-w-0">
                        <div className="text-xl font-black tracking-tight leading-none">Display de Cocina</div>
                        <div className="text-xs text-gray-400 font-semibold mt-1">
                            {formatKdsIdentityLabel(terminalIdentity.code, terminalIdentity.name)} · Órdenes en tiempo real
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-5">
                    <button
                        type="button"
                        onClick={() => void reconnectKds(true)}
                        disabled={connectionState === 'connecting'}
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors disabled:cursor-wait ${
                            connectionState === 'online'
                                ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                                : connectionState === 'connecting'
                                    ? 'border-blue-400/30 bg-blue-500/10 text-blue-300'
                                    : 'border-amber-400/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                        }`}
                        title={`${connectionMessage}. Reconectar servicio`}
                        aria-label="Reconectar servicio de cocina"
                    >
                        <RefreshCw size={20} className={connectionState === 'connecting' ? 'animate-spin' : ''} />
                    </button>

                    <button
                        type="button"
                        onClick={handleCopyEndpoint}
                        disabled={!networkInfo.url}
                        className={`hidden lg:flex items-center gap-2 rounded-2xl border px-3 py-2 text-left transition-colors ${networkInfo.url && networkInfo.serverRunning
                            ? 'border-blue-400/25 bg-blue-500/10 text-blue-100 hover:bg-blue-500/20'
                            : 'border-amber-400/20 bg-amber-500/10 text-amber-100 cursor-not-allowed'
                            }`}
                        title={networkInfo.url ? `Copiar ${networkInfo.url}` : 'No se detectó una IP LAN para este KDS'}
                    >
                        {networkInfo.url && networkInfo.serverRunning ? <Wifi size={18} className="text-cyan-300" /> : <WifiOff size={18} className="text-amber-300" />}
                        <div className="min-w-0">
                            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400">
                                {connectionState === 'connecting'
                                    ? 'Reconectando'
                                    : connectionState === 'online' && networkInfo.serverRunning
                                        ? 'Ruta KDS activa'
                                        : 'Servidor KDS sin conexión'}
                            </div>
                            <div className="max-w-[260px] truncate text-xs font-black">
                                {connectionState === 'online'
                                    ? networkInfo.url
                                    : connectionMessage || networkInfo.message || `IP no detectada · puerto ${networkInfo.port}`}
                            </div>
                            {networkInfo.ips.length > 1 && (
                                <div className="max-w-[260px] truncate text-[9px] font-bold text-gray-400">
                                    Otras IP: {networkInfo.ips.slice(1).join(', ')}
                                </div>
                            )}
                        </div>
                        {networkInfo.url && (
                            <div className="flex items-center gap-1 text-[10px] font-black uppercase text-cyan-200">
                                <Copy size={13} />
                                {copyState === 'copied' ? 'Copiado' : copyState === 'failed' ? 'Error' : 'Copiar'}
                            </div>
                        )}
                    </button>

                    <div className="hidden sm:flex items-center gap-4 text-[10px] font-black uppercase text-gray-400">
                        <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-emerald-500 rounded-full" /> Normal</div>
                        <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-amber-500 rounded-full" /> Alerta</div>
                        <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-red-500 rounded-full" /> Critico</div>
                    </div>

                    <button
                        onClick={() => setShowSummary(!showSummary)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl font-black text-sm transition-all shadow-lg ${showSummary ? 'bg-blue-600 text-white shadow-blue-500/20' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                            }`}
                    >
                        {showSummary ? <LayoutGrid size={18} /> : <ListOrdered size={18} />}
                        {showSummary ? 'Ver Tickets' : 'Ver Resumen'}
                    </button>

                    <div className="text-right min-w-[132px]">
                        <div className="text-2xl font-black leading-none">
                            {currentTime.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className="text-xs text-gray-400 font-semibold mt-1">
                            {currentTime.toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' })}
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 scroll-smooth">
                {showSummary ? (
                    /* 1. Production Summary View */
                    <div className="max-w-4xl mx-auto animate-in fade-in zoom-in-95 duration-300">
                        <div className="bg-gray-900 rounded-[2.5rem] border border-gray-800 shadow-2xl overflow-hidden mt-8">
                            <div className="p-8 border-b border-gray-800 flex items-center justify-between">
                                <h2 className="text-3xl font-black flex items-center gap-3">
                                    <ChefHat className="text-blue-500" /> Resumen de Producción
                                </h2>
                                <div className="px-4 py-2 bg-gray-800 rounded-full text-xs font-bold text-gray-400">
                                    Total Diferentes: {productionSummary.length}
                                </div>
                            </div>
                            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                {productionSummary.map(([name, qty]) => (
                                    <div key={name} className="flex items-center justify-between p-6 bg-gray-800/50 rounded-3xl border border-gray-700 hover:border-blue-500/50 transition-colors">
                                        <span className="text-xl font-bold text-gray-200">{name}</span>
                                        <span className="text-5xl font-black text-blue-500 leading-none">{qty}</span>
                                    </div>
                                ))}
                                {productionSummary.length === 0 && (
                                    <div className="col-span-full py-20 text-center text-gray-600 font-bold italic">
                                        No hay productos pendientes en cocina.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    /* 2. Ticket Grid View */
                    <div className="grid min-h-full grid-cols-1 content-start gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                        {orders.map(order => (
                            <TicketCard
                                key={order.id}
                                order={order}
                                onStatusChange={handleUpdateStatus}
                            />
                        ))}
                        {orders.length === 0 && (
                            <div className="w-full flex flex-col items-center justify-center opacity-20">
                                <ChefHat size={120} strokeWidth={1} />
                                <p className="text-2xl font-black uppercase mt-4 tracking-tighter">Cocina Limpia</p>
                            </div>
                        )}
                    </div>
                )}
            </main>

        </div>
    );
};

const resolveOrderTiming = (order: KDSOrder): { warningMinutes: number; criticalMinutes: number } => {
    const warning = Number(order.kdsTiming?.warningMinutes ?? order.area?.warningMinutes ?? DEFAULT_WARNING_MINUTES);
    const critical = Number(order.kdsTiming?.criticalMinutes ?? order.area?.criticalMinutes ?? DEFAULT_CRITICAL_MINUTES);
    const warningMinutes = Number.isFinite(warning) && warning > 0 ? Math.floor(warning) : DEFAULT_WARNING_MINUTES;
    const criticalMinutes = Number.isFinite(critical) && critical > warningMinutes ? Math.floor(critical) : Math.max(warningMinutes + 1, DEFAULT_CRITICAL_MINUTES);
    return { warningMinutes, criticalMinutes };
};

const resolveTableLabel = (order: KDSOrder): string => {
    const compactLabel = String(order.table?.displayLabel || '').trim();
    if (compactLabel) return compactLabel;

    const tableName = String(order.table?.name || order.table?.nombre || '').trim();
    const roomName = String(order.table?.roomName || '').trim();
    if (tableName && roomName) return `${roomName} · ${tableName}`;
    if (tableName) return tableName;
    return '';
};

const looksTechnicalOrderId = (value?: string): boolean => {
    const normalized = String(value || '').trim();
    if (!normalized) return true;
    return /^P-\d+$/i.test(normalized)
        || /^TXN-/i.test(normalized)
        || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(normalized)
        || normalized.length > 18;
};

const resolveVisibleOrderNumber = (order: KDSOrder): string => {
    const orderNumber = String(order.orderNumber || '').trim();
    if (orderNumber) return orderNumber;

    const displayId = String(order.displayId || '').trim();
    if (displayId && !looksTechnicalOrderId(displayId)) return displayId;

    return '';
};

const TicketCard: React.FC<{
    order: KDSOrder,
    onStatusChange: (id: string, s: string, t: 'item' | 'order') => void
}> = ({ order, onStatusChange }) => {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const start = new Date(order.date).getTime();
        const update = () => {
            setElapsed(Math.floor((Date.now() - start) / 60000));
        };
        update();
        const interval = setInterval(update, 30000);
        return () => clearInterval(interval);
    }, [order.date]);

    // Aging Logic
    const timing = resolveOrderTiming(order);
    const getSeverity = () => {
        if (elapsed >= timing.criticalMinutes) return 'critical';
        if (elapsed >= timing.warningMinutes) return 'warning';
        return 'normal';
    };

    const severity = getSeverity();
    const tableLabel = resolveTableLabel(order);
    const visibleOrderNumber = resolveVisibleOrderNumber(order);
    const headerTitle = tableLabel || (visibleOrderNumber ? `Orden ${visibleOrderNumber}` : 'Venta directa');
    const sourceTerminalLabel = formatKdsIdentityLabel(order.sourceTerminal?.code, order.sourceTerminal?.name);
    const productionAreaLabel = String(order.area?.name || order.area?.nombre || '').trim();
    const severityStyles = {
        normal: {
            card: 'border-emerald-500/30 bg-gray-900 text-gray-100',
            header: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
            body: 'bg-gray-900',
            itemName: 'text-gray-200',
            qty: 'text-blue-500',
            modifier: 'text-red-300',
            footer: 'bg-gray-800/50',
            button: 'bg-gray-100 text-gray-900 hover:bg-white'
        },
        warning: {
            card: 'border-amber-500 bg-amber-300 text-amber-950 shadow-amber-500/30',
            header: 'bg-amber-500 text-amber-950 border-b border-amber-600/40',
            body: 'bg-amber-300',
            itemName: 'text-amber-950',
            qty: 'text-amber-950',
            modifier: 'text-red-800',
            footer: 'bg-amber-400/60 border-t border-amber-600/30',
            button: 'bg-amber-950 text-amber-50 hover:bg-amber-900'
        },
        critical: {
            card: 'border-red-700 bg-red-600 text-white shadow-red-500/40 animate-pulse-slow',
            header: 'bg-red-800 text-white border-b border-red-950/30',
            body: 'bg-red-600',
            itemName: 'text-white',
            qty: 'text-white',
            modifier: 'text-red-50',
            footer: 'bg-red-800/70 border-t border-red-950/30',
            button: 'bg-white text-red-700 hover:bg-red-50'
        }
    };
    const activeSeverityStyles = severityStyles[severity];

    return (
        <div className={`min-w-0 h-[calc((100vh-9.5rem)/2)] min-h-[250px] flex flex-col rounded-[1.5rem] border-2 shadow-2xl transition-all duration-500 ${activeSeverityStyles.card}`}>

            {/* Card Header */}
            <div className={`p-3 rounded-t-[1.3rem] flex flex-col gap-1 ${activeSeverityStyles.header}`}>
                <div className="flex items-center justify-between">
                    <span className="text-lg font-black tracking-tighter truncate pr-2"># {headerTitle}</span>
                    <div
                        className="flex items-center gap-1 text-[10px] font-black bg-black/20 px-2 py-1 rounded-full shrink-0"
                        title={`Alerta: ${timing.warningMinutes} min · Crítico: ${timing.criticalMinutes} min`}
                    >
                        <Timer size={12} /> {elapsed} min
                    </div>
                </div>
                <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wide opacity-80">
                    <span className="flex items-center gap-1"><Users size={10} /> {order.userName}</span>
                    <span>{visibleOrderNumber ? `Orden: ${visibleOrderNumber}` : `Ref: ${String(order.id).slice(-4)}`}</span>
                </div>
                {(productionAreaLabel || order.sourceTerminal) && (
                    <div className="flex items-center justify-between gap-2 text-[9px] font-black uppercase tracking-wide opacity-90">
                        <span className="truncate">{productionAreaLabel ? `Centro: ${productionAreaLabel}` : 'Centro de producción'}</span>
                        {order.sourceTerminal && (
                            <span className="flex max-w-[48%] items-center gap-1 truncate" title={sourceTerminalLabel}>
                                <Monitor size={11} className="shrink-0" /> {sourceTerminalLabel}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* Items List */}
            <div className={`flex-1 overflow-y-auto p-3 space-y-2 ${activeSeverityStyles.body}`}>
                {order.items.map((item) => {
                    const isReturned = item.estado_cocina === 'DEVUELTO';
                    const isReady = item.estado_cocina === 'LISTO';
                    return (
                        <div
                            key={item.id}
                            onClick={() => {
                                if (isReturned) return;
                                onStatusChange(item.id, isReady ? 'PENDIENTE' : 'LISTO', 'item');
                            }}
                            className={`transition-all ${isReturned ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${isReady || isReturned ? 'grayscale line-through' : ''}`}
                        >
                            <div className="flex items-start gap-2">
                                <span className={`text-lg font-black leading-tight ${isReturned ? 'text-red-200' : activeSeverityStyles.qty}`}>{item.cantidad}x</span>
                                <div className="flex-1">
                                    <div className="flex items-start justify-between gap-2">
                                        <p className={`text-base font-bold leading-tight ${activeSeverityStyles.itemName}`}>{item.nombre}</p>
                                        {isReturned && (
                                            <span className="rounded-full bg-red-500/20 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-red-200">
                                                Devuelto
                                            </span>
                                        )}
                                    </div>
                                    {item.modificadores && item.modificadores.length > 0 && (
                                        <ul className="mt-1 space-y-0.5">
                                            {item.modificadores.map((mod, i) => (
                                                <li key={i} className={`${activeSeverityStyles.modifier} text-xs font-bold uppercase flex items-center gap-1`}>
                                                    <span className="text-xs">↳</span> {mod}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Card Footer */}
            <div className={`p-3 rounded-b-[1.3rem] ${activeSeverityStyles.footer}`}>
                <button
                    onClick={() => onStatusChange(order.id, 'LISTO', 'order')}
                    className={`w-full py-2.5 rounded-xl font-black text-sm active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-xl ${activeSeverityStyles.button}`}
                >
                    <CheckCircle2 size={18} /> MARCHAR / LISTO
                </button>
            </div>

            <style>{`
        .animate-pulse-slow {
          animation: pulse-slow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes pulse-slow {
          50% { opacity: .8; border-color: rgb(239 68 68); }
        }
      `}</style>
        </div>
    );
};

export default KitchenDisplay;
