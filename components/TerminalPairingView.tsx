import React, { useState, useEffect } from 'react';
import {
    Monitor,
    Server,
    WifiOff,
    ArrowRight,
    RefreshCw,
    CheckCircle,
    AlertTriangle
} from 'lucide-react';
import { TerminalConfig } from '../types';

interface TerminalPairingViewProps {
    currentDeviceId: string;
    onPair: (terminalId: string, masterIp?: string) => Promise<void>;
    initialMasterIp?: string;
}

type NodeMode = 'SERVER' | 'CLIENT';
const SERVER_AUTO_TERMINAL_ID = '__SERVER_AUTO__';

export const TerminalPairingView: React.FC<TerminalPairingViewProps> = ({
    currentDeviceId,
    onPair,
    initialMasterIp = ''
}) => {
    const persistedMasterIp = initialMasterIp || localStorage.getItem('pos_master_ip') || '';
    const [nodeMode, setNodeMode] = useState<NodeMode>(persistedMasterIp ? 'CLIENT' : 'SERVER');
    const [masterIp, setMasterIp] = useState(persistedMasterIp || window.location.hostname);
    const [terminals, setTerminals] = useState<{ id: string; config: TerminalConfig }[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
    const [isPairing, setIsPairing] = useState(false);
    const [showIpInput, setShowIpInput] = useState(false);

    const fetchTerminals = async () => {
        setIsLoading(true);
        setError(null);
        setTerminals([]);

        try {
            const protocol = window.location.protocol;
            const targetUrl = `${protocol}//${masterIp}:3001/api/config`;

            console.log(`📡 Fetching terminals from: ${targetUrl}`);

            // Short timeout to fail fast if IP is wrong
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            const res = await fetch(targetUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!res.ok) throw new Error(`HTTP Error ${res.status}`);

            const data = await res.json();

            if (data && Array.isArray(data.terminals)) {
                // Filter: Show only terminals that are NOT currently bound to another device ID
                const availables = data.terminals.filter((t: any) => {
                    // Logic: Terminal is available if it has NO currentDeviceId 
                    // OR if it was previously bound to THIS device (re-binding)
                    return !t.config?.currentDeviceId || t.config?.currentDeviceId === currentDeviceId;
                });
                setTerminals(availables);
                if (availables.length === 0) {
                    setError("No hay terminales disponibles en el servidor.");
                }
            } else {
                throw new Error("Formato de respuesta inválido del servidor.");
            }
        } catch (err: any) {
            console.error("❌ Error fetching terminals:", err);
            setError(err.name === 'AbortError'
                ? "Tiempo de espera agotado. Verifique la IP."
                : `No se pudo conectar al Master (${masterIp}).`);
            setShowIpInput(true); // Auto-show IP input on error
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (nodeMode === 'CLIENT') {
            setSelectedTerminalId(null);
            fetchTerminals().catch(console.error);
            return;
        }

        setError(null);
        setTerminals([]);
        setSelectedTerminalId(SERVER_AUTO_TERMINAL_ID);
    }, [nodeMode]);

    const handleConfirmPairing = async () => {
        if (nodeMode === 'CLIENT' && !selectedTerminalId) return;
        setIsPairing(true);
        try {
            if (nodeMode === 'SERVER') {
                await onPair(SERVER_AUTO_TERMINAL_ID, '');
            } else {
                await onPair(selectedTerminalId!, masterIp.trim());
            }
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

                    {/* Node Mode Selector */}
                    <div className="mb-6">
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                            Modo de Operación
                        </label>
                        <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl">
                            <button
                                onClick={() => setNodeMode('SERVER')}
                                className={`py-2.5 rounded-lg text-sm font-bold transition-colors ${nodeMode === 'SERVER' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Servidor
                            </button>
                            <button
                                onClick={() => setNodeMode('CLIENT')}
                                className={`py-2.5 rounded-lg text-sm font-bold transition-colors ${nodeMode === 'CLIENT' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Cliente
                            </button>
                        </div>
                    </div>

                    {nodeMode === 'CLIENT' ? (
                        <>
                            {/* Master Connection Status */}
                            <div className="mb-6">
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Servidor Master</label>
                                    <button
                                        onClick={() => setShowIpInput(!showIpInput)}
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
                                            onChange={(e) => setMasterIp(e.target.value)}
                                            className="flex-1 bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                            placeholder="Ej: 192.168.1.100"
                                        />
                                        <button
                                            onClick={fetchTerminals}
                                            disabled={isLoading}
                                            className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-lg transition-colors flex items-center justify-center"
                                        >
                                            {isLoading ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                                        </button>
                                    </div>
                                ) : (
                                    <div onClick={fetchTerminals} className="group cursor-pointer flex items-center gap-3 p-3 bg-blue-50/50 hover:bg-blue-50 border border-blue-100/50 hover:border-blue-200 rounded-xl transition-all">
                                        <div className={`p-2 rounded-lg ${error ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                                            {error ? <WifiOff size={18} /> : <Server size={18} />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-slate-700 truncate">{masterIp || 'Sin Configurar'}</p>
                                            <p className="text-xs text-slate-500 truncate">
                                                {isLoading ? 'Conectando...' : (error ? 'Sin conexión' : 'Conectado')}
                                            </p>
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
                        </>
                    ) : (
                        <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-800">
                            Este equipo quedará como <span className="font-bold">Servidor (Master)</span>.
                            La base de datos operará localmente y las otras cajas se podrán vincular a esta IP.
                        </div>
                    )}

                    {/* Action Button */}
                    <button
                        onClick={handleConfirmPairing}
                        disabled={(nodeMode === 'CLIENT' && !selectedTerminalId) || isPairing}
                        className={`
              w-full py-3.5 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2
              ${(nodeMode === 'CLIENT' && !selectedTerminalId) || isPairing
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
                                {nodeMode === 'SERVER' ? 'Iniciar como Servidor' : 'Confirmar Vinculación'}
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
