import { recoveryUuid } from "./RecoveryUuid";
import { recoveryCanonicalJson } from "./RecoveryJson";
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
import { buildNativeZReportContent } from "./NativeZReport";
import { projectNativeZConfiguration } from "./NativeZConfiguration";

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
  dependencies?: Array<{
    collection: "transactionHistory" | "wallet_transactions";
    id: string;
    expectedDocument: string;
  }>;
  /** Native confirmed input, preserved as given, without inventing defaults. */
  declaration: unknown;
  retainedSet?: {
    manifestReference: any;
    descriptorHash: string;
    configurationBasis: "CURRENT_AT_PREPARATION";
  };
  /** Optional native producer; declaration is the existing reportData input. */
  nativeZ?: {
    configurationSha256: string;
    timeZone?: string;
    user?: { id: string; name: string };
    notes: string;
  };
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
    collection: MemberCollection | "transactionHistory" | "wallet_transactions",
    document: any,
  ) {
    const kind = CAPTURE_COLLECTIONS[collection];
    if (
      document._posRecovery?.snapshotId &&
      !document._posRecovery.closedImage
    ) {
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
      const originalRuntime = decodeOriginal(envelope.document) as any;
      if (marker.provenCloseId) {
        const saved = await base.getDocument<any>(
          RECOVERY_STATE,
          "pendingSelection:" + marker.snapshotId,
        );
        const selection = saved?.body;
        if (!selection) fail("CLOSE_EVIDENCE_MISSING");
        const { selectionHash, ...descriptor } = selection;
        if (
          (await digest(recoveryCanonicalJson(descriptor))) !== selectionHash ||
          !selection.closed?.some(
            (c: any) =>
              c.reference.receiptId === row.receiptId &&
              c.reference.recordHash === row.recordHash &&
              c.closeId === marker.provenCloseId,
          ) ||
          runtime.zReportId !== marker.provenCloseId
        )
          fail("CLOSE_EVIDENCE_MISMATCH");
        if (!Object.prototype.hasOwnProperty.call(originalRuntime, "zReportId"))
          delete runtime.zReportId;
      }

      if (JSON.stringify(originalRuntime) !== JSON.stringify(runtime))
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
    const { _posRecovery, ...unmarked } = document;
    if (
      _posRecovery?.closedImage &&
      envelope.closeCommitId !== _posRecovery.commitId
    )
      fail("CLOSE_EVIDENCE_MISMATCH");
    if (
      JSON.stringify(decodeOriginal(envelope.document)) !==
      JSON.stringify(_posRecovery?.closedImage ? unmarked : document)
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
    if (
      request.dependencies !== undefined &&
      !Array.isArray(request.dependencies)
    )
      fail("INVALID_DEPENDENCY");
    for (const d of request.dependencies || []) {
      if (
        !["transactionHistory", "wallet_transactions"].includes(d.collection) ||
        !nonempty(d.id) ||
        !nonempty(d.expectedDocument)
      )
        fail("INVALID_DEPENDENCY");
      const identity = JSON.stringify([
        d.collection === "transactionHistory" ? "transactions" : d.collection,
        d.id,
      ]);
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
      const dependencies = [];
      for (const dependency of request.dependencies || []) {
        const document = await base.getDocument<any>(
          dependency.collection,
          dependency.id,
        );
        if (
          !document ||
          encodeOriginal(document) !== dependency.expectedDocument
        )
          fail("STALE_DEPENDENCY");
        if (
          dependency.collection === "transactionHistory" &&
          !document.zReportId
        )
          fail("DEPENDENCY_NOT_CLOSED");
        const source = await this.source(base, dependency.collection, document);
        if (source.stage === "LOCAL" && source.originKey !== request.scopeKey)
          fail("ORIGINAL_SCOPE");
        dependencies.push({ ...dependency, source });
      }
      const currentCapture = await base.getDocument<any>(
        RECOVERY_STATE,
        "capture",
      );
      const commandCapture = currentCapture || {
        id: "capture",
        storageEpoch: recoveryUuid(),
        openSetId: recoveryUuid(),
        sequence: "0",
      };
      const receivedContext = {
        version: request.retainedSet ? 2 : 1,
        storageEpoch: commandCapture.storageEpoch,
        openSetId: commandCapture.openSetId,
        coverage: "RECEIVED_ONLY",
        ...(request.retainedSet ? { retainedSet: request.retainedSet } : {}),
      };
      const observation = await this.observe(base);
      if (!currentCapture) observation.capture = encodeOriginal(commandCapture);
      const closeControl = {
        closeId: recoveryUuid(),
        closeEventId: recoveryUuid(),
        nextOpenSetId: recoveryUuid(),
      };
      const preparedAt = new Date().toISOString();
      let nativeReport;
      let nativeConfiguration;
      if (request.nativeZ) {
        const config = await base.getDocument<any>("config", "current");
        if (
          !config ||
          (await digest(encodeOriginal(config))) !==
            request.nativeZ.configurationSha256
        )
          fail("CONFIGURATION_CHANGED");
        const terminals = (config.terminals || []).filter(
          (t: any) => t.id === request.terminalId,
        );
        if (
          terminals.length !== 1 ||
          typeof request.nativeZ.notes !== "string" ||
          !request.declaration ||
          typeof request.declaration !== "object" ||
          Array.isArray(request.declaration)
        )
          fail("NATIVE_INPUT_INVALID");
        const documents = (collection: string): any[] =>
          members
            .filter((m) => m.collection === collection)
            .map((m) => decodeOriginal(m.expectedDocument));
        const nativeInput = {
          terminalTransactions: documents("transactions"),
          terminalCashMovements: documents("cashMovements"),
          terminalCollections: documents("collections"),
          config,
          terminalId: request.terminalId,
          currentTerminal: terminals[0],
          currentUser: request.nativeZ.user,
          notes: request.nativeZ.notes,
          reportData: request.declaration,
          fallbackOpenedAt: preparedAt,
        };
        const content = buildNativeZReportContent(nativeInput);
        const projected = projectNativeZConfiguration(config);
        const projectedTerminal = projected.terminals?.find(
          (t) => t.id === request.terminalId,
        );
        const reproduced = buildNativeZReportContent({
          ...nativeInput,
          config: projected,
          currentTerminal: projectedTerminal,
        });
        if (encodeOriginal(content) !== encodeOriginal(reproduced))
          fail("CONFIGURATION_INCOMPLETE");
        const configurationBody = encodeOriginal(projected);
        nativeConfiguration = {
          version: 1,
          profile: "pos.native-z.configuration.v1",
          body: configurationBody,
          bodySha256: await digest(configurationBody),
          sourceConfigurationSha256: request.nativeZ.configurationSha256,
        };
        nativeReport = {
          ...content,
          id: closeControl.closeId,
          closedAt: preparedAt,
          recoveryMemberIds: {
            transactions: documents("transactions").map((d) => d.id),
            cashMovements: documents("cashMovements").map((d) => d.id),
            collections: documents("collections").map((d) => d.id),
          },
        };
      }
      const body = encodeOriginal({
        domain: "pos.close.preparation.local.v1",
        version: 1,
        requestBody,
        commandId: recoveryUuid(),
        closeControl,
        preparedAt,
        ...(nativeReport ? { nativeReport, nativeConfiguration } : {}),
        receivedContext,
        members,
        ...(dependencies.length ? { dependencies } : {}),
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
        [
          ...(currentCapture
            ? []
            : [{ collectionName: RECOVERY_STATE, document: commandCapture }]),
          { collectionName: RECOVERY_STATE, document: prepared },
        ],
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
    for (const member of [...body.members, ...(body.dependencies || [])]) {
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
    return this.withCurrent(
      scopeKey,
      preparationId,
      async (_base, prepared) => prepared,
    );
  }

  /** Local-only integration boundary; use base inside work, never the queued proxy/network. */
  async withCurrent<T>(
    scopeKey: string,
    preparationId: string,
    work: (base: DatabaseAdapter, prepared: PreparedClose) => Promise<T>,
  ): Promise<T> {
    return withRecoveryPreparation(this.db, scopeKey, async (base) => {
      const id = key(scopeKey, preparationId);
      const prepared = await base.getDocument<PreparedClose>(
        RECOVERY_STATE,
        id,
      );
      if (!prepared) fail("NOT_FOUND");
      await this.verify(prepared!, scopeKey, id);
      await this.checkCurrent(base, prepared!);
      return work(base, prepared!);
    });
  }
}
