import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import 'fake-indexeddb/auto';

import { DEFAULT_TERMINAL_CONFIG } from '../constants';
import {
  applyFiscalProviderResult,
  DEFAULT_FISCAL_PROVIDERS,
  getEffectiveFiscalComplianceConfig,
  getExistingFiscalProviderReference,
  getFiscalProviderConfig,
  normalizeFiscalProviderId,
} from '../utils/fiscal/fiscalHelpers';
import {
  applyTerminalConfigSnapshot,
  sanitizeFiscalConfigSecrets,
  sanitizeTerminalSnapshotFiscalSecrets,
} from '../utils/terminalConfigSnapshot';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
};

const localStorageMock = memoryStorage();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageMock });
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: localStorageMock,
    location: {
      origin: 'https://pos.example.test',
      protocol: 'https:',
      hostname: 'pos.example.test',
    },
    setTimeout,
    clearTimeout,
  },
});

const issuance=(code:string,sequence:number)=>({schemaVersion:1,source:'POS_FISCAL_RESERVATION_V1',ncf:code+String(sequence).padStart(10,'0'),ncfType:code,sequence,
 fiscalRangeId:'original-range-'+code,fiscalAllocationId:'original-allocation-'+code,prefix:code,rangeStart:1,rangeEnd:9999999999,allocationStart:1,allocationEnd:9999999999,
 expiryDate:'2099-12-31',issuerRnc:'101010101',tenantId:'tenant',companyId:'company',terminalId:'terminal-mseller',capturedAt:'2026-10-16T00:00:00Z'} as any);

const buildBusinessConfig = () => ({
  companyInfo: { name: 'Comercio QA', rnc: '101010101' },
  fiscalCompliance: {
    mode: 'ECF',
    defaultProvider: 'NONE',
    allowLegacyFallback: false,
    providers: [],
  },
  terminals: [{
    id: 'terminal-mseller',
    name: 'Caja MSeller',
    config: {
      ...structuredClone(DEFAULT_TERMINAL_CONFIG),
      fiscal: {
        ...structuredClone(DEFAULT_TERMINAL_CONFIG.fiscal),
        providerId: 'NONE',
        authToken: 'STALE_LOCAL_SECRET',
      },
    },
  }],
} as any);

test('normaliza MSELLER y conserva defaults delegados sin afectar proveedores existentes', () => {
  assert.equal(normalizeFiscalProviderId(' mseller '), 'MSELLER');
  assert.equal(normalizeFiscalProviderId('POLARIS'), 'POLARIS');
  assert.equal(normalizeFiscalProviderId('digifact'), 'DIGIFACT');
  assert.equal(normalizeFiscalProviderId('NONE'), 'NONE');

  const provider = DEFAULT_FISCAL_PROVIDERS.find((entry) => entry.id === 'MSELLER');
  assert.equal(provider?.displayName, 'MSeller e-CF');
  assert.equal(provider?.environment, 0);
  assert.equal(provider?.deliveryMode, 'DELEGATED_ERP');
});

