// J2 documentary model. Trust anchors are explicit fixture inputs, NOT ERP credentials/proofs.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildGraph, validateGraph, validateCalculationInput, canonical, vector } from './verify-vectors.mjs';

const id = r => JSON.stringify([r.kind, r.originalId]);
const same = (a, b, code) => assert.equal(canonical(a), canonical(b), code);
const ref = r => ({ kind: r.kind, originalId: r.originalId, revision: r.revision });
const sort = rows => [...rows].sort((a, b) => {
  for (const key of ['kind', 'originalId', 'revision']) {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
  }
  return 0;
});

export function buildContinuation(input, trustedArchiveDigest) {
  const { archive, mode, storageEpoch, openSetId, scope, operations, selection, configuration, declaration, report, manifest: base } = input;
  const archiveGraph = buildGraph(archive);
  validateGraph(archive, archiveGraph);
  // Anchor is supplied separately, never learned from the continuation itself.
  assert.equal(archiveGraph.acceptanceDigest, trustedArchiveDigest, 'UNTRUSTED_ARCHIVE');
  same(scope, archive.scope, 'SCOPE');
  assert.notEqual(openSetId, archive.openSetId, 'REUSED_OPEN_SET');
  assert(['NEW_EPOCH', 'SAME_EPOCH_SUFFIX'].includes(mode), 'MODE');
  if (mode === 'NEW_EPOCH') assert.notEqual(storageEpoch, archive.storageEpoch, 'REUSED_EPOCH');
  else assert.equal(storageEpoch, archive.storageEpoch, 'WRONG_EPOCH');
  const vectors = [];
  const put = (name, value) => { const v = vector(name, value); vectors.push(v); return v.sha256; };
  const resumeAnchor = {
    domain: 'pos.journal.resume.v1', scope, mode, storageEpoch, openSetId,
    priorStorageEpoch: archive.storageEpoch, priorOpenSetId: archive.openSetId,
    priorFinalSequence: archiveGraph.seal.finalSequence,
    priorChainHash: archiveGraph.seal.chainHash,
    priorAcceptanceDigest: trustedArchiveDigest,
  };
  put('resume-anchor', resumeAnchor);
  let head = mode === 'NEW_EPOCH'
    ? put('genesis', { domain: 'pos.journal.genesis.v1', scope, storageEpoch })
    : archiveGraph.seal.chainHash;
  const offset = mode === 'NEW_EPOCH' ? 0n : BigInt(archiveGraph.seal.finalSequence);
  const registry = new Map(archiveGraph.history.map(row => [id(row), row]));
  const closedIds = new Set(archiveGraph.manifest.members.map(id));
  const currentIds = new Set();
  const history = [...archiveGraph.history];
  for (const [index, op] of operations.entries()) {
    assert(/^[1-9][0-9]*$/.test(op.sequence), 'SEQUENCE_SHAPE');
    assert.equal(BigInt(op.sequence), offset + BigInt(index + 1), 'SEQUENCE');
    assert(/^[1-9][0-9]*$/.test(op.revision), 'REVISION_SHAPE');
    const previous = registry.get(id(op));
    assert.equal(BigInt(op.revision), previous ? BigInt(previous.revision) + 1n : 1n, 'REVISION');
    assert.equal(op.previousContentHash, previous?.originalContentHash ?? null, 'PREDECESSOR_HASH');
    assert.equal(op.original.id, op.originalId, 'ORIGINAL_ID');
    const originalContentHash = put(`original-${op.sequence}`, {
      scope, storageEpoch, openSetId, sequence: op.sequence, kind: op.kind,
      originalId: op.originalId, revision: op.revision, original: op.original,
    });
    const entryHash = put(`entry-${op.sequence}`, {
      domain: 'pos.journal.entry.v1', scope, storageEpoch, openSetId,
      sequence: op.sequence, commandId: op.commandId, originalSchemaVersion: op.originalSchemaVersion,
      kind: op.kind, originalId: op.originalId, revision: op.revision,
      previousContentHash: op.previousContentHash, originalContentHash,
    });
    head = put(`chain-${op.sequence}`, { domain: 'pos.journal.chain.v1', previousChainHash: head, entryHash });
    const row = { ...ref(op), originalContentHash, commercialType: op.commercialType };
    registry.set(id(op), row); history.push(row); currentIds.add(id(op));
  }
  const selectedIds = selection.members.map(id);
  const dependencyIds = selection.dependencies.map(id);
  assert.equal(new Set(selectedIds).size, selectedIds.length, 'DUPLICATE_MEMBER');
  assert.equal(new Set(dependencyIds).size, dependencyIds.length, 'DUPLICATE_DEPENDENCY');
  assert(!dependencyIds.some(key => selectedIds.includes(key)), 'INTERSECTION');
  const select = (r, isMember) => {
    const row = registry.get(id(r));
    assert(row, 'UNKNOWN_REFERENCE');
    assert.equal(row.revision, r.revision, 'SELECTED_REVISION');
    if (isMember) {
      assert(!closedIds.has(id(r)), 'REOPEN_CLOSED');
      assert(currentIds.has(id(r)), 'MEMBER_NOT_CURRENT');
    } else assert(closedIds.has(id(r)), 'DEPENDENCY_NOT_CLOSED');
    return isMember ? row : { ...row, role: 'READ_ONLY' };
  };
  const members = sort(selection.members.map(r => select(r, true)));
  const dependencies = sort(selection.dependencies.map(r => select(r, false)));
  // In this bounded model every new identity is a member; previously closed ones are context.
  for (const key of currentIds) if (!closedIds.has(key)) assert(selectedIds.includes(key), 'MEMBER_OMISSION');
  for (const op of operations.filter(op => op.kind === 'COLLECTION')) {
    for (const allocation of op.original.allocations) {
      assert.equal(allocation.collectionId, op.originalId, 'ALLOCATION_COLLECTION');
      assert(dependencies.some(d => d.kind === 'TRANSACTION' && d.originalId === allocation.transactionId), 'ALLOCATION_DEPENDENCY');
    }
  }
  validateCalculationInput(configuration.calculationInputOrder, { members, dependencies });
  // Proposal: bind the cross-epoch/suffix anchor in the configuration context, not by
  // rewriting R4's originalContentHash or J1 entry preimages.
  same(configuration.resumeAnchor, resumeAnchor, 'RESUME_ANCHOR');
  assert.equal(base.previousCloseId, archiveGraph.manifest.closeId, 'PREVIOUS_CLOSE');
  assert.equal(base.previousCloseProof, 'EXPLICIT_PREVIOUS', 'PREVIOUS_PROOF');
  assert.equal(report.id, base.closeId, 'REPORT_CLOSE');
  assert.notEqual(base.closeId, base.closeEventId, 'CLOSE_EVENT');
  const manifest = { ...base, terminalId: scope.terminalId, storageEpoch, openSetId,
    sealedThrough: String(offset + BigInt(operations.length)), members, dependencies,
    configurationHash: put('configuration', configuration), declarationHash: put('declaration', declaration), reportHash: put('report', report) };
  const manifestHash = put('manifest', manifest);
  const seal = { domain: 'pos.open-set.seal.v1', scope, storageEpoch, openSetId,
    finalSequence: manifest.sealedThrough, chainHash: head, manifestHash,
    closeId: manifest.closeId, closeEventId: manifest.closeEventId };
  const sealHash = put('seal', seal);
  const acceptanceDigest = put('acceptance', { domain: 'pos.close.acceptance.v1', scope,
    closeId: manifest.closeId, closeEventId: manifest.closeEventId, manifestHash, sealHash });
  return { vectors, history, manifest, seal, acceptanceDigest, archiveAcceptanceDigest: archiveGraph.acceptanceDigest };
}

