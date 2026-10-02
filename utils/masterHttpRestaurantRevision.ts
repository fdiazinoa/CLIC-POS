export const canApplyMasterHttpRestaurantRevision = (input: {
  responseRevision: number;
  knownRevision: number;
  appliedRevision: number;
}): boolean => {
  if (!Number.isFinite(input.responseRevision) || input.responseRevision < 0) return false;
  const authoritativeFloor = Math.max(input.knownRevision, input.appliedRevision);
  if (authoritativeFloor > 0 && input.responseRevision <= 0) return false;
  return input.responseRevision >= input.knownRevision
    && input.responseRevision >= input.appliedRevision;
};

export const canUseMasterSqliteRestaurantFallback = (input: {
  knownRevision: number;
  appliedRevision: number;
}): boolean => input.knownRevision === 0 && input.appliedRevision === 0;
