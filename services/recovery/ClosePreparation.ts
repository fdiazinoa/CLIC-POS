import type { DatabaseAdapter } from "../db/DatabaseAdapter";
import {
  encodeOriginal,
  decodeOriginal,
  decodeBase64,
  originalDigest,
} from "./OriginalCodec";
import { recordBytes } from "./PendingOperationsRecovery";
import {
  CAPTURE_COLLECTIONS,
  RECOVERY_OUTBOX,
  RECOVERY_STAGE,
  RECOVERY_STATE,
} from "./OriginalCapture";
import { withRecoveryPreparation } from "./RecoveryDatabase";

const MEMBER_COLLECTIONS = [
  "transactions",
  "cashMovements",
  "collections",
] as const;
type MemberCollection = (typeof MEMBER_COLLECTIONS)[number];
// Conservative read guard, not a claim that every native resolver is covered.
const WATCHED = [
  ...MEMBER_COLLECTIONS,
  "transactionHistory",
  "wallet_transactions",
  "zReports",
  "internalSequences",
  "config",
];
const digest = (s: string) => originalDigest(new TextEncoder().encode(s));
const fail = (reason: string): never => {
  throw new Error("CLOSE_PREPARATION_" + reason);
};
const nonempty = (s: unknown): s is string =>
  typeof s === "string" && !!s.trim();
export interface ClosePreparationInput {
  /** Caller persists/reuses this key; changing a request under the same key conflicts. */
  preparationId: string;
  scopeKey: string;
  terminalId: string;
  members: Array<{
    collection: MemberCollection;
    id: string;
    expectedDocument: string;
  }>;
  /** Native confirmed input, preserved as given, without inventing defaults. */
  declaration: unknown;
}
export interface PreparedClose {
  id: string;
  scopeKey: string;
  requestBody: string;
  body: string;
  bodySha256: string;
  status: "PREPARED_LOCAL";
}
const key = (scope: string, id: string) =>
  JSON.stringify(["closePreparation", scope, id]);

/** Local preparation only. Its digest is NOT an ERP intentHash or an authentic seal. */
export class ClosePreparation {
  constructor(private readonly db: DatabaseAdapter) {}

  private async observe(base: DatabaseAdapter) {
    const collections: Record<string, string> = {};
    for (const name of WATCHED)
      collections[name] = await digest(
        encodeOriginal(await base.getCollection(name)),
      );
    return {
      collections,
      capture: encodeOriginal(
        await base.getDocument(RECOVERY_STATE, "capture"),
      ),
    };
  }

  private async source(
    base: DatabaseAdapter,
    collection: MemberCollection,
    document: any,
  ) {
    const kind = CAPTURE_COLLECTIONS[collection];
    if (document._posRecovery?.snapshotId) {
      const marker = document._posRecovery;
      const rows = (await base.getCollection<any>(RECOVERY_STAGE)).filter(
        (row) =>
          row.snapshotId === marker.snapshotId &&
          row.receiptId === marker.receiptId,
      );
      if (rows.length !== 1) fail("MISSING_ORIGINAL");
      const row = rows[0];
      if (
        row.record?.kind !== kind ||
        row.record?.originalId !== document.id ||
        row.record?.bodySha256 !== marker.bodySha256
      )
        fail("ORIGINAL_MISMATCH");
      const bytes = decodeBase64(row.record.bodyBase64);
      if (
        bytes.length !== row.record.byteLength ||
        (await originalDigest(bytes)) !== row.record.bodySha256 ||
        (await originalDigest(recordBytes(row.record))) !== row.recordHash
      )
        fail("ORIGINAL_MISMATCH");
      const envelope = decodeOriginal(new TextDecoder().decode(bytes)) as any;
      const { _posRecovery, ...runtime } = document;
      if (
        JSON.stringify(decodeOriginal(envelope.document)) !==
        JSON.stringify(runtime)
      )
        fail("ORIGINAL_MISMATCH");
      return { stage: "RECOVERED", receipt: row };
    }
    const head = await base.getDocument<any>(
      RECOVERY_STATE,
      JSON.stringify([kind, document.id]),
    );
    const original = head?.captureId
      ? await base.getDocument<any>(RECOVERY_OUTBOX, head.captureId)
      : null;
    if (
      !original ||
      original.kind !== kind ||
      original.originalId !== document.id ||
      original.body !== head.body
    )
      fail("MISSING_ORIGINAL");
    const envelope = decodeOriginal(original.body) as any;
    if (
      JSON.stringify(decodeOriginal(envelope.document)) !==
      JSON.stringify(document)
    )
      fail("ORIGINAL_MISMATCH");
    // Technical receipt/status changes do not change the frozen native revision.
    return {
      stage: "LOCAL",
      originKey: original.originKey,
      captureId: original.id,
      storageEpoch: original.storageEpoch,
      openSetId: original.openSetId,
      sequence: original.sequence,
      revision: original.revision,
      kind,
      originalId: original.originalId,
      body: original.body,
    };
  }