export function verifyLineage(bundle) {
  assert.equal(bundle.agreementStatus, 'UNAGREED');
  assert.equal(bundle.exactZEligible, false);
  assert.equal(bundle.closeAuthorization, 'NOT_GRANTED');
  for (const s of bundle.scenarios) {
    const originalArchive = canonical(s.input.archive);
    same(buildContinuation(s.input, s.trustedArchiveDigest), s.expected, s.name);
    assert.equal(canonical(s.input.archive), originalArchive, 'ARCHIVE_MUTATED');
    assert.equal(s.expected.manifest.members.length, 1);
    assert.equal(s.expected.manifest.members[0].kind, 'COLLECTION');
    assert.equal(s.expected.manifest.dependencies[0].revision, '3');
    for (const v of s.expected.vectors) same(vector(v.name, v.input), v, 'BYTES');
  }
  let negatives = 0;
  const fails = (mutate, code) => {
    const s = structuredClone(bundle.scenarios[0]); mutate(s.input);
    assert.throws(() => buildContinuation(s.input, s.trustedArchiveDigest), error => error.message.includes(code)); negatives++;
  };
  fails(i => { i.configuration.calculationInputOrder.transactions = i.configuration.calculationInputOrder.collections; i.configuration.calculationInputOrder.collections = []; }, 'INPUT_KIND');
  fails(i => { i.operations[0].previousContentHash = null; }, 'PREDECESSOR_HASH');
  fails(i => { i.operations[0].revision = '1'; }, 'REVISION');
  fails(i => { i.selection.members.push(i.selection.dependencies[0]); i.selection.dependencies = []; }, 'REOPEN_CLOSED');
  fails(i => { i.configuration.calculationInputOrder.transactions.push(i.selection.dependencies[0]); }, 'INPUT_DEPENDENCY');
  fails(i => { i.selection.dependencies[0].revision = '2'; }, 'SELECTED_REVISION');
  fails(i => { i.archive.operations[0].original.total = 999; }, 'UNTRUSTED_ARCHIVE');
  fails(i => { i.operations[0].sequence = '3'; }, 'SEQUENCE');
  fails(i => { i.storageEpoch = i.archive.storageEpoch; }, 'REUSED_EPOCH');
  fails(i => { i.openSetId = i.archive.openSetId; }, 'REUSED_OPEN_SET');
  fails(i => { i.scope.companyId = 'another-company'; }, 'SCOPE');
  fails(i => { i.selection.dependencies = []; }, 'ALLOCATION_DEPENDENCY');
  fails(i => { i.configuration.resumeAnchor.priorChainHash = '0'.repeat(64); }, 'RESUME_ANCHOR');
  fails(i => { i.selection.members = []; }, 'MEMBER_OMISSION');
  fails(i => { i.selection.dependencies.push(i.selection.dependencies[0]); }, 'DUPLICATE_DEPENDENCY');
  const unknown = structuredClone(bundle.scenarios[0]);
  assert.throws(() => buildContinuation(unknown.input, null), error => error.message.includes('UNTRUSTED_ARCHIVE')); negatives++;
  const suffix = structuredClone(bundle.scenarios[1]);
  suffix.input.operations[0].sequence = '1';
  assert.throws(() => buildContinuation(suffix.input, suffix.trustedArchiveDigest), error => error.message.includes('SEQUENCE')); negatives++;
  const member = { kind: 'TRANSACTION', originalId: 'sale-A', revision: '2' };
  const other = { ...member, originalId: 'sale-B' };
  const manifest = { members: [member, other], dependencies: [{ ...member, originalId: 'closed', role: 'READ_ONLY' }] };
  const order = { transactions: [other, member], cashMovements: [], collections: [] };
  const before = canonical(order);
  validateCalculationInput(order, manifest); assert.equal(canonical(order), before);
  for (const [mutate, code] of [
    [o => { o.transactions[0].revision = '1'; }, 'INPUT_REVISION'],
    [o => { o.transactions.pop(); }, 'INPUT_OMISSION'],
    [o => { o.transactions.push(o.transactions[0]); }, 'INPUT_DUPLICATE'],
    [o => { o.transactions[0].originalId = 'closed'; }, 'INPUT_DEPENDENCY'],
    [o => { o.transactions[0].kind = 'WALLET'; }, 'INPUT_KIND'],
    [o => { o.cashMovements = o.transactions; o.transactions = []; }, 'INPUT_KIND'],
    [o => { o.collections = o.transactions; o.transactions = []; }, 'INPUT_KIND'],
  ]) {
    const mutated = structuredClone(order); mutate(mutated);
    assert.throws(() => validateCalculationInput(mutated, manifest), error => error.message.includes(code)); negatives++;
  }
  console.log(`PASS: ${bundle.scenarios.length} anchored continuation scenarios; reverse calculation order preserved; ${negatives} semantic negatives. No operational recovery certification.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  verifyLineage(JSON.parse(readFileSync(new URL('./lineage-vectors.json', import.meta.url), 'utf8')));
}
