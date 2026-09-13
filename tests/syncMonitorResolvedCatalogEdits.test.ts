import test from 'node:test';
import assert from 'node:assert/strict';
import { SYNC_MONITOR_PAGE_SQL } from '../services/db/SyncMonitorPage';

test('native sync monitor excludes resolved catalog edits from the operational list', () => {
    assert.match(
        SYNC_MONITOR_PAGE_SQL,
        /collection_name='catalogEdits'.*json_extract\(data,'\$\.resolution'\).*IS NOT NULL/s,
    );
});
