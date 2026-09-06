// Offline proposal model only. No application imports, DB, HTTP or operational writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const validString = value => {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      assert(next >= 0xdc00 && next <= 0xdfff, 'INVALID_UNICODE');
    } else assert(c < 0xdc00 || c > 0xdfff, 'INVALID_UNICODE');
  }
  return JSON.stringify(value);
};

// Fixture canonicalizer: parsed plain JSON only. Duplicate raw keys cannot be
// detected here; the future wire parser must reject them before parsing.
export function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return validString(value);
  if (typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    assert(Number.isFinite(value), 'NON_FINITE');
    return JSON.stringify(value);
  }
  assert(value && typeof value === 'object', 'NOT_JSON');
  if (Array.isArray(value)) {
    assert(Object.keys(value).length === value.length, 'SPARSE_ARRAY');
    return '[' + value.map(canonical).join(',') + ']';
  }
  assert(Object.getPrototypeOf(value) === Object.prototype, 'NOT_PLAIN_JSON');
  return '{' + Object.keys(value).sort().map(k => validString(k) + ':' + canonical(value[k])).join(',') + '}';
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const hash = value => sha(Buffer.from(canonical(value), 'utf8'));
export const vector = (name, input) => {
  const canonicalUtf8 = canonical(input);
  return { name, input, canonicalUtf8, utf8Hex: Buffer.from(canonicalUtf8).toString('hex'), sha256: hash(input) };
};
const decimal = value => assert(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'DECIMAL');
const same = (a, b, why) => assert.equal(canonical(a), canonical(b), why);
const identity = x => JSON.stringify([x.kind, x.originalId]);
const compare = (a, b) => {
  for (const key of ['kind', 'originalId', 'revision']) {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
  }
  return 0;
};

export function validateCalculationInput(order, manifest) {
  assert(order && Object.getPrototypeOf(order) === Object.prototype, 'INPUT_ORDER_OBJECT');
  same(Object.keys(order).sort(), ['cashMovements', 'collections', 'transactions'], 'INPUT_ORDER_KEYS');
  const expectedTypes = { transactions: 'TRANSACTION', cashMovements: 'CASH_MOVEMENT', collections: 'COLLECTION' };
  const selected = new Map(manifest.members.map(m => [identity(m), m]));
  assert.equal(selected.size, manifest.members.length, 'DUPLICATE_MEMBER');
  const deps = new Set(manifest.dependencies.map(identity));
  const seen = new Set();
  for (const [name, kind] of Object.entries(expectedTypes)) {
    assert(Array.isArray(order[name]), 'INPUT_ORDER_ARRAY');
    for (const ref of order[name]) {
      same(Object.keys(ref).sort(), ['kind', 'originalId', 'revision'], 'INPUT_REFERENCE_KEYS');
      assert.equal(ref.kind, kind, 'INPUT_KIND');
      const id = identity(ref);
      assert(!deps.has(id), 'INPUT_DEPENDENCY');
      assert(!seen.has(id), 'INPUT_DUPLICATE');
      const member = selected.get(id);
      assert(member, 'INPUT_NOT_SELECTED');
      assert.equal(ref.revision, member.revision, 'INPUT_REVISION');
      seen.add(id);
    }
  }
  assert.equal(seen.size, manifest.members.filter(m => m.kind !== 'WALLET').length, 'INPUT_OMISSION');
  // No sorting or mutation of the input arrays: they retain calculation order.
}

export function buildGraph(input) {
  const { scope, storageEpoch, openSetId, operations, report, configuration, declaration, manifest: supplied } = input;
  const vectors = [];
  const put = (name, preimage) => { const v = vector(name, preimage); vectors.push(v); return v.sha256; };
  let chainHash = put('genesis', { domain: 'pos.journal.genesis.v1', scope, storageEpoch });
  const selected = new Map();
  const history = [];
  operations.forEach((op, index) => {
    decimal(op.sequence); decimal(op.revision);
    assert.equal(BigInt(op.sequence), BigInt(index + 1), 'NON_CONTIGUOUS');
    assert.equal(op.original.id, op.originalId, 'ORIGINAL_ID');
    const previous = selected.get(identity(op));
    assert.equal(BigInt(op.revision), previous ? BigInt(previous.revision) + 1n : 1n, 'REVISION');
    const content = { scope, storageEpoch, openSetId, sequence: op.sequence, kind: op.kind,
      originalId: op.originalId, revision: op.revision, original: op.original };
    const originalContentHash = put(`original-${op.sequence}`, content);
    const entry = { domain: 'pos.journal.entry.v1', scope, storageEpoch, openSetId,
      sequence: op.sequence, commandId: op.commandId, originalSchemaVersion: op.originalSchemaVersion,
      kind: op.kind, originalId: op.originalId, revision: op.revision,
      previousContentHash: previous?.originalContentHash ?? null, originalContentHash };
    const entryHash = put(`entry-${op.sequence}`, entry);
    chainHash = put(`chain-${op.sequence}`, { domain: 'pos.journal.chain.v1', previousChainHash: chainHash, entryHash });
    const member = { kind: op.kind, originalId: op.originalId, revision: op.revision,
      originalContentHash, commercialType: op.commercialType };
    selected.set(identity(op), member);
    history.push(member);
  });
  const members = [...selected.values()].sort(compare);
  const configurationHash = put('configuration', configuration);
  const declarationHash = put('declaration', declaration);
  const reportHash = put('report', report);
  const manifest = { ...supplied, terminalId: scope.terminalId, storageEpoch, openSetId,
    sealedThrough: String(operations.length), members, dependencies: [], configurationHash, declarationHash, reportHash };
  const manifestHash = put('manifest', manifest);
  const seal = { domain: 'pos.open-set.seal.v1', scope, storageEpoch, openSetId,
    finalSequence: manifest.sealedThrough, chainHash, manifestHash,
    closeId: manifest.closeId, closeEventId: manifest.closeEventId };
  const sealHash = put('seal', seal);
  const acceptanceDigest = put('acceptance', { domain: 'pos.close.acceptance.v1', scope,
    closeId: manifest.closeId, closeEventId: manifest.closeEventId, manifestHash, sealHash });
  return { vectors, history, manifest, seal, acceptanceDigest };
}

