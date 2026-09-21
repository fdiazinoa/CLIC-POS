/** A conditional setup response reuses local config metadata, not a fresh product snapshot. */
export const pairingSnapshotItems = <T>(response: {
  unchanged?: boolean;
  items?: T[];
  terminal_config?: { masters?: { items?: T[] } };
}): T[] | undefined => {
  if (response.unchanged) return undefined;
  if (Array.isArray(response.items)) return response.items;
  return Array.isArray(response.terminal_config?.masters?.items)
    ? response.terminal_config.masters.items
    : undefined;
};
