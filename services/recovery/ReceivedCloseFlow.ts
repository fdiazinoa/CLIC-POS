import type {
  DatabaseAdapter,
  DurableDocumentMutation,
} from "../db/DatabaseAdapter";
import { ClosePreparation, type PreparedClose } from "./ClosePreparation";
import {
  encodeOriginal,
  decodeOriginal,
  originalDigest,
} from "./OriginalCodec";
import { recoveryCanonicalJson } from "./RecoveryJson";
import { RECOVERY_STATE } from "./OriginalCapture";
import { withRecoveryPreparation } from "./RecoveryDatabase";

export interface ReceivedCloseScope {
  tenantId: string;
  companyId: string;
  storeId: string;
  terminalId: string;
}
export interface ReceivedCloseTransport {
  context(): Promise<{
    key: string;
    scope: ReceivedCloseScope;
    enabled: boolean;
  }>;
  observe(body: unknown): Promise<any>;
  submit(exactBody: string): Promise<any>;
  result(commandId: string): Promise<any | null>;
}
export interface ReceivedCloseStart {
  scopeKey: string;
  preparationId: string;
  snapshotId: string;
  seriesId: string;
  receiptBindings: any[];
}
const digest = (s: string) => originalDigest(new TextEncoder().encode(s));
const same = (a: unknown, b: unknown) =>
  recoveryCanonicalJson(a) === recoveryCanonicalJson(b);
const hex = (v: any) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const uuid = (v: any) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const fail = (s: string): never => {
  throw Error("RECEIVED_CLOSE_" + s);
};
const keys = (scope: string, prep: string) => ({
  candidate: JSON.stringify(["receivedCloseCandidate", scope, prep]),
  ack: JSON.stringify(["receivedCloseAck", scope, prep]),
  published: JSON.stringify(["receivedClosePublished", scope, prep]),
});
async function wrapped(id: string, value: unknown) {
  const body = encodeOriginal(value);
  return { id, body, bodySha256: await digest(body) };
}
async function unpack(row: any) {
  if (!row || (await digest(row.body)) !== row.bodySha256) fail("CORRUPT");
  return decodeOriginal(row.body) as any;
}

/** Received-scope laboratory orchestration. No production mounting or ordinary Z shortcut. */
export class ReceivedCloseFlow {
  private queue: Promise<unknown> = Promise.resolve();
  private preparation: ClosePreparation;
  constructor(
    private db: DatabaseAdapter,
    private transport: ReceivedCloseTransport,
  ) {
    this.preparation = new ClosePreparation(db);
  }
  private exclusive<T>(work: () => Promise<T>) {
    const p = this.queue.then(work, work);
    this.queue = p.catch(() => {});
    return p;
  }
  private async context(key: string) {
    const c = await this.transport.context();
    if (!c.enabled) fail("DISABLED");
    if (
      c.key !== key ||
      !c.scope ||
      ![
        c.scope.tenantId,
        c.scope.companyId,
        c.scope.storeId,
        c.scope.terminalId,
      ].every(uuid)
    )
      fail("SCOPE");
    return c;
  }
  private async load(id: string) {
    const row = await this.db.getDocument(RECOVERY_STATE, id);
    return row ? unpack(row) : null;
  }

