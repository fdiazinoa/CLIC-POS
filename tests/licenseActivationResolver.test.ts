import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual resolver with synthetic transport/auth seams. No tenant network calls.
for (const persistIdentity of [false, undefined]) {
    test(`activation resolver persistence mode ${String(persistIdentity)} preserves expected identity writes`, async () => {
        const writes: string[] = [];
        const tenant = { id: '11111111-1111-4111-8111-111111111111', slug: 'synthetic' };
        const source = readFileSync(new URL('../utils/licenseGuard.ts', import.meta.url), 'utf8').replaceAll('import.meta.env', '({VITE_SUPABASE_URL: "https://synthetic.invalid", VITE_SUPABASE_ANON_KEY: "synthetic-public"})');
        const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        const exports: Record<string, any> = {};
        const context = vm.createContext({
            exports, console, setTimeout, clearTimeout, AbortController,
            localStorage: { getItem: () => null, setItem: (key: string) => writes.push(key) },
            fetch: async () => ({ ok: true, status: 200, json: async () => [tenant] }),
            require: (name: string) => {
                if (name === './supabase') return { ensureSupabaseSessionRestored: async () => {}, supabase: { auth: { getSession: async () => ({ data: { session: { user: { email: 'synthetic@example.invalid' } } } }) } } };
                if (name === './cloudDefaults') return { DEFAULT_CLOUD_SUPABASE_ANON_KEY: 'synthetic-public', DEFAULT_CLOUD_SUPABASE_URL: 'https://synthetic.invalid', normalizeCloudUrl: (value: string) => value };
                if (name === './erpBaseUrl') return { DEFAULT_PUBLIC_ERP_BASE_URL: 'https://synthetic.invalid' };
                if (name === './erpSyncLifecycle') return { clearStoredErpSyncBinding: () => {} };
                throw Error(`Unexpected dependency ${name}`);
            },
        });
        vm.runInContext(js, context);
        const result = await exports.resolveTenantRecord({ tenantId: tenant.id }, persistIdentity === false ? { persistIdentity: false } : undefined);
        assert.equal(result.id, tenant.id);
        if (persistIdentity === false) assert.deepEqual(writes, []);
        else assert.ok(writes.includes('clic_tenant_id'));
    });
}
