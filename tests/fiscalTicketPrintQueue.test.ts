import assert from 'node:assert/strict';
import test from 'node:test';
import { FiscalTicketPrintQueue, type FiscalTicketPrintJob } from '../services/fiscal/FiscalTicketPrintQueue';

function fixture() {
  const jobs = new Map<string, FiscalTicketPrintJob>();
  let scope = 'terminal A';
  const ports = {
    scope: () => scope,
    get: async (id: string) => jobs.get(id) ?? null,
    list: async () => [...jobs.values()],
    save: async (job: FiscalTicketPrintJob) => { jobs.set(job.id, { ...job }); },
  };
  return { jobs, ports, setScope: (value: string) => { scope = value; } };
}

test('retains a single waiting print, and prints once after the signed timbre is available', async () => {
  const { jobs, ports } = fixture();
  const queue = new FiscalTicketPrintQueue(ports);
  await Promise.all([queue.enqueue('sale'), queue.enqueue('sale')]);
  assert.equal(jobs.size, 1);
  assert.equal(await queue.drain(async () => undefined), true);
  assert.equal(await queue.blocksManualPrint('sale'), true);
  const restarted = new FiscalTicketPrintQueue(ports);
  let attempts = 0;
  const prepare = async () => async () => {
    assert.equal([...jobs.values()][0].state, 'SENDING');
    attempts += 1;
    return true;
  };
  await Promise.all([restarted.drain(prepare), restarted.drain(prepare)]);
  assert.equal(await restarted.blocksManualPrint('sale'), false);
  assert.equal([...jobs.values()][0].state, 'PRINTED');
  assert.equal(attempts, 1);
});

test('does not automatically send interrupted, failed or fiscally rejected prints', async () => {
  const { jobs, ports } = fixture();
  const queue = new FiscalTicketPrintQueue(ports);
  await queue.enqueue('interrupted');
  const interrupted = [...jobs.values()][0];
  await ports.save({ ...interrupted, state: 'SENDING' });
  await queue.enqueue('failed');
  await queue.enqueue('rejected');
  let attempts = 0;
  const prepare = async (job: FiscalTicketPrintJob) => job.transactionId === 'rejected'
    ? 'REVIEW' as const
    : async () => { attempts += 1; return false; };
  const restarted = new FiscalTicketPrintQueue(ports);
  await restarted.drain(prepare);
  await restarted.drain(prepare);
  assert.equal(attempts, 1);
  assert.equal(await restarted.blocksManualPrint('interrupted'), false);
  assert.deepEqual([...jobs.values()].map(job => job.state), ['SENDING', 'REVIEW', 'REVIEW']);
});

test('rotates through unsigned backlog and stops when terminal scope changes', async () => {
  const { jobs, ports, setScope } = fixture();
  const queue = new FiscalTicketPrintQueue(ports);
  for (let index = 0; index < 6; index++) await queue.enqueue(String(index));
  let sent = 0;
  const prepare = async (job: FiscalTicketPrintJob) => job.transactionId === '5'
    ? async () => { sent += 1; return true; }
    : undefined;
  await queue.drain(prepare);
  assert.equal(sent, 0);
  await queue.drain(prepare);
  assert.equal(sent, 1);
  await queue.drain(async () => {
    setScope('terminal B');
    return async () => { sent += 1; return true; };
  });
  assert.equal(sent, 1);
  assert.equal([...jobs.values()][0].state, 'WAITING_SIGNATURE');
});
