export const POS_CATEGORY_COLUMNS_PER_ROW = 6;
const POS_CATEGORY_ROWS_PER_PAGE = 2;

export const resolvePosCategoryGridPosition = (index: number): {
  gridColumn: number;
  gridRow: number;
} => {
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const itemsPerPage = POS_CATEGORY_COLUMNS_PER_ROW * POS_CATEGORY_ROWS_PER_PAGE;
  const pageIndex = Math.floor(safeIndex / itemsPerPage);
  const pageOffset = safeIndex % itemsPerPage;

  return {
    gridColumn: (pageIndex * POS_CATEGORY_COLUMNS_PER_ROW)
      + (pageOffset % POS_CATEGORY_COLUMNS_PER_ROW)
      + 1,
    gridRow: Math.floor(pageOffset / POS_CATEGORY_COLUMNS_PER_ROW) + 1,
  };
};