  async observe(input: ReceivedCloseStart): Promise<any> {
    const frozen = decodeOriginal(encodeOriginal(input)) as ReceivedCloseStart;
    return this.exclusive(async () => {
      const context = await this.context(frozen.scopeKey),
        k = keys(frozen.scopeKey, frozen.preparationId);
      const existing = await this.load(k.candidate);
      if (existing) {
        if (
          !same(existing.input, frozen) ||
          !same(existing.scope, context.scope)
        )
          fail("INTENT_CONFLICT");
        await this.preparation.resume(frozen.scopeKey, frozen.preparationId);
        return existing.observed;
      }
      const prepared = await this.preparation.resume(
        frozen.scopeKey,
        frozen.preparationId,
      );
      const body = decodeOriginal(prepared.body) as any,
        request = decodeOriginal(body.requestBody) as any;
      if (
        !body.nativeReport ||
        !body.nativeConfiguration ||
        !uuid(frozen.snapshotId) ||
        !uuid(frozen.seriesId)
      )
        fail("PREPARATION_INCOMPLETE");
      const declarationBody = encodeOriginal(request.declaration);
      const observationRequest = {
        snapshotId: frozen.snapshotId,
        seriesId: frozen.seriesId,
        receiptBindings: frozen.receiptBindings,
        preparation: { body: prepared.body, bodySha256: prepared.bodySha256 },
        configuration: {
          body: body.nativeConfiguration.body,
          bodySha256: body.nativeConfiguration.bodySha256,
        },
        declaration: {
          body: declarationBody,
          bodySha256: await digest(declarationBody),
        },
      };
      const observed = await this.transport.observe(observationRequest);
      if (!same((await this.context(frozen.scopeKey)).scope, context.scope))
        fail("SCOPE");
      await this.validateObservation(context.scope, frozen, prepared, observed);
      const submission = {
        snapshotId: frozen.snapshotId,
        membership: observed.membership,
        preparation: observationRequest.preparation,
        configuration: observationRequest.configuration,
        declaration: observationRequest.declaration,
        resources: observed.trace.resources,
      };
      const value = {
        input: frozen,
        scope: context.scope,
        preparationHash: prepared.bodySha256,
        observed,
        submissionBody: JSON.stringify(submission),
      };
      const row = await wrapped(k.candidate, value);
      await this.preparation.withCurrent(
        frozen.scopeKey,
        frozen.preparationId,
        async (base, current) => {
          if (current.bodySha256 !== prepared.bodySha256)
            fail("PREPARATION_CHANGED");
          if (!base.saveDocumentsAtomically) fail("ATOMIC_UNAVAILABLE");
          await base.saveDocumentsAtomically(
            [{ collectionName: RECOVERY_STATE, document: row }],
            true,
          );
        },
      );
      return observed;
    });
  }
  private async validateObservation(
    scope: ReceivedCloseScope,
    input: ReceivedCloseStart,
    prepared: PreparedClose,
    o: any,
  ) {
    const p = decodeOriginal(prepared.body) as any;
    if (
      o?.status !== "PRODUCED_NOT_AUTHORIZED" ||
      o.closeAuthorization !== "NOT_GRANTED" ||
      o.exactZEligible !== false ||
      o.snapshotId !== input.snapshotId ||
      !hex(o.registrationHash)
    )
      fail("OBSERVATION_UNAUTHORIZED");
    if (
      typeof o.packetJson !== "string" ||
      (await digest(o.packetJson)) !== o.packetHash ||
      o.trace?.preparationHash !== prepared.bodySha256
    )
      fail("OBSERVATION_HASH");
    const resources = o.trace.resources;
    if (
      resources?.version !== 1 ||
      !same(resources.scope, scope) ||
      resources.series?.seriesId !== input.seriesId ||
      (await digest(recoveryCanonicalJson(resources))) !== o.trace.resourceHash
    )
      fail("RESOURCES");
    const membership = o.membership,
      intent = membership?.intent;
    if (
      intent?.domain !== "pos.intent.close_set.v2" ||
      intent.version !== 2 ||
      intent.commandId !== p.commandId ||
      !same(intent.scope, scope) ||
      (await digest(recoveryCanonicalJson(intent))) !== membership.intentHash
    )
      fail("MEMBERSHIP");
    const controlRef = intent.artifacts?.find(
      (a: any) => a.role === "closeControl",
    );
    const control = membership.artifacts?.[controlRef?.artifactHash];
    if (!control || !same(control.document, p.closeControl))
      fail("CLOSE_CONTROL");
    for (const ref of intent.artifacts) {
      if (
        (await digest(
          recoveryCanonicalJson(membership.artifacts?.[ref.artifactHash]),
        )) !== ref.artifactHash
      )
        fail("ARTIFACT_HASH");
    }
    if (
      !same(
        JSON.parse(o.packetJson).report,
        JSON.parse(JSON.stringify(p.nativeReport)),
      )
    )
      fail("REPORT_CHANGED");
    if (!same(membership.receiptBindings, input.receiptBindings))
      fail("MEMBERS_CHANGED");
    if (
      (await digest(
        recoveryCanonicalJson({ ...membership, closeControl: p.closeControl }),
      )) !== o.registrationHash
    )
      fail("REGISTRATION_HASH");
  }