test('hidrata terminalFiscalConfig de MSeller, fuerza ERP delegado y descarta secretos', () => {
  const snapshot = {
    terminal_id: 'terminal-mseller',
    fiscalMode: 'ECF',
    resolved: {
      terminalFiscalConfig: {
        providerId: 'MSELLER',
        environment: 2,
        credentialKey: 'tenant-qa/key.01',
        deliveryMode: 'LOCAL_DIRECT',
        authToken: 'TOKEN_SHOULD_NOT_PERSIST',
        access_token: 'ACCESS_SHOULD_NOT_PERSIST',
        refreshToken: 'REFRESH_SHOULD_NOT_PERSIST',
        password: 'PASSWORD_SHOULD_NOT_PERSIST',
        apiKey: 'API_KEY_SHOULD_NOT_PERSIST',
        credentials: [{ password: 'ARRAY_SECRET_SHOULD_NOT_PERSIST' }],
      },
    },
  } as any;

  const applied = applyTerminalConfigSnapshot(buildBusinessConfig(), {
    terminalId: 'terminal-mseller',
    incomingSnapshot: snapshot,
  });
  const terminal = applied.config.terminals.find((entry) => entry.id === 'terminal-mseller')!;

  assert.equal(terminal.config.fiscal.providerId, 'MSELLER');
  assert.equal(terminal.config.fiscal.environment, 2);
  assert.equal(terminal.config.fiscal.credentialKey, 'tenant-qa/key.01');
  assert.equal(terminal.config.fiscal.deliveryMode, 'DELEGATED_ERP');
  const serialized = JSON.stringify(terminal.config);
  assert.doesNotMatch(serialized, /TOKEN_SHOULD_NOT_PERSIST|ACCESS_SHOULD_NOT_PERSIST|REFRESH_SHOULD_NOT_PERSIST|PASSWORD_SHOULD_NOT_PERSIST|API_KEY_SHOULD_NOT_PERSIST|ARRAY_SECRET_SHOULD_NOT_PERSIST|STALE_LOCAL_SECRET/);

  const effective = getEffectiveFiscalComplianceConfig(applied.config, terminal.config);
  assert.equal(effective.defaultProvider, 'MSELLER');
  assert.equal(getFiscalProviderConfig(effective, 'MSELLER').deliveryMode, 'DELEGATED_ERP');

  const legacySafe = sanitizeTerminalSnapshotFiscalSecrets({
    terminal_config: {
      resolved: {
        terminal_fiscal_config: {
          provider_id: 'MSELLER',
          credential_key: 'tenant-qa/key.01',
          access_token: 'LEAK_ACCESS',
          refreshToken: 'LEAK_REFRESH',
          credentials: [{ password: 'LEAK_ARRAY' }],
        },
      },
    },
  } as any);
  assert.equal(JSON.stringify(legacySafe).includes('tenant-qa/key.01'), true);
  assert.doesNotMatch(JSON.stringify(legacySafe), /LEAK_ACCESS|LEAK_REFRESH|LEAK_ARRAY/);
  const lifecycleSource = readFileSync(new URL('../utils/erpSyncLifecycle.ts', import.meta.url), 'utf8');
  assert.match(lifecycleSource, /snapshot: sanitizeTerminalSnapshotFiscalSecrets\(/);
  assert.match(lifecycleSource, /const nextErpSnapshot = sanitizeTerminalSnapshotFiscalSecrets\(/);
  assert.match(lifecycleSource, /fiscal: sanitizeFiscalConfigSecrets\(resolvedConfig\.fiscal\)/);
  assert.deepEqual(
    sanitizeFiscalConfigSecrets({
      providerId: 'MSELLER',
      credentialKey: 'tenant-qa/key.01',
      authToken: 'LEGACY_TOKEN',
      access_token: 'LEGACY_ACCESS',
    } as any),
    { providerId: 'MSELLER', credentialKey: 'tenant-qa/key.01' }
  );
});

test('normaliza y persiste la respuesta fiscal completa de MSeller', async () => {
  const { normalizeFiscalProviderResponse } = await import('../services/fiscal/fiscalService');
  const normalized = normalizeFiscalProviderResponse({
    success: true,
    providerId: 'MSELLER',
    environment: 0,
    documentCode: 'E31',
    providerTransactionId: 'E310000000001',
    providerReference: 'TRACK-001',
    eNCF: 'E310000000001',
    status: 'RECIBIDO',
    message: 'Recibido por MSeller',
    pending: true,
    diagnostics: {
      qrUrl: 'https://qr.example.test/1',
      securityCode: 'SEC-001',
    },
  });
  const transaction = applyFiscalProviderResult({
    id: 'sale-1',
    date: new Date().toISOString(),
    items: [],
    total: 0,
    payments: [],
    userId: 'u1',
    userName: 'QA',
    status: 'COMPLETED',
  } as any, normalized);

  assert.equal(normalized.pending, true);
  assert.equal(transaction.fiscalCertifiedNcf, 'E310000000001');
  assert.equal(transaction.fiscalReferenceId, 'E310000000001');
  assert.equal(transaction.fiscalProviderStatus, 'RECIBIDO');
  assert.equal(transaction.fiscalQrUrl, 'https://qr.example.test/1');
  assert.equal(transaction.fiscalSecurityCode, 'SEC-001');
  assert.equal(transaction.fiscalResponseMessage, 'Recibido por MSeller');

  const rejected = normalizeFiscalProviderResponse({
    success: true,
    providerId: 'MSELLER',
    environment: 0,
    providerTransactionId: 'E310000000002',
    status: 'RECHAZADO',
    message: 'Documento no enviado por validación',
    pending: false,
  });
  assert.equal(rejected.pending, false);
  assert.equal(rejected.success, false);

  const failedWhileProcessing = normalizeFiscalProviderResponse({
    success: false,
    providerId: 'MSELLER',
    environment: 0,
    providerTransactionId: 'E310000000003',
    status: 'ERROR',
    message: 'Error procesando documento',
    pending: false,
  });
  assert.equal(failedWhileProcessing.pending, false);
  assert.equal(failedWhileProcessing.success, false);
});

test('production E31/E32/E34/E44/E45 remains held without authoritative ERP APPLIED receipt, zero network and no source mutation',async()=>{
 const {issueFiscalDocument,getFiscalDocumentStatus}=await import('../services/fiscal/fiscalService');
 const {initDatabase}=await import('../services/db');await initDatabase();
 const originalFetch=globalThis.fetch;let posts=0;globalThis.fetch=async()=>{posts++;return Response.json({success:true,status:'ACCEPTED'});};
 try{for(const code of ['E31','E32','E34','E44','E45']){
  const tx:any={id:'held-'+code,ncfType:code,ncf:code+'0000000001',electronicNcf:code+'0000000001',fiscalProvider:'MSELLER',fiscalIssuance:issuance(code,1),items:[],payments:[],total:118};
  const before=JSON.stringify(tx),input:any={providerId:'MSELLER',environment:0,companyInfo:{name:'Synthetic',rnc:'101010101'},transaction:tx};
  const results=await Promise.allSettled([issueFiscalDocument(input),issueFiscalDocument(input)]);
  for(const result of results){assert.equal(result.status,'rejected');assert.match((result as PromiseRejectedResult).reason.message,/APPLIED_RECEIPT_REQUIRED/);}
  assert.equal(JSON.stringify(tx),before);
  await assert.rejects(()=>issueFiscalDocument({...input,providerId:'DIGIFACT'}),/UNKNOWN_GET_ONLY/);
 }await assert.rejects(()=>getFiscalDocumentStatus('MSELLER',0,'track'),/SCOPED_GET_REQUIRED/);assert.equal(posts,0);
 }finally{globalThis.fetch=originalFetch;}
});

test('protege reintentos con referencia o e-NCF certificado y bloquea credenciales locales', async () => {
  assert.equal(getExistingFiscalProviderReference({ fiscalSyncStatus: 'ERROR', fiscalReferenceId: 'TRACK-ERROR' }), 'TRACK-ERROR');
  assert.equal(getExistingFiscalProviderReference({ fiscalSyncStatus: 'ERROR', fiscalCertifiedNcf: 'E310000000009' }), 'E310000000009');

  const { saveLocalFiscalCredential, saveSupabaseFiscalCredential } = await import('../services/fiscal/fiscalService');
  await assert.rejects(
    saveLocalFiscalCredential('MSELLER', 'FAKE_SECRET'),
    /exclusivamente en el ERP/
  );
  await assert.rejects(
    saveSupabaseFiscalCredential('MSELLER', 'FAKE_SECRET'),
    /exclusivamente en el ERP/
  );

  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(appSource, /const existingReference = getExistingFiscalProviderReference\(transaction\);/);
  assert.match(appSource, /if \(existingReference\) \{\s*await pollFiscalDocumentStatus\(/);
  assert.match(appSource, /fiscalReferenceId: undefined,\s*fiscalCertifiedNcf: undefined,\s*fiscalProviderStatus: undefined,\s*fiscalQrUrl: undefined,\s*fiscalSecurityCode: undefined,/);
});
test('non-MSeller issuer/status retain legacy transport and acceptance; source claim blocks provider escape even if caller changes its provider field',async()=>{
 const {issueFiscalDocument,getFiscalDocumentStatus}=await import('../services/fiscal/fiscalService');const {db}=await import('../utils/db');
 const originalFetch=globalThis.fetch;let calls=0;localStorageMock.setItem('CLIC_POS_FISCAL_BASE_URL','https://legacy-fiscal.example.test');
 globalThis.fetch=async(_url:any,init:any)=>{calls++;if(init?.method==='POST'){const body=JSON.parse(init.body);assert.equal(body.providerId,'POLARIS');assert.equal(body.transaction.fiscalProvider,'POLARIS');}
  return Response.json({success:true,pending:false,status:'ACCEPTED',providerId:'POLARIS',environment:0,documentCode:'E32',eNCF:'E320000000077',providerTransactionId:'legacy-track'});};
 const input:any={providerId:'POLARIS',environment:0,companyInfo:{name:'Synthetic',rnc:'101010101'},transaction:{id:'legacy-source',fiscalProvider:'POLARIS',ncfType:'E32',ncf:'E320000000077',electronicNcf:'E320000000077',items:[],payments:[],total:118}};
 try{assert.equal((await issueFiscalDocument(input)).success,true);assert.equal(calls,1);assert.equal((await getFiscalDocumentStatus('POLARIS',0,'legacy-track')).success,true);assert.equal(calls,2);
  await db.saveDocument('fiscalDispatchClaims' as any,{id:'claimed-source',malformed:true});
  await assert.rejects(()=>issueFiscalDocument({...input,transaction:{...input.transaction,id:'claimed-source'}}),/UNKNOWN_GET_ONLY/);assert.equal(calls,2);
 }finally{globalThis.fetch=originalFetch;}
});
