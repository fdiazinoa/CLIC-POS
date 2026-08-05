import { RealtimeChannel } from '@supabase/supabase-js';
import { syncManager } from './SyncManager';
import { ensureSupabaseSessionRestored, supabase } from '../../utils/supabase';
import { getStoredErpSyncBinding, triggerErpSyncOutbox } from '../../utils/erpSyncLifecycle';
import { dispatchDeviceRevoked, resolveLocalDeviceId } from '../../utils/deviceRevocation';

const FORCE_SYNC_NOTICE_KEY = 'clic_pos_force_sync_notice';
const LIGHTWEIGHT_SYNC_NOTICE_KEY = 'clic_pos_lightweight_sync_notice';
const LIGHTWEIGHT_SYNC_DEBOUNCE_MS = 1800;
const LIGHTWEIGHT_SYNC_JITTER_MS = 2200;
const LIGHTWEIGHT_COLLECTIONS = new Set([
    'products',
    'productStocks',
    'productPrices',
    'priceLists',
    'warehouses',
    'taxes',
    'paymentMethods',
    'customers',
    'suppliers',
    'documentSeries',
    'internalSequences',
    'fiscalRanges',
    'terminalFiscalConfig',
]);

const asObject = (value: unknown): Record<string, any> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, any>;
};

const resolveSupabaseConfig = () => {
    const env = (import.meta as any).env || {};
    const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim() : '';
    const anonKey = typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY.trim() : '';
    return { url, anonKey, isConfigured: Boolean(url && anonKey) };
};

