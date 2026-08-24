import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, Clock, UploadCloud, DownloadCloud, Database, Server, ArrowRight, ShieldCheck, X, Wifi, WifiOff, Globe, Monitor, Laptop, Search, Filter, RotateCcw, Code, Copy, Check } from 'lucide-react';
import { syncManager } from '../services/sync/SyncManager';
import { permissionService } from '../services/sync/PermissionService';
import { backgroundSyncManager } from '../services/sync/BackgroundSyncManager';
import { BusinessConfig } from '../types';
import SyncProgressModal from './SyncProgressModal';
import { db } from '../utils/db';
import { loadSyncProfile, resolveSyncTarget, SyncProfile, ResolvedSyncTarget } from '../services/sync/SyncProfile';
import { posCloudStagingService } from '../services/sync/PosCloudStagingService';
import { resetDeviceIdentityBySupport } from '../utils/deviceRevocation';
import { getConfigPushV2Diagnostics, triggerErpSyncOutbox } from '../utils/erpSyncLifecycle';
import { syncTriggerCoordinator } from '../services/sync/SyncTriggerCoordinator';

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
    const [erpForwardStatus, setErpForwardStatus] = useState<any>(null);
    const [isRetryingErpForward, setIsRetryingErpForward] = useState(false);
    const [jsonCopyStatus, setJsonCopyStatus] = useState<'COPIED' | 'ERROR' | null>(null);
    const [retryingDocumentKey, setRetryingDocumentKey] = useState<string | null>(null);
    const [retryFeedback, setRetryFeedback] = useState<{ key: string; type: 'success' | 'error' | 'pending'; message: string } | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [syncProfile, setSyncProfile] = useState<SyncProfile>(() => loadSyncProfile());
    const [syncTarget, setSyncTarget] = useState<ResolvedSyncTarget>(() => resolveSyncTarget());
    const [diagnosticCounts, setDiagnosticCounts] = useState<Record<string, number>>({});
    const [isSendingSnapshot, setIsSendingSnapshot] = useState(false);
    const [configPushDiagnostics, setConfigPushDiagnostics] = useState<{
        baseCurrency: string;
        enabledCurrencies: string[];
        versionHash: string | null;
        configVersion: number;
        appliedAt: string | null;
    } | null>(null);
    const [isRetryingConfigPush, setIsRetryingConfigPush] = useState(false);
    const [configPushRetryResult, setConfigPushRetryResult] = useState<{
        type: 'success' | 'error';
        message: string;
    } | null>(null);

    const resolveDocumentStatus = (raw: any): 'SYNCED' | 'PENDING' | 'ERROR' => {
        const status = String(raw?.syncStatus || raw?.cloudSyncStatus || '').toUpperCase();
        if (status === 'COMPLETED' || status === 'SYNCED') return 'SYNCED';
        if (status === 'ERROR') return 'ERROR';
        return 'PENDING';
    };

    const resolveDocumentError = (raw: any): string | undefined =>
        raw?.syncError || raw?.cloudSyncError || raw?.fiscalSyncError || undefined;

    const normalizeDocumentRef = (value: any): string => String(value || '').trim().toLowerCase();

    const collectDocumentRefs = (raw: any): string[] => [
        raw?.id,
        raw?.displayId,
        raw?.documentRef,
        raw?.reference,
        raw?.source_transaction_id,
        raw?.source_display_id,
        raw?.transactionId,
        raw?.saleId,
        raw?.ncf,
        raw?.electronicNcf
    ]
        .map(normalizeDocumentRef)
        .filter(Boolean);

    const isSaleInventoryMovement = (movement: any): boolean => {
        const concept = normalizeDocumentRef(movement?.concept || movement?.concepto || movement?.type);
        return concept === 'venta' || concept === 'sale';
    };

    const resolveRetryId = (item: any): string | undefined =>
        item?.raw?.source_transaction_id ||
        item?.raw?.id ||
        item?.raw?.displayId ||
        item?.id;

    const aggregateDocumentStatus = (items: any[]): 'SYNCED' | 'PENDING' | 'ERROR' => {
        const statuses = items.map(resolveDocumentStatus);
        if (statuses.includes('ERROR')) return 'ERROR';
        if (statuses.includes('PENDING')) return 'PENDING';
        return 'SYNCED';
    };

    const resolveTerminalDisplayName = (terminalId: any): string => {
        const rawId = String(terminalId || '').trim();
        if (!rawId || rawId === '-') return '-';
        const normalized = normalizeDocumentRef(rawId);
        const terminal = (config.terminals || []).find((candidate: any) => {
            const terminalConfig: any = candidate?.config || {};
            const refs = [
                candidate?.id,
                terminalConfig?.terminalName,
                terminalConfig?.terminalCode,
                terminalConfig?.stationNumber,
                terminalConfig?.erpTerminalId,
                terminalConfig?.erpBinding?.terminalId,
                terminalConfig?.erpBinding?.terminalName,
                terminalConfig?.erpBinding?.terminalCode,
            ].map(normalizeDocumentRef).filter(Boolean);
            return refs.includes(normalized);
        });
        const terminalConfig: any = terminal?.config || {};
        return String(
            terminalConfig?.terminalName ||
            terminalConfig?.erpBinding?.terminalName ||
            terminalConfig?.terminalCode ||
            terminalConfig?.stationNumber ||
            rawId
        ).trim();
    };

    const loadStatus = async () => {
        try {
            const statuses = await syncManager.getSyncStatus();
            setStatus(statuses);
            setIsMaster(permissionService.isMasterTerminal());
            const profile = loadSyncProfile();
            const target = resolveSyncTarget(profile);
            setSyncProfile(profile);
            setSyncTarget(target);
            const persistedValue = await db.get('config');
            const persistedConfig = persistedValue && !Array.isArray(persistedValue)
                ? persistedValue as unknown as BusinessConfig
                : null;
            const effectiveConfig = persistedConfig || config;
            const enabledCurrencies = (effectiveConfig.currencies || [])
                .filter((currency) => currency.isEnabled)
                .map((currency) => currency.code);
            const baseCurrency = (effectiveConfig.currencies || [])
                .find((currency) => currency.isBase)?.code
                || enabledCurrencies[0]
                || 'DOP';
            const configPushState = getConfigPushV2Diagnostics();
            setConfigPushDiagnostics({
                baseCurrency,
                enabledCurrencies,
                versionHash: configPushState.versionHash,
                configVersion: Number(configPushState.domainVersions.config || 0),
                appliedAt: configPushState.appliedAt,
            });

            // Get connection status
            const connStatus = syncManager.getSyncConnectionStatus();
            setConnectionStatus(connStatus);

            // Load connected terminals if Master
            let opStatus: any = null;
            if (permissionService.isMasterTerminal()) {
                const terminals = await syncManager.getConnectedTerminals();
                opStatus = await syncManager.getOperationalStatus();
                setErpForwardStatus(opStatus?.erpForward || null);

                const allTerminalIds = new Set([
                    ...terminals.map(t => t.terminalId),
                    ...(opStatus?.terminals?.map((t: any) => t.terminalId) || [])
                ]);
                const [
                    products,
                    customers,
                    suppliers,
                    users,
                    warehouses,
                    paymentMethods,
                    internalSequences,
                    productStocks
                ] = await Promise.all([
                    db.get('products'),
                    db.get('customers'),
                    db.get('suppliers'),
                    db.get('users'),
                    db.get('warehouses'),
                    db.get('paymentMethods'),
                    db.get('internalSequences'),
                    db.get('productStocks')
                ]);
                setDiagnosticCounts({
                    products: Array.isArray(products) ? products.length : 0,
                    customers: Array.isArray(customers) ? customers.length : 0,
                    suppliers: Array.isArray(suppliers) ? suppliers.length : 0,
                    users: Array.isArray(users) ? users.length : 0,
                    warehouses: Array.isArray(warehouses) ? warehouses.length : 0,
                    paymentMethods: Array.isArray(paymentMethods) ? paymentMethods.length : 0,
                    internalSequences: Array.isArray(internalSequences) ? internalSequences.length : 0,
                    productStocks: Array.isArray(productStocks) ? productStocks.length : 0,
                });

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
            } else {
                setErpForwardStatus(null);
            }

            // Load Audit Data for Data Monitor
            if (activeTab === 'MONITOR') {
                const [txns, reservations, movements, zReports] = await Promise.all([
                    db.get('transactions'),
                    db.get('reservations'),
                    db.get('inventoryLedger'),
                    db.get('zReports')
                ]);

                const transactionRefs = new Set<string>();
                (txns as any[] || []).forEach((t) => {
                    collectDocumentRefs(t).forEach((normalized) => transactionRefs.add(normalized));
                });

                const formattedTxns = (txns as any[] || []).map(t => ({
                    key: `transactions:${t.id}`,
                    collection: 'transactions',
                    id: t.displayId || t.id,
                    terminalId: t.terminalId || '-',
                    terminalLabel: resolveTerminalDisplayName(t.terminalId || t.source_terminal_id || '-'),
                    type: 'VENTA',
                    date: t.date || t.createdAt,
                    status: resolveDocumentStatus(t),
                    error: resolveDocumentError(t),
                    raw: t
                }));

                const formattedRes = (reservations as any[] || []).map(r => ({
                    key: `reservations:${r.id}`,
                    collection: 'reservations',
                    id: r.code || r.id,
                    terminalId: r.terminalId || '-',
                    terminalLabel: resolveTerminalDisplayName(r.terminalId || r.source_terminal_id || '-'),
                    type: 'RESERVA',
                    date: r.createdAt,
                    status: resolveDocumentStatus(r),
                    error: resolveDocumentError(r),
                    raw: r
                }));

                const inventoryGroups = new Map<string, any[]>();
                (movements as any[] || []).forEach((m) => {
                    const movementRefs = collectDocumentRefs(m);
                    const matchesKnownTransaction = movementRefs.some((movementRef) => {
                        if (transactionRefs.has(movementRef)) return true;
                        return Array.from(transactionRefs).some((transactionRef) =>
                            movementRef.length > transactionRef.length &&
                            (movementRef.startsWith(`${transactionRef}:`) ||
                                movementRef.startsWith(`${transactionRef}-`) ||
                                movementRef.startsWith(`${transactionRef}_`))
                        );
                    });

                    if (matchesKnownTransaction || isSaleInventoryMovement(m)) {
                        return;
                    }

                    const displayRef = m.documentRef || m.reference || m.source_display_id || m.id;
                    const normalizedGroupRef = normalizeDocumentRef(displayRef || m.id);
                    const normalizedTerminalId = normalizeDocumentRef(m.terminalId || '-');
                    const groupKey = `${normalizedGroupRef || normalizeDocumentRef(m.id)}::${normalizedTerminalId || '-'}`;
                    const group = inventoryGroups.get(groupKey) || [];
                    group.push(m);
                    inventoryGroups.set(groupKey, group);
                });

                const formattedMovs = Array.from(inventoryGroups.entries()).map(([groupKey, group]) => {
                    const first = group[0] || {};
                    const latest = group.reduce((current, movement) => {
                        const currentTime = new Date(current.createdAt || current.timestamp || 0).getTime();
                        const movementTime = new Date(movement.createdAt || movement.timestamp || 0).getTime();
                        return movementTime > currentTime ? movement : current;
                    }, first);
                    const id = first.documentRef || first.reference || first.source_display_id || first.id || groupKey;
                    return {
                        key: `inventoryLedger:${groupKey}`,
                        collection: 'inventoryLedger',
                        id,
                        terminalId: first.terminalId || '-',
                        terminalLabel: resolveTerminalDisplayName(first.terminalId || first.source_terminal_id || '-'),
                        type: 'INVENTARIO',
                        date: latest.createdAt || latest.timestamp || first.createdAt || first.timestamp,
                        status: aggregateDocumentStatus(group),
                        error: group.map(resolveDocumentError).find(Boolean),
                        movementCount: group.length,
                        raw: {
                            ...first,
                            id: first.id || groupKey,
                            documentRef: id,
                            movementCount: group.length,
                            movements: group
                        }
                    };
                });

                const formattedZs = (zReports as any[] || []).map(z => ({
                    key: `zReports:${z.id}`,
                    collection: 'zReports',
                    id: z.sequenceNumber || z.id,
                    terminalId: z.terminalId || '-',
                    terminalLabel: resolveTerminalDisplayName(z.terminalId || z.source_terminal_id || '-'),
                    type: 'CIERRE_Z',
                    date: z.closedAt,
                    status: resolveDocumentStatus(z),
                    error: resolveDocumentError(z),
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

    // Memoized Filtered Content
    const filteredAuditData = React.useMemo(() => {
        return auditData.filter(item => {
            const itemId = String(item.id || '').toLowerCase();
            const matchesSearch = itemId.includes(searchTerm.toLowerCase()) ||
                (item.raw?.ncf || '').toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
            const matchesTerminal = terminalFilter === 'ALL' || item.terminalId === terminalFilter;
            return matchesSearch && matchesStatus && matchesTerminal;
        });
    }, [auditData, searchTerm, statusFilter, terminalFilter]);

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, statusFilter, terminalFilter, rowsPerPage]);

    const selectedJsonText = React.useMemo(() => {
        if (!selectedJson) return '';
        return JSON.stringify(selectedJson, null, 2);
    }, [selectedJson]);

    useEffect(() => {
        setJsonCopyStatus(null);
    }, [selectedJson]);

    const copyTextToClipboard = async (text: string): Promise<boolean> => {
        if (!text) return false;

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch {
            // Fallback below handles Android WebView cases without Clipboard API permission.
        }

        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', 'true');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const copied = document.execCommand('copy');
            document.body.removeChild(textarea);
            return copied;
        } catch {
            return false;
        }
    };

    const handleCopySelectedJson = async () => {
        const copied = await copyTextToClipboard(selectedJsonText);
        setJsonCopyStatus(copied ? 'COPIED' : 'ERROR');
    };

    const resolveRetryResult = async (item: any): Promise<{ status: 'SYNCED' | 'PENDING' | 'ERROR'; error?: string }> => {
        if (!item?.collection) return { status: 'PENDING' };

        const data = await db.get(item.collection as any);
        if (!Array.isArray(data)) return { status: 'PENDING' };

        if (item.collection === 'inventoryLedger' && Array.isArray(item.raw?.movements)) {
            const movementIds = new Set(item.raw.movements.map((movement: any) => movement.id).filter(Boolean));
            const movements = data.filter((movement: any) => movementIds.has(movement.id));
            return {
                status: aggregateDocumentStatus(movements),
                error: movements.map(resolveDocumentError).find(Boolean)
            };
        }

        const document = data.find((entry: any) => entry.id === item.raw?.id) || null;
        if (!document) return { status: 'PENDING' };

        return {
            status: resolveDocumentStatus(document),
            error: resolveDocumentError(document)
        };
    };

    // Pagination Logic
    const totalPages = Math.ceil(filteredAuditData.length / rowsPerPage);
    const paginatedData = filteredAuditData.slice(
        (currentPage - 1) * rowsPerPage,
        currentPage * rowsPerPage
    );

    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, filteredAuditData.length);

    // Periodic polling
    useEffect(() => {
        const interval = setInterval(loadStatus, 5000);
        return () => clearInterval(interval);
    }, []);



    const handleSync = async () => {
        setIsSyncing(true);
        try {
            await syncTriggerCoordinator.request({ reason: 'MANUAL' });
            if (syncManager.isUsingConfigPushV2Primary()) {
                await syncManager.syncTerminalManifestInBackground(undefined, { reason: 'manual_sync' });
            } else {
                // Legacy/POS master modes preserve their existing catalog flow.
                await syncManager.syncAllCatalogs();
            }

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

    const handleRetryConfigPush = async () => {
        setIsRetryingConfigPush(true);
        setConfigPushRetryResult(null);
        try {
            const result = await triggerErpSyncOutbox('manual_sync');
            await loadStatus();
            if (!result) {
                throw new Error('La terminal no tiene una identidad ERP activa para consultar configuración.');
            }
            if (result.failed > 0) {
                throw new Error(`${result.failed} evento(s) de configuración terminaron con error.`);
            }
            setConfigPushRetryResult({
                type: 'success',
                message: result.applied > 0
                    ? `Configuración aplicada correctamente (${result.applied} evento(s)).`
                    : 'Sin cambios pendientes. La configuración local ya está actualizada.',
            });
        } catch (error) {
            setConfigPushRetryResult({
                type: 'error',
                message: error instanceof Error ? error.message : 'No se pudo sincronizar la configuración.',
            });
        } finally {
            setIsRetryingConfigPush(false);
        }
    };

    const handleRetryDocument = async (item: any) => {
        const feedbackKey = item?.key || `${item?.collection || 'document'}:${item?.id || item?.raw?.id || Date.now()}`;
        try {
            if (!item?.collection || !item?.raw?.id) return;
            setRetryingDocumentKey(feedbackKey);
            setRetryFeedback({ key: feedbackKey, type: 'pending', message: 'Reintentando envio...' });

            if (item.collection === 'inventoryLedger' && Array.isArray(item.raw.movements)) {
                await Promise.all(item.raw.movements.map((movement: any) =>
                    db.saveDocument('inventoryLedger' as any, {
                        ...movement,
                        syncStatus: 'PENDING',
                        syncError: undefined,
                        cloudSyncStatus: undefined,
                        cloudSyncError: undefined,
                        erpSyncStatus: undefined,
                        erpSyncResponse: undefined,
                        erpSyncedAt: undefined,
                        syncRetryAfter: undefined,
                        syncStartedAt: undefined,
                        syncBlockedReason: undefined,
                        syncBlockedAt: undefined
                    })
                ));
            } else {
                await db.saveDocument(item.collection as any, {
                    ...item.raw,
                    syncStatus: 'PENDING',
                    syncError: undefined,
                    cloudSyncStatus: undefined,
                    cloudSyncError: undefined,
                    syncResponse: undefined,
                    syncedAt: undefined,
                    erpSyncStatus: undefined,
                    erpSyncResponse: undefined,
                    erpSyncedAt: undefined,
                    syncRetryAfter: undefined,
                    syncStartedAt: undefined,
                    syncBlockedReason: undefined,
                    syncBlockedAt: undefined,
                    _forceSyncReplay: item.collection === 'transactions' ? true : item.raw?._forceSyncReplay
                });
            }

            await backgroundSyncManager.triggerSyncAndWait();

            if (
                item.collection === 'transactions' &&
                permissionService.isMasterTerminal() &&
                !syncManager.isUsingErpOperationalTarget()
            ) {
                try {
                    await syncManager.retryErpForwardQueue([resolveRetryId(item)].filter(Boolean) as string[]);
                } catch (error) {
                    console.warn('ERP forward queue retry failed after local requeue:', error);
                }
            }

            await loadStatus();

            const result = await resolveRetryResult(item);
            if (result.status === 'SYNCED') {
                setRetryFeedback({ key: feedbackKey, type: 'success', message: 'Documento enviado correctamente.' });
            } else if (result.status === 'ERROR') {
                const message = result.error || 'El reintento termino con error.';
                setRetryFeedback({ key: feedbackKey, type: 'error', message });
                alert('❌ Reintento falló: ' + message);
            } else {
                setRetryFeedback({ key: feedbackKey, type: 'pending', message: 'Reintento solicitado. El documento sigue pendiente.' });
                alert('⏳ Reintento solicitado. El documento sigue pendiente; revisa el estado en unos segundos.');
            }
        } catch (error) {
            console.error('Error retrying document sync:', error);
            setRetryFeedback({
                key: feedbackKey,
                type: 'error',
                message: error instanceof Error ? error.message : 'Error desconocido'
            });
            alert('❌ No se pudo reintentar el documento: ' + (error instanceof Error ? error.message : 'Error desconocido'));
        } finally {
            setRetryingDocumentKey(null);
        }
    };

    const handleRefreshAudit = async () => {
        setIsRefreshingAudit(true);
        try {
            await loadStatus();
        } finally {
            setIsRefreshingAudit(false);
        }
    };

    const handleRetryErpForward = async () => {
        setIsRetryingErpForward(true);
        try {
            if (syncManager.isUsingErpOperationalTarget()) {
                const requeued = await backgroundSyncManager.requeueBlockedOperationalDocuments();
                await backgroundSyncManager.triggerSyncAndWait();
                await loadStatus();
                alert(`✅ Reintento ejecutado. Documentos reencolados: ${requeued}. Revisa el monitor para confirmar si quedaron pendientes o con error.`);
                return;
            }

            const result = await syncManager.retryErpForwardQueue();
            await loadStatus();
            alert(`✅ Reintento ERP solicitado. En cola: ${result?.pending ?? 0}`);
        } catch (error) {
            console.error('Error retrying ERP forward:', error);
            alert('❌ No se pudo reintentar la cola ERP: ' + (error instanceof Error ? error.message : 'Error desconocido'));
        } finally {
            setIsRetryingErpForward(false);
        }
    };

    const handleSendCloudSnapshot = async () => {
        setIsSendingSnapshot(true);
        try {
            const result = await posCloudStagingService.sendSnapshot('MANUAL_SYNC_SETTINGS');
            await loadStatus();
            const pushed = Object.entries(result.pushed)
                .map(([collection, count]) => `${collection}: ${count}`)
                .join(', ');
            alert(pushed
                ? `✅ Snapshot enviado a cloud staging.\n${pushed}`
                : `ℹ️ No se envió snapshot. Canal actual: ${result.targetKind}`);
        } catch (error) {
            console.error('Cloud staging snapshot failed:', error);
            alert('❌ No se pudo enviar snapshot de maestros: ' + (error instanceof Error ? error.message : 'Error desconocido'));
        } finally {
            setIsSendingSnapshot(false);
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
            const usePort3000 = await clicConfirm(
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
        if (!await clicConfirm('⚠️ ¿Estás seguro? Esto reiniciará la sincronización y descargará TODO del servidor nuevamente.')) return;

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
                                            if (await clicConfirm('⚠️ SOPORTE: ¿Deseas resetear la identidad física de este dispositivo?\n\nAl hacerlo:\n- Se generará un nuevo device_id DEV-*.\n- Cloud-Admin deberá reautorizar este equipo.\n- Se borrará la IP de la Maestra guardada.\n- Se reseteará la configuración local.\n\nNo uses esta opción para limpiar solo la BD local.')) {
                                                try {
                                                    // 1. Explicit support-only identity reset
                                                    await resetDeviceIdentityBySupport();
                                                    localStorage.removeItem('pos_master_ip');
                                                    localStorage.removeItem('CLIC_POS_MASTER_URL');
                                                    localStorage.removeItem('pos_sync_status');

                                                    // 2. Wipe Local DB Config to avoid stale Slave/Master role mismatch
                                                    await db.deleteDocument('config', 'config' as any); // Delete whole config document

                                                    console.log("🧺 Terminal identity reset by support & local config wiped.");
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
                                        Resetear identidad del dispositivo (Soporte)
                                    </button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'MONITOR' && (
                            <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                        <div>
                                            <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">
                                                Estado de sincronización
                                            </h3>
                                            <p className="mt-1 text-sm font-semibold text-slate-500">
                                                El canal decide si el POS envia a cloud staging, ERP activo o Master local.
                                            </p>
                                        </div>
                                        <button
                                            onClick={handleSendCloudSnapshot}
                                            disabled={isSendingSnapshot || syncTarget.kind !== 'POS_CLOUD_STAGING'}
                                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-sm transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            <UploadCloud size={16} className={isSendingSnapshot ? 'animate-pulse' : ''} />
                                            Enviar snapshot maestros
                                        </button>
                                    </div>

                                    <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                                        {[
                                            ['Producto contratado', syncProfile.contractedProduct],
                                            ['Runtime POS', syncProfile.posRuntime],
                                            ['Canal cloud', syncTarget.kind],
                                            ['Fuente maestros', syncTarget.dataMaster],
                                            ['Cliente ve ERP', syncTarget.customerErpAccess ? 'SI' : 'NO'],
                                            ['Cloud staging', syncProfile.cloudStagingReady || syncTarget.kind === 'POS_CLOUD_STAGING' ? 'LISTO' : 'NO'],
                                            ['ERP ventas', syncProfile.erpReadyForSales ? 'LISTO' : 'NO'],
                                            ['Ultimo snapshot', localStorage.getItem('clic_pos_cloud_staging_last_snapshot_at') || 'N/D'],
                                        ].map(([label, value]) => (
                                            <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
                                                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</div>
                                                <div className="mt-1 break-words text-sm font-black text-slate-800">{value}</div>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="mt-4 grid grid-cols-4 gap-2 md:grid-cols-8">
                                        {Object.entries(diagnosticCounts).map(([collection, count]) => (
                                            <div key={collection} className="rounded-lg bg-white px-3 py-2 text-center ring-1 ring-slate-100">
                                                <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{collection}</div>
                                                <div className="text-lg font-black text-slate-900">{count}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
                                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                        <div>
                                            <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">
                                                Configuración recibida del ERP
                                            </h3>
                                            <p className="mt-1 text-sm font-semibold text-slate-500">
                                                Estado local confirmado después del último CONFIG_PUSH_V2.
                                            </p>
                                        </div>
                                        <button
                                            onClick={handleRetryConfigPush}
                                            disabled={isRetryingConfigPush}
                                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <RotateCcw size={15} className={isRetryingConfigPush ? 'animate-spin' : ''} />
                                            Reintentar sincronización de configuración
                                        </button>
                                    </div>
                                    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                        {[
                                            ['Moneda base', configPushDiagnostics?.baseCurrency || 'N/D'],
                                            ['Monedas habilitadas', configPushDiagnostics?.enabledCurrencies.join(', ') || 'N/D'],
                                            ['Versión terminal_config', configPushDiagnostics?.configVersion || 'N/D'],
                                            ['Última aplicación', configPushDiagnostics?.appliedAt
                                                ? new Date(configPushDiagnostics.appliedAt).toLocaleString()
                                                : 'N/D'],
                                        ].map(([label, value]) => (
                                            <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</div>
                                                <div className="mt-1 break-words text-sm font-black text-slate-800">{value}</div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                            Último hash CONFIG_PUSH_V2
                                        </div>
                                        <div className="mt-1 break-all font-mono text-xs font-bold text-slate-700">
                                            {configPushDiagnostics?.versionHash || 'N/D'}
                                        </div>
                                    </div>
                                    {configPushRetryResult && (
                                        <div className={`mt-3 rounded-xl border px-4 py-3 text-sm font-bold ${
                                            configPushRetryResult.type === 'success'
                                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                                : 'border-red-200 bg-red-50 text-red-800'
                                        }`}>
                                            {configPushRetryResult.message}
                                        </div>
                                    )}
                                </div>

                                {isMaster && erpForwardStatus && (
                                    <div className={`rounded-2xl border p-4 shadow-sm ${erpForwardStatus.pending > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                            <div>
                                                <h3 className={`text-sm font-black uppercase tracking-widest ${erpForwardStatus.pending > 0 ? 'text-amber-800' : 'text-emerald-800'}`}>
                                                    Cola de envío ERP
                                                </h3>
                                                <p className={`mt-1 text-sm font-bold ${erpForwardStatus.pending > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                    {erpForwardStatus.pending > 0
                                                        ? `${erpForwardStatus.pending} documento(s) esperando envío al ERP`
                                                        : 'Sin documentos pendientes hacia ERP'}
                                                </p>
                                                {erpForwardStatus.lastError && (
                                                    <p className="mt-2 max-w-3xl truncate text-xs font-mono text-red-700" title={erpForwardStatus.lastError}>
                                                        Último error: {erpForwardStatus.lastError}
                                                    </p>
                                                )}
                                            </div>
                                            <button
                                                onClick={handleRetryErpForward}
                                                disabled={isRetryingErpForward}
                                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-widest text-white shadow-sm transition-all hover:bg-slate-800 disabled:opacity-50"
                                            >
                                                <RotateCcw size={14} className={isRetryingErpForward ? 'animate-spin' : ''} />
                                                Reintentar ERP
                                            </button>
                                        </div>
                                    </div>
                                )}

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
                                        onClick={handleRefreshAudit}
                                        className="p-2 hover:bg-gray-100 rounded-xl text-blue-600 transition-all"
                                        title="Refrescar lista"
                                    >
                                        <RotateCcw size={20} className={isRefreshingAudit ? 'animate-spin' : ''} />
                                    </button>
                                </div>

                                {/* Audit Table */}
                                <div className="audit-table-container overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm overflow-y-auto max-h-[600px]">
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
                                            {paginatedData.map((item, idx) => {
                                                const rowKey = item.key || item.raw.id || `${item.collection}-${idx}`;
                                                const isRetryingThisDocument = retryingDocumentKey === rowKey;
                                                const rowRetryFeedback = retryFeedback?.key === rowKey ? retryFeedback : null;

                                                return (
                                                <tr key={rowKey} className="hover:bg-gray-50/50 transition-colors">
                                                    <td className="py-4 px-6">
                                                        <div className="font-bold text-gray-700 font-mono text-sm">{item.id}</div>
                                                        {item.movementCount > 1 && (
                                                            <div className="text-[10px] text-slate-400 font-bold mt-0.5">
                                                                {item.movementCount} movimientos agrupados
                                                            </div>
                                                        )}
                                                        {item.raw?.ncf && (
                                                            <div className="text-[10px] text-blue-600 font-bold mt-0.5">{item.raw.ncf}</div>
                                                        )}
                                                    </td>
                                                    <td className="py-4 px-6 text-center">
                                                        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-100 text-gray-600 font-bold text-xs">
                                                            <Monitor size={12} /> {item.terminalLabel || item.terminalId}
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
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button
                                                                onClick={() => setSelectedJson(item.raw)}
                                                                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-700 bg-blue-600 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white shadow-sm transition-all hover:bg-blue-700"
                                                                title="Ver JSON"
                                                            >
                                                                <Code size={14} /> JSON
                                                            </button>
                                                            {item.status !== 'SYNCED' && (
                                                                <button
                                                                    onClick={() => handleRetryDocument(item)}
                                                                    disabled={isRetryingThisDocument}
                                                                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-wider shadow-sm transition-all ${
                                                                        isRetryingThisDocument
                                                                            ? 'border-slate-300 bg-slate-200 text-slate-500'
                                                                            : item.status === 'ERROR'
                                                                            ? 'border-red-700 bg-red-600 text-white hover:bg-red-700'
                                                                            : 'border-amber-600 bg-amber-500 text-white hover:bg-amber-600'
                                                                    }`}
                                                                    title="Reintentar envío"
                                                                >
                                                                    <RotateCcw size={14} className={isRetryingThisDocument ? 'animate-spin' : ''} />
                                                                    {isRetryingThisDocument ? 'Enviando...' : 'Reenviar'}
                                                                </button>
                                                            )}
                                                        </div>
                                                        {rowRetryFeedback && (
                                                            <div
                                                                className={`mt-2 text-[10px] font-bold ${
                                                                    rowRetryFeedback.type === 'success'
                                                                        ? 'text-emerald-600'
                                                                        : rowRetryFeedback.type === 'error'
                                                                            ? 'text-red-600'
                                                                            : 'text-amber-600'
                                                                }`}
                                                            >
                                                                {rowRetryFeedback.message}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                                );
                                            })}
                                            {filteredAuditData.length === 0 && (
                                                <tr>
                                                    <td colSpan={6} className="py-12 text-center text-gray-400 italic">
                                                        No se encontraron documentos procesados.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Pagination Controls */}
                                {filteredAuditData.length > 0 && (
                                    <div className="flex flex-col md:flex-row items-center justify-between gap-4 py-2 px-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
                                        {/* Records Summary */}
                                        <div className="text-sm font-medium text-gray-400">
                                            Mostrando <span className="text-gray-700 font-bold">{filteredAuditData.length > 0 ? startIndex + 1 : 0}</span> - <span className="text-gray-700 font-bold">{endIndex}</span> de <span className="text-gray-700 font-bold">{filteredAuditData.length}</span> documentos
                                        </div>

                                        {/* Navigation and Density */}
                                        <div className="flex items-center gap-6">
                                            {/* Density Selector */}
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Filas:</span>
                                                <div className="flex bg-gray-100 p-1 rounded-xl gap-1">
                                                    {[10, 25, 50].map(val => (
                                                        <button
                                                            key={val}
                                                            onClick={() => setRowsPerPage(val)}
                                                            className={`px-3 py-1 rounded-lg text-xs font-black transition-all ${rowsPerPage === val
                                                                ? 'bg-white text-blue-600 shadow-sm'
                                                                : 'text-gray-400 hover:text-gray-600'}`}
                                                        >
                                                            {val}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Navigation Buttons */}
                                            <div className="flex items-center gap-3">
                                                <button
                                                    disabled={currentPage === 1}
                                                    onClick={() => {
                                                        setCurrentPage(prev => Math.max(1, prev - 1));
                                                        document.querySelector('.audit-table-container')?.scrollTo({ top: 0, behavior: 'smooth' });
                                                    }}
                                                    className="p-2 bg-white border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 hover:text-blue-600 disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-gray-600 transition-all font-bold group"
                                                >
                                                    <ArrowRight size={18} className="rotate-180 group-active:-translate-x-1 transition-transform" />
                                                </button>

                                                <div className="px-4 py-2 bg-gray-50 rounded-xl text-xs font-black text-gray-500 uppercase tracking-widest border border-gray-100 italic">
                                                    Página <span className="text-blue-600 font-bold">{currentPage}</span> de <span className="text-gray-800 font-bold">{totalPages || 1}</span>
                                                </div>

                                                <button
                                                    disabled={currentPage >= totalPages}
                                                    onClick={() => {
                                                        setCurrentPage(prev => Math.min(totalPages, prev + 1));
                                                        document.querySelector('.audit-table-container')?.scrollTo({ top: 0, behavior: 'smooth' });
                                                    }}
                                                    className="p-2 bg-white border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 hover:text-blue-600 disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-gray-600 transition-all font-bold group"
                                                >
                                                    <ArrowRight size={18} className="group-active:translate-x-1 transition-transform" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
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
                                <p className="text-xs text-gray-500 mt-1">JSON editable para seleccionar, copiar y enviar: {selectedJson.displayId || selectedJson.id || selectedJson.code}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleCopySelectedJson}
                                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wider transition-all ${
                                        jsonCopyStatus === 'COPIED'
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : jsonCopyStatus === 'ERROR'
                                                ? 'bg-red-100 text-red-700'
                                                : 'bg-blue-600 text-white hover:bg-blue-700'
                                    }`}
                                >
                                    {jsonCopyStatus === 'COPIED' ? <Check size={16} /> : <Copy size={16} />}
                                    {jsonCopyStatus === 'COPIED' ? 'Copiado' : jsonCopyStatus === 'ERROR' ? 'No copió' : 'Copiar JSON'}
                                </button>
                                <button onClick={() => setSelectedJson(null)} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-400"><X /></button>
                            </div>
                        </div>
                        <div className="p-8">
                            <textarea
                                key={selectedJson.displayId || selectedJson.id || selectedJson.code || selectedJsonText.length}
                                defaultValue={selectedJsonText}
                                spellCheck={false}
                                onFocus={(event) => event.currentTarget.select()}
                                className="h-[500px] w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 p-6 font-mono text-sm leading-relaxed text-emerald-300 outline-none ring-0 selection:bg-emerald-200 selection:text-slate-950"
                                style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
                            />
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
