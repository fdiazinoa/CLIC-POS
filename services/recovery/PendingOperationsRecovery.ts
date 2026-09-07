import type {
  DatabaseAdapter,
  DurableDocumentMutation,
} from "../db/DatabaseAdapter";
import {
  decodeBase64,
  decodeOriginal,
  encodeBase64,
  originalDigest,
  ORIGINAL_ENCODING,
} from "./OriginalCodec";
import {
  CAPTURE_COLLECTIONS,
  RECOVERY_OUTBOX,
  RECOVERY_STAGE,
  RECOVERY_STATE,
} from "./OriginalCapture";
export interface OriginalRecord {
  version: 1;
  storageEpoch: string;
  openSetId: string;
  sequence: string;
  kind: string;
  originalId: string;
  revision: string;
  encoding: typeof ORIGINAL_ENCODING;
  bodyBase64: string;
  bodySha256: string;
  byteLength: number;
}
export interface OriginalReceipt {
  receiptId: string;
  recordHash: string;
  receivedAt: string;
  record: OriginalRecord;
}
export interface RecoverySnapshot {
  snapshotId: string;
  totalRecords: number;
  snapshotDigest: string;
  expiresAt: string;
  nextCursor: string | null;
  completeness: string;
  exactZEligible: boolean;
  closeAuthorization: string;
}
export interface RecoveryTransport {
  context(): Promise<{
    key: string;
    terminalIds: string[];
    enabled: boolean;
    commercialBindingVersion?: number;
  }>;
  receive(records: OriginalRecord[]): Promise<{
    receipts: Array<{
      receiptId: string;
      originalId: string;
      revision: string;
      kind: string;
      bodySha256: string;
      receiptStatus: string;
    }>;
  }>;
  commercialStatus?(references: OriginalReference[]): Promise<{
    observedAt: string;
    results: Array<{
      reference: OriginalReference;
      businessState: string;
      reason: string;
      rollbackProven: boolean;
      authoritativeForClose: boolean;
    }>;
  }>;
  snapshot(): Promise<RecoverySnapshot>;
  page(
    id: string,
    cursor: string,
  ): Promise<
    RecoverySnapshot & { records: OriginalReceipt[]; pageStart: number }
  >;
}
export const isRecoveredOperation = (document: any): boolean =>
  Boolean(document?._posRecovery?.snapshotId);
const bytes = (s: string) => new TextEncoder().encode(s);
export const recordBytes = (r: OriginalRecord): Uint8Array =>
  bytes(
    JSON.stringify({
      version: r.version,
      storageEpoch: r.storageEpoch,
      openSetId: r.openSetId,
      sequence: r.sequence,
      kind: r.kind,
      originalId: r.originalId,
      revision: r.revision,
      encoding: r.encoding,
      bodyBase64: r.bodyBase64,
      bodySha256: r.bodySha256,
      byteLength: r.byteLength,
    }),
  );
export interface OriginalReference {
  receiptId: string;
  recordHash: string;
  storageEpoch: string;
  kind: string;
  originalId: string;
  revision: string;
  bodySha256: string;
}
const originalRecord = async (row: any): Promise<OriginalRecord> => {
  const raw = bytes(row.body);
  if (raw.length > 524288) fail("ORIGINAL_TOO_LARGE");
  const record: OriginalRecord = {
    version: 1,
    storageEpoch: row.storageEpoch,
    openSetId: row.openSetId,
    sequence: row.sequence,
    kind: row.kind,
    originalId: row.originalId,
    revision: row.revision,
    encoding: ORIGINAL_ENCODING,
    bodyBase64: encodeBase64(raw),
    bodySha256: await originalDigest(raw),
    byteLength: raw.length,
  };
  return record;
};
const decimal = (s: unknown) =>
  typeof s === "string" && /^(0|[1-9][0-9]*)$/.test(s);
