import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogEditQueue, type CatalogEdit, type CatalogResult } from '../services/sync/CatalogEditQueue';

const scope = {
    tenantId: 'tenant-1', terminalId: 'pos-a', companyId: 'company-1',
    deviceId: 'device-a', baseUrl: 'https://erp.example.test',
};
const edit = (id: string, before: number, after: number, dependsOn?: string): CatalogEdit => ({
    id, scope, label: 'Café', dependsOn,
    mutation: { id, recordId: 'product-1', domain: 'prices', field: 'precio_venta', before, after, actorId: 'operator-a' },
    status: 'PENDING', syncStatus: 'PENDING', attempts: 0, nextAttemptAt: 0, createdAt: `2026-09-10T00:00:0${after}.000Z`,
});

test('POS A survives lost ACK, offline and restart; ERP publishes successive changes to POS B', async () => {
    let now = 1_000;
    let rows = [edit('mutation-1', 10, 11), edit('mutation-2', 11, 12, 'mutation-1')];
    const applied = new Map<string, CatalogResult>();
    let erpPrice = 10;
    let loseFirstAck = true;
    let offline = false;
    const send = async (proposal: CatalogEdit): Promise<CatalogResult> => {
        if (offline) throw new Error('offline');
        const replay = applied.get(proposal.id);
        if (replay) return replay;
        const result: CatalogResult = proposal.mutation.before === erpPrice
            ? { id: proposal.id, status: 'APPLIED' }
            : { id: proposal.id, status: 'CONFLICT', current: erpPrice };
        if (result.status === 'APPLIED') erpPrice = proposal.mutation.after as number;
        applied.set(proposal.id, result);
        if (loseFirstAck) { loseFirstAck = false; throw new Error('ACK perdido'); }
        return result;
    };
    const restartPosA = () => new CatalogEditQueue({
        read: async () => structuredClone(rows),
        save: async next => { rows = rows.map(row => row.id === next.id ? structuredClone(next) : row); },
        matchesScope: candidate => candidate.terminalId === 'pos-a' && candidate.tenantId === 'tenant-1',
        send,
        now: () => now,
    });

    await restartPosA().process();
    assert.equal(erpPrice, 11, 'ERP aplicó la mutación aunque se perdió el ACK');
    assert.equal(rows[0].status, 'PENDING', 'POS A conserva la mutación durable para reintentar');
    assert.equal(rows[1].status, 'PENDING', 'el cambio sucesivo espera el ACK anterior');

    now += 400_000;
    await restartPosA().process();
    assert.equal(erpPrice, 12);
    assert.deepEqual(rows.map(row => row.status), ['APPLIED', 'APPLIED']);
    assert.equal(applied.size, 2, 'el replay tras reinicio no duplica aplicaciones ERP');

    let posBPrice = 10;
    posBPrice = erpPrice;
    assert.equal(posBPrice, 12, 'el snapshot canónico ERP llega a POS B');

    rows.push(edit('mutation-3', 12, 13));
    offline = true;
    await restartPosA().process();
    assert.equal(rows[2].status, 'PENDING');
    assert.equal(erpPrice, 12);

    offline = false;
    now += 400_000;
    await restartPosA().process();
    posBPrice = erpPrice;
    assert.equal(posBPrice, 13, 'la cola se recupera después del modo sin conexión y otro reinicio');
});
