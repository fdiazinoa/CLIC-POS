const firstNumberToken = (value: string): string => value.match(/\d+/)?.[0] || '';

const padLocationNumber = (value: string): string =>
  value.replace(/^\d+$/, token => token.padStart(2, '0'));

const shortenLabel = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
};

export const resolvePosTableHeaderLabel = ({
  roomName,
  tableName,
}: {
  roomName?: string;
  tableName?: string;
}): string => {
  const normalizedRoom = String(roomName || '').trim();
  const normalizedTable = String(tableName || '').trim();
  const roomNumber = firstNumberToken(normalizedRoom);
  const tableNumber = firstNumberToken(normalizedTable);

  const roomLabel = roomNumber
    ? `S${padLocationNumber(roomNumber)}`
    : shortenLabel(
      normalizedRoom.replace(/^(sal[oó]n|sala|[aá]rea)\s+/i, '').trim(),
      16,
    );
  const tableLabel = tableNumber
    ? `M${padLocationNumber(tableNumber)}`
    : shortenLabel(normalizedTable.replace(/^mesa\s+/i, '').trim(), 10);

  return [roomLabel, tableLabel].filter(Boolean).join(' · ');
};
