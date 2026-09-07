import { projectNativeZConfiguration } from "./NativeZConfiguration";
import type {
  DatabaseAdapter,
  DurableDocumentMutation,
  FinancialCommitInput,
} from "../db/DatabaseAdapter";
import {
  captureDocument,
  CAPTURE_COLLECTIONS,
  RECOVERY_OUTBOX,
  RECOVERY_STATE,
} from "./OriginalCapture";
import { decodeOriginal, encodeOriginal } from "./OriginalCodec";

const transportCapture = new WeakMap<
  DatabaseAdapter,
  (
    document: any,
    item: unknown,
    scope: string,
    collection: string,
  ) => Promise<string | null>
>();
const preparationQueue = new WeakMap<
  DatabaseAdapter,
  <T>(scope: string, work: (base: DatabaseAdapter) => Promise<T>) => Promise<T>
>();
/** Internal local-only boundary. Callbacks must use base, not the queued proxy. */
export function withRecoveryPreparation<T>(
  db: DatabaseAdapter,
  scope: string,
  work: (base: DatabaseAdapter) => Promise<T>,
): Promise<T> {
  const run = preparationQueue.get(db);
  if (!run)
    return Promise.reject(new Error("RECOVERY_PREPARATION_UNAVAILABLE"));
  return run(scope, work);
}
/** Preserve the actual outbound image without replacing the native original. No network. */
export const captureOriginalTransport = (
  db: DatabaseAdapter,
  document: any,
  item: unknown,
  scope: string,
  collection = "transactions",
): Promise<string | null> =>
  transportCapture.get(db)?.(document, item, scope, collection) ??
  Promise.resolve(null);

