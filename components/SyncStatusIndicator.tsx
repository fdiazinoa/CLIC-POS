/**
 * Sync Status Indicator Component
 * 
 * Displays real-time synchronization status for catalog collections.
 * Shows which collections are synced, pending, or have errors.
 */

import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { syncManager } from '../services/sync/SyncManager';
import { permissionService } from '../services/sync/PermissionService';

interface SyncStatusProps {
    onSync?: () => void;
    compact?: boolean;
}

const SyncStatusIndicator: React.FC<SyncStatusProps> = ({ onSync, compact = false }) => {
    const [status, setStatus] = useState<any[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
    const [showDetails, setShowDetails] = useState(false);

    const loadStatus = async () => {
        const statuses = await syncManager.getSyncStatus();
        setStatus(statuses);
    };

    useEffect(() => {
        loadStatus();

        // Refresh status every 10 seconds
        const interval = setInterval(loadStatus, 10000);

        return () => clearInterval(interval);
    }, []);

    const handleSync = async () => {
        setIsSyncing(true);
        try {
            await syncManager.syncAllCatalogs();
            setLastSyncTime(new Date());
            await loadStatus();
            if (onSync) onSync();
        } catch (error) {
            console.error('Sync error:', error);
        } finally {
            setIsSyncing(false);
        }
    };

    const pendingCount = status.filter(s => s.status === 'PENDING').length;
    const errorCount = status.filter(s => s.status === 'ERROR').length;
    const syncedCount = status.filter(s => s.status === 'SYNCED').length;

    const getCollectionLabel = (collection: string) => {
        const labels: { [key: string]: string } = {
            products: 'Productos',
            customers: 'Clientes',
            suppliers: 'Proveedores',
            internalSequences: 'Series'
        };
        return labels[collection] || collection;
    };

    if (compact) {
        return (
            <button
                onClick={handleSync}
                disabled={isSyncing}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-all text-sm font-medium disabled:opacity-50"
            >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Sincronizando...' : (
                    pendingCount > 0 ? `${pendingCount} pendiente${pendingCount > 1 ? 's' : ''}` : 'Sincronizado'
                )}
            </button>
        );
    }

    return (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${errorCount > 0 ? 'bg-red-100 text-red-600' :
                            pendingCount > 0 ? 'bg-yellow-100 text-yellow-600' :
                                'bg-emerald-100 text-emerald-600'
                        }`}>
                        {errorCount > 0 ? <AlertCircle className="h-5 w-5" /> :
                            pendingCount > 0 ? <Clock className="h-5 w-5" /> :
                                <CheckCircle2 className="h-5 w-5" />}
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-800">
                            Estado de Sincronización
                        </h3>
                        <p className="text-xs text-gray-500">
                            {permissionService.isMasterTerminal() ? 'Terminal Master' : 'Terminal Esclava'}
                        </p>
                    </div>
                </div>

                <button
                    onClick={handleSync}
                    disabled={isSyncing}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all shadow-sm font-medium text-sm"
                >
                    <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                    {isSyncing ? 'Sincronizando...' : 'Sincronizar Ahora'}
                </button>
            </div>

            {lastSyncTime && (
                <p className="text-xs text-gray-400 mb-4">
                    Última sincronización: {lastSyncTime.toLocaleString()}
                </p>
            )}

            <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-emerald-50 rounded-xl p-3 text-center">
                    <div className="text-2xl font-black text-emerald-600">{syncedCount}</div>
                    <div className="text-xs text-emerald-700 font-medium">Sincronizados</div>
                </div>
                <div className="bg-yellow-50 rounded-xl p-3 text-center">
                    <div className="text-2xl font-black text-yellow-600">{pendingCount}</div>
                    <div className="text-xs text-yellow-700 font-medium">Pendientes</div>
                </div>
                <div className="bg-red-50 rounded-xl p-3 text-center">
                    <div className="text-2xl font-black text-red-600">{errorCount}</div>
                    <div className="text-xs text-red-700 font-medium">Errores</div>
                </div>
            </div>

            <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium w-full text-center"
            >
                {showDetails ? 'Ocultar detalles' : 'Ver detalles'}
            </button>

            {showDetails && (
                <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
                    {status.map((s) => (
                        <div key={s.collection} className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
                            <div className="flex items-center gap-2">
                                {s.status === 'SYNCED' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> :
                                    s.status === 'PENDING' ? <Clock className="h-4 w-4 text-yellow-600" /> :
                                        <AlertCircle className="h-4 w-4 text-red-600" />}
                                <span className="text-sm font-medium text-gray-700">
                                    {getCollectionLabel(s.collection)}
                                </span>
                            </div>
                            <span className="text-xs text-gray-400">
                                v{s.localVersion}
                                {s.remoteVersion && s.remoteVersion > s.localVersion && (
                                    <span className="text-yellow-600 ml-2">→ v{s.remoteVersion}</span>
                                )}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SyncStatusIndicator;
