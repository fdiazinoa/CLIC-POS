import { useCallback, useEffect, useRef, useState } from 'react';
import { InventoryCountSession } from '../types';
import { db } from '../utils/db';
import { apiSyncAdapter } from '../services/sync/ApiSyncAdapter';

interface UseOfflineInventoryCountSyncOptions {
  enabled?: boolean;
}

interface QueueMeta {
  warehouseName?: string;
}

export interface OfflineInventoryCountQueueItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: 'PENDING' | 'SYNCING' | 'ERROR';
  attempts: number;
  localApplied: boolean;
  appliedSessionId?: string;
  forceOverwrite?: boolean;
  lastError?: string;
  payload: InventoryCountSession;
  warehouseName?: string;
}

export interface OfflineInventoryCountConflict {
  id: string;
  createdAt: string;
  reason: string;
  queueItem: OfflineInventoryCountQueueItem;
}

const queueCollection = 'offline_inventory_count_queue';
const conflictsCollection = 'offline_inventory_count_conflicts';
const scansCollection = 'offline_inventory_counts';

const isDbNotConnectedError = (error: unknown): boolean => {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return message.includes('db not connected');
};

const conflictMessage = (error: unknown): boolean => {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return (
    message.includes('conflict') ||
    message.includes('409') ||
    message.includes('already') ||
    message.includes('duplicate') ||
    message.includes('ya existe')
  );
};

