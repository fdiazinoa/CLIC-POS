import { RealtimeChannel } from '@supabase/supabase-js';
import { syncManager } from './SyncManager';
import { ensureSupabaseSessionRestored, supabase } from '../../utils/supabase';
import { getStoredErpSyncBinding } from '../../utils/erpSyncLifecycle';
import { dispatchDeviceRevoked, resolveLocalDeviceId } from '../../utils/deviceRevocation';

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
                await syncManager.fullPull();
            } catch (error) {
                console.error('❌ RealtimeNotificationService: Error during force_sync handling:', error);
            }
        });

        channel.on('broadcast', { event: 'device_revoked' }, ({ payload }) => {
            const eventPayload = asObject(payload);
            const localDeviceId = resolveLocalDeviceId();
            const previousDeviceId = String(eventPayload.previous_device_id || '').trim();
            const terminalIdFromEvent = String(eventPayload.terminal_id || '').trim();
            const boundTerminalId = getStoredErpSyncBinding().terminalId || '';

            const appliesToThisDevice =
                Boolean(localDeviceId && previousDeviceId && localDeviceId === previousDeviceId)
                || Boolean(boundTerminalId && terminalIdFromEvent && boundTerminalId === terminalIdFromEvent);

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
        this.storeId = null;
    }
}

export const realtimeNotificationService = new RealtimeNotificationService();
