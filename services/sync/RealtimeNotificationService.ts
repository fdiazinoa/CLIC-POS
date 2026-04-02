import { io, Socket } from 'socket.io-client';
import { syncManager } from './SyncManager';
import { buildTerminalConfigRefreshRequest } from '../../utils/terminalConfigPushScopes';

const TERMINAL_CONFIG_RESTART_NOTICE_KEY = 'clic_pos_terminal_config_restart_notice';

type TerminalConfigRestartNotice = {
    receivedAt: string;
    eventId?: string | null;
    terminalId?: string | null;
};

const asObject = (value: unknown): Record<string, any> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, any>;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const extractConfigPushEventId = (value: unknown): string | null => {
    const data = asObject(value);
    const snapshot = asObject(data.terminal_config);

    return (
        asString(data.event_id) ||
        asString(data.eventId) ||
        asString(snapshot.event_id) ||
        asString(snapshot.eventId) ||
        null
    );
};

const persistRestartNotice = (value: unknown) => {
    const payload = asObject(value);
    const notice: TerminalConfigRestartNotice = {
        receivedAt: new Date().toISOString(),
        eventId: extractConfigPushEventId(value),
        terminalId: asString(payload.terminalId) || asString(asObject(payload.terminal_config).terminal_id) || null,
    };

    localStorage.setItem(TERMINAL_CONFIG_RESTART_NOTICE_KEY, JSON.stringify(notice));
    window.dispatchEvent(new CustomEvent('terminalConfigRestartRequired', { detail: notice }));
};

class RealtimeNotificationService {
    private socket: Socket | null = null;
    private masterUrl: string = '';

    initialize(masterUrl: string, terminalId: string) {
        if (this.socket) {
            this.socket.disconnect();
        }

        this.masterUrl = masterUrl;
        console.log(`📡 RealtimeNotificationService: Connecting to ${masterUrl}...`);

        this.socket = io(masterUrl, {
            query: { terminalId },
            reconnectionAttempts: 10,
            reconnectionDelay: 5000
        });

        this.socket.on('connect', () => {
            console.log(`📡 RealtimeNotificationService: Connected to Master (${masterUrl}) via WebSocket as ${terminalId}`);
        });

        this.socket.on('connect_error', (error) => {
            console.error('📡 RealtimeNotificationService: Connection error:', error.message);
        });

        this.socket.on('reconnect', (attempt) => {
            console.log(`📡 RealtimeNotificationService: Reconnected after ${attempt} attempts`);
        });

        this.socket.on('disconnect', (reason) => {
            console.warn(`📡 RealtimeNotificationService: Disconnected from Master WebSocket. Reason: ${reason}`);
        });

        this.socket.on('CATALOG_UPDATED', async (data: { collection: string, _origin?: string }) => {
            // const timestamp = new Date().toISOString();
            // console.log(`[WS_RECIBIDO] ${timestamp} Notificación del Master: CATALOG_UPDATED for ${data.collection}`, data);

            // 1. Recursive Loop Protection: Ignore if we are currently syncing
            if (syncManager.getIsInternalSyncing()) {
                // console.warn(`[WS_IGNORED] ${timestamp} Ignored update for ${data.collection} (Sync in progress)`);
                return;
            }

            try {
                // Force an immediate pull, ignoring the auto-sync interval
                await syncManager.pullCatalog(data.collection as any, true);
            } catch (error) {
                console.error(`❌ RealtimeNotificationService: Error pulling catalog for ${data.collection}:`, error);
            }
        });

        this.socket.on('PRICE_CHANGED', async () => {
            console.log('📡 RealtimeNotificationService: Received PRICE_CHANGED. Updating products...');
            try {
                await syncManager.pullCatalog('products', true);
            } catch (error) {
                console.error('❌ RealtimeNotificationService: Error updating prices:', error);
            }
        });

        this.socket.on('CONFIG_PUSH', async (data: { terminal_config?: unknown; terminalId?: string }) => {
            console.log('📡 RealtimeNotificationService: Received CONFIG_PUSH. Refreshing terminal snapshot...');
            try {
                await syncManager.refreshTerminalResolvedConfig(undefined, buildTerminalConfigRefreshRequest(data));
                persistRestartNotice(data);
            } catch (error) {
                console.error('❌ RealtimeNotificationService: Error applying CONFIG_PUSH:', error);
                persistRestartNotice(data);
            }
        });
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }
}

export const realtimeNotificationService = new RealtimeNotificationService();