export const useOfflineInventoryCountSync = ({ enabled = true }: UseOfflineInventoryCountSyncOptions = {}) => {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflicts, setConflicts] = useState<OfflineInventoryCountConflict[]>([]);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const runningRef = useRef(false);

  const refreshState = useCallback(async () => {
    if (!enabled) return;

    let queue: OfflineInventoryCountQueueItem[] = [];
    let conflictList: OfflineInventoryCountConflict[] = [];
    try {
      queue = (await db.get(queueCollection as any)) as OfflineInventoryCountQueueItem[] || [];
      conflictList = (await db.get(conflictsCollection as any)) as OfflineInventoryCountConflict[] || [];
    } catch (error) {
      if (!isDbNotConnectedError(error)) {
        console.error('OfflineInventoryCountSync.refreshState error:', error);
      }
      return;
    }

    const active = queue.filter(i => i.status === 'PENDING' || i.status === 'ERROR' || i.status === 'SYNCING');
    setPendingCount(active.length);

    const sortedConflicts = [...conflictList].sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });
    setConflicts(sortedConflicts);
  }, [enabled]);

  const clearScanLogsForSession = useCallback(async (sessionId: string) => {
    const logs = (await db.get(scansCollection as any)) as Array<{ id: string; sessionId?: string }> || [];
    const remaining = logs.filter(log => log.sessionId !== sessionId);
    await db.save(scansCollection as any, remaining as any);
  }, []);

  const moveToConflict = useCallback(async (item: OfflineInventoryCountQueueItem, reason: string) => {
    const conflict: OfflineInventoryCountConflict = {
      id: `IC-CONFLICT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      reason,
      queueItem: {
        ...item,
        status: 'ERROR',
        lastError: reason,
        updatedAt: new Date().toISOString()
      }
    };

    await db.saveDocument(conflictsCollection as any, conflict as any);
    await db.deleteDocument(queueCollection as any, item.id);
  }, []);

  const pushSession = useCallback(async (session: InventoryCountSession) => {
    if (!navigator.onLine) throw new Error('Cannot push while offline');
    await apiSyncAdapter.push('inventoryCounts', [session], 'CREATE', 'UPSERT');
  }, []);

  const processQueue = useCallback(async () => {
    if (!enabled || runningRef.current || !navigator.onLine) return;

    runningRef.current = true;
    setIsSyncing(true);

    try {
      const queue = (await db.get(queueCollection as any)) as OfflineInventoryCountQueueItem[] || [];
      const sortedQueue = [...queue].sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        return timeA - timeB;
      });

      for (const original of sortedQueue) {
        if (!navigator.onLine) break;
        if (!(original.status === 'PENDING' || original.status === 'ERROR' || original.status === 'SYNCING')) continue;

        const item: OfflineInventoryCountQueueItem = {
          ...original,
          status: 'SYNCING',
          attempts: Math.max(0, Number(original.attempts || 0)) + 1,
          updatedAt: new Date().toISOString(),
          lastError: undefined
        };

        await db.saveDocument(queueCollection as any, item as any);

        try {
          if (!item.localApplied) {
            await db.saveDocument('inventoryCounts' as any, item.payload as any);
            item.localApplied = true;
            item.appliedSessionId = item.payload.id;
            item.status = 'PENDING';
            item.updatedAt = new Date().toISOString();
            await db.saveDocument(queueCollection as any, item as any);
          }

          await pushSession(item.payload);

          await db.deleteDocument(queueCollection as any, item.id);
          await clearScanLogsForSession(item.payload.id);

          setSyncToast(`Sincronización completa: Conteo #${item.payload.id} procesado`);
        } catch (error: any) {
          if (!item.forceOverwrite && conflictMessage(error)) {
            await moveToConflict(item, error?.message || 'Conflicto detectado en sincronización.');
            continue;
          }

          const failed: OfflineInventoryCountQueueItem = {
            ...item,
            status: 'ERROR',
            updatedAt: new Date().toISOString(),
            lastError: error?.message || 'Error de sincronización'
          };
          await db.saveDocument(queueCollection as any, failed as any);
        }
      }
    } catch (error) {
      if (!isDbNotConnectedError(error)) {
        console.error('OfflineInventoryCountSync.processQueue error:', error);
      }
    } finally {
      runningRef.current = false;
      setIsSyncing(false);
      await refreshState();
    }
  }, [clearScanLogsForSession, enabled, moveToConflict, pushSession, refreshState]);

  const saveSession = useCallback(async (session: InventoryCountSession, meta: QueueMeta = {}) => {
    if (!enabled) {
      return {
        queued: true,
        message: 'Inicializando base local. Intenta nuevamente en unos segundos.'
      };
    }

    const queueItem: OfflineInventoryCountQueueItem = {
      id: `ICQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'PENDING',
      attempts: 0,
      localApplied: false,
      payload: {
        ...session,
        syncStatus: 'PENDING'
      } as any,
      warehouseName: meta.warehouseName
    };

    if (!navigator.onLine) {
      await db.saveDocument(queueCollection as any, queueItem as any);
      await refreshState();
      return {
        queued: true,
        message: 'Conteo guardado. Se enviará automáticamente cuando recuperes conexión.'
      };
    }

    await db.saveDocument('inventoryCounts' as any, queueItem.payload as any);

    try {
      await pushSession(queueItem.payload);
      await clearScanLogsForSession(queueItem.payload.id);

      return {
        queued: false,
        message: 'Conteo guardado y sincronizado correctamente.'
      };
    } catch (error: any) {
      queueItem.localApplied = true;
      queueItem.appliedSessionId = queueItem.payload.id;
      queueItem.status = 'ERROR';
      queueItem.lastError = error?.message || 'Error al sincronizar';
      await db.saveDocument(queueCollection as any, queueItem as any);
      await refreshState();

      return {
        queued: true,
        message: 'Conteo guardado localmente. Se sincronizará cuando haya conexión.'
      };
    }
  }, [clearScanLogsForSession, enabled, pushSession, refreshState]);

  const recordOfflineScan = useCallback(async (params: {
    sessionId: string;
    warehouseId?: string;
    productId?: string;
    code: string;
  }) => {
    if (!enabled) return;
    if (navigator.onLine) return;

    const log = {
      id: `IC-SCAN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      sessionId: params.sessionId,
      warehouseId: params.warehouseId,
      productId: params.productId,
      scannedCode: params.code
    };

    await db.saveDocument(scansCollection as any, log as any);
  }, [enabled]);

  const resolveConflict = useCallback(async (conflictId: string, action: 'OVERWRITE' | 'CANCEL') => {
    if (!enabled) return;
    const conflict = await db.getDocument(conflictsCollection as any, conflictId) as OfflineInventoryCountConflict | null;
    if (!conflict) return;

    if (action === 'CANCEL') {
      await db.deleteDocument(conflictsCollection as any, conflictId);
      await refreshState();
      return;
    }

    const requeue: OfflineInventoryCountQueueItem = {
      ...conflict.queueItem,
      id: `ICQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'PENDING',
      forceOverwrite: true,
      attempts: 0,
      localApplied: true,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      lastError: undefined
    };

    await db.saveDocument(queueCollection as any, requeue as any);
    await db.deleteDocument(conflictsCollection as any, conflictId);
    await refreshState();

    if (navigator.onLine) {
      await processQueue();
    }
  }, [enabled, processQueue, refreshState]);

  const clearSyncToast = useCallback(() => setSyncToast(null), []);

  useEffect(() => {
    if (!enabled) return;

    refreshState().catch(console.error);

    const onOnline = () => {
      setIsOnline(true);
      processQueue().catch(console.error);
    };
    const onOffline = () => setIsOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [enabled, processQueue, refreshState]);

  return {
    isOnline,
    isSyncing,
    pendingCount,
    conflicts,
    syncToast,
    saveSession,
    recordOfflineScan,
    processQueue,
    resolveConflict,
    clearSyncToast,
    refreshState
  };
};
