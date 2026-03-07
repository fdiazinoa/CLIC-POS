import React, { useState, useEffect } from 'react';
import {
    Monitor,
    Server,
    Wifi,
    WifiOff,
    ArrowRight,
    RefreshCw,
    CheckCircle,
    AlertTriangle
} from 'lucide-react';
import { TerminalConfig } from '../types';
import { normalizeMasterHost, resolveMasterEndpointFromCloud } from '../utils/cloudMasterRegistry';

interface TerminalPairingViewProps {
    currentDeviceId: string;
    onPair: (terminalId: string, masterIp: string) => Promise<void>;
    initialMasterIp?: string;
}

type ConnectionSource = 'CLOUD' | 'MANUAL' | 'LOCAL' | null;

export const TerminalPairingView: React.FC<TerminalPairingViewProps> = ({
    currentDeviceId,
    onPair,
    initialMasterIp = ''
}) => {
    const [masterIp, setMasterIp] = useState(() => normalizeMasterHost(initialMasterIp || localStorage.getItem('pos_master_ip') || ''));
    const [terminals, setTerminals] = useState<{ id: string; config: TerminalConfig }[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
    const [isPairing, setIsPairing] = useState(false);
    const [showIpInput, setShowIpInput] = useState(false);
    const [connectionSource, setConnectionSource] = useState<ConnectionSource>(null);

    const persistResolvedMaster = (host: string, source: Exclude<ConnectionSource, null>) => {
        if (!host) return;
        localStorage.setItem('pos_master_ip', host);
        localStorage.setItem('CLIC_POS_MASTER_URL', `${window.location.protocol}//${host}:3001`);
        localStorage.setItem('CLIC_POS_MASTER_DISCOVERY', source);
    };

    const fetchAvailableTerminals = async (resolvedMasterIp: string) => {
        const protocol = window.location.protocol;
        const targetUrl = `${protocol}//${resolvedMasterIp}:3001/api/config`;

        console.log(`📡 Fetching terminals from: ${targetUrl}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        try {
            const res = await fetch(targetUrl, { signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

            const data = await res.json();

            if (!data || !Array.isArray(data.terminals)) {
                throw new Error("Formato de respuesta inválido del servidor.");
            }

            return data.terminals.filter((t: any) => {
                return !t.config?.currentDeviceId || t.config?.currentDeviceId === currentDeviceId;
            });
        } finally {
            clearTimeout(timeoutId);
        }
    };

    const buildConnectionError = (resolvedMasterIp: string, err: any) => {
        if (err?.name === 'AbortError') {
            return "Tiempo de espera agotado. Verifique la IP.";
        }

        return `No se pudo conectar al Master (${resolvedMasterIp}).`;
    };

    const fetchTerminals = async (
        hostOverride?: string,
        sourceOverride?: Exclude<ConnectionSource, null>,
        allowCloudFallback = true
    ) => {
        const requestedHost = normalizeMasterHost(hostOverride ?? masterIp);
        const requestedSource = sourceOverride || connectionSource || 'MANUAL';

        if (!requestedHost) {
            setError("Ingrese la IP del servidor master.");
            setShowIpInput(true);
            setTerminals([]);
            return;
        }

        setIsLoading(true);
        setError(null);
        setTerminals([]);

        try {
            const availables = await fetchAvailableTerminals(requestedHost);
            setMasterIp(requestedHost);
            setConnectionSource(requestedSource);
            setShowIpInput(false);
            persistResolvedMaster(requestedHost, requestedSource);
            setTerminals(availables);

            if (availables.length === 0) {
                setError("No hay terminales disponibles en el servidor.");
            }
        } catch (err: any) {
            console.error("❌ Error fetching terminals:", err);

            if (allowCloudFallback) {
                const cloudEndpoint = await resolveMasterEndpointFromCloud();
                const cloudHost = normalizeMasterHost(cloudEndpoint?.localIp || cloudEndpoint?.endpointUrl || '');

                if (cloudHost && cloudHost !== requestedHost) {
                    try {
                        const availables = await fetchAvailableTerminals(cloudHost);
                        setMasterIp(cloudHost);
                        setConnectionSource('CLOUD');
                        setShowIpInput(false);
                        persistResolvedMaster(cloudHost, 'CLOUD');
                        setTerminals(availables);

                        if (availables.length === 0) {
                            setError("No hay terminales disponibles en el servidor.");
                        }

                        return;
                    } catch (cloudError: any) {
                        console.error("❌ Error fetching terminals from cloud-discovered host:", cloudError);
                        setError(buildConnectionError(cloudHost, cloudError));
                        setMasterIp(cloudHost);
                        setConnectionSource('CLOUD');
                        setShowIpInput(true);
                        return;
                    }
                }
            }

            setError(buildConnectionError(requestedHost, err));
            setShowIpInput(true);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        let isMounted = true;

        const bootstrapDiscovery = async () => {
            const storedHost = normalizeMasterHost(initialMasterIp || localStorage.getItem('pos_master_ip') || '');
            const storedSource = localStorage.getItem('CLIC_POS_MASTER_DISCOVERY') === 'CLOUD' ? 'CLOUD' : 'MANUAL';

            if (storedHost) {
                if (!isMounted) return;
                setMasterIp(storedHost);
                setConnectionSource(storedSource);
                await fetchTerminals(storedHost, storedSource, true);
                return;
            }

            const cloudEndpoint = await resolveMasterEndpointFromCloud();
            const cloudHost = normalizeMasterHost(cloudEndpoint?.localIp || cloudEndpoint?.endpointUrl || '');

            if (cloudHost) {
                if (!isMounted) return;
                setMasterIp(cloudHost);
                setConnectionSource('CLOUD');
                await fetchTerminals(cloudHost, 'CLOUD', false);
                return;
            }

            const fallbackHost = normalizeMasterHost(window.location.hostname);
            if (!isMounted) return;

            setMasterIp(fallbackHost);
            setConnectionSource('LOCAL');
            setShowIpInput(true);
            setError("No se encontró un servidor master en cloud. Ingrese la IP manualmente.");
        };

        void bootstrapDiscovery();

        return () => {
            isMounted = false;
        };
    }, []);

    const handleConfirmPairing = async () => {
        if (!selectedTerminalId) return;

        const resolvedMasterIp = normalizeMasterHost(masterIp);
        if (!resolvedMasterIp) {
            setError("Ingrese la IP del servidor master.");
            setShowIpInput(true);
            return;
        }

        setIsPairing(true);
        try {
            await onPair(selectedTerminalId, resolvedMasterIp);
        } catch (e: any) {
            setError(e.message || "Error al vincular.");
            setIsPairing(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 font-sans text-slate-800">

            <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">

                {/* Header */}
                <div className="bg-slate-900 p-6 text-white text-center">
                    <div className="mx-auto bg-blue-600 w-12 h-12 rounded-xl flex items-center justify-center mb-4 shadow-lg ring-4 ring-blue-500/20">
                        <Monitor size={24} className="text-white" />
                    </div>
                    <h1 className="text-2xl font-bold mb-1">Vincular Dispositivo</h1>
                    <p className="text-slate-400 text-sm">
                        Este equipo no está autorizado.
                    </p>
                </div>

                <div className="p-6">
                    {/* Device ID Badge */}
                    <div className="flex justify-center mb-6">
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-full text-xs font-mono font-medium text-gray-500 border border-gray-200">
                            <span>ID: {currentDeviceId}</span>
                        </div>
                    </div>

                    {/* Master Connection Status */}
                    <div className="mb-6">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Servidor Master</label>
                            <button
                                onClick={() => {
                                    setShowIpInput(!showIpInput);
                                    if (!showIpInput) {
                                        setConnectionSource('MANUAL');
                                    }
                                }}
                                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                            >
                                {showIpInput ? 'Ocultar' : 'Cambiar IP'}
                            </button>
                        </div>

                        {showIpInput ? (
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={masterIp}
                                    onChange={(e) => {
                                        setMasterIp(e.target.value);
                                        setConnectionSource('MANUAL');
                                    }}
                                    className="flex-1 bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                    placeholder="Ej: 192.168.1.100"
                                />
                                <button
                                    onClick={() => void fetchTerminals(masterIp, 'MANUAL')}
                                    disabled={isLoading}
                                    className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-lg transition-colors flex items-center justify-center"
                                >
                                    {isLoading ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                                </button>
                            </div>
                        ) : (
                            <div onClick={() => void fetchTerminals(masterIp, connectionSource || 'MANUAL')} className="group cursor-pointer flex items-center gap-3 p-3 bg-blue-50/50 hover:bg-blue-50 border border-blue-100/50 hover:border-blue-200 rounded-xl transition-all">
                                <div className={`p-2 rounded-lg ${error ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                                    {error ? <WifiOff size={18} /> : <Server size={18} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-700 truncate">{masterIp || 'Sin Configurar'}</p>
                                    <p className="text-xs text-slate-500 truncate">
                                        {isLoading ? 'Conectando...' : (error ? 'Sin conexión' : 'Conectado')}
                                    </p>
                                    {connectionSource && (
                                        <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mt-1">
                                            {connectionSource === 'CLOUD' && 'Detectado desde Cloud'}
                                            {connectionSource === 'MANUAL' && 'Configurado manualmente'}
                                            {connectionSource === 'LOCAL' && 'Host local'}
                                        </p>
                                    )}
                                </div>
                                <div className="text-gray-400 group-hover:text-blue-500">
                                    <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
                                </div>
                            </div>
                        )}

                        {error && !showIpInput && (
                            <p className="mt-2 text-xs text-red-500 flex items-center gap-1 animate-in fade-in slide-in-from-top-1">
                                <AlertTriangle size={12} /> {error}
                            </p>
                        )}
                    </div>

                    {/* Terminal List */}
                    <div className="mb-6">
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                            Terminales Disponibles
                        </label>

                        {terminals.length === 0 && !isLoading && !error && (
                            <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                                <p className="text-sm">No se encontraron terminales libres.</p>
                            </div>
                        )}

                        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                            {terminals.map((t) => {
                                const isSelected = selectedTerminalId === t.id;
                                const isRebind = t.config?.currentDeviceId === currentDeviceId;

                                return (
                                    <div
                                        key={t.id}
                                        onClick={() => setSelectedTerminalId(t.id)}
                                        className={`
                        relative cursor-pointer p-3 rounded-xl border transition-all duration-200
                        ${isSelected
                                                ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-500/20'
                                                : 'bg-white border-gray-200 text-slate-700 hover:border-blue-300 hover:shadow-sm'}
                      `}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className={`font-semibold text-sm ${isSelected ? 'text-white' : 'text-slate-800'}`}>
                                                    {t.config?.deviceRole?.role.replace('_', ' ') || 'Terminal POS'}
                                                </p>
                                                <p className={`text-xs ${isSelected ? 'text-blue-100' : 'text-slate-500'}`}>
                                                    ID: {t.id} {isRebind && '(Actual)'}
                                                </p>
                                            </div>
                                            {isSelected && <CheckCircle size={18} className="text-white" />}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Action Button */}
                    <button
                        onClick={handleConfirmPairing}
                        disabled={!selectedTerminalId || isPairing}
                        className={`
              w-full py-3.5 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2
              ${!selectedTerminalId || isPairing
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/25 active:scale-[0.98]'}
            `}
                    >
                        {isPairing ? (
                            <>
                                <RefreshCw size={18} className="animate-spin" />
                                Vinculando...
                            </>
                        ) : (
                            <>
                                Confirmar Vinculación
                                <ArrowRight size={18} />
                            </>
                        )}
                    </button>

                </div>
            </div>

            <p className="mt-8 text-xs text-slate-400 font-medium">
                CLIC POS v2.5 &bull; Powered by Antigravity
            </p>
        </div>
    );
};
