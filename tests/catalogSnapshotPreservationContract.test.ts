import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('ERP catalog and price snapshots preserve pending and unconfirmed applied local edits', async () => {
    const source = await readFile(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');
    const preservation = await readFile(new URL('../services/sync/preserveLocalCatalog.ts', import.meta.url), 'utf8');

  assert.match(source, /import \{ preserveLocalCatalog \} from '\.\/preserveLocalCatalog';/);
  assert.match(
    source,
    /preserveLocalCatalog\(\s*'productPrices',\s*Array\.from\(nextPriceDocs\.values\(\)\),\s*\)/,
  );
  assert.match(
    source,
    /preserveLocalCatalog\(\s*'products',\s*Array\.from\(localById\.values\(\)\),\s*\)/,
  );
  assert.match(
    source,
    /preserveLocalCatalog\(\s*'products',\s*Array\.from\(localProductsById\.values\(\)\),\s*\)/,
  );
  assert.match(preservation, /edit\.status === 'APPLIED' && !edit\.snapshotConfirmedAt/);
  assert.match(preservation, /catalogSnapshotConfirmsMutation\(collection, payload, mutation\)/);
  assert.match(preservation, /snapshotConfirmedAt: new Date\(\)\.toISOString\(\)/);
});
