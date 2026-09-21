/** Keep catalog identity for delta requests without storing every ERP item twice in config. */
export const compactTerminalCatalogSnapshot = <T>(snapshot: T): T => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return snapshot;
  const value = snapshot as Record<string, any>;
  if (!Array.isArray(value.masters?.items)) return snapshot;
  return {
    ...value,
    masters: {
      ...value.masters,
      items: value.masters.items.map((item: any) => ({
        id: item?.id,
        _catalog_hash: item?._catalog_hash,
      })),
    },
  } as T;
};

/** Also compact legacy configurations when they are read from SQLite. */
export const compactStoredTerminalCatalog = <T>(config: T): T => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  const value = config as Record<string, any>;
  const snapshots = value.terminalSnapshots;
  return {
    ...value,
    ...(snapshots && typeof snapshots === 'object' && !Array.isArray(snapshots)
      ? { terminalSnapshots: Object.fromEntries(Object.entries(snapshots).map(([id, snapshot]) => [
          id, compactTerminalCatalogSnapshot(snapshot),
        ])) }
      : {}),
    ...(Array.isArray(value.terminals)
      ? { terminals: value.terminals.map((terminal: any) => terminal?.config?.erpSnapshot
          ? { ...terminal, config: {
              ...terminal.config,
              erpSnapshot: compactTerminalCatalogSnapshot(terminal.config.erpSnapshot),
            } }
          : terminal) }
      : {}),
  } as T;
};
