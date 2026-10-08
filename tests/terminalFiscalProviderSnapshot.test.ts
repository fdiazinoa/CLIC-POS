import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TERMINAL_CONFIG } from '../constants';
import { applyTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';
import { getEffectiveFiscalComplianceConfig } from '../utils/fiscal/fiscalHelpers';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
} });
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage, location: { origin: 'https://pos.example.test', protocol: 'https:', hostname: 'pos.example.test' },
  setTimeout, clearTimeout,
} });

const terminal = (id = 'T99', fiscal = {}) => ({ id, name: id, config: {
  ...structuredClone(DEFAULT_TERMINAL_CONFIG),
  fiscal: { ...structuredClone(DEFAULT_TERMINAL_CONFIG.fiscal), providerId: 'NONE', enabled: true, ...fiscal },
} });
const business = (fiscal = {}) => ({ companyInfo: { name: 'QA' },
  fiscalCompliance: { mode: 'ECF', defaultProvider: 'NONE', allowLegacyFallback: false, providers: [] },
  terminals: [terminal('T99', fiscal), terminal('OTHER', { providerId: 'DIGIFACT', environment: 3, credentialKey: 'OTHER' })],
} as any);
const snapshot = (resolved = {}, config = {}) => ({ terminal_id: 'T99', fiscalMode: 'ECF', resolved, config } as any);
const apply = (incoming: any, base = business(), cached?: any, terminalId = 'T99') =>
  applyTerminalConfigSnapshot(base, { terminalId, incomingSnapshot: incoming, cachedSnapshot: cached });
const fiscal = (result: ReturnType<typeof apply>, id = 'T99') => result.config.terminals.find(t => t.id === id)!.config.fiscal as any;

for (const providerId of ['MSELLER', 'DIGIFACT', 'POLARIS']) {
  test(`actual ERP nested wrapper maps ${providerId}, environment and source credential reference`, () => {
    const record = { providerId, enabled: true, mode: 'ECF', environment: 2,
      credentialKey: 'tenant-qa/key.01', deliveryMode: 'LOCAL_DIRECT', authToken: 'INCOMING_SECRET',
      credentials: [{ password: 'NESTED_SECRET' }] };
    const input = snapshot({ terminalFiscalConfig: { canIssueFiscalDocuments: true, fiscal: record }, fiscal: record }, { fiscal: record });
    const base = business({ authToken: 'OLD_SECRET' });
    const before = structuredClone(base);
    const result = apply(input, base);
    const current = fiscal(result);
    assert.equal(current.providerId, providerId);
    assert.equal(current.environment, 2);
    assert.equal(current.enabled, true);
    assert.equal(current.credentialKey, providerId === 'MSELLER' ? 'tenant-qa/key.01' : 'TENANTQAKEY01');
    assert.equal(current.deliveryMode, providerId === 'MSELLER' ? 'DELEGATED_ERP' : 'LOCAL_DIRECT');
    assert.equal(getEffectiveFiscalComplianceConfig(result.config, result.config.terminals[0].config).defaultProvider, providerId);
    assert.doesNotMatch(JSON.stringify(result.config.terminals[0].config), /INCOMING_SECRET|NESTED_SECRET|OLD_SECRET/);
    assert.deepEqual(result.config.terminals[1], before.terminals[1]);
    assert.deepEqual(base, before);
  });
}

for (const shape of ['flat', 'resolved', 'config', 'snake']) {
  test(`${shape} fiscal source preserves compatible provider mapping`, () => {
    const record = { providerId: 'MSELLER', environment: 1, credentialKey: 'erp/key-1' };
    const input = shape === 'flat' ? snapshot({ terminalFiscalConfig: record })
      : shape === 'resolved' ? snapshot({ fiscal: record })
        : shape === 'config' ? snapshot({}, { fiscal: record })
          : snapshot({ terminal_fiscal_config: { fiscal: { provider_id: 'MSELLER', ambiente: 1, credential_key: 'erp/key-1', delivery_mode: 'LOCAL_DIRECT' } } });
    const result = fiscal(apply(input));
    assert.equal(result.providerId, 'MSELLER'); assert.equal(result.environment, 1);
    assert.equal(result.credentialKey, 'erp/key-1'); assert.equal(result.deliveryMode, 'DELEGATED_ERP');
  });
}

test('explicit NONE and disabled false in legacy wrapper beat lower-priority nested provider', () => {
  const incoming = snapshot({ terminalFiscalConfig: { providerId: 'NONE', enabled: false,
    fiscal: { providerId: 'MSELLER', environment: 2, credentialKey: 'DO_NOT_BORROW' } },
    fiscal: { providerId: 'DIGIFACT', environment: 3, credentialKey: 'OTHER_SOURCE' } },
  { fiscal: { providerId: 'POLARIS', credentialKey: 'LOWEST_SOURCE' } });
  const result = fiscal(apply(incoming, business({ providerId: 'POLARIS', credentialKey: 'STALE_KEY' })));
  assert.equal(result.providerId, 'NONE'); assert.equal(result.enabled, false);
  assert.equal(result.environment, 0); assert.equal(result.credentialKey, undefined);
});

