import { describe, expect, it } from 'vitest';
import { buildPrivateSyncTopic, tokenHasPrivateRealtimeScope } from './PrivateRealtimeAuthorization.ts';

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (appMetadata) => `${encode({ alg: 'none' })}.${encode({ app_metadata: appMetadata })}.signature`;
const scope = { tenantId: 'tenant-a', storeId: 'store-a', terminalId: 'terminal-a', deviceId: 'device-a' };

describe('private Realtime authorization contract', () => {
    it('uses the canonical terminal-scoped topic', () => {
        expect(buildPrivateSyncTopic(scope)).toBe('sync:tenant-a:store-a:terminal-a');
    });

    it('accepts only an exact authoritative claim scope', () => {
        expect(tokenHasPrivateRealtimeScope(token({
            sync_tenant_id: 'tenant-a',
            sync_store_id: 'store-a',
            sync_terminal_id: 'terminal-a',
            sync_device_id: 'device-a',
        }), scope)).toBe(true);
        expect(tokenHasPrivateRealtimeScope(token({
            sync_tenant_id: 'tenant-a',
            sync_store_id: 'store-b',
            sync_terminal_id: 'terminal-a',
            sync_device_id: 'device-a',
        }), scope)).toBe(false);
    });
});
