import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, Clock, UploadCloud, DownloadCloud, Database, Server, ArrowRight, ShieldCheck, X, Wifi, WifiOff, Globe, Monitor, Laptop } from 'lucide-react';
import { syncManager } from '../services/sync/SyncManager';
import { permissionService } from '../services/sync/PermissionService';
import { BusinessConfig } from '../types';
import SyncProgressModal from './SyncProgressModal';

interface SyncSettingsProps {
    config: BusinessConfig;
    onClose: () => void;
}

const SyncSettings: React.FC<SyncSettingsProps> = ({ config, onClose }) => {
    const [status, setStatus] = useState<any[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
    const [isMaster, setIsMaster] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<any>(null);
    const [masterUrl, setMasterUrl] = useState('');
    const [isTestingConnection, setIsTestingConnection] = useState(false);
    const [connectedTerminals, setConnectedTerminals] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<'MONITOR' | 'TERMINALS' | 'CONFIG' | 'HELP'>('MONITOR');

    const loadStatus = async () => {
        try {
            const statuses = await syncManager.getSyncStatus();
            setStatus(statuses);
            setIsMaster(permissionService.isMasterTerminal());

            // Get connection status
            const connStatus = syncManager.getSyncConnectionStatus();
            setConnectionStatus(connStatus);

            // Load connected terminals if Master
            if (permissionService.isMasterTerminal()) {
                const terminals = await syncManager.getConnectedTerminals();
                const opStatus = await syncManager.getOperationalStatus();

                const allTerminalIds = new Set([
                    ...terminals.map(t => t.terminalId),
                    ...(opStatus?.terminals?.map((t: any) => t.terminalId) || [])
                ]);

                const mergedTerminals = Array.from(allTerminalIds)
                    .filter(tid => tid === 't1' || tid === 't2')
                    .map(tid => {
                        const connectedInfo = terminals.find(t => t.terminalId === tid);
                        const opInfo = opStatus?.terminals?.find((t: any) => t.terminalId === tid);
                        const isLocal = tid === permissionService.getTerminalId();

                        return {
                            terminalId: tid,
                            ip: isLocal ? 'Localhost' : (connectedInfo?.ip || '-'),
                            lastSeen: isLocal ? new Date().toISOString() : (connectedInfo?.lastSeen || null),
                            ...(connectedInfo || {}),
                            ...(opInfo || {}),
                            status: isLocal ? 'MASTER' : (connectedInfo?.status || 'OFFLINE')
                        };
                    });

                setConnectedTerminals(mergedTerminals);
            }
        } catch (error) {
            console.error('Error loading sync status:', error);
        }
    };

    const initialLoadDone = React.useRef(false);

    // Initial load
    useEffect(() => {
        if (initialLoadDone.current) return;

        const connStatus = syncManager.getSyncConnectionStatus();
        if (!permissionService.isMasterTerminal() && connStatus.masterUrl) {
            setMasterUrl(connStatus.masterUrl);
        }
        loadStatus();
        initialLoadDone.current = true;
    }, []);

    // Periodic polling
    useEffect(() => {
        const interval = setInterval(loadStatus, 5000);
        return () => clearInterval(interval);
    }, []);



    const handleSync = async () => {
        setIsSyncing(true);
        try {
            // Master should also use syncAllCatalogs to PULL operations (Z-Reports, etc.)
            // while PUSHING catalogs.
            await syncManager.syncAllCatalogs();

            if (isMaster) {
                alert('✅ Sincronización completa. Catálogos enviados y datos operativos recibidos.');
            } else {
                alert('✅ Sincronización exitosa. Todos los catálogos han sido actualizados desde el Master.');
            }
            setLastSyncTime(new Date());
            await loadStatus();
        } catch (error) {
            console.error('Sync error:', error);
            alert('❌ Error durante la sincronización: ' + (error instanceof Error ? error.message : 'Error desconocido'));
        } finally {
            setIsSyncing(false);
        }
    };

    const handleTestConnection = async () => {
        if (!masterUrl) {
            alert('⚠️ Por favor ingresa la URL del Master terminal');
            return;
        }

        // Normalize URL (handle Https:// and trailing slashes)
        const normalizedUrl = masterUrl.trim().replace(/\/$/, '');
        const isHttpsOrigin = window.location.protocol === 'https:';
        const isTargetHttps = normalizedUrl.toLowerCase().startsWith('https:');
        const isTargetPort3001 = normalizedUrl.includes(':3001');

        // Mixed Content / Proxy Warning
        if (isHttpsOrigin && isTargetPort3001) {
            const usePort3000 = confirm(
                '⚠️ Estás usando HTTPS en el puerto 3001.\n\n' +
                'Debido a restricciones de seguridad (Mixed Content), es probable que la conexión falle directamente al puerto 3001.\n\n' +
                '¿Deseas intentar usar el puerto 3000? (Recomendado para usar el proxy de seguridad)'
            );
            if (usePort3000) {
                const newUrl = normalizedUrl.replace(':3001', ':3000');
                setMasterUrl(newUrl);
                alert(`URL actualizada a: ${newUrl}. Intenta probar la conexión de nuevo.`);
                return;
            }
        }

        setIsTestingConnection(true);
        try {
            // 1. Ping test
            const isReachable = await syncManager.testConnection(normalizedUrl);
            if (!isReachable) {
                let extraInfo = '';
                if (isHttpsOrigin && !isTargetHttps) {
                    extraInfo = '\n\n⚠️ NOTA: Tu App usa HTTPS, pero intentas conectar vía HTTP. El navegador bloqueará esta conexión por seguridad.';
                } else if (isTargetHttps && normalizedUrl.includes('192.168.')) {
                    extraInfo = '\n\n⚠️ NOTA: Usar HTTPS con IPs locales suele requerir certificados válidos o aceptar el riesgo en el navegador.';
                }

                alert(`❌ No se detecta el servidor en ${normalizedUrl}.\n\nAsegúrate de que:\n1. La IP es correcta (ej. 192.168.x.x)\n2. El puerto es 3000 (recomendado) o 3001\n3. El servidor backend está corriendo${extraInfo}`);
                return;
            }

            // 2. Auth test
            const response = await fetch(`${normalizedUrl}/api/sync/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    terminalId: permissionService.getTerminalId() || 'test-conn',
                    deviceToken: 'test-probe'
                })
            });

            if (response.ok) {
                alert('✅ Conexión exitosa con el Master terminal (Ping + Auth OK)!');
            } else {
                alert(`⚠️ El servidor en ${normalizedUrl} responde, pero la autenticación falló: ${response.status} ${response.statusText}`);
            }
        } catch (error) {
            console.error('Connection test error:', error);
            alert(`❌ Error de conexión intentando contactar a ${normalizedUrl}:\n` +
                (error instanceof Error ? error.message : 'No se puede alcanzar el servidor') +
                '\n\nTip: Si usas HTTPS, intenta usar el puerto 3000 en lugar del 3001.');
        } finally {
            setIsTestingConnection(false);
        }
    };

    const getCollectionLabel = (collection: string) => {
        const labels: { [key: string]: string } = {
            products: 'Catálogo de Productos',
            customers: 'Base de Clientes',
            suppliers: 'Proveedores',
            internalSequences: 'Secuencias de Documentos',
            zReports: 'Reportes Z (Cierres)',
            transactions: 'Transacciones',
            inventoryLedger: 'Movimientos de Inventario'
        };
        return labels[collection] || collection;
    };

    // Sync Progress State
    const [showProgressModal, setShowProgressModal] = useState(false);
    const [syncModules, setSyncModules] = useState<any[]>([]);

    useEffect(() => {
        const handleSyncStart = (e: CustomEvent) => {
            setSyncModules(e.detail.modules.map((m: any) => ({ ...m, status: 'PENDING' })));
            setShowProgressModal(true);
        };

        const handleSyncProgress = (e: CustomEvent) => {
            setSyncModules(prev => prev.map(m => {
                if (m.id === e.detail.id) {
                    return { ...m, status: e.detail.status, message: e.detail.message, count: e.detail.count };
                }
                return m;
            }));
        };

        window.addEventListener('syncStart', handleSyncStart as EventListener);
        window.addEventListener('syncProgress', handleSyncProgress as EventListener);

        return () => {
            window.removeEventListener('syncStart', handleSyncStart as EventListener);
            window.removeEventListener('syncProgress', handleSyncProgress as EventListener);
        };
    }, []);

    const handleForcePull = async () => {
        if (!confirm('⚠️ ¿Estás seguro? Esto reiniciará la sincronización y descargará TODO del servidor nuevamente.')) return;

        // Modal will open via event listener
        try {
            await syncManager.forcePullAll();
            // Wait a bit before closing to let user see success
            // Modal handles its own close button which reloads
        } catch (error) {
            console.error('Force pull error:', error);
            alert('❌ Error crítico: ' + (error instanceof Error ? error.message : 'Error desconocido'));
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300 relative">
            <SyncProgressModal
                isOpen={showProgressModal}
                onClose={() => window.location.reload()}
                modules={syncModules}
            />

            {/* Header */}
            <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                            <RefreshCw className={`text-blue-600 ${isSyncing ? 'animate-spin' : ''}`} /> Centro de Sincronización
                        </h1>
                        {/* Connection Status Badge */}
                        {connectionStatus && (
                            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${(isMaster && connectionStatus.isOnline) || (connectionStatus.isOnline && connectionStatus.isAuthenticated)
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-red-100 text-red-700'
                                }`}>
                                {(isMaster && connectionStatus.isOnline) || (connectionStatus.isOnline && connectionStatus.isAuthenticated) ? (
                                    <><Wifi size={14} /> {isMaster ? 'Servidor Activo' : 'Conectado'}</>
                                ) : (
                                    <><WifiOff size={14} /> Desconectado</>
                                )}
                            </div>
                        )}
                    </div>
                    <p className="text-sm text-gray-500">Estado de la red local y replicación de datos.</p>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><X size={24} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-5xl mx-auto space-y-8">

                    {/* Status Card */}
                    <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-4">
                                <div className={`p-4 rounded-2xl ${isMaster ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                                    {isMaster ? <Server size={32} /> : <Database size={32} />}
                                </div>
                                <div>
                                    <h2 className="text-xl font-black text-gray-800">
                                        {isMaster ? 'Terminal Master (Servidor)' : 'Terminal Esclava (Cliente)'}
                                    </h2>
                                    <p className="text-sm text-gray-500">
                                        {isMaster
                                            ? 'Esta terminal es la fuente de verdad. Los cambios se envían a las demás cajas.'
                                            : 'Esta terminal recibe actualizaciones del Master. Los cambios locales pueden sobrescribirse.'}
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={handleSync}
                                disabled={isSyncing}
                                className={`px-8 py-4 rounded-2xl font-black text-white shadow-lg flex items-center gap-3 transition-all active:scale-95 ${isMaster
                                    ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-200'
                                    : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'
                                    }`}
                            >
                                {isSyncing ? (
                                    <>
                                        <RefreshCw className="animate-spin" /> Procesando...
                                    </>
                                ) : (
                                    <>
                                        {isMaster ? <UploadCloud /> : <DownloadCloud />}
                                        {isMaster ? 'Sincronizar Todo' : 'Sincronizar Ahora'}
                                    </>
                                )}
                            </button>

                            <button
                                onClick={handleForcePull}
                                disabled={isSyncing}
                                className={`mt-3 w-full py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-2 border transition-colors ${isMaster
                                    ? 'text-purple-600 bg-purple-50 hover:bg-purple-100 border-purple-200'
                                    : 'text-red-600 bg-red-50 hover:bg-red-100 border-red-200'}`}
                            >
                                <DownloadCloud size={14} />
                                {isMaster ? 'Restaurar Respaldo del Servidor' : 'Forzar Descarga Completa (Reset)'}
                            </button>
                        </div>

                        {/* Tab Navigation */}
                        <div className="flex gap-2 p-1 bg-gray-100 rounded-2xl mb-8">
                            {[
                                { id: 'MONITOR', label: 'Monitor de Datos', icon: Database },
                                { id: 'TERMINALS', label: 'Terminales', icon: Monitor, hidden: !isMaster },
                                { id: 'CONFIG', label: 'Configuración', icon: Globe, hidden: isMaster },
                                { id: 'HELP', label: 'Ayuda y Soporte', icon: ShieldCheck },
                            ].filter(t => !t.hidden).map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as any)}
                                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all ${activeTab === tab.id
                                        ? 'bg-white text-blue-600 shadow-sm'
                                        : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
                                        }`}
                                >
                                    <tab.icon size={18} />
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {activeTab === 'CONFIG' && !isMaster && (
                            <div className="mt-6 p-6 bg-blue-50 border border-blue-200 rounded-2xl">
                                <h3 className="font-black text-blue-900 mb-3 flex items-center gap-2">
                                    <Globe size={18} /> Configuración de Conexión
                                </h3>
                                <p className="text-sm text-blue-700 mb-4">
                                    Ingresa la URL del Master terminal. Asegúrate de usar el puerto <strong>3001</strong> (backend).<br />
                                    Ejemplo: <code className="bg-blue-100 px-2 py-0.5 rounded">https://192.168.1.100:3001</code>
                                </p>
                                <div className="flex gap-3">
                                    <input
                                        type="text"
                                        value={masterUrl}
                                        onChange={(e) => setMasterUrl(e.target.value)}
                                        placeholder="https://192.168.1.100:3001"
                                        className="flex-1 px-4 py-3 rounded-xl border-2 border-blue-200 focus:border-blue-500 focus:outline-none font-mono text-sm"
                                    />
                                    <button
                                        onClick={handleTestConnection}
                                        disabled={isTestingConnection || !masterUrl}
                                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-xl font-bold transition-colors flex items-center gap-2"
                                    >
                                        {isTestingConnection ? (
                                            <><RefreshCw className="animate-spin" size={16} /> Probando...</>
                                        ) : (
                                            <>Probar Conexión</>
                                        )}
                                    </button>
                                    <button
                                        onClick={async () => {
                                            try {
                                                await syncManager.setMasterUrl(masterUrl);
                                                alert('✅ Configuración guardada y conexión establecida exitosamente');
                                                await loadStatus();
                                            } catch (error) {
                                                console.error('Error saving config:', error);
                                                alert('⚠️ Configuración guardada, pero no se pudo conectar con el Master: ' + (error instanceof Error ? error.message : 'Error desconocido'));
                                                await loadStatus();
                                            }
                                        }}
                                        disabled={!masterUrl}
                                        className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white rounded-xl font-bold transition-colors flex items-center gap-2"
                                    >
                                        <CheckCircle2 size={16} /> Guardar
                                    </button>

                                </div>
                                {connectionStatus?.masterUrl && (
                                    <p className="text-xs text-blue-600 mt-2">
                                        ✓ Configurado: {connectionStatus.masterUrl}
                                    </p>
                                )}
                            </div>
                        )}

                        {activeTab === 'MONITOR' && (
                            <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
                                {/* Detailed Table */}
                                <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                                    <table className="w-full">
                                        <thead className="bg-gray-50 border-b border-gray-100">
                                            <tr>
                                                <th className="text-left py-4 px-6 text-xs font-bold text-gray-400 uppercase">Colección de Datos</th>
                                                <th className="text-center py-4 px-6 text-xs font-bold text-gray-400 uppercase">Registros Locales</th>
                                                <th className="text-center py-4 px-6 text-xs font-bold text-gray-400 uppercase">Versión Local</th>
                                                <th className="text-center py-4 px-6 text-xs font-bold text-gray-400 uppercase">Versión Remota</th>
                                                <th className="text-right py-4 px-6 text-xs font-bold text-gray-400 uppercase">Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {status.map((s) => (
                                                <tr key={s.collection} className="hover:bg-gray-50/50 transition-colors">
                                                    <td className="py-4 px-6">
                                                        <div className="font-bold text-gray-700">{getCollectionLabel(s.collection)}</div>
                                                        <div className="text-xs text-gray-400 font-mono mt-1">{s.collection}</div>
                                                    </td>
                                                    <td className="py-4 px-6 text-center font-mono font-bold text-gray-600">
                                                        {s.itemCount?.toLocaleString() || '-'}
                                                    </td>
                                                    <td className="py-4 px-6 text-center">
                                                        <span className="px-2 py-1 rounded bg-gray-100 text-gray-500 text-xs font-mono font-bold">
                                                            v{s.localVersion}
                                                        </span>
                                                    </td>
                                                    <td className="py-4 px-6 text-center">
                                                        {s.remoteVersion ? (
                                                            <span className={`px-2 py-1 rounded text-xs font-mono font-bold ${s.remoteVersion > s.localVersion
                                                                ? 'bg-yellow-100 text-yellow-700'
                                                                : 'bg-green-100 text-green-700'
                                                                }`}>
                                                                v{s.remoteVersion}
                                                            </span>
                                                        ) : (
                                                            <span className="text-gray-300">-</span>
                                                        )}
                                                    </td>
                                                    <td className="py-4 px-6 text-right">
                                                        <div className="flex items-center justify-end gap-2">
                                                            {s.status === 'SYNCED' ? (
                                                                <>
                                                                    <span className="text-xs font-bold text-emerald-600">Sincronizado</span>
                                                                    <CheckCircle2 size={18} className="text-emerald-500" />
                                                                </>
                                                            ) : s.status === 'PENDING' ? (
                                                                <>
                                                                    <span className="text-xs font-bold text-yellow-600">Actualización Disp.</span>
                                                                    <Clock size={18} className="text-yellow-500" />
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <span className="text-xs font-bold text-red-600">Error</span>
                                                                    <AlertCircle size={18} className="text-red-500" />
                                                                </>
                                                            )}
                                                        </div>
                                                        {s.lastSyncedAt && (
                                                            <div className="text-[10px] text-gray-400 mt-1">
                                                                {new Date(s.lastSyncedAt).toLocaleTimeString()}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {activeTab === 'TERMINALS' && isMaster && (
                            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300">
                                {/* Connected Terminals (Master Only) */}
                                <div className="mt-8 space-y-8">
                                    {/* Operational Stats Section */}
                                    <div>
                                        <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                                            <Database size={24} className="text-blue-600" /> Documentos Recibidos por Terminal
                                        </h3>
                                        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                                            <table className="w-full">
                                                <thead className="bg-blue-50 border-b border-blue-100">
                                                    <tr>
                                                        <th className="text-left py-4 px-6 text-xs font-bold text-blue-800 uppercase">Terminal</th>
                                                        <th className="text-center py-4 px-6 text-xs font-bold text-blue-800 uppercase">Ventas (Txns)</th>
                                                        <th className="text-center py-4 px-6 text-xs font-bold text-blue-800 uppercase">Mov. Inventario</th>
                                                        <th className="text-center py-4 px-6 text-xs font-bold text-blue-800 uppercase">Cierres (Z)</th>
                                                        <th className="text-center py-4 px-6 text-xs font-bold text-blue-800 uppercase">Pendientes</th>
                                                        <th className="text-center py-4 px-6 text-xs font-bold text-blue-800 uppercase">Errores</th>
                                                        <th className="text-right py-4 px-6 text-xs font-bold text-blue-800 uppercase">Última Actividad</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-50">
                                                    {connectedTerminals.length === 0 ? (
                                                        <tr>
                                                            <td colSpan={7} className="py-8 text-center text-gray-400 italic">
                                                                No hay datos operativos recibidos aún.
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        connectedTerminals.map((t) => (
                                                            <tr key={t.terminalId} className="hover:bg-gray-50/50 transition-colors">
                                                                <td className="py-4 px-6">
                                                                    <div className="font-bold text-gray-700 flex items-center gap-2">
                                                                        <Monitor size={16} className="text-gray-400" />
                                                                        {t.terminalId}
                                                                    </div>
                                                                </td>
                                                                <td className="py-4 px-6 text-center">
                                                                    <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 font-bold text-sm">
                                                                        {t.transactions || 0}
                                                                    </span>
                                                                </td>
                                                                <td className="py-4 px-6 text-center">
                                                                    <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 font-bold text-sm">
                                                                        {t.movements || 0}
                                                                    </span>
                                                                </td>
                                                                <td className="py-4 px-6 text-center">
                                                                    <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-700 font-bold text-sm">
                                                                        {t.zReports || 0}
                                                                    </span>
                                                                </td>
                                                                <td className="py-4 px-6 text-center">
                                                                    <span className={`px-3 py-1 rounded-full font-bold text-sm ${t.pending > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-400'}`}>
                                                                        {t.pending || 0}
                                                                    </span>
                                                                </td>
                                                                <td className="py-4 px-6 text-center">
                                                                    <span className={`px-3 py-1 rounded-full font-bold text-sm ${t.errors > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-400'}`}>
                                                                        {t.errors || 0}
                                                                    </span>
                                                                </td>
                                                                <td className="py-4 px-6 text-right">
                                                                    <div className="text-sm font-medium text-gray-700">
                                                                        {t.lastActivity ? new Date(t.lastActivity).toLocaleString() : 'Nunca'}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    {/* Connection Status Section */}
                                    <div>
                                        <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                                            <Monitor size={24} className="text-purple-600" /> Estado de Conexión de Terminales
                                        </h3>
                                        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                                            <table className="w-full">
                                                <thead className="bg-purple-50 border-b border-purple-100">
                                                    <tr>
                                                        <th className="text-left py-4 px-6 text-xs font-bold text-purple-800 uppercase">Terminal ID</th>
                                                        <th className="text-left py-4 px-6 text-xs font-bold text-purple-800 uppercase">Dirección IP</th>
                                                        <th className="text-center py-4 px-6 text-xs font-bold text-purple-800 uppercase">Última Conexión</th>
                                                        <th className="text-right py-4 px-6 text-xs font-bold text-purple-800 uppercase">Estado</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-50">
                                                    {connectedTerminals.map((t) => (
                                                        <tr key={t.terminalId} className="hover:bg-gray-50/50 transition-colors">
                                                            <td className="py-4 px-6">
                                                                <div className="font-bold text-gray-700 flex items-center gap-2">
                                                                    <Laptop size={16} className="text-gray-400" />
                                                                    {t.terminalId}
                                                                </div>
                                                            </td>
                                                            <td className="py-4 px-6 font-mono text-sm text-gray-600">
                                                                {t.ip}
                                                            </td>
                                                            <td className="py-4 px-6 text-center">
                                                                <div className="flex flex-col items-center">
                                                                    <span className="text-sm font-medium text-gray-700">
                                                                        {new Date(t.lastSeen).toLocaleTimeString()}
                                                                    </span>
                                                                    <span className="text-xs text-gray-400">
                                                                        Hace {Math.floor((Date.now() - new Date(t.lastSeen).getTime()) / 60000)} min
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="py-4 px-6 text-right">
                                                                <div className="flex justify-end">
                                                                    <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${t.status === 'MASTER'
                                                                        ? 'bg-purple-100 text-purple-700'
                                                                        : t.status === 'ONLINE'
                                                                            ? 'bg-emerald-100 text-emerald-700'
                                                                            : 'bg-gray-100 text-gray-500'
                                                                        }`}>
                                                                        {t.status === 'MASTER' ? (
                                                                            <><Server size={14} /> Local (Master)</>
                                                                        ) : t.status === 'ONLINE' ? (
                                                                            <><Wifi size={14} /> En Línea</>
                                                                        ) : (
                                                                            <><WifiOff size={14} /> Desconectado</>
                                                                        )}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'HELP' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-bottom-4 duration-300">
                                {/* Help Section */}
                                <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
                                    <h3 className="font-bold text-blue-800 mb-2 flex items-center gap-2">
                                        <ShieldCheck size={18} /> Integridad de Datos
                                    </h3>
                                    <p className="text-sm text-blue-600 leading-relaxed">
                                        El sistema utiliza un mecanismo de "fuente única de verdad". La terminal Master es la autoridad.
                                        Si nota discrepancias, utilice "Forzar Subida" en el Master y luego "Sincronizar Ahora" en las esclavas.
                                    </p>
                                </div>
                                <div className="bg-orange-50 rounded-2xl p-6 border border-orange-100">
                                    <h3 className="font-bold text-orange-800 mb-2 flex items-center gap-2">
                                        <AlertCircle size={18} /> Solución de Problemas
                                    </h3>
                                    <p className="text-sm text-orange-600 leading-relaxed">
                                        Si las series de facturas no coinciden, asegúrese de que la terminal Master haya completado una subida exitosa.
                                        Verifique que ambas terminales estén en la misma red si usa sincronización local.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SyncSettings;