test('nested wrapper precedes resolved and config without mixing provider fields', () => {
  const result = fiscal(apply(snapshot({ terminalFiscalConfig: { fiscal: { providerId: 'MSELLER' } },
    fiscal: { providerId: 'DIGIFACT', environment: 3, credentialKey: 'WRONG_KEY' } },
  { fiscal: { providerId: 'POLARIS', environment: 2, credentialKey: 'WRONG_CONFIG_KEY' } }),
  business({ providerId: 'POLARIS', environment: 3, credentialKey: 'OLD_PROVIDER_KEY' })));
  assert.equal(result.providerId, 'MSELLER'); assert.equal(result.environment, 0);
  assert.equal(result.credentialKey, undefined); assert.equal(result.deliveryMode, 'DELEGATED_ERP');
});

test('configured provider with explicit enabled false remains disabled in ECF policy', () => {
  const result = apply(snapshot({ terminalFiscalConfig: { fiscal: { providerId: 'MSELLER', enabled: false, environment: 2, mode: 'ECF' } } }));
  assert.equal(fiscal(result).providerId, 'MSELLER'); assert.equal(fiscal(result).enabled, false);
  const effective = getEffectiveFiscalComplianceConfig(result.config, result.config.terminals[0].config);
  assert.equal(effective.mode, 'ECF'); assert.equal(effective.defaultProvider, 'NONE');
});

test('disabled-only source blocks lower-priority enable/provider while preserving local assignment', () => {
  const result = fiscal(apply(snapshot({ terminalFiscalConfig: { enabled: false, fiscal: { providerId: 'MSELLER' } } }),
    business({ providerId: 'POLARIS', enabled: true })));
  assert.equal(result.enabled, false); assert.equal(result.providerId, 'POLARIS');
});

for (const value of ['UNKNOWN_PROVIDER', null, 'NONE']) {
  test(`explicit provider ${value} is safe NONE rather than borrowed from another alias or source`, () => {
    const result = fiscal(apply(snapshot({ terminalFiscalConfig: { fiscal: { providerId: value, provider_id: 'MSELLER' } } }),
      business({ providerId: 'POLARIS', credentialKey: 'STALE_KEY' })));
    assert.equal(result.providerId, 'NONE'); assert.equal(result.credentialKey, undefined);
  });
}

test('omitted incoming provider preserves local settings and never borrows cached fallback credentials', () => {
  const base = business({ providerId: 'POLARIS', environment: 3, credentialKey: 'LOCAL_REF', deliveryMode: 'LOCAL_DIRECT' });
  const cached = snapshot({ terminalFiscalConfig: { providerId: 'MSELLER', environment: 2, credentialKey: 'CACHE_REF' } },
    { fiscal: { providerId: 'DIGIFACT', environment: 1, credentialKey: 'CACHE_CONFIG_REF' } });
  const result = fiscal(apply(snapshot({ terminalFiscalConfig: { canIssueFiscalDocuments: true }, fiscal: { environment: 0 } }), base, cached));
  assert.equal(result.providerId, 'POLARIS'); assert.equal(result.environment, 3);
  assert.equal(result.credentialKey, 'LOCAL_REF'); assert.equal(result.deliveryMode, 'LOCAL_DIRECT');
});

test('incoming config provider wins over cached resolved fiscal when fresh resolved scope is absent', () => {
  const cached = snapshot({ terminalFiscalConfig: { providerId: 'DIGIFACT', credentialKey: 'CACHE_REF' } });
  const result = fiscal(apply(snapshot({}, { fiscal: { providerId: 'MSELLER', environment: 2, credentialKey: 'FRESH_REF' } }), business(), cached));
  assert.equal(result.providerId, 'MSELLER'); assert.equal(result.environment, 2); assert.equal(result.credentialKey, 'FRESH_REF');
});

for (const mode of ['LEGACY_B', 'NONE']) {
  test(`${mode} policy is retained despite a nested eCF provider`, () => {
    const input = snapshot({ terminalFiscalConfig: { fiscal: { providerId: 'MSELLER', enabled: true } } });
    input.fiscalMode = mode;
    const result = fiscal(apply(input));
    assert.equal(result.mode, mode);
    assert.equal(result.providerId, mode === 'NONE' ? 'NONE' : undefined);
    assert.equal(result.enabled, mode !== 'NONE');
  });
}

test('snapshot for another terminal does not reassign current terminal provider', () => {
  const input = snapshot({ fiscal: { providerId: 'MSELLER', environment: 2 } }); input.terminal_id = 'OTHER';
  const result = fiscal(apply(input, business({ providerId: 'POLARIS', environment: 3 })));
  assert.equal(result.providerId, 'POLARIS'); assert.equal(result.environment, 3);
});

