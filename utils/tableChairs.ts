export type TableChairSlot =
  | 'TOP_CENTER'
  | 'BOTTOM_CENTER'
  | 'LEFT_CENTER'
  | 'RIGHT_CENTER';

const FOUR_CHAIR_LAYOUT: readonly TableChairSlot[] = [
  'TOP_CENTER',
  'BOTTOM_CENTER',
  'LEFT_CENTER',
  'RIGHT_CENTER'
];

export const getTableChairSlots = (): TableChairSlot[] => [...FOUR_CHAIR_LAYOUT];
