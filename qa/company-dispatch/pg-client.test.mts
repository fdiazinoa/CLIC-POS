/** Transport contract tests against a newly owned disposable PG database.
 * Synthetic functions below test SQL/result encoding only, not ERP business apply.
 * Run explicitly: CLIC_DISPATCH_TEST_PG_PORT=55443 node --import tsx --test qa/company-dispatch/pg-client.test.mts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { localPgClient } from './pg-client.mts';

test('local QA transport preserves PostgreSQL results and fails closed', async t => {
    assert.equal(process.env.CLIC_DISPATCH_TEST_PG_PORT, '55443', 'Explicit isolated PG55443 required');
    const require = createRequire(new URL('../../../CLIC-ERP-company-dispatch/package.json', import.meta.url));
    const { Client } = require('pg');
    const config = { host: '127.0.0.1', port: 55443, user: 'felixdiaz', connectionTimeoutMillis: 3000 };
    const database = 'dispatch_transport_' + randomUUID().replaceAll('-', '');
    const admin = new Client({ ...config, database: 'postgres' });
    const db = new Client({ ...config, database });
    let created = false, connected = false, calls = 0;
    try {
        await admin.connect();
        const own = (await admin.query("select current_user owner, host(inet_server_addr()) address, inet_server_port() port, current_setting('data_directory') directory")).rows[0];
        assert.deepEqual(own, { owner: 'felixdiaz', address: '127.0.0.1', port: 55443, directory: '/tmp/clic-company-dispatch-pg.g555s1ac' });
        assert.match(database, /^dispatch_transport_[0-9a-f]{32}$/);
        await admin.query('create database "' + database + '"');
        created = true;
        await db.connect();
        connected = true;
        await db.query(`
            create table transport_rows (id integer primary key, tenant text, code text, name text, metadata jsonb);
            create function public.erp_sync_receive_inbox_batch(p_events jsonb)
            returns table(batch_ordinal integer, result_event_id uuid, payload jsonb)
            language sql as $$
                select (ordinality - 1)::integer, (event->>'event_id')::uuid, event->'payload'
                from jsonb_array_elements(p_events) with ordinality source(event, ordinality)
                order by ordinality
            $$;
            create function public.transport_scalar(p_events text[]) returns jsonb
            language sql as $$ select jsonb_build_object('values', to_jsonb(p_events)) $$;
        `);
        const quoted = 'a,"quoted"\\value';
        await db.query('insert into transport_rows values($1,$2,$3,$4,$5),($6,$7,$8,$9,$10),($11,$12,$13,$14,$15)', [
            1, 'A', 'cash', quoted, { status: 'BOUND' },
            2, 'A', 'credit', null, { status: 'READY' },
            3, 'B', 'cash', quoted, { status: 'BOUND' }
        ]);
        const client = localPgClient({ query: (...args: any[]) => { calls++; return db.query(...args); } });

        await t.test('OR stays grouped with tenant filters and quoted values remain bound', async () => {
            const result = await client.from('transport_rows').select('id').eq('tenant', 'A')
                .or('code.eq.cash,name.eq.' + JSON.stringify(quoted)).order('id');
            assert.equal(result.error, null);
            assert.deepEqual(result.data, [{ id: 1 }]);
            const comma = await client.from('transport_rows').select('id').eq('tenant', 'A')
                .or('name.eq.' + JSON.stringify(quoted));
            assert.deepEqual(comma.data, [{ id: 1 }]);
            const injection = await client.from('transport_rows').select('id')
                .or('name.eq.' + JSON.stringify("x' OR true; --"));
            assert.equal(injection.error, null);
            assert.deepEqual(injection.data, []);
        });

        await t.test('supported null, wildcard and JSON-path predicates execute in PostgreSQL', async () => {
            const nulls = await client.from('transport_rows').select('id').eq('tenant', 'A')
                .or('name.is.null,code.ilike.CA*').order('id');
            assert.equal(nulls.error, null);
            assert.deepEqual(nulls.data, [{ id: 1 }, { id: 2 }]);
            const path = await client.from('transport_rows').select('id').eq('tenant', 'A')
                .or('metadata->>status.eq.BOUND');
            assert.equal(path.error, null);
            assert.deepEqual(path.data, [{ id: 1 }]);
        });

        await t.test('unsupported and malformed OR filters fail before SQL with no mutations', async () => {
            const before = (await db.query('select * from transport_rows order by id')).rows;
            const beforeCalls = calls;
            for (const expression of ['', 'code.neq.cash', '(code.eq.cash)', 'code.is.true',
                'code.eq."unterminated', 'code.eq.cash,', 'code.eq.x;delete',
                'code.eq.' + 'x'.repeat(16384), Array(33).fill('code.eq.cash').join(',')]) {
                assert.throws(() => client.from('transport_rows').or(expression));
            }
            assert.throws(() => client.from('transport_rows').or('code.eq.cash', {}));
            assert.equal(calls, beforeCalls);
            assert.deepEqual((await db.query('select * from transport_rows order by id')).rows, before);
        });

        await t.test('batch array is JSONB and all ordered UUID rows are returned', async () => {
            const events = [
                { event_id: randomUUID(), payload: { type: 'PAYMENT_POSTED', amount: 550 } },
                { event_id: randomUUID(), payload: { type: 'SALE_POSTED', items: [{ quantity: 6 }] } }
            ];
            const result = await client.rpc('erp_sync_receive_inbox_batch', { p_events: events });
            assert.equal(result.error, null);
            assert.deepEqual(result.data, events.map((event, batch_ordinal) => ({ batch_ordinal, result_event_id: event.event_id, payload: event.payload })));
            assert.deepEqual(await client.rpc('erp_sync_receive_inbox_batch', { p_events: [] }), { data: [], error: null });
        });

        await t.test('other scalar RPCs retain native PostgreSQL array handling and scalar result', async () => {
            assert.deepEqual(await client.rpc('transport_scalar', { p_events: ['cash', 'a,b', '"quoted"'] }),
                { data: { values: ['cash', 'a,b', '"quoted"'] }, error: null });
        });

        await t.test('PostgreSQL errors are retained without success or substituted rows', async () => {
            const result = await client.rpc('erp_sync_receive_inbox_batch', { p_events: [{ event_id: 'invalid', payload: {} }] });
            assert.equal(result.data, null);
            assert.equal(result.error?.code, '22P02');
        });
    } finally {
        if (connected) await db.end();
        if (created) await admin.query('drop database "' + database + '"');
        await admin.end();
    }
});
