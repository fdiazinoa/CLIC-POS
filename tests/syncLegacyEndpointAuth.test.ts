import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const readSource = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('individual inbox, batch sender and heartbeat share the persisted terminal credential helper', async () => {
    const [credentials, adapter, lifecycle] = await Promise.all([
        readSource('../services/sync/TerminalCredentialStore.ts'),
        readSource('../services/sync/ApiSyncAdapter.ts'),
        readSource('../utils/erpSyncLifecycle.ts'),
    ]);

    assert.match(credentials, /resolvePersistedTerminalSyncToken[\s\S]*readTerminalCredentialsSync\(\)\.syncToken/);
    assert.match(credentials, /buildTerminalSyncAuthHeaders[\s\S]*resolvePersistedTerminalSyncToken\(\)/);
    assert.match(adapter, /buildOperationalHeaders[\s\S]*buildTerminalSyncAuthHeaders\(\)/);
    assert.match(adapter, /pushDurableOutboxBatch[\s\S]*postOperationalPayload\('\/inbox\/batch'/);
    assert.match(lifecycle, /buildDeviceHeaders[\s\S]*buildTerminalSyncAuthHeaders\(\)/);
    assert.match(lifecycle, /heartbeatErpSyncTerminal[\s\S]*postJson<SyncHeartbeatResponse>\('\/terminals\/heartbeat'/);
});

test('residual legacy ERP forwarder authenticates transactions, generic inbox and apply with one token resolver', async () => {
    const source = await readSource('../server/services/erpInboxForward.ts');

    assert.match(source, /const syncToken = resolveErpSyncToken\(options\?\.authTerminalId \|\| null\)/);
    assert.match(source, /transactionsUrl[\s\S]*headers:\s*\{[\s\S]*buildErpInboxAuthHeaders\(syncToken\)/);
    assert.match(source, /inboxUrl[\s\S]*headers:\s*buildErpInboxAuthHeaders\(syncToken\)/);
    assert.match(source, /applyErpInboxRow\(baseUrl, syncId, body\.event_type, syncToken\)/);
    assert.match(source, /'X-Sync-Token': syncToken/);
});

test('sync scope comes from persisted binding and credentials are not inserted into payloads or token logs', async () => {
    const [adapter, lifecycle, forwarder, httpClient, deviceToken] = await Promise.all([
        readSource('../services/sync/ApiSyncAdapter.ts'),
        readSource('../utils/erpSyncLifecycle.ts'),
        readSource('../server/services/erpInboxForward.ts'),
        readSource('../services/network/httpClient.ts'),
        readSource('../services/sync/deviceToken.ts'),
    ]);

    assert.match(adapter, /companyId, company_id: companyId/);
    assert.match(adapter, /storeId, store_id: storeId/);
    assert.match(lifecycle, /tenant_id: storedBinding\.tenantId/);
    assert.match(lifecycle, /company_id: storedBinding\.companyId/);
    assert.match(lifecycle, /store_id: storedBinding\.storeId/);
    assert.match(forwarder, /tenant_id: scope\.tenantId/);
    assert.match(forwarder, /company_id: scope\.companyId/);
    assert.match(forwarder, /store_id: scope\.storeId/);
    assert.match(adapter, /return normalized \? '\(redacted\)' : null/);
    assert.match(httpClient, /return normalized \? '\(redacted\)' : null/);
    assert.match(deviceToken, /return cleaned \? '\(redacted\)' : null/);
    const heartbeatSource = lifecycle.slice(
        lifecycle.indexOf('export const heartbeatErpSyncTerminal'),
        lifecycle.indexOf('export const getErpSyncLifecycleStatus'),
    );
    assert.doesNotMatch(heartbeatSource, /syncToken\s*:|sync_token\s*:|token\s*:/);
});
