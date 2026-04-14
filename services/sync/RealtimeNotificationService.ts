import { RealtimeChannel } from '@supabase/supabase-js';
import { syncManager } from './SyncManager';
import { ensureSupabaseSessionRestored, supabase } from '../../utils/supabase';
import { getStoredErpSyncBinding } from '../../utils/erpSyncLifecycle';

const FORCE_SYNC_NOTICE_KEY = 'clic_pos_force_sync_notice';

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

class RealtimeNotificationService {
    private channel: RealtimeChannel | null = null;
    private storeId: string | null = null;

    async initialize(_masterUrl: string, terminalId: string) {
        await this.disconnect();

        const { isConfigured } = resolveSupabaseConfig();
        const binding = getStoredErpSyncBinding();
        const storeId = binding.storeId || null;
        if (!isConfigured || !storeId) {
            console.warn('📡 RealtimeNotificationService: Supabase realtime disabled (missing config or storeId).');
            return;
        }

        this.storeId = storeId;
        console.log(`📡 RealtimeNotificationService: Connecting to Supabase Realtime store_${storeId}...`);

        await ensureSupabaseSessionRestored();

        const channel = supabase.channel(`store_${storeId}`, {
            config: { presence: { key: terminalId } },
        });

        channel.on('broadcast', { event: 'force_sync' }, async ({ payload }) => {
            console.log('📡 RealtimeNotificationService: Received force_sync broadcast.', payload);
            persistForceSyncNotice(payload);

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
        this.storeId = null;
    }
}

export const realtimeNotificationService = new RealtimeNotificationService();
