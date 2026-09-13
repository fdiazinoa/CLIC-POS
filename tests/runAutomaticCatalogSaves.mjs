import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const directory = await mkdtemp(resolve('.catalog-sync-test-'));
try {
    const outfile = join(directory, 'automatic.mjs');
    await build({ entryPoints: ['tests/automaticCatalogSaves.integration.ts'], outfile,
        bundle: true, platform: 'node', format: 'esm', packages: 'external',
        define: { 'import.meta.env': JSON.stringify({ VITE_POS_CATALOG_EDITS_ENABLED: 'true' }) },
    });
    const result = spawnSync(process.execPath, ['--test', outfile], { stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
} finally { await rm(directory, { recursive: true, force: true }); }