export function validateGraph(input, graph) {
  assert.equal(input.report.id, graph.manifest.closeId, 'REPORT_CLOSE_ID');
  assert.notEqual(graph.manifest.closeId, graph.manifest.closeEventId, 'CLOSE_EVENT_ID');
  const selectedIds = graph.manifest.members.map(identity);
  assert.equal(new Set(selectedIds).size, selectedIds.length, 'DUPLICATE_MEMBER');
  const depIds = graph.manifest.dependencies.map(identity);
  assert.equal(new Set(depIds).size, depIds.length, 'DUPLICATE_DEPENDENCY');
  assert(!depIds.some(id => selectedIds.includes(id)), 'MEMBER_DEPENDENCY_INTERSECTION');
  same(graph.manifest.members, [...graph.manifest.members].sort(compare), 'ORDER');
  validateCalculationInput(input.configuration.calculationInputOrder, graph.manifest);
  same(graph, buildGraph(input), 'GRAPH_MISMATCH');
}

export function verify(bundle) {
  assert.equal(bundle.agreementStatus, 'UNAGREED');
  assert.equal(bundle.exactZEligible, false);
  assert.equal(bundle.closeAuthorization, 'NOT_GRANTED');
  for (const v of [...bundle.canonicalization, ...bundle.graph.vectors]) {
    assert.equal(canonical(v.input), v.canonicalUtf8, v.name);
    assert.equal(Buffer.from(v.canonicalUtf8, 'utf8').toString('hex'), v.utf8Hex, v.name);
    assert.equal(sha(Buffer.from(v.utf8Hex, 'hex')), v.sha256, v.name);
  }
  validateGraph(bundle.input, bundle.graph);
  let negatives = 0;
  const badGraph = mutate => { const b = structuredClone(bundle); mutate(b); assert.throws(() => validateGraph(b.input, b.graph)); negatives++; };
  badGraph(b => { b.input.operations[0].original.amount = 51; });
  badGraph(b => { b.input.scope.companyId = 'different-company'; });
  badGraph(b => { b.input.storageEpoch = 'different-epoch'; });
  badGraph(b => { b.input.operations.reverse(); });
  badGraph(b => { b.input.operations.pop(); });
  badGraph(b => { b.graph.manifest.members.push(b.graph.history[0]); });
  badGraph(b => { b.graph.manifest.dependencies.push({ ...b.graph.history[0], role: 'READ_ONLY' }); });
  badGraph(b => { b.graph.manifest.configurationHash = '0'.repeat(64); });
  badGraph(b => { b.graph.seal.openSetId = 'different-open-set'; });
  badGraph(b => { b.graph.seal.finalSequence = '3'; });
  badGraph(b => { b.input.report.id = 'different-close'; });
  badGraph(b => { b.graph.manifest.closeEventId = b.graph.manifest.closeId; });
  badGraph(b => { b.input.configuration.calculationInputOrder.cashMovements = []; });
  // Semantic negatives recompute every digest; corruption checks alone are insufficient.
  for (const mutate of [
    b => { const o = b.configuration.calculationInputOrder; o.transactions = o.cashMovements; o.cashMovements = []; },
    b => { b.configuration.calculationInputOrder.cashMovements[0].revision = '1'; },
    b => { b.configuration.calculationInputOrder.cashMovements.push(b.configuration.calculationInputOrder.cashMovements[0]); },
    b => { b.configuration.calculationInputOrder.cashMovements = []; },
  ]) {
    const input = structuredClone(bundle.input); mutate(input);
    assert.throws(() => validateGraph(input, buildGraph(input))); negatives++;
  }
  for (const bad of [NaN, Infinity, undefined, 1n, new Date(0), '\ud800', { value: undefined }]) {
    assert.throws(() => canonical(bad)); negatives++;
  }
  // Explicit expectations independent of the fixture-generation path.
  assert.equal(canonical({ 2: 'two', 10: 'ten' }), '{"10":"ten","2":"two"}');
  assert.equal(canonical({ '\ue000': 1, '😀': 2 }), '{"😀":2,"":1}');
  assert.notEqual(hash({ date: '2026-09-06T00:00:00-04:00' }), hash({ date: '2026-09-06T04:00:00.000Z' }));
  assert.notEqual(hash({}), hash({ value: null }));
  assert.notEqual(hash({ value: null }), hash({ value: 0 }));
  assert.notEqual(hash([1, 2]), hash([2, 1]));
  console.log(`PASS: ${bundle.canonicalization.length} canonical vectors; ${bundle.graph.vectors.length} graph digests; ${negatives} negatives. Offline proposal only; no runtime/cash/atomicity certification.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verify(JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8')));
  const erpVectors = JSON.parse(readFileSync(new URL('./erp-own-vectors.json', import.meta.url), 'utf8'));
  for (const v of erpVectors) {
    assert.equal(canonical(v.input), v.canonicalUtf8);
    assert.equal(hash(v.input), v.sha256);
    assert.equal(Buffer.from(v.canonicalUtf8).toString('hex'), v.utf8Hex);
  }
  console.log(`PASS: ${erpVectors.length} unchanged ERP canonicalization vectors.`);
}