  /** Always look up a durable result first, including after a lost submit ACK. */
  async commit(scopeKey: string, preparationId: string): Promise<any> {
    return this.exclusive(async () => {
      const context = await this.context(scopeKey),
        k = keys(scopeKey, preparationId);
      const candidate = await this.load(k.candidate);
      if (!candidate || !same(candidate.scope, context.scope))
        fail("NOT_OBSERVED");
      let ack = await this.load(k.ack);
      if (!ack) {
        ack = await this.transport.result(
          candidate.observed.membership.intent.commandId,
        );
        if (!same((await this.context(scopeKey)).scope, context.scope))
          fail("SCOPE");
        if (!ack) {
          await this.preparation.resume(scopeKey, preparationId);
          ack = await this.transport.submit(candidate.submissionBody);
          if (!same((await this.context(scopeKey)).scope, context.scope))
            fail("SCOPE");
        }
        await this.validateAck(candidate, ack);
        const row = await wrapped(k.ack, ack);
        await withRecoveryPreparation(this.db, scopeKey, async (base) => {
          const existing = await base.getDocument(RECOVERY_STATE, k.ack);
          if (existing) {
            if (!same(await unpack(existing), ack)) fail("ACK_CONFLICT");
            return;
          }
          if (!base.saveDocumentsAtomically) fail("ATOMIC_UNAVAILABLE");
          await base.saveDocumentsAtomically(
            [{ collectionName: RECOVERY_STATE, document: row }],
            true,
          );
        });
      }
      await this.validateAck(candidate, ack);
      await this.publish(scopeKey, preparationId, candidate, ack);
      return ack;
    });
  }
  private async validateAck(c: any, ack: any) {
    const intent = c.observed.membership.intent,
      ref = intent.artifacts.find((a: any) => a.role === "closeControl"),
      control = c.observed.membership.artifacts[ref.artifactHash].document;
    if (
      ack?.status !== "COMMITTED" ||
      ack.coverage !== "RECEIVED_ONLY" ||
      ack.exactZEligible !== false ||
      ack.closeAuthorization !== "GRANTED_RECEIVED_SCOPE"
    )
      fail("ACK_NOT_AUTHORIZED");
    if (
      !same(ack.scope, c.scope) ||
      ack.commandId !== intent.commandId ||
      ack.closeId !== control.closeId ||
      ack.closeEventId !== control.closeEventId ||
      ack.nextOpenSetId !== control.nextOpenSetId ||
      ack.snapshotId !== c.input.snapshotId ||
      ack.intentHash !== c.observed.membership.intentHash ||
      ack.registrationHash !== c.observed.registrationHash ||
      ack.packetHash !== c.observed.packetHash ||
      ack.resourceHash !== c.observed.trace.resourceHash
    )
      fail("ACK_BINDING");
    if (
      ack.preparationHash !== c.preparationHash ||
      ack.requestHash !==
        (await digest(recoveryCanonicalJson(JSON.parse(c.submissionBody))))
    )
      fail("ACK_REQUEST");
    if (
      !uuid(ack.commitId) ||
      !uuid(ack.membershipId) ||
      !uuid(ack.journalId) ||
      ack.seriesId !== c.input.seriesId ||
      typeof ack.number !== "string" ||
      !/^\d+$/.test(ack.number) ||
      !Number.isSafeInteger(Number(ack.number)) ||
      Number(ack.number) < 1 ||
      Number(ack.number) >= Number.MAX_SAFE_INTEGER ||
      typeof ack.code !== "string" ||
      !ack.code
    )
      fail("ACK_NUMBER");
    const series = c.observed.trace.resources.series;
    if (
      ack.number !== series.nextNumber ||
      ack.code !== series.prefix + ack.number.padStart(series.padding, "0")
    )
      fail("ACK_NUMBER");
    const packet = JSON.parse(c.observed.packetJson);
    if (
      !same(ack.report, { ...packet.report, sequenceNumber: ack.code }) ||
      !same(ack.summary, {
        ...packet.summary,
        report_id: ack.closeId,
        sequence_number: ack.code,
      }) ||
      !same(ack.journal, {
        ...packet.journal,
        id: ack.journalId,
        reference: ack.code,
      })
    )
      fail("ACK_OUTPUT_CHANGED");
  }
  private async publish(
    scopeKey: string,
    preparationId: string,
    candidate: any,
    ack: any,
  ) {
    const k = keys(scopeKey, preparationId);
    const published = await this.load(k.published);
    if (published) {
      if (
        published.commitId !== ack.commitId ||
        published.packetHash !== ack.packetHash
      )
        fail("PUBLICATION_CONFLICT");
      return;
    }
    await this.preparation.withCurrent(
      scopeKey,
      preparationId,
      async (base, prepared) => {
        if (prepared.bodySha256 !== candidate.preparationHash)
          fail("PREPARATION_CHANGED");
        const p = decodeOriginal(prepared.body) as any;
        if (await base.getDocument("zReports", ack.closeId))
          fail("LOCAL_COLLISION");
        const changes: DurableDocumentMutation[] = [];
        // Runtime support is explicitly limited to the same whole-set profile the ERP accepts.
        if (p.members.some((m: any) => m.collection !== "transactions"))
          fail("UNSUPPORTED_MEMBER");
        const memberIds = new Set(p.members.map((m: any) => m.id));
        for (const m of p.members) {
          if (await base.getDocument("transactionHistory", m.id))
            fail("LOCAL_COLLISION");
          const doc = await base.getDocument<any>("transactions", m.id);
          if (!doc || doc.zReportId) fail("LOCAL_MEMBER_CHANGED");
          changes.push({
            collectionName: "transactionHistory",
            document: {
              ...doc,
              zReportId: ack.closeId,
              zReportSequence: ack.code,
            },
          });
        }
        const active = await base.getCollection<any>("transactions");
        changes.push(
          ...active
            .filter((d) => !memberIds.has(d.id))
            .map((document) => ({ collectionName: "transactions", document })),
        );
        const series = await base.getDocument<any>(
          "internalSequences",
          ack.seriesId,
        );
        if (
          !series ||
          !Number.isSafeInteger(Number(series.nextNumber)) ||
          Number(series.nextNumber) < 1
        )
          fail("LOCAL_SERIES_UNAVAILABLE");
        const nextNumber = Math.max(
          Number(series.nextNumber),
          Number(ack.number) + 1,
        );
        changes.push({
          collectionName: "internalSequences",
          document: { ...series, nextNumber },
        });
        const config = await base.getDocument<any>("config", "current");
        if (config) {
          let changed = false;
          const terminals = (config.terminals || []).map((t: any) => {
            if (
              !Array.isArray(t.config?.documentSeries) ||
              !t.config.documentSeries.some((s: any) => s.id === ack.seriesId)
            )
              return t;
            changed = true;
            return {
              ...t,
              config: {
                ...t.config,
                documentSeries: t.config.documentSeries.map((s: any) => {
                  if (s.id !== ack.seriesId) return s;
                  if (
                    !Number.isSafeInteger(Number(s.nextNumber)) ||
                    Number(s.nextNumber) < 1
                  )
                    fail("LOCAL_SERIES_UNAVAILABLE");
                  return {
                    ...s,
                    nextNumber: Math.max(Number(s.nextNumber), nextNumber),
                  };
                }),
              },
            };
          });
          if (changed)
            changes.push({
              collectionName: "config",
              document: { ...config, terminals },
            });
        }
        const capture = await base.getDocument<any>(RECOVERY_STATE, "capture");
        changes.push({
          collectionName: RECOVERY_STATE,
          document: {
            ...(capture || {
              id: "capture",
              storageEpoch: crypto.randomUUID(),
              sequence: "0",
            }),
            openSetId: ack.nextOpenSetId,
          },
        });
        changes.push({
          collectionName: "zReports",
          document: {
            ...ack.report,
            seriesId: ack.seriesId,
            seriesNumber: Number(ack.number),
            syncStatus: "SYNCED",
            _posRecovery: {
              snapshotId: candidate.input.snapshotId,
              commitId: ack.commitId,
              coverage: "RECEIVED_ONLY",
              exactZEligible: false,
              closeAuthorization: "GRANTED_RECEIVED_SCOPE",
            },
          },
        });
        changes.push({
          collectionName: RECOVERY_STATE,
          document: await wrapped(k.published, {
            commitId: ack.commitId,
            packetHash: ack.packetHash,
          }),
        });
        if (!base.saveDocumentsAtomically) fail("ATOMIC_UNAVAILABLE");
        await base.saveDocumentsAtomically(changes, false, ["transactions"]);
      },
    );
  }
}