/** A single local write queue covers document + original capture, without network in checkout. */
export function recoveryDatabase(
  base: DatabaseAdapter,
  enabled: () => boolean,
  provenance: () => { key: string; terminalId?: string } = () => ({ key: "" }),
): DatabaseAdapter {
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>) => {
    const result = queue.then(fn, fn);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const addCaptures = async (documents: DurableDocumentMutation[]) => {
    const config = await base.getDocument<any>("config", "current");
    const configuration = config ? projectNativeZConfiguration(config) : null;
    const captures = documents
      .map((d) =>
        captureDocument(
          d.collectionName,
          d.document,
          provenance(),
          configuration,
        ),
      )
      .filter(Boolean);
    if (!captures.length) return documents;
    if (!base.saveDocumentsAtomically)
      throw new Error("RECOVERY_ATOMIC_STORAGE_UNAVAILABLE");
    const previous = await base.getDocument<any>(RECOVERY_STATE, "capture");
    const state = previous || {
      id: "capture",
      storageEpoch: crypto.randomUUID(),
      openSetId: crypto.randomUUID(),
      sequence: "0",
    };
    const extra: DurableDocumentMutation[] = [];
    for (const capture of captures) {
      // Same snapshot retry must not manufacture a new revision.
      const headId = JSON.stringify([capture!.kind, capture!.originalId]);
      const head = await base.getDocument<any>(RECOVERY_STATE, headId);
      if (head?.body === capture!.body) continue;
      state.sequence = (BigInt(state.sequence) + 1n).toString();
      extra.push({
        collectionName: RECOVERY_OUTBOX,
        document: {
          ...capture!,
          storageEpoch: state.storageEpoch,
          openSetId: state.openSetId,
          sequence: state.sequence,
          revision: state.sequence,
        },
      });
      extra.push({
        collectionName: RECOVERY_STATE,
        document: {
          id: headId,
          body: capture!.body,
          sequence: state.sequence,
          captureId: capture!.id,
        },
      });
    }
    return [
      ...documents,
      ...extra,
      { collectionName: RECOVERY_STATE, document: state },
    ];
  };
  const proxy = new Proxy(base, {
    get(target, key) {
      if (
        key === "saveDocument" ||
        key === "bulkUpsert" ||
        key === "saveCollection"
      )
        return (collectionName: string, value: any) =>
          exclusive(async () => {
            if (!enabled() || !CAPTURE_COLLECTIONS[collectionName])
              return (target[key] as any).call(target, collectionName, value);
            const docs = key === "saveDocument" ? [value] : value;
            if (!Array.isArray(docs))
              throw new Error("RECOVERY_INVALID_COLLECTION");
            const mutations = await addCaptures(
              docs.map((document) => ({ collectionName, document })),
            );
            await base.saveDocumentsAtomically!(
              mutations,
              false,
              key === "saveCollection" ? [collectionName] : [],
            );
          });
      if (
        key === "commitFinancialTransaction" &&
        target.commitFinancialTransaction
      )
        return (input: FinancialCommitInput) =>
          exclusive(async () => {
            const documents = enabled()
              ? await addCaptures(input.documents)
              : input.documents;
            await target.commitFinancialTransaction!({ ...input, documents });
          });
      if (
        [
          "deleteDocument",
          "saveDocumentsAtomically",
          "commitNumberedMasterCreation",
        ].includes(String(key)) &&
        typeof (target as any)[key] === "function"
      )
        return (...args: any[]) =>
          exclusive(() => (target as any)[key](...args));
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  transportCapture.set(proxy, (document, item, scope, collection) =>
    exclusive(async () => {
      if (
        !enabled() ||
        document?._posRecovery?.snapshotId ||
        !document?.id ||
        scope !== provenance().key
      )
        return null;
      const route = (
        {
          transactions: "/api/sync/transactions",
          cashMovements: "/api/sync/cash/movements",
        } as Record<string, string>
      )[collection];
      const kind = CAPTURE_COLLECTIONS[collection];
      if (!route || !kind) return null;
      const headId = JSON.stringify([kind, document.id]);
      const head = await base.getDocument<any>(RECOVERY_STATE, headId);
      if (!head?.captureId) return null; // Legacy images have no ingress reference.
      const previous = await base.getDocument<any>(
        RECOVERY_OUTBOX,
        head.captureId,
      );
      if (!previous || previous.originKey !== scope || previous.kind !== kind)
        return null;
      const envelope = decodeOriginal(previous.body) as any;
      // SQLite's JSON projection is used only to verify the current runtime image.
      // The typed source images themselves remain unchanged, including omitted/Date values.
      if (
        JSON.stringify(decodeOriginal(envelope.document)) !==
        JSON.stringify(document)
      )
        return null;
      const transport = {
        version: 1,
        route,
        item: encodeOriginal(item),
      };
      if (JSON.stringify(envelope.transport) === JSON.stringify(transport))
        return previous.id;
      const state = await base.getDocument<any>(RECOVERY_STATE, "capture");
      if (
        !state ||
        state.storageEpoch !== previous.storageEpoch ||
        scope !== provenance().key
      )
        return null;
      state.sequence = (BigInt(state.sequence) + 1n).toString();
      const body = encodeOriginal({ ...envelope, transport });
      const record = {
        ...previous,
        id: crypto.randomUUID(),
        body,
        sequence: state.sequence,
        revision: state.sequence,
        capturedAt: new Date().toISOString(),
        status: "PENDING",
      };
      delete record.receipt;
      await base.saveDocumentsAtomically!([
        { collectionName: RECOVERY_OUTBOX, document: record },
        {
          collectionName: RECOVERY_STATE,
          document: {
            id: headId,
            body,
            sequence: state.sequence,
            captureId: record.id,
          },
        },
        { collectionName: RECOVERY_STATE, document: state },
      ]);
      return record.id;
    }),
  );
  preparationQueue.set(proxy, (scope, work) =>
    exclusive(async () => {
      if (!enabled()) throw new Error("RECOVERY_DISABLED");
      if (!scope || scope !== provenance().key)
        throw new Error("RECOVERY_SCOPE_CHANGED");
      const result = await work(base);
      if (!enabled() || scope !== provenance().key)
        throw new Error("RECOVERY_SCOPE_CHANGED");
      return result;
    }),
  );
  return proxy;
}
