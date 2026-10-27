/**
 * Modifier groups as the V3 sales contract actually defines them: the cashier picks up to
 * `max_select` **distinct** options. Repeating the same option (2× "extra cheese" on one
 * article) is not representable: the client authority and the ERP both require unique option
 * ids and cap the list at `max_select`. So the UI must not silently swallow the tap that
 * exceeds the cap — it says what the limit is.
 */

export interface ModifierSelectionGroup {
  selection_type?: string | null;
  max_select?: number | null;
  min_select?: number | null;
  required?: boolean | null;
}

export const modifierGroupSelectionLimit = (group: ModifierSelectionGroup | null | undefined): number => {
  if (!group) return 0;
  if (String(group.selection_type || '') === 'SINGLE') return 1;
  return Math.max(0, Number(group.max_select || 0));
};

export const modifierGroupSelectionMinimum = (group: ModifierSelectionGroup | null | undefined): number => {
  if (!group) return 0;
  const declared = Number(group.min_select || 0);
  return group.required ? Math.max(1, declared) : Math.max(0, declared);
};

/** A tap on a new option would exceed the contract: it cannot be added. */
export const isModifierSelectionCapped = (
  group: ModifierSelectionGroup | null | undefined,
  selectedCount: number,
): boolean => {
  const limit = modifierGroupSelectionLimit(group);
  return limit > 0 && Number(selectedCount || 0) >= limit;
};

export const modifierSelectionCapNotice = (group: ModifierSelectionGroup | null | undefined): string => {
  const limit = modifierGroupSelectionLimit(group);
  if (limit <= 0) return '';
  if (String(group?.selection_type || '') === 'SINGLE') return 'Solo puedes elegir una opción en este grupo.';
  return `Máximo ${limit} opciones distintas en este grupo.`;
};

/** Remaining slots before the cap; 0 means "full", null means "no cap". */
export const modifierGroupRemainingSlots = (
  group: ModifierSelectionGroup | null | undefined,
  selectedCount: number,
): number | null => {
  const limit = modifierGroupSelectionLimit(group);
  if (limit <= 0) return null;
  return Math.max(0, limit - Number(selectedCount || 0));
};
