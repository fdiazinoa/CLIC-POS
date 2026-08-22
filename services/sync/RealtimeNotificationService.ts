import { RealtimeChannel } from '@supabase/supabase-js';
import { ensureSupabaseSessionRestored, supabase } from '../../utils/supabase';
import { getStoredErpSyncBinding } from '../../utils/erpSyncLifecycle';
import { dispatchDeviceRevoked, resolveLocalDeviceId } from '../../utils/deviceRevocation';
import { isSyncFeatureEnabled } from './SyncFeatureFlags';
import { syncTriggerCoordinator, type SyncDomainVersions } from './SyncTriggerCoordinator';
import { syncMetrics } from './SyncMetrics';
import { isSyncHintV2Payload, payloadAppliesToRealtimeScope } from './RealtimeHintScope';
import {
    buildPrivateSyncTopic,
    ensurePrivateRealtimeAuthorization,
} from './PrivateRealtimeAuthorization';

export type RealtimeConnectionState = 'DISABLED' | 'CONNECTING' | 'HEALTHY' | 'DEGRADED' | 'DISCONNECTED';

const FORCE_SYNC_NOTICE_KEY = 'clic_pos_force_sync_notice';
const LIGHTWEIGHT_SYNC_NOTICE_KEY = 'clic_pos_lightweight_sync_notice';
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

const normalizeDomainVersions = (payload: unknown): SyncDomainVersions => {
    const eventPayload = asObject(payload);
    const rawVersions = asObject(eventPayload.domainVersions || eventPayload.domain_versions);
    return Object.entries(rawVersions).reduce<SyncDomainVersions>((versions, [domain, value]) => {
        if (typeof value === 'number' && Number.isFinite(value)) versions[domain] = value;
        else if (typeof value === 'string' && value.trim()) versions[domain] = value.trim();
        return versions;
    }, {});
};

