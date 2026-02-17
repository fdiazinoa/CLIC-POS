import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, Clock, UploadCloud, DownloadCloud, Database, Server, ArrowRight, ShieldCheck, X, Wifi, WifiOff, Globe, Monitor, Laptop, Search, Filter, RotateCcw, Code } from 'lucide-react';
import { syncManager } from '../services/sync/SyncManager';
import { permissionService } from '../services/sync/PermissionService';
import { BusinessConfig } from '../types';
import SyncProgressModal from './SyncProgressModal';
import { db } from '../utils/db';

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
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'ERROR'>('ALL');
    const [terminalFilter, setTerminalFilter] = useState('ALL');
    const [auditData, setAuditData] = useState<any[]>([]);
    const [selectedJson, setSelectedJson] = useState<any>(null);
    const [isRefreshingAudit, setIsRefreshingAudit] = useState(false);

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
                    .filter(tid => /^t\d+$/i.test(tid)) // Only show "real" terminals (t1, t2, t3...)
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

            // Load Audit Data for Data Monitor
            if (activeTab === 'MONITOR') {
                const [txns, reservations, movements, zReports] = await Promise.all([
                    db.get('transactions'),
                    db.get('reservations'),
                    db.get('inventoryLedger'),
                    db.get('zReports')
                ]);

                const formattedTxns = (txns as any[] || []).map(t => ({
                    id: t.displayId || t.id,
                    terminalId: t.terminalId || '-',
                    type: 'VENTA',
                    date: t.date || t.createdAt,
                    status: t.cloudSyncStatus || 'PENDING',
                    error: t.cloudSyncError,
                    raw: t
                }));

                const formattedRes = (reservations as any[] || []).map(r => ({
                    id: r.code || r.id,
                    terminalId: r.terminalId || '-',
                    type: 'RESERVA',
                    date: r.createdAt,
                    status: r.cloudSyncStatus || 'PENDING',
                    error: r.cloudSyncError,
                    raw: r
                }));

                const formattedMovs = (movements as any[] || []).map(m => ({
                    id: m.documentRef || m.id,
                    terminalId: m.terminalId || '-',
                    type: 'INVENTARIO',
                    date: m.createdAt || m.timestamp,
                    status: m.cloudSyncStatus || 'PENDING',
                    error: m.cloudSyncError,
                    raw: m
                }));

                const formattedZs = (zReports as any[] || []).map(z => ({
                    id: z.sequenceNumber || z.id,
                    terminalId: z.terminalId || '-',
                    type: 'CIERRE_Z',
                    date: z.closedAt,
                    status: z.cloudSyncStatus || 'PENDING',
                    error: z.cloudSyncError,
                    raw: z
                }));

                const combined = [...formattedTxns, ...formattedRes, ...formattedMovs, ...formattedZs]
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                setAuditData(combined);
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

                                <div className="mt-10 pt-6 border-t border-blue-100">
                                    <button
                                        onClick={async () => {
                                            if (confirm('⚠️ ¿Deseas REALIZAR UN RESET TOTAL de la red en esta terminal?\n\nAl hacerlo:\n- Se borrará la IP de la Maestra guardada.\n- Se reseteará la configuración local (se restaurarán valores por defecto).\n- Regresarás a la pantalla de vinculación para elegir si eres Maestra o Esclava.')) {
                                                try {
                                                    // 1. Clear LocalStorage identifiers
                                                    localStorage.removeItem('pos_device_id');
                                                    localStorage.removeItem('pos_master_ip');
                                                    localStorage.removeItem('CLIC_POS_MASTER_URL');
                                                    localStorage.removeItem('pos_sync_status');

                                                    // 2. Wipe Local DB Config to avoid stale Slave/Master role mismatch
                                                    await db.deleteDocument('config', 'config' as any); // Delete whole config document

                                                    console.log("🧺 Terminal Unbound & Local Config Wiped.");
                                                    window.location.reload();
                                                } catch (err) {
                                                    console.error("Error during reset:", err);
                                                    alert("Error al resetear. Se recomienda limpiar el caché del navegador manualmente.");
                                                }
                                            }
                                        }}
                                        className="w-full py-3 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2 border border-red-100"
                                    >
                                        <Monitor size={18} />
                                        Desvincular y Resetear Identidad de Terminal
                                    </button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'MONITOR' && (
                            <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
                                {/* Filter Bar */}
                                <div className="flex flex-wrap items-center gap-4 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
                                    <div className="flex-1 min-w-[200px] relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                        <input
                                            type="text"
                                            placeholder="Buscar por ID o NCF..."
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            className="w-full pl-10 pr-4 py-2 bg-gray-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Filter size={16} className="text-gray-400" />
                                        <select
                                            value={statusFilter}
                                            onChange={(e) => setStatusFilter(e.target.value as any)}
                                            className="bg-gray-50 border-none rounded-xl text-sm py-2 px-4 focus:ring-2 focus:ring-blue-500 font-bold text-gray-600"
                                        >
                                            <option value="ALL">Todos los Estados</option>
                                            <option value="PENDING">Pendientes ☁️</option>
                                            <option value="ERROR">Errores ❌</option>
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Monitor size={16} className="text-gray-400" />
                                        <select
                                            value={terminalFilter}
                                            onChange={(e) => setTerminalFilter(e.target.value)}
                                            className="bg-gray-50 border-none rounded-xl text-sm py-2 px-4 focus:ring-2 focus:ring-blue-500 font-bold text-gray-600"
                                        >
                                            <option value="ALL">Todas las Terminales</option>
                                            {connectedTerminals.map(t => (
                                                <option key={t.terminalId} value={t.terminalId}>{t.terminalId}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <button
                                        onClick={() => loadStatus()}
                                        className="p-2 hover:bg-gray-100 rounded-xl text-blue-600 transition-all"
                                        title="Refrescar lista"
                                    >
                                        <RotateCcw size={20} className={isRefreshingAudit ? 'animate-spin' : ''} />
                                    </button>
                                </div>

                                {/* Audit Table */}
                                <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                                    <table className="w-full border-collapse">
                                        <thead className="bg-gray-50 border-b border-gray-100">
                                            <tr>
                                                <th className="text-left py-4 px-6 text-xs font-bold text-gray-400 uppercase">Documento</th>
                                                <th className="text-center py-4 px-6 text-xs font-bold text-gray-400 uppercase">Terminal</th>
                                                <th className="text-center py-4 px-6 text-xs font-bold text-gray-400 uppercase">Tipo</th>
                                                <th className="text-center py-4 px-6 text-xs font-bold text-gray-400 uppercase">Fecha Local</th>
                                                <th className="text-center py-4 px-6 text-xs font-bold text-gray-400 uppercase">Estado Nube</th>
                                                <th className="text-right py-4 px-6 text-xs font-bold text-gray-400 uppercase">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {auditData
                                                .filter(item => {
                                                    const matchesSearch = item.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                                        (item.raw?.ncf || '').toLowerCase().includes(searchTerm.toLowerCase());
                                                    const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
                                                    const matchesTerminal = terminalFilter === 'ALL' || item.terminalId === terminalFilter;
                                                    return matchesSearch && matchesStatus && matchesTerminal;
                                                })
                                                .map((item) => (
                                                    <tr key={item.raw.id} className="hover:bg-gray-50/50 transition-colors group">
                                                        <td className="py-4 px-6">
                                                            <div className="font-bold text-gray-700 font-mono text-sm">{item.id}</div>
                                                            {item.raw?.ncf && (
                                                                <div className="text-[10px] text-blue-600 font-bold mt-0.5">{item.raw.ncf}</div>
                                                            )}
                                                        </td>
                                                        <td className="py-4 px-6 text-center">
                                                            <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-100 text-gray-600 font-bold text-xs">
                                                                <Monitor size={12} /> {item.terminalId}
                                                            </div>
                                                        </td>
                                                        <td className="py-4 px-6 text-center">
                                                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${item.type === 'VENTA' ? 'bg-emerald-100 text-emerald-700' :
                                                                item.type === 'RESERVA' ? 'bg-amber-100 text-amber-700' :
                                                                    item.type === 'INVENTARIO' ? 'bg-blue-100 text-blue-700' :
                                                                        'bg-purple-100 text-purple-700'
                                                                }`}>
                                                                {item.type}
                                                            </span>
                                                        </td>
                                                        <td className="py-4 px-6 text-center">
                                                            <div className="text-xs text-gray-600 font-medium">
                                                                {new Date(item.date).toLocaleDateString()}
                                                            </div>
                                                            <div className="text-[10px] text-gray-400">
                                                                {new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                            </div>
                                                        </td>
                                                        <td className="py-4 px-6 text-center">
                                                            <div className="flex items-center justify-center gap-2">
                                                                {item.status === 'SYNCED' ? (
                                                                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase">
                                                                        <CheckCircle2 size={12} /> Sincronizado
                                                                    </span>
                                                                ) : item.status === 'ERROR' ? (
                                                                    <span
                                                                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-red-100 text-red-700 text-[10px] font-black uppercase cursor-help"
                                                                        title={item.error || 'Error desconocido'}
                                                                    >
                                                                        <AlertCircle size={12} /> Error
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-gray-100 text-gray-500 text-[10px] font-black uppercase">
                                                                        <Clock size={12} /> Pendiente
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="py-4 px-6 text-right">
                                                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <button
                                                                    onClick={() => setSelectedJson(item.raw)}
                                                                    className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-blue-600 transition-all"
                                                                    title="Ver JSON"
                                                                >
                                                                    <Code size={16} />
                                                                </button>
                                                                {item.status === 'ERROR' && (
                                                                    <button
                                                                        className="p-2 hover:bg-gray-100 rounded-lg text-red-400 hover:text-red-600 transition-all"
                                                                        title="Reintentar envío"
                                                                    >
                                                                        <RotateCcw size={16} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            {auditData.length === 0 && (
                                                <tr>
                                                    <td colSpan={6} className="py-12 text-center text-gray-400 italic">
                                                        No se encontraron documentos procesados.
                                                    </td>
                                                </tr>
                                            )}
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

            {/* JSON Modal */}
            {selectedJson && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6 animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="px-8 py-6 border-b flex justify-between items-center bg-gray-50">
                            <div>
                                <h3 className="text-xl font-black text-gray-800">Detalles del Documento</h3>
                                <p className="text-xs text-gray-500 mt-1">Audit Data: {selectedJson.displayId || selectedJson.id || selectedJson.code}</p>
                            </div>
                            <button onClick={() => setSelectedJson(null)} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-400"><X /></button>
                        </div>
                        <div className="p-8">
                            <div className="bg-slate-900 rounded-2xl p-6 overflow-auto max-h-[500px]">
                                <pre className="text-emerald-400 font-mono text-sm leading-relaxed">
                                    {JSON.stringify(selectedJson, null, 2)}
                                </pre>
                            </div>
                            <div className="mt-8">
                                <button
                                    onClick={() => setSelectedJson(null)}
                                    className="w-full py-4 bg-slate-900 text-white font-black rounded-2xl active:scale-95 transition-all shadow-lg shadow-slate-200"
                                >
                                    Cerrar Vista Técnica
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SyncSettings;
