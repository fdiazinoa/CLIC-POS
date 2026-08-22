import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(
    new URL('../services/sync/BackgroundSyncManager.ts', import.meta.url),
    'utf8',
);

test('interrupted and legacy error states return to a consumable retry state', () => {
    const recovery = source.match(/private async recoverStuckSyncItems\(\)[\s\S]*?private async recoverCompletedTransactionsForReplay/)?.[0] || '';
    assert.match(recovery, /syncStatus === 'SYNCING' \|\| item\?\.syncStatus === 'ERROR'/);
    assert.match(recovery, /item\.syncStatus = 'RETRY_WAIT'/);
    assert.doesNotMatch(recovery, /item\.syncStatus = 'ERROR'/);
});

test('ERP application and master persistence remain distinct terminal states', () => {
    assert.match(source, /targetKind === 'ERP_ACTIVE'[\s\S]*?\? 'APPLIED_ERP'/);
    assert.match(source, /targetKind === 'POS_MASTER'[\s\S]*?\? 'SYNCED_MASTER'/);
});