  async prepare(input: ClosePreparationInput): Promise<PreparedClose> {
    // Freeze synchronously, before waiting behind another write; caller mutations cannot race it.
    const requestBody = encodeOriginal(input);
    const request = decodeOriginal(requestBody) as ClosePreparationInput;
    if (
      !nonempty(request.preparationId) ||
      !nonempty(request.scopeKey) ||
      !nonempty(request.terminalId) ||
      !Array.isArray(request.members) ||
      !request.members.length
    )
      fail("INVALID_REQUEST");
    const seen = new Set<string>();
    for (const member of request.members) {
      if (
        !MEMBER_COLLECTIONS.includes(member.collection) ||
        !nonempty(member.id) ||
        !nonempty(member.expectedDocument)
      )
        fail("INVALID_MEMBER");
      const identity = JSON.stringify([member.collection, member.id]);
      if (seen.has(identity)) fail("DUPLICATE_MEMBER");
      seen.add(identity);
    }
    return withRecoveryPreparation(this.db, request.scopeKey, async (base) => {
      const id = key(request.scopeKey, request.preparationId);
      const existing = await base.getDocument<PreparedClose>(
        RECOVERY_STATE,
        id,
      );
      if (existing) {
        await this.verify(existing, request.scopeKey, id);
        if (existing.requestBody !== requestBody) fail("REQUEST_CONFLICT");
        await this.checkCurrent(base, existing);
        return existing;
      }
      const members = [];
      for (const member of request.members) {
        const document = await base.getDocument<any>(
          member.collection,
          member.id,
        );
        if (!document || encodeOriginal(document) !== member.expectedDocument)
          fail("STALE_SELECTION");
        if (document.terminalId !== request.terminalId)
          fail("TERMINAL_MISMATCH");
        if (document.zReportId) fail("ALREADY_CLOSED");
        const source = await this.source(base, member.collection, document);
        if (source.stage === "LOCAL" && source.originKey !== request.scopeKey)
          fail("ORIGINAL_SCOPE");
        members.push({ ...member, source });
      }
      const observation = await this.observe(base);
      const body = encodeOriginal({
        domain: "pos.close.preparation.local.v1",
        version: 1,
        requestBody,
        commandId: crypto.randomUUID(),
        closeControl: {
          closeId: crypto.randomUUID(),
          closeEventId: crypto.randomUUID(),
          nextOpenSetId: crypto.randomUUID(),
        },
        preparedAt: new Date().toISOString(),
        members,
        observation,
        coverage: "UNKNOWN",
        configurationCoverage: "INCOMPLETE",
        seal: null,
        exactZEligible: false,
        closeAuthorization: "NOT_GRANTED",
      });
      const prepared: PreparedClose = {
        id,
        scopeKey: request.scopeKey,
        requestBody,
        body,
        bodySha256: await digest(body),
        status: "PREPARED_LOCAL",
      };
      if (!base.saveDocumentsAtomically) fail("ATOMIC_STORAGE_UNAVAILABLE");
      await base.saveDocumentsAtomically!(
        [{ collectionName: RECOVERY_STATE, document: prepared }],
        true,
      );
      return prepared;
    });
  }

  private async verify(prepared: PreparedClose, scope: string, id: string) {
    if (
      prepared.id !== id ||
      prepared.scopeKey !== scope ||
      prepared.status !== "PREPARED_LOCAL" ||
      (await digest(prepared.body)) !== prepared.bodySha256
    )
      fail("CORRUPT");
    const body = decodeOriginal(prepared.body) as any;
    if (
      body?.domain !== "pos.close.preparation.local.v1" ||
      body.version !== 1 ||
      body.requestBody !== prepared.requestBody ||
      body.exactZEligible !== false ||
      body.closeAuthorization !== "NOT_GRANTED" ||
      body.seal !== null
    )
      fail("CORRUPT");
  }

  private async checkCurrent(base: DatabaseAdapter, prepared: PreparedClose) {
    const body = decodeOriginal(prepared.body) as any;
    if (
      encodeOriginal(await this.observe(base)) !==
      encodeOriginal(body.observation)
    )
      fail("STALE");
    for (const member of body.members) {
      const document = await base.getDocument<any>(
        member.collection,
        member.id,
      );
      if (
        !document ||
        encodeOriginal(document) !== member.expectedDocument ||
        encodeOriginal(await this.source(base, member.collection, document)) !==
          encodeOriginal(member.source)
      )
        fail("STALE");
    }
  }

  /** Reopen after restart. A stale draft is preserved for inspection but never silently refreshed. */
  async listPreparedIds(scopeKey: string): Promise<string[]> {
    return withRecoveryPreparation(this.db, scopeKey, async (base) => {
      const ids: string[] = [];
      for (const row of await base.getCollection<any>(RECOVERY_STATE)) {
        if (row.status !== "PREPARED_LOCAL" || row.scopeKey !== scopeKey)
          continue;
        const request = decodeOriginal(
          row.requestBody,
        ) as ClosePreparationInput;
        if (request.scopeKey !== scopeKey || !nonempty(request.preparationId))
          fail("CORRUPT");
        await this.verify(row, scopeKey, key(scopeKey, request.preparationId));
        ids.push(request.preparationId);
      }
      // Discovery does not establish freshness; callers must resume the chosen preparation.
      return ids;
    });
  }

  async resume(
    scopeKey: string,
    preparationId: string,
  ): Promise<PreparedClose> {
    return withRecoveryPreparation(this.db, scopeKey, async (base) => {
      const id = key(scopeKey, preparationId);
      const prepared = await base.getDocument<PreparedClose>(
        RECOVERY_STATE,
        id,
      );
      if (!prepared) fail("NOT_FOUND");
      await this.verify(prepared!, scopeKey, id);
      await this.checkCurrent(base, prepared!);
      return prepared!;
    });
  }
}
