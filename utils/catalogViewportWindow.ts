export interface CatalogViewportWindowInput {
  itemCount: number;
  columns: number;
  rowHeight: number;
  rowGap: number;
  paddingTop: number;
  paddingBottom: number;
  scrollTop: number;
  viewportHeight: number;
  overscanRows?: number;
}

export interface CatalogViewportWindow {
  startIndex: number;
  endIndex: number;
  startRow: number;
  endRow: number;
  totalHeight: number;
  offsetTop: number;
  rowCount: number;
}

/** Virtualize DOM rows, never the searchable/catalog data source. */
export const catalogViewportWindow = ({
  itemCount,
  columns,
  rowHeight,
  rowGap,
  paddingTop,
  paddingBottom,
  scrollTop,
  viewportHeight,
  overscanRows = 1,
}: CatalogViewportWindowInput): CatalogViewportWindow => {
  const count = Math.max(0, Math.floor(itemCount));
  const columnCount = Math.max(1, Math.floor(columns));
  const height = Math.max(1, rowHeight);
  const gap = Math.max(0, rowGap);
  const topPadding = Math.max(0, paddingTop);
  const bottomPadding = Math.max(0, paddingBottom);
  const stride = height + gap;
  const rowCount = Math.ceil(count / columnCount);
  const totalHeight = topPadding + bottomPadding
    + rowCount * height + Math.max(0, rowCount - 1) * gap;
  if (rowCount === 0) {
    return { startIndex: 0, endIndex: 0, startRow: 0, endRow: 0, totalHeight, offsetTop: 0, rowCount };
  }

  const safeTop = Math.max(0, scrollTop - topPadding);
  const firstVisibleRow = Math.min(rowCount - 1, Math.floor(safeTop / stride));
  const lastVisibleRow = Math.min(
    rowCount,
    Math.ceil((Math.max(0, scrollTop) + Math.max(1, viewportHeight) - topPadding + gap) / stride),
  );
  const overscan = Math.max(0, Math.floor(overscanRows));
  const startRow = Math.max(0, firstVisibleRow - overscan);
  const endRow = Math.min(rowCount, Math.max(firstVisibleRow + 1, lastVisibleRow) + overscan);
  return {
    startIndex: startRow * columnCount,
    endIndex: Math.min(count, endRow * columnCount),
    startRow,
    endRow,
    totalHeight,
    offsetTop: startRow * stride,
    rowCount,
  };
};
