export type MasterRestaurantRevisionResult = {
  knownRevision: number;
  appliedRevision: number;
  applied: boolean;
};

export const canApplyMasterRestaurantRevision = (input: {
  revision: number;
  knownRevision: number;
  appliedRevision: number;
  fenced: boolean;
}): boolean => Number.isFinite(input.revision)
  && !input.fenced
  && input.revision > input.appliedRevision
  && input.revision >= input.knownRevision;

export const applyAuthoritativeMasterRestaurantSnapshot = async <Snapshot>(input: {
  revision: number;
  knownRevision: number;
  appliedRevision: number;
  fenced: boolean;
  snapshot: Snapshot;
  publish: (snapshot: Snapshot) => void;
  persist: (snapshot: Snapshot) => Promise<void>;
}): Promise<MasterRestaurantRevisionResult> => {
  const knownRevision = Number.isFinite(input.revision)
    ? Math.max(input.knownRevision, input.revision)
    : input.knownRevision;
  if (!canApplyMasterRestaurantRevision(input)) {
    return { knownRevision, appliedRevision: input.appliedRevision, applied: false };
  }

  input.publish(input.snapshot);
  await input.persist(input.snapshot);
  return { knownRevision, appliedRevision: input.revision, applied: true };
};
