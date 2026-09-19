export const MODIFIER_MODAL_LAYOUT = {
  optionsPerPage: 8,
  minimumCardHeight: 88,
  landscapeColumns: 4,
  portraitColumns: 2,
} as const;

export const paginateModifierOptions = <T>(options: T[], page: number): T[] => {
  const safePage = Math.max(0, Math.min(page, Math.max(0, Math.ceil(options.length / MODIFIER_MODAL_LAYOUT.optionsPerPage) - 1)));
  return options.slice(
    safePage * MODIFIER_MODAL_LAYOUT.optionsPerPage,
    (safePage + 1) * MODIFIER_MODAL_LAYOUT.optionsPerPage,
  );
};

export const isModifierSelectionCountValid = (
  selectedCount: number,
  group: { required?: boolean; min_select?: number },
) => selectedCount >= (group.required ? Math.max(1, Number(group.min_select || 1)) : Number(group.min_select || 0));