test('new terminal without provider cannot inherit another terminal provider or credential reference', () => {
  const result = apply({ terminal_id: 'NEW', fiscalMode: 'ECF', resolved: {} }, business({ providerId: 'POLARIS', credentialKey: 'OTHER_SECRET_REF' }), undefined, 'NEW');
  assert.equal(fiscal(result, 'NEW').providerId, undefined);
  assert.equal(fiscal(result, 'NEW').credentialKey, undefined);
});

test('CONFIG_PUSH wrapper and pull resolved/config shapes are equivalent and repeated application is idempotent', () => {
  const record = { providerId: 'MSELLER', enabled: true, environment: 2, credentialKey: 'REFERENCE_ONLY', mode: 'ECF' };
  const pushed = apply(snapshot({ terminalFiscalConfig: { fiscal: record } }));
  const pulled = apply(snapshot({ fiscal: record }, { fiscal: record }));
  const repeated = apply(snapshot({ terminalFiscalConfig: { fiscal: record } }), pushed.config);
  assert.deepEqual(fiscal(pushed), fiscal(pulled));
  assert.deepEqual(fiscal(repeated), fiscal(pushed));
});

for (const [oldProvider, newProvider] of [['DIGIFACT', 'MSELLER'], ['MSELLER', 'POLARIS'], ['POLARIS', 'DIGIFACT']]) {
  test(`provider switch ${oldProvider} to ${newProvider} clears stale endpoint and provider codes`, () => {
    const base = business({ providerId: oldProvider, credentialKey: 'OLD_REF', apiBaseUrl: 'https://old.example.test',
      testUrl: 'https://old.example.test/test', issueUrl: 'https://old.example.test/issue', statusUrl: 'https://old.example.test/status',
      establishmentCode: 'OLD_EST', branchCode: 'OLD_BRANCH', branchName: 'OLD_NAME', cashierCode: 'OLD_CASHIER',
      branch_id: 'OLD_ALIAS_BRANCH', digifact_cashier_code: 'OLD_ALIAS_CASHIER', tipoIngreso: 2,
      modificationCode: 4, unitCodeGoods: 99, unitCodeServices: 99 });
    const result = fiscal(apply(snapshot({ fiscal: { providerId: newProvider, environment: 2 } }), base));
    assert.equal(result.providerId, newProvider);
    assert.equal(result.credentialKey, undefined);
    assert.doesNotMatch(JSON.stringify(result), /old.example.test|OLD_EST|OLD_BRANCH|OLD_NAME|OLD_CASHIER|OLD_ALIAS/);
    assert.equal(result.tipoIngreso, undefined); assert.equal(result.modificationCode, undefined);
    assert.equal(result.unitCodeGoods, undefined); assert.equal(result.unitCodeServices, undefined);
    assert.equal(result.batchSize, base.terminals[0].config.fiscal.batchSize);
    assert.equal(result.lowBatchThreshold, base.terminals[0].config.fiscal.lowBatchThreshold);
  });
}

test('same provider retains existing local endpoints while new source metadata stays coherent', () => {
  const result = fiscal(apply(snapshot({ fiscal: { providerId: 'DIGIFACT', environment: 0 } }),
    business({ providerId: 'DIGIFACT', apiBaseUrl: 'https://same.example.test', establishmentCode: 'SAME', credentialKey: 'OLD_REF' })));
  assert.equal(result.apiBaseUrl, 'https://same.example.test'); assert.equal(result.establishmentCode, 'SAME');
  assert.equal(result.environment, 0); assert.equal(result.credentialKey, undefined);
});

test('nested NONE blocks resolved provider and resolved NONE blocks fallback provider', () => {
  for (const input of [snapshot({ terminalFiscalConfig: { fiscal: { providerId: 'NONE' } }, fiscal: { providerId: 'MSELLER' } }),
    snapshot({ fiscal: { providerId: 'NONE' } }, { fiscal: { providerId: 'MSELLER' } })]) {
    assert.equal(fiscal(apply(input)).providerId, 'NONE');
  }
});

test('enabled true without provider is metadata, not authority to mask a nested assignment or enable local fiscal', () => {
  const result = fiscal(apply(snapshot({ terminalFiscalConfig: { enabled: true, fiscal: { providerId: 'MSELLER', environment: 2 } } })));
  assert.equal(result.providerId, 'MSELLER'); assert.equal(result.environment, 2);
  const omitted = fiscal(apply(snapshot({ terminalFiscalConfig: { enabled: true } }), business({ providerId: 'POLARIS', enabled: false })));
  assert.equal(omitted.providerId, 'POLARIS'); assert.equal(omitted.enabled, false);
});