const fail = (code: string): never => {
  throw new Error(code);
};
const validateSnapshot = (snapshot: RecoverySnapshot) => {
  if (
    !snapshot ||
    typeof snapshot.snapshotId !== "string" ||
    !snapshot.snapshotId ||
    !Number.isSafeInteger(snapshot.totalRecords) ||
    snapshot.totalRecords < 0 ||
    !/^[a-f0-9]{64}$/.test(snapshot.snapshotDigest) ||
    !Number.isFinite(Date.parse(snapshot.expiresAt)) ||
    Date.parse(snapshot.expiresAt) <= Date.now() ||
    !(
      snapshot.nextCursor === null ||
      (typeof snapshot.nextCursor === "string" &&
        snapshot.nextCursor.length > 0)
    ) ||
    snapshot.exactZEligible !== false ||
    snapshot.closeAuthorization !== "NOT_GRANTED" ||
    snapshot.completeness !== "RECEIVED_ORIGINALS_ONLY"
  )
    fail("RECOVERY_SNAPSHOT_INVALID");
};
export class PendingOperationsRecovery {
  private running: Promise<unknown> | null = null;
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly transport: RecoveryTransport,
  ) {}
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.running) return Promise.reject(new Error("RECOVERY_BUSY"));
    const run = work();
    this.running = run;
    return run.finally(() => {
      if (this.running === run) this.running = null;
    });
  }
  private commit(documents: DurableDocumentMutation[], requireAbsent = false) {
    if (!this.db.saveDocumentsAtomically)
      return Promise.reject(new Error("RECOVERY_ATOMIC_STORAGE_UNAVAILABLE"));
    return this.db.saveDocumentsAtomically(documents, requireAbsent);
  }
  async sendPending(): Promise<number> {
    if (this.running) return 0;
    return this.exclusive(async () => {
      const ctx = await this.transport.context();
      if (!ctx.enabled) return 0;
      const pending = (await this.db.getCollection<any>(RECOVERY_OUTBOX))
        .filter((x) => x.status === "PENDING")
        .sort((a, b) => (BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1));
      const selected: any[] = [],
        records: OriginalRecord[] = [];
      let size = 4096;
      for (const row of pending) {
        if (
          row.originKey !== ctx.key ||
          !row.localTerminalId ||
          !ctx.terminalIds.includes(row.localTerminalId)
        )
          fail("ORIGINAL_TERMINAL_UNBOUND");
        const record = await originalRecord(row);
        const nextSize = recordBytes(record).length;
        if (records.length === 100 || size + nextSize > 2 * 1024 * 1024) break;
        records.push(record);
        selected.push(row);
        size += nextSize + 1;
      }
      if (!records.length) return 0;
      if ((await this.transport.context()).key !== ctx.key)
        fail("RECOVERY_SCOPE_CHANGED");
      const ack = await this.transport.receive(records);
      const mutations: DurableDocumentMutation[] = [];
      for (let i = 0; i < records.length; i++) {
        const r = records[i],
          matches = ack.receipts?.filter(
            (x) =>
              x.kind === r.kind &&
              x.originalId === r.originalId &&
              x.revision === r.revision &&
              x.bodySha256 === r.bodySha256,
          );
        if (matches?.length !== 1 || matches[0].receiptStatus !== "RECEIVED")
          fail("ORIGINAL_ACK_MISMATCH");
        mutations.push({
          collectionName: RECOVERY_OUTBOX,
          document: { ...selected[i], status: "RECEIVED", receipt: matches[0] },
        });
      }
      // ACK changes only technical receipt state; commercial queue is untouched.
      await this.commit(mutations);
      return records.length;
    });
  }
  async receiveCapturedOriginal(
    captureId: string,
  ): Promise<OriginalReference | null> {
    if (this.running) return null;
    return this.exclusive(async () => {
      const ctx = await this.transport.context();
      if (!ctx.enabled) return null;
      let row = await this.db.getDocument<any>(RECOVERY_OUTBOX, captureId);
      if (
        !row ||
        row.originKey !== ctx.key ||
        !ctx.terminalIds.includes(row.localTerminalId)
      )
        return null;
      const record = await originalRecord(row);
      if (row.status !== "RECEIVED") {
        if ((await this.transport.context()).key !== ctx.key)
          fail("RECOVERY_SCOPE_CHANGED");
        const ack = await this.transport.receive([record]);
        const matches = ack.receipts?.filter(
          (r) =>
            r.kind === record.kind &&
            r.originalId === record.originalId &&
            r.revision === record.revision &&
            r.bodySha256 === record.bodySha256 &&
            r.receiptStatus === "RECEIVED",
        );
        if (matches?.length !== 1 || !matches[0].receiptId)
          fail("ORIGINAL_ACK_MISMATCH");
        row = { ...row, status: "RECEIVED", receipt: matches[0] };
        await this.commit([{ collectionName: RECOVERY_OUTBOX, document: row }]);
      }
      if ((await this.transport.context()).key !== ctx.key)
        fail("RECOVERY_SCOPE_CHANGED");
      if (
        !row.receipt?.receiptId ||
        row.receipt.bodySha256 !== record.bodySha256
      )
        fail("ORIGINAL_ACK_MISMATCH");
      return {
        receiptId: row.receipt.receiptId,
        recordHash: await originalDigest(recordBytes(record)),
        storageEpoch: record.storageEpoch,
        kind: record.kind,
        originalId: record.originalId,
        revision: record.revision,
        bodySha256: record.bodySha256,
      };
    });
  }
  async download(restart = false): Promise<RecoverySnapshot> {
    return this.exclusive(async () => {
      const ctx = await this.transport.context();
      if (!ctx.enabled) fail("RECOVERY_NOT_AVAILABLE");
      let state = await this.db.getDocument<any>(RECOVERY_STATE, "download");
      if (
        restart ||
        !state ||
        state.context !== ctx.key ||
        Date.parse(state.snapshot.expiresAt) <= Date.now()
      ) {
        const snapshot = await this.transport.snapshot();
        validateSnapshot(snapshot);
        if ((await this.transport.context()).key !== ctx.key)
          fail("RECOVERY_SCOPE_CHANGED");
        state = {
          id: "download",
          context: ctx.key,
          snapshot,
          loaded: 0,
          status: "DOWNLOADING",
          receipts: [],
        };
        await this.commit([
          { collectionName: RECOVERY_STATE, document: state },
        ]);
      }
      while (state.snapshot.nextCursor !== null) {
        const current = await this.transport.context();
        if (!current.enabled || current.key !== state.context)
          fail("RECOVERY_SCOPE_CHANGED");
        const page = await this.transport.page(
          state.snapshot.snapshotId,
          state.snapshot.nextCursor,
        );
        validateSnapshot(page);
        if ((await this.transport.context()).key !== ctx.key)
          fail("RECOVERY_SCOPE_CHANGED");
        if (
          page.snapshotId !== state.snapshot.snapshotId ||
          page.snapshotDigest !== state.snapshot.snapshotDigest ||
          page.totalRecords !== state.snapshot.totalRecords ||
          page.pageStart !== state.loaded ||
          !Array.isArray(page.records) ||
          page.records.length === 0
        )
          fail("RECOVERY_PAGE_MISMATCH");
        const mutations: DurableDocumentMutation[] = [];
        for (const item of page.records) {
          const r = item.record;
          if (
            r.version !== 1 ||
            r.encoding !== ORIGINAL_ENCODING ||
            !decimal(r.sequence) ||
            !decimal(r.revision) ||
            r.revision === "0"
          )
            fail("RECOVERY_RECORD_INVALID");
          const data = decodeBase64(r.bodyBase64);
          if (
            data.length !== r.byteLength ||
            data.length > 524288 ||
            (await originalDigest(data)) !== r.bodySha256 ||
            (await originalDigest(recordBytes(r))) !== item.recordHash
          )
            fail("RECOVERY_INTEGRITY_FAILED");
          if (state.receipts.some((p: any) => p.receiptId === item.receiptId))
            fail("RECOVERY_DUPLICATE_RECEIPT");
          mutations.push({
            collectionName: RECOVERY_STAGE,
            document: {
              id: state.snapshot.snapshotId + ":" + item.receiptId,
              ...item,
              snapshotId: state.snapshot.snapshotId,
            },
          });
          state.receipts.push({
            receiptId: item.receiptId,
            recordHash: item.recordHash,
          });
        }
        state.loaded += page.records.length;
        if (
          state.loaded > state.snapshot.totalRecords ||
          page.nextCursor === state.snapshot.nextCursor
        )
          fail("RECOVERY_PAGE_MISMATCH");
        state.snapshot.nextCursor = page.nextCursor;
        mutations.push({ collectionName: RECOVERY_STATE, document: state });
        await this.commit(mutations);
      }
      const digest = await originalDigest(
        bytes(
          state.receipts
            .map((r: any) => `${r.receiptId}:${r.recordHash}\n`)
            .join(""),
        ),
      );
      if (
        state.loaded !== state.snapshot.totalRecords ||
        digest !== state.snapshot.snapshotDigest
      )
        fail("RECOVERY_INCOMPLETE_SNAPSHOT");
      state.status = "VERIFIED";
      await this.commit([{ collectionName: RECOVERY_STATE, document: state }]);
      return state.snapshot;
    });
  }
  private async selectedOriginals(state: any): Promise<any[]> {
    const all = (await this.db.getCollection<any>(RECOVERY_STAGE)).filter(
      (x) => x.snapshotId === state.snapshot.snapshotId,
    );
    if (all.length !== state.loaded) fail("RECOVERY_STAGE_CHANGED");
    const expected = new Map(
      state.receipts.map((x: any) => [x.receiptId, x.recordHash]),
    );
    if (expected.size !== all.length) fail("RECOVERY_STAGE_CHANGED");
    for (const row of all) {
      if (
        expected.get(row.receiptId) !== row.recordHash ||
        (await originalDigest(recordBytes(row.record))) !== row.recordHash
      )
        fail("RECOVERY_STAGE_CHANGED");
      expected.delete(row.receiptId);
    }
    if (expected.size) fail("RECOVERY_STAGE_CHANGED");
    const heads = new Map<string, any>();
    for (const row of all) {
      const r = row.record,
        key = JSON.stringify([r.kind, r.originalId]),
        prior = heads.get(key);
      if (prior && prior.record.storageEpoch !== r.storageEpoch)
        fail("RECOVERY_EPOCH_AUTHORITY_REQUIRED");
      if (!prior || BigInt(r.revision) > BigInt(prior.record.revision))
        heads.set(key, row);
    }
    return [...heads.values()];
  }
  async checkCommercialStates(): Promise<{
    observedAt: string;
    counts: Record<string, number>;
  }> {
    return this.exclusive(async () => {
      const ctx = await this.transport.context();
      const state = await this.db.getDocument<any>(RECOVERY_STATE, "download");
      if (
        !ctx.enabled ||
        ctx.commercialBindingVersion !== 1 ||
        !this.transport.commercialStatus
      )
        fail("COMMERCIAL_STATUS_NOT_AVAILABLE");
      if (!state || state.context !== ctx.key || state.status !== "VERIFIED")
        fail("RECOVERY_NOT_VERIFIED");
      const rows = await this.selectedOriginals(state);
      const references: OriginalReference[] = rows.map((row) => ({
        receiptId: row.receiptId,
        recordHash: row.recordHash,
        storageEpoch: row.record.storageEpoch,
        kind: row.record.kind,
        originalId: row.record.originalId,
        revision: row.record.revision,
        bodySha256: row.record.bodySha256,
      }));
      const counts: Record<string, number> = {
        APPLIED: 0,
        PENDING: 0,
        PROCESSING: 0,
        FAILED: 0,
        UNKNOWN: 0,
      };
      const mutations: DurableDocumentMutation[] = [];
      let observedAt = "";
      for (let offset = 0; offset < references.length; offset += 100) {
        const batch = references.slice(offset, offset + 100);
        if ((await this.transport.context()).key !== ctx.key)
          fail("RECOVERY_SCOPE_CHANGED");
        const response = await this.transport.commercialStatus!(batch);
        if (
          !Number.isFinite(Date.parse(response.observedAt)) ||
          !Array.isArray(response.results) ||
          response.results.length !== batch.length
        )
          fail("COMMERCIAL_STATUS_MISMATCH");
        for (const reference of batch) {
          const matches = response.results.filter((row) =>
            Object.keys(reference).every(
              (k) => (row.reference as any)?.[k] === (reference as any)[k],
            ),
          );
          if (
            matches.length !== 1 ||
            !Object.hasOwn(counts, matches[0].businessState) ||
            matches[0].rollbackProven !== false ||
            matches[0].authoritativeForClose !== false
          )
            fail("COMMERCIAL_STATUS_MISMATCH");
          const result = matches[0];
          counts[result.businessState]++;
          mutations.push({
            collectionName: RECOVERY_STATE,
            document: {
              id: "commercial:" + reference.receiptId,
              context: ctx.key,
              reference,
              businessState: result.businessState,
              reason: result.reason,
              observedAt: response.observedAt,
              authoritativeForClose: false,
            },
          });
        }
        observedAt = response.observedAt;
      }
      if ((await this.transport.context()).key !== ctx.key)
        fail("RECOVERY_SCOPE_CHANGED");
      // Separate observations: never overwrite runtime documents, sync status or close grants.
      await this.commit(mutations);
      return { observedAt, counts };
    });
  }
  async restore(): Promise<number> {
    return this.exclusive(async () => {
      const ctx = await this.transport.context(),
        state = await this.db.getDocument<any>(RECOVERY_STATE, "download");
      if (
        !ctx.enabled ||
        !state ||
        state.context !== ctx.key ||
        state.status !== "VERIFIED" ||
        Date.parse(state.snapshot.expiresAt) <= Date.now()
      )
        fail("RECOVERY_NOT_VERIFIED");
      validateSnapshot(state.snapshot);
      const markerId = "import:" + state.snapshot.snapshotId;
      const imported = await this.db.getDocument<any>(RECOVERY_STATE, markerId);
      if (imported) return imported.count;
      const heads = await this.selectedOriginals(state);
      const decoded: Array<{ row: any; collection: string; document: any }> =
        [];
      for (const row of heads) {
        const raw = decodeBase64(row.record.bodyBase64);
        if ((await originalDigest(raw)) !== row.record.bodySha256)
          fail("RECOVERY_STAGE_CHANGED");
        const envelope = decodeOriginal(
          new TextDecoder("utf-8", { fatal: true }).decode(raw),
        ) as any;
        if (
          envelope?.version !== 1 ||
          typeof envelope.document !== "string" ||
          typeof envelope.original !== "string"
        )
          fail("RECOVERY_PROFILE_UNSUPPORTED");
        const document = decodeOriginal(envelope.document) as any;
        decodeOriginal(envelope.original); // validates original without replacing runtime aliases
        if (
          !document ||
          document.id !== row.record.originalId ||
          CAPTURE_COLLECTIONS[envelope.collection] !== row.record.kind
        )
          fail("RECOVERY_IDENTITY_MISMATCH");
        decoded.push({ row, collection: envelope.collection, document });
      }
      const closed = new Map<string, string>();
      for (const x of decoded.filter((x) => x.collection === "zReports")) {
        const members = x.document.recoveryMemberIds;
        if (!members) fail("RECOVERY_CLOSE_MEMBERSHIP_UNKNOWN");
        for (const collection of [
          "transactions",
          "cashMovements",
          "collections",
        ]) {
          if (!Array.isArray(members[collection]))
            fail("RECOVERY_CLOSE_MEMBERSHIP_UNKNOWN");
          for (const id of members[collection]) {
            const key = JSON.stringify([collection, id]);
            if (closed.has(key) && closed.get(key) !== x.document.id)
              fail("RECOVERY_MULTIPLE_CLOSES");
            closed.set(key, x.document.id);
          }
        }
      }
      const mutations: DurableDocumentMutation[] = [];
      for (const { row, collection, document } of decoded) {
        const closeId =
          closed.get(JSON.stringify([collection, document.id])) ||
          document.zReportId;
        const destination =
          collection === "transactions" && closeId
            ? "transactionHistory"
            : collection;
        const restored = {
          ...document,
          ...(closeId ? { zReportId: closeId } : {}),
          _posRecovery: {
            snapshotId: state.snapshot.snapshotId,
            receiptId: row.receiptId,
            bodySha256: row.record.bodySha256,
            businessApplication: "UNKNOWN",
            exactZEligible: false,
            closeAuthorization: "NOT_GRANTED",
          },
        };
        if (collection === "transactions") {
          const other =
            destination === "transactions"
              ? "transactionHistory"
              : "transactions";
          if (await this.db.getDocument(other, document.id))
            fail("RECOVERY_LOCAL_CONFLICT:" + other + ":" + document.id);
        }
        const current = await this.db.getDocument<any>(
          destination,
          document.id,
        );
        if (current?._posRecovery?.bodySha256 === row.record.bodySha256)
          continue;
        if (current)
          fail("RECOVERY_LOCAL_CONFLICT:" + destination + ":" + document.id);
        mutations.push({ collectionName: destination, document: restored });
      }
      // Preserve original staging and pending local work; no inventory/customer/series writes.
      mutations.push({
        collectionName: RECOVERY_STATE,
        document: {
          id: markerId,
          count: mutations.length,
          snapshotId: state.snapshot.snapshotId,
          exactZEligible: false,
          closeAuthorization: "NOT_GRANTED",
        },
      });
      if ((await this.transport.context()).key !== ctx.key)
        fail("RECOVERY_SCOPE_CHANGED");
      await this.commit(mutations, true);
      return mutations.length - 1;
    });
  }
}
