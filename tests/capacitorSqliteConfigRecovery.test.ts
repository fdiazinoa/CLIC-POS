import assert from 'node:assert/strict';
import test from 'node:test';
import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';

test('lee configuración anterior mayor de 4 MiB por fragmentos sin perder vinculación', async () => {
  const stored = JSON.stringify({
    id: 'current',
    terminals: [{ id: 'master-1', config: { erpSnapshot: {
      masters: { items: [{ id: 'sku-270', _catalog_hash: 'a'.repeat(40), name: 'x'.repeat(5 * 1024 * 1024) }] },
    } } }],
    terminalSnapshots: {},
  });
  const queries: string[] = [];
  const adapter = new CapacitorSQLiteAdapter();
  (adapter as any).isReady = true;
  (adapter as any).db = {
    query: async (sql: string, values: any[]) => {
      queries.push(sql);
      if (sql.includes('substr(data')) {
        const [start, length] = values;
        return { values: [{ data: stored.slice(start - 1, start - 1 + length) }] };
      }
      return { values: values[values.length - 1] === 0
        ? [{ doc_id: 'current', data_length: stored.length, data: null }]
        : [] };
    },
  };
  const config = await adapter.getCollection<any>('config');
  assert.equal(config.terminals[0].id, 'master-1');
  assert.deepEqual(config.terminals[0].config.erpSnapshot.masters.items[0], {
    id: 'sku-270', _catalog_hash: 'a'.repeat(40),
  });
  assert.ok(queries.filter((sql) => sql.includes('substr(data')).length > 1);
});
