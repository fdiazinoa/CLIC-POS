export type TableChairSlot =
  | 'TOP_CENTER'
  | 'BOTTOM_CENTER'
  | 'LEFT_CENTER'
  | 'RIGHT_CENTER'
  | 'TOP_LEFT'
  | 'TOP_RIGHT'
  | 'BOTTOM_LEFT'
  | 'BOTTOM_RIGHT';

export const resolveVisibleTableChairCount = (capacity?: number): number => {
  const parsedCapacity = Number(capacity);
  if (!Number.isFinite(parsedCapacity) || parsedCapacity <= 0) return 4;
  return Math.max(2, Math.min(8, Math.round(parsedCapacity)));
};

export const getTableChairSlots = (capacity?: number): TableChairSlot[] => {
  const count = resolveVisibleTableChairCount(capacity);
  if (count === 2) return ['TOP_CENTER', 'BOTTOM_CENTER'];
  if (count === 3) return ['TOP_CENTER', 'LEFT_CENTER', 'RIGHT_CENTER'];
  if (count === 4) return ['TOP_CENTER', 'BOTTOM_CENTER', 'LEFT_CENTER', 'RIGHT_CENTER'];
  if (count === 5) return ['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_CENTER', 'LEFT_CENTER', 'RIGHT_CENTER'];
  if (count === 6) return ['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT', 'LEFT_CENTER', 'RIGHT_CENTER'];
  if (count === 7) return ['TOP_LEFT', 'TOP_CENTER', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT', 'LEFT_CENTER', 'RIGHT_CENTER'];
  return ['TOP_LEFT', 'TOP_CENTER', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_CENTER', 'BOTTOM_RIGHT', 'LEFT_CENTER', 'RIGHT_CENTER'];
};
