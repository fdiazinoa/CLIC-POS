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
    const configuration = config
      ? {
          currencies: config.currencies,
          taxes: config.taxes,
          paymentMethods: (config.paymentMethods || []).map(
            ({ integrationConfig, ...method }: any) => method,
          ),
          terminals: (config.terminals || []).map((terminal: any) => ({
            id: terminal.id,
            operational: terminal.config?.operational,
            workflow: terminal.config?.workflow,
          })),
          coverage: "DECLARED_NOT_PROVEN",
        }
      : null;
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
        document: { id: headId, body: capture!.body, sequence: state.sequence },
      });
    }
    return [
      ...documents,
      ...extra,
      { collectionName: RECOVERY_STATE, document: state },
    ];
  };
  return new Proxy(base, {
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
}
