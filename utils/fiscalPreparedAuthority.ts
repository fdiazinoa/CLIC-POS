import type { FiscalAllocation, FiscalDocumentCode, LocalFiscalBuffer } from '../types';

const key = (value: unknown): string => String(value || '').trim().toLowerCase();

export const reconcilePreparedFiscalCollections = (
  allocations: FiscalAllocation[],
  buffers: LocalFiscalBuffer[],
  type: FiscalDocumentCode,
  terminalId: string,
  ncf: string,
): { allocations: FiscalAllocation[]; buffers: LocalFiscalBuffer[] } => {
  const normalized = String(ncf || '').trim().toUpperCase();
  const prefix = String(type || '').trim().toUpperCase();
  if (!prefix || !normalized.startsWith(prefix) || !/^\d+$/.test(normalized.slice(prefix.length))) {
    throw new Error('PREPARED_NCF_INVALID');
  }
  const issuedNumber = Number(normalized.slice(prefix.length));
  if (!Number.isSafeInteger(issuedNumber) || issuedNumber < 1) throw new Error('PREPARED_NCF_INVALID');

  const matchingAllocation = allocations.find(allocation => (
    allocation.ncfType === type
    && key(allocation.terminalId) === key(terminalId)
    && issuedNumber >= allocation.reservedStart
    && issuedNumber <= allocation.reservedEnd
    && allocation.status === 'ACTIVE'
  ));
  const nextAllocations = matchingAllocation
    ? allocations.map(allocation => allocation.id === matchingAllocation.id
      ? { ...allocation, nextNumber: Math.max(Number(allocation.nextNumber) || allocation.reservedStart, issuedNumber + 1) }
      : allocation)
    : allocations;

  const nextBuffers = buffers.flatMap(buffer => {
    const sameAuthority = buffer.type === type && (!buffer.terminalId || key(buffer.terminalId) === key(terminalId));
    if (!sameAuthority) return [buffer];
    const start = Number(buffer.startNumber || buffer.currentNumber || 0);
    if (issuedNumber < start || issuedNumber > Number(buffer.endNumber || 0)) return [];
    return [{ ...buffer, currentNumber: Math.max(Number(buffer.currentNumber) || start, issuedNumber + 1) }];
  });
  return { allocations: nextAllocations, buffers: nextBuffers };
};
