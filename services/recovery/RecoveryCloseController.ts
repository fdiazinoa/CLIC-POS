import { recoveryUuid } from "./RecoveryUuid";
import type { DatabaseAdapter } from "../db/DatabaseAdapter";
import { ClosePreparation } from "./ClosePreparation";
import { ReceivedCloseFlow } from "./ReceivedCloseFlow";
import {
  decodeOriginal,
  encodeOriginal,
  originalDigest,
  decodeBase64,
} from "./OriginalCodec";
import { withRecoveryPreparation } from "./RecoveryDatabase";
import { resolveDocumentAssignmentId } from "../../utils/documentSeriesIdentity";
export interface RecoveryCloseInput {
  terminalId: string;
  user: { id: string; name: string };
  notes: string;
  declaration: any;
}
const hash = (body: string) => originalDigest(new TextEncoder().encode(body));
const fail = (code: string): never => {
  throw Error("RECOVERY_CLOSE_" + code);
};
/** Coordinates UI with persisted preparation. No business appliers or optimistic close. */
export class RecoveryCloseController {
  private prepare: ClosePreparation;
  private running = false;
  constructor(
    private db: DatabaseAdapter,
    private flow: ReceivedCloseFlow,
    private provenance: () => { key: string; terminalIds: string[] },
    private refreshSnapshot?: () => Promise<any>,
  ) {
    this.prepare = new ClosePreparation(db);
  }
  async availability() {
    await this.flow.availability(this.provenance().key);
  }
  async list() {
    const scopeKey = this.provenance().key;
    const rows = (await this.db.getCollection<any>("recoveryState")).filter(
      (r) => r.uiRecoveryClose === 1 && r.scopeKey === scopeKey,
    );
    return Promise.all(
      rows.map(async (row) => {
        if ((await hash(row.body)) !== row.bodySha256) fail("CORRUPT");
        const job = decodeOriginal(row.body) as any;
        if (
          job.scopeKey !== scopeKey ||
          row.id !==
            JSON.stringify(["recoveryCloseUI", scopeKey, job.preparationId])
        )
          fail("CORRUPT");
        return {
          ...job,
          ...(await this.flow.progress(scopeKey, job.preparationId)),
        };
      }),
    );
  }
  async review(input: RecoveryCloseInput) {
    if (this.running) fail("BUSY");
    this.running = true;
    const value = decodeOriginal(encodeOriginal(input)) as RecoveryCloseInput;
    try {
      await this.availability();
      if ((await this.list()).some((j) => !j.published))
        fail("RESUME_REQUIRED");
      const provenance = this.provenance(),
        scopeKey = provenance.key;
      if (!provenance.terminalIds.includes(value.terminalId)) fail("TERMINAL");
      const retainedDescriptor = this.refreshSnapshot
        ? await this.refreshSnapshot()
        : undefined;
      if (this.provenance().key !== scopeKey) fail("SCOPE_CHANGED");
      const snapshot = await this.db.getDocument<any>(
        "recoveryState",
        "download",
      );
      if (snapshot?.context !== scopeKey || snapshot.status !== "VERIFIED")
        fail("DOWNLOAD_REQUIRED");
      const config = await this.db.getDocument<any>("config", "current");
      const terminal = config?.terminals?.find(
        (t: any) => t.id === value.terminalId,
      );
      if (!terminal) fail("TERMINAL");
      const series = await this.db.getCollection<any>("internalSequences");
      const seriesId = resolveDocumentAssignmentId(
        "Z_REPORT",
        series,
        terminal.config?.documentAssignments?.Z_REPORT,
      );
      if (!seriesId) fail("SERIES_REQUIRED");
      const belongs = (d: any) =>
        provenance.terminalIds.includes(d.terminalId) || !d.terminalId;
      const selected = {
        transactions: (await this.db.getCollection<any>("transactions")).filter(
          (d) => belongs(d) && !d.zReportId,
        ),
        cashMovements: (
          await this.db.getCollection<any>("cashMovements")
        ).filter((d) => belongs(d) && !d.zReportId),
        collections: (await this.db.getCollection<any>("collections")).filter(
          (d) => belongs(d) && !d.zReportId,
        ),
      };
      const all = Object.values(selected).flat();
      if (!all.length || all.some((d) => d.terminalId !== value.terminalId))
        fail("LOCAL_OR_MIXED_OPERATIONS");
      // Keep full active selection. A modal subset cannot remove operations from this close.
      for (const [name, ids] of [
        ["transactionIds", selected.transactions.map((d) => d.id)],
        ["cashMovementIds", selected.cashMovements.map((d) => d.id)],
        ["collectionIds", selected.collections.map((d) => d.id)],
      ] as const) {
        const selected = value.declaration?.[name];
        if (
          selected !== undefined &&
          (!Array.isArray(selected) ||
            new Set(selected).size !== selected.length ||
            selected.length !== ids.length ||
            ids.some((id) => !selected.includes(id)))
        )
          fail("SELECTION_CHANGED");
      }
      const dependencies: Array<{
        collection: "transactionHistory" | "wallet_transactions";
        id: string;
        expectedDocument: string;
      }> = [];
      const needed = new Set<string>();
      for (const t of selected.transactions)
        for (const id of [t.originalTransactionId, t.original_transaction_id])
          if (id) needed.add(id);
      for (const c of selected.collections)
        for (const a of c.allocations || [])
          if (a.transactionId) needed.add(a.transactionId);
      for (const id of needed) {
        if (selected.transactions.some((t) => t.id === id)) continue;
        const doc = await this.db.getDocument<any>("transactionHistory", id);
        if (!doc?.zReportId) fail("DEPENDENCY_REQUIRED");
        dependencies.push({
          collection: "transactionHistory",
          id,
          expectedDocument: encodeOriginal(doc),
        });
      }
      for (const w of await this.db.getCollection<any>("wallet_transactions")) {
        if (!belongs(w) || w.zReportId) continue;

        dependencies.push({
          collection: "wallet_transactions",
          id: w.id,
          expectedDocument: encodeOriginal(w),
        });
      }
      const preparationId = recoveryUuid();
      const prepared = await this.prepare.prepare({
        preparationId,
        scopeKey,
        terminalId: value.terminalId,
        members: (
          Object.keys(selected) as Array<keyof typeof selected>
        ).flatMap((collection) =>
          selected[collection].map((d) => ({
            collection,
            id: d.id,
            expectedDocument: encodeOriginal(d),
          })),
        ),
        ...(dependencies.length ? { dependencies } : {}),
        declaration: value.declaration,
        ...(retainedDescriptor
          ? {
              retainedSet: {
                manifestReference: retainedDescriptor.manifestReference,
                descriptorHash: retainedDescriptor.descriptorHash,
                configurationBasis: "CURRENT_AT_PREPARATION" as const,
              },
            }
          : {}),
        nativeZ: {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          user: value.user,
          notes: value.notes,
          configurationSha256: await hash(encodeOriginal(config)),
        },
      });
      const body = decodeOriginal(prepared.body) as any;
      const stage = await this.db.getCollection<any>("recoveryStage");
      const receiptBindings = [
        ...body.members.map((m: any) => ({ ...m, group: "members" })),
        ...(body.dependencies || []).map((m: any) => ({
          ...m,
          group: "dependencies",
        })),
      ].map((m: any) => {
        const receipt =
            m.source.stage === "RECOVERED"
              ? m.source.receipt
              : stage.find(
                  (row) =>
                    row.snapshotId === snapshot.snapshot.snapshotId &&
                    row.record.kind === m.source.kind &&
                    row.record.originalId === m.source.originalId &&
                    row.record.revision === m.source.revision &&
                    row.record.storageEpoch === m.source.storageEpoch &&
                    new TextDecoder().decode(
                      decodeBase64(row.record.bodyBase64),
                    ) === m.source.body,
                ),
          r = receipt?.record;
        if (!r) fail("ORIGINAL_REQUIRED");
        return {
          group: m.group,
          kind: r.kind,
          originalId: r.originalId,
          revision: r.revision,
          reference: {
            receiptId: receipt.receiptId,
            recordHash: receipt.recordHash,
            storageEpoch: r.storageEpoch,
            kind: r.kind,
            originalId: r.originalId,
            revision: r.revision,
            bodySha256: r.bodySha256,
          },
        };
      });
      const job = {
        scopeKey,
        preparationId,
        snapshotId: snapshot.snapshot.snapshotId,
        seriesId,
        receiptBindings,
        terminalId: value.terminalId,
      };
      const serialized = encodeOriginal(job);
      await withRecoveryPreparation(this.db, scopeKey, async (base) => {
        if (!base.saveDocumentsAtomically) fail("ATOMIC_REQUIRED");
        await base.saveDocumentsAtomically(
          [
            {
              collectionName: "recoveryState",
              document: {
                id: JSON.stringify([
                  "recoveryCloseUI",
                  scopeKey,
                  preparationId,
                ]),
                scopeKey,
                uiRecoveryClose: 1,
                body: serialized,
                bodySha256: await hash(serialized),
              },
            },
          ],
          true,
        );
      });
      await this.flow.observe(job);
      return (await this.list()).find((j) => j.preparationId === preparationId);
    } finally {
      this.running = false;
    }
  }
  async resumeReview(id: string) {
    const job = (await this.list()).find((j) => j.preparationId === id);
    if (!job) fail("NOT_FOUND");
    if (!job.candidate)
      await this.flow.observe({
        scopeKey: job.scopeKey,
        preparationId: job.preparationId,
        snapshotId: job.snapshotId,
        seriesId: job.seriesId,
        receiptBindings: job.receiptBindings,
      });
    return (await this.list()).find((j) => j.preparationId === id);
  }
  async discardUnsentReview(id: string) {
    const job = (await this.list()).find((j) => j.preparationId === id);
    if (!job) fail("NOT_FOUND");
    // Only UI metadata is removed; original data and immutable preparation remain.
    await this.flow.discardUnobserved(job.scopeKey, id, async (base) => {
      await base.deleteDocument(
        "recoveryState",
        JSON.stringify(["recoveryCloseUI", job.scopeKey, id]),
      );
    });
  }
  async confirm(id: string) {
    const job = (await this.list()).find((j) => j.preparationId === id);
    if (!job) fail("NOT_FOUND");
    return this.flow.commit(job.scopeKey, id);
  }
}