const payloadAppliesToBinding = (payload: unknown, strict: boolean): boolean =>
    payloadAppliesToRealtimeScope(payload, getStoredErpSyncBinding(), strict);

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
    private channels: RealtimeChannel[] = [];
    private storeId: string | null = null;
    private terminalId: string | null = null;
    private initializePromise: Promise<void> | null = null;
    private initializeKey: string | null = null;
    private state: RealtimeConnectionState = 'DISABLED';
    private stateListeners = new Set<(state: RealtimeConnectionState) => void>();
    private hasSubscribed = false;

    getState(): RealtimeConnectionState {
        return this.state;
    }

    subscribeState(listener: (state: RealtimeConnectionState) => void): () => void {
        this.stateListeners.add(listener);
        listener(this.state);
        return () => this.stateListeners.delete(listener);
    }

    private setState(state: RealtimeConnectionState): void {
        if (this.state === state) return;
        this.state = state;
        syncMetrics.setRealtimeState(state);
        this.stateListeners.forEach((listener) => listener(state));
    }

    private requestRealtimeSync(payload: unknown, fallbackCollections: string[] = []) {
        const collections = normalizeCollections(payload, fallbackCollections);
        if (collections.length > 0) persistLightweightSyncNotice(payload, collections);
        const eventPayload = asObject(payload);
        void syncTriggerCoordinator.request({
            reason: 'REALTIME_HINT',
            domainVersions: normalizeDomainVersions(payload),
            collections,
            imageOnly: Boolean(
                eventPayload.imageOnly
                || eventPayload.image_only
                || eventPayload.reason === 'PRODUCT_IMAGE_UPDATED'
            ),
        }).catch((error) => {
            console.error('❌ RealtimeNotificationService: Realtime hint processing failed.', error);
        });
    }

    async initialize(masterUrl: string, terminalId: string) {
        const { isConfigured } = resolveSupabaseConfig();
        const binding = getStoredErpSyncBinding();
        const storeId = binding.storeId || null;
        if (!isConfigured || !storeId) {
            await this.disconnect('DISABLED');
            console.warn('📡 RealtimeNotificationService: Supabase realtime disabled (missing config or storeId).');
            return;
        }

        const key = `${storeId}:${terminalId}`;
        if (this.channels.length > 0 && this.storeId === storeId && this.terminalId === terminalId) {
            console.log('📡 RealtimeNotificationService: Reusing active sync channels.');
            return;
        }
        if (this.initializePromise && this.initializeKey === key) {
            return this.initializePromise;
        }

        const operation = this.connect(masterUrl, binding.tenantId || '', storeId, terminalId);
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

    private async connect(masterUrl: string, tenantId: string, storeId: string, terminalId: string) {
        await this.disconnect('CONNECTING');
        this.storeId = storeId;
        this.terminalId = terminalId;
        this.setState('CONNECTING');
        const privateRealtime = isSyncFeatureEnabled('private_realtime');
        let channelClient = supabase;
        let channelNames = [`store_${storeId}`];
        if (privateRealtime) {
            const authorization = await ensurePrivateRealtimeAuthorization({
                tenantId,
                storeId,
                terminalId,
            }, masterUrl);
            channelClient = authorization.client;
            const terminalTopic = buildPrivateSyncTopic(authorization.scope);
            channelNames = [
                `sync:${authorization.scope.tenantId}:${authorization.scope.storeId}`,
                terminalTopic,
            ];
        } else {
            await ensureSupabaseSessionRestored();
        }
        console.log(`📡 RealtimeNotificationService: Connecting to ${privateRealtime ? 'private sync scope' : `store_${storeId}`}...`);

        const channels = channelNames.map((channelName) => channelClient.channel(channelName, {
            config: privateRealtime
                ? { private: true, broadcast: { self: false } }
                : { broadcast: { self: false } },
        }));
        const subscribedChannels = new Set<string>();

        channels.forEach((channel, channelIndex) => {

        if (isSyncFeatureEnabled('sync_hint_v2')) {
            channel.on('broadcast', { event: 'SYNC_HINT' }, ({ payload }) => {
                if (!isSyncHintV2Payload(payload) || !payloadAppliesToBinding(payload, true)) {
                    console.warn('📡 RealtimeNotificationService: Ignoring out-of-scope SYNC_HINT.');
                    return;
                }
                void syncTriggerCoordinator.request({
                    reason: 'REALTIME_HINT',
                    domainVersions: normalizeDomainVersions(payload),
                }).catch((error) => {
                    console.error('❌ RealtimeNotificationService: SYNC_HINT processing failed.', error);
                });
            });
        }

        channel.on('broadcast', { event: 'force_sync' }, ({ payload }) => {
            if (!payloadAppliesToBinding(payload, false)) return;
            console.log('📡 RealtimeNotificationService: Received force_sync broadcast.', payload);
            persistForceSyncNotice(payload);
            this.requestRealtimeSync(payload);
        });

        channel.on('broadcast', { event: 'catalog_changed' }, ({ payload }) => {
            if (!payloadAppliesToBinding(payload, false)) return;
            console.log('📡 RealtimeNotificationService: Received catalog_changed broadcast.', payload);
            this.requestRealtimeSync(payload);
        });

        channel.on('broadcast', { event: 'products_changed' }, ({ payload }) => {
            if (!payloadAppliesToBinding(payload, false)) return;
            console.log('📡 RealtimeNotificationService: Received products_changed broadcast.', payload);
            this.requestRealtimeSync(payload, ['products']);
        });

        channel.on('broadcast', { event: 'product_images_changed' }, ({ payload }) => {
            if (!payloadAppliesToBinding(payload, false)) return;
            console.log('📡 RealtimeNotificationService: Received product_images_changed broadcast.', payload);
            this.requestRealtimeSync(payload, ['products']);
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
                subscribedChannels.add(channelNames[channelIndex]);
                console.log(`📡 RealtimeNotificationService: Subscribed to ${privateRealtime ? 'private sync scope' : `store_${storeId}`}.`);
                if (subscribedChannels.size === channels.length) {
                    const reconnected = this.hasSubscribed;
                    this.hasSubscribed = true;
                    this.setState('HEALTHY');
                    if (reconnected) {
                        syncMetrics.increment('realtime_reconnects');
                        void syncTriggerCoordinator.request({ reason: 'REALTIME_RECONNECTED' });
                    }
                }
                return;
            }

            subscribedChannels.delete(channelNames[channelIndex]);

            if (status === 'CHANNEL_ERROR') {
                this.setState('DEGRADED');
                console.warn('📡 RealtimeNotificationService: Channel error.');
            } else if (status === 'TIMED_OUT') {
                this.setState('DEGRADED');
                console.warn('📡 RealtimeNotificationService: Channel timed out.');
            } else if (status === 'CLOSED') {
                this.setState('DISCONNECTED');
                console.warn('📡 RealtimeNotificationService: Channel closed.');
            }
        });
        });

        this.channels = channels;
    }

    async disconnect(nextState: RealtimeConnectionState = 'DISCONNECTED') {
        if (this.channels.length > 0) {
            const existing = this.channels;
            this.channels = [];
            try {
                await Promise.all(existing.map((channel) => channel.unsubscribe()));
            } catch (error) {
                console.warn('📡 RealtimeNotificationService: Failed to unsubscribe channel.', error);
            }
        }
        this.storeId = null;
        this.terminalId = null;
        this.hasSubscribed = false;
        this.setState(nextState);
    }
}

export const realtimeNotificationService = new RealtimeNotificationService();