const persistForceSyncNotice = (payload: unknown) => {
    const eventPayload = asObject(payload);
    const notice = {
        receivedAt: new Date().toISOString(),
        terminalId: eventPayload.terminal_id || null,
        reason: eventPayload.reason || null,
        timestamp: eventPayload.timestamp || null,
    };

    localStorage.setItem(FORCE_SYNC_NOTICE_KEY, JSON.stringify(notice));
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const uniqueStrings = (values: unknown[]): string[] =>
    Array.from(new Set(values.map(asString).filter(Boolean)));

const normalizeCollections = (payload: unknown, fallback: string[] = []): string[] => {
    const eventPayload = asObject(payload);
    const rawCollections = Array.isArray(eventPayload.collections)
        ? eventPayload.collections
        : Array.isArray(eventPayload.collection)
            ? eventPayload.collection
            : eventPayload.collection
                ? [eventPayload.collection]
                : [];

    return uniqueStrings([...rawCollections, ...fallback]).filter((collection) => LIGHTWEIGHT_COLLECTIONS.has(collection));
};

const persistLightweightSyncNotice = (payload: unknown, collections: string[]) => {
    const eventPayload = asObject(payload);
    localStorage.setItem(LIGHTWEIGHT_SYNC_NOTICE_KEY, JSON.stringify({
        receivedAt: new Date().toISOString(),
        event: eventPayload.event || eventPayload.reason || null,
        collections,
        ids: Array.isArray(eventPayload.ids) ? eventPayload.ids : [],
        imageOnly: Boolean(eventPayload.imageOnly || eventPayload.image_only),
        version: eventPayload.version || null,
    }));
};

class RealtimeNotificationService {
    private channel: RealtimeChannel | null = null;
    private storeId: string | null = null;
    private terminalId: string | null = null;
    private initializePromise: Promise<void> | null = null;
    private initializeKey: string | null = null;
    private lightweightSyncTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingCollections = new Set<string>();

    private scheduleLightweightSync(payload: unknown, fallbackCollections: string[]) {
        const collections = normalizeCollections(payload, fallbackCollections);
        if (collections.length === 0) return;

        collections.forEach((collection) => this.pendingCollections.add(collection));
        persistLightweightSyncNotice(payload, Array.from(this.pendingCollections));

        if (this.lightweightSyncTimer) {
            clearTimeout(this.lightweightSyncTimer);
        }

        const jitter = Math.floor(Math.random() * LIGHTWEIGHT_SYNC_JITTER_MS);
        this.lightweightSyncTimer = setTimeout(async () => {
            this.lightweightSyncTimer = null;
            const collectionsToSync = Array.from(this.pendingCollections);
            this.pendingCollections.clear();

            if (syncManager.getIsInternalSyncing()) {
                console.log('📡 RealtimeNotificationService: Sync already running, delaying lightweight sync.');
                this.scheduleLightweightSync({ collections: collectionsToSync, reason: 'RETRY_AFTER_BUSY' }, collectionsToSync);
                return;
            }

            try {
                console.log('📡 RealtimeNotificationService: Running lightweight sync.', { collections: collectionsToSync });
                for (const collection of collectionsToSync) {
                    await syncManager.pullCatalog(collection as any, false, { ignoreThrottle: true });
                }
            } catch (error) {
                console.error('❌ RealtimeNotificationService: Error during lightweight sync handling:', error);
            }
        }, LIGHTWEIGHT_SYNC_DEBOUNCE_MS + jitter);
    }

    async initialize(_masterUrl: string, terminalId: string) {
        const { isConfigured } = resolveSupabaseConfig();
        const binding = getStoredErpSyncBinding();
        const storeId = binding.storeId || null;
        if (!isConfigured || !storeId) {
            await this.disconnect();
            console.warn('📡 RealtimeNotificationService: Supabase realtime disabled (missing config or storeId).');
            return;
        }

        const key = `${storeId}:${terminalId}`;
        if (this.channel && this.storeId === storeId && this.terminalId === terminalId) {
            console.log(`📡 RealtimeNotificationService: Reusing store_${storeId} channel.`);
            return;
        }
        if (this.initializePromise && this.initializeKey === key) {
            return this.initializePromise;
        }

        const operation = this.connect(storeId, terminalId);
        this.initializeKey = key;
        this.initializePromise = operation;
        try {
            await operation;
        } finally {
            if (this.initializePromise === operation) {
                this.initializePromise = null;
                this.initializeKey = null;
            }
        }
    }

    private async connect(storeId: string, terminalId: string) {
        await this.disconnect();
        this.storeId = storeId;
        this.terminalId = terminalId;
        console.log(`📡 RealtimeNotificationService: Connecting to Supabase Realtime store_${storeId}...`);

        await ensureSupabaseSessionRestored();

        const channel = supabase.channel(`store_${storeId}`, {
            config: { presence: { key: terminalId } },
        });

        channel.on('broadcast', { event: 'force_sync' }, async ({ payload }) => {
            console.log('📡 RealtimeNotificationService: Received force_sync broadcast.', payload);
            persistForceSyncNotice(payload);
            try {
                await triggerErpSyncOutbox('force_sync');
            } catch (error) {
                console.error('❌ RealtimeNotificationService: ERP outbox failed during force_sync.', error);
            }
            const eventPayload = asObject(payload);
            const specificCollections = normalizeCollections(eventPayload);
            const imageOnly = Boolean(eventPayload.imageOnly || eventPayload.image_only || eventPayload.reason === 'PRODUCT_IMAGE_UPDATED');

            if (syncManager.isUsingConfigPushV2Primary() && !imageOnly) {
                await syncManager.syncTerminalManifestInBackground(undefined, { reason: 'realtime' });
                console.info('[SYNC_STRATEGY]', {
                    target: 'ERP_ACTIVE',
                    strategy: 'CONFIG_PUSH_V2_PRIMARY',
                    action: 'realtime_legacy_catalog_pull_skipped',
                    requested_collections: specificCollections.length,
                });
                return;
            }

            if (imageOnly || specificCollections.length > 0) {
                this.scheduleLightweightSync(eventPayload, imageOnly ? ['products'] : specificCollections);
                return;
            }

            if (syncManager.getIsInternalSyncing()) {
                console.log('📡 RealtimeNotificationService: Sync already running, skipping force_sync.');
                return;
            }

            try {
                await syncManager.refreshTerminalResolvedConfig(undefined, {
                    forceRemoteFetch: true,
                    forceFullCatalog: false,
                    dispatchEvent: true,
                });
                await syncManager.syncAllCatalogs();
            } catch (error) {
                console.error('❌ RealtimeNotificationService: Error during force_sync handling:', error);
            }
        });

        channel.on('broadcast', { event: 'catalog_changed' }, ({ payload }) => {
            console.log('📡 RealtimeNotificationService: Received catalog_changed broadcast.', payload);
            this.scheduleLightweightSync(payload, normalizeCollections(payload));
        });

        channel.on('broadcast', { event: 'products_changed' }, ({ payload }) => {
            console.log('📡 RealtimeNotificationService: Received products_changed broadcast.', payload);
            this.scheduleLightweightSync(payload, ['products']);
        });

        channel.on('broadcast', { event: 'product_images_changed' }, ({ payload }) => {
            console.log('📡 RealtimeNotificationService: Received product_images_changed broadcast.', payload);
            this.scheduleLightweightSync(payload, ['products']);
        });

        channel.on('broadcast', { event: 'device_revoked' }, ({ payload }) => {
            const eventPayload = asObject(payload);
            const localDeviceId = resolveLocalDeviceId();
            const previousDeviceId = String(eventPayload.previous_device_id || '').trim();
            const terminalIdFromEvent = String(eventPayload.terminal_id || '').trim();
            const boundTerminalId = getStoredErpSyncBinding().terminalId || '';

            const appliesByDevice = Boolean(localDeviceId && previousDeviceId && localDeviceId === previousDeviceId);
            const appliesByTerminalFallback = Boolean(!previousDeviceId && boundTerminalId && terminalIdFromEvent && boundTerminalId === terminalIdFromEvent);
            const appliesToThisDevice = appliesByDevice || appliesByTerminalFallback;

            if (!appliesToThisDevice) {
                return;
            }

            console.warn('📡 RealtimeNotificationService: device_revoked received for this POS.', payload);
            dispatchDeviceRevoked({
                reason: 'DEVICE_REVOKED',
                message: 'Este equipo fue reemplazado por otro dispositivo. La operación queda bloqueada en esta tablet.',
                terminalId: terminalIdFromEvent || null,
                previousDeviceId: previousDeviceId || null,
                newDeviceId: String(eventPayload.new_device_id || '').trim() || null,
                payload,
            });
        });

        channel.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                console.log(`📡 RealtimeNotificationService: Subscribed to store_${storeId}.`);
                await channel.track({
                    terminal_id: terminalId,
                    online_at: new Date().toISOString(),
                });
                return;
            }

            if (status === 'CHANNEL_ERROR') {
                console.warn('📡 RealtimeNotificationService: Channel error.');
            } else if (status === 'TIMED_OUT') {
                console.warn('📡 RealtimeNotificationService: Channel timed out.');
            } else if (status === 'CLOSED') {
                console.warn('📡 RealtimeNotificationService: Channel closed.');
            }
        });

        this.channel = channel;
    }

    async disconnect() {
        if (this.channel) {
            const existing = this.channel;
            this.channel = null;
            try {
                await existing.unsubscribe();
            } catch (error) {
                console.warn('📡 RealtimeNotificationService: Failed to unsubscribe channel.', error);
            }
        }
        if (this.lightweightSyncTimer) {
            clearTimeout(this.lightweightSyncTimer);
            this.lightweightSyncTimer = null;
        }
        this.pendingCollections.clear();
        this.storeId = null;
        this.terminalId = null;
    }
}

export const realtimeNotificationService = new RealtimeNotificationService();
