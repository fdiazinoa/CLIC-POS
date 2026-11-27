import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessConfig } from '../types';
import { v3OperationalConfigContext } from '../services/sync/LargeMasterSyncV3OperationalConfigScope';
import { acknowledgeV3SalesConfig, isV3SalesConfigPending, publishV3SalesConfig,
  subscribeV3SalesConfigPublication } from '../services/sync/LargeMasterSyncV3ConfigPublication';

const fixture = (id: string, tariff: string) => ({ terminals: [{ id, config: {
  pricing: { defaultTariffId: tariff, allowedTariffIds: [tariff] },
} }] }) as BusinessConfig;
const key = (id: string, config: BusinessConfig) => v3OperationalConfigContext(config, { localTerminalId: id }).key;

test('first catalog input waits from the start of the save until its committed authority is rendered', async () => {
  const id = 'login';
  const previous = fixture(id, 'before');
  const current = fixture(id, 'after');
  const events: boolean[] = [];
  const unsubscribe = subscribeV3SalesConfigPublication(() => events.push(isV3SalesConfigPending(id, key(id, previous))));
  try {
    let commit!: () => void;
    const persisting = new Promise<void>(resolve => { commit = resolve; });
    const save = publishV3SalesConfig(id, previous, current, () => persisting);
    assert.equal(isV3SalesConfigPending(id, key(id, previous)), true);
    assert.equal(isV3SalesConfigPending(id, key(id, current)), true);
    assert.equal(isV3SalesConfigPending('other-terminal', ''), false);
    commit();
    await save;
    assert.equal(isV3SalesConfigPending(id, key(id, previous)), true);
    assert.equal(isV3SalesConfigPending(id, key(id, current)), false);
    acknowledgeV3SalesConfig(id, key(id, current));
    assert.deepEqual(events, [true, true]);
  } finally { unsubscribe(); }
});

test('an equivalent config or a failed write leaves the current authority available', async () => {
  const id = 'unchanged';
  const previous = fixture(id, 'before');
  await publishV3SalesConfig(id, previous, structuredClone(previous), async () => {
    assert.equal(isV3SalesConfigPending(id, key(id, previous)), false);
  });
  await assert.rejects(publishV3SalesConfig(id, previous, fixture(id, 'after'), async () => {
    assert.equal(isV3SalesConfigPending(id, key(id, previous)), true);
    throw Error('write-failed');
  }), /write-failed/);
  assert.equal(isV3SalesConfigPending(id, key(id, previous)), false);
});
