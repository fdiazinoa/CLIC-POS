import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePosCatalogEditAuthorization } from '../services/sync/catalogEditAuthorization';

const profile = {
  contractedProduct: 'POS_ERP' as const,
  cloudChannel: 'ERP_ACTIVE' as const,
  localTerminalId: 'CAJA 4',
  erpTerminalId: 'terminal-erp-4',
};

const configWithPermission = (enabled: boolean) => ({
  terminals: [{
    id: 'CAJA 4',
    config: {
      erpTerminalId: 'terminal-erp-4',
      erpSnapshot: {
        terminal: { config: { posCatalogEdits: { enabled } } },
        config: { posCatalogEdits: { enabled } },
      },
    },
  }],
  terminalSnapshots: {},
} as any);

test('ERP terminal explicitly enables POS catalog mutations', () => {
  assert.deepEqual(resolvePosCatalogEditAuthorization(configWithPermission(true), profile, 'CAJA 4'), {
    allowed: true,
    governedByErp: true,
    reason: 'ENABLED',
  });
});

test('ERP terminal explicitly disables POS catalog mutations', () => {
  assert.deepEqual(resolvePosCatalogEditAuthorization(configWithPermission(false), profile, 'CAJA 4'), {
    allowed: false,
    governedByErp: true,
    reason: 'DISABLED',
  });
});

test('ERP-managed catalog fails closed while terminal permission is missing', () => {
  assert.equal(resolvePosCatalogEditAuthorization({ terminals: [] } as any, profile, 'CAJA 4').allowed, false);
});

test('POS-only catalog remains locally editable', () => {
  const authorization = resolvePosCatalogEditAuthorization(null, {
    contractedProduct: 'POS_ONLY',
    cloudChannel: 'NONE',
  }, 'CAJA 4');
  assert.equal(authorization.allowed, true);
  assert.equal(authorization.reason, 'NOT_ERP_MANAGED');
});
