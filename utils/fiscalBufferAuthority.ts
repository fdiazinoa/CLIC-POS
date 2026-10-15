import type {BusinessConfig,FiscalAllocation,FiscalDocumentCode,FiscalRangeDGII,LocalFiscalBuffer,TerminalConfig} from '../types';
const normalizeSequenceKey=(value:unknown)=>String(value || '').trim().toUpperCase();
/** Shared pure policy: native format and ordinary fiscal issuance must authorize the same scope and lot. */
export const resolveFiscalTerminalPolicyFromConfig=(business:BusinessConfig|undefined,terminalId:string|undefined,allocations:FiscalAllocation[],context?:TerminalConfig)=>{
  const terminal = business?.terminals?.find(candidate => candidate.id === terminalId || candidate.config?.erpTerminalId === terminalId);
  const terminalConfig = terminal?.config || context;
  const authorityId = terminalConfig?.erpTerminalId || terminalId;
  const identityMatches = Boolean(terminalId && authorityId && (authorityId === terminalId ||
    (terminal && terminal.id === terminalId && terminal.config?.erpTerminalId === authorityId)));
  const companyId = terminalConfig?.erpBinding?.companyId;
  const assignedRangeIds = Array.isArray(terminalConfig?.fiscal?.fiscalRanges)
    ? new Set(terminalConfig.fiscal.fiscalRanges.map(range => range.id)) : null;
  const configuredAllocations = Array.isArray(terminalConfig?.fiscal?.fiscalAllocations)
    ? terminalConfig.fiscal.fiscalAllocations : null;
  const foreignCompany = [...allocations, ...(configuredAllocations || [])].some(allocation => {
    if (normalizeSequenceKey(allocation.terminalId) !== normalizeSequenceKey(authorityId)) return false;
    const sourceCompany = allocation.metadata?.companyId || allocation.metadata?.company_id || allocation.metadata?.sourceCompanyId;
    return sourceCompany && (!companyId || normalizeSequenceKey(sourceCompany) !== normalizeSequenceKey(companyId));
  });
  return { authorityId, mode:terminalConfig?.fiscal?.mode, managed: true, assignedRangeIds, configuredAllocations, enabled: identityMatches && !foreignCompany &&
    terminalConfig?.fiscal?.mode !== 'NONE' &&
    (terminalConfig?.fiscal?.mode === 'LEGACY_B' || terminalConfig?.fiscal?.enabled !== false) };

};

export const hasValidFiscalAllocationPointer = (allocation: FiscalAllocation): boolean => {
  const next = Number(allocation.nextNumber);
  const start = Number(allocation.reservedStart);
  const end = Number(allocation.reservedEnd);
  return Number.isSafeInteger(next) && Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) && start > 0 && end >= start &&
    next >= start && next <= end + 1;
};

export const getFiscalRangeForEmission = (
  ranges: FiscalRangeDGII[],
  type: FiscalDocumentCode,
  allocation?: FiscalAllocation | null
): FiscalRangeDGII | null => {
  const normalizedType = normalizeSequenceKey(type);
  const normalizedRangeId = normalizeSequenceKey(allocation?.fiscalRangeId || '');
  const normalizedPrefix = normalizeSequenceKey(allocation?.prefix || '');

  if (normalizedRangeId) {
    const matchById = (ranges || []).find((range) => normalizeSequenceKey(range.id) === normalizedRangeId);
    if (matchById && normalizeSequenceKey(matchById.type) === normalizedType) return matchById;
    return null;
  }

  if (normalizedPrefix) {
    const matchByPrefix = (ranges || []).find((range) =>
      normalizeSequenceKey(range.prefix) === normalizedPrefix &&
      normalizeSequenceKey(range.type) === normalizedType
    );
    if (matchByPrefix) return matchByPrefix;
  }

  return (ranges || []).find((range) =>
    normalizeSequenceKey(range.type) === normalizedType && Boolean(range.isActive)
  ) || null;
};

export const hasValidAllocatedFiscalRange = (
  ranges: FiscalRangeDGII[], allocation: FiscalAllocation, type: FiscalDocumentCode
): boolean => {
  if (!allocation.id || !allocation.fiscalRangeId || !allocation.terminalId) return false;
  if (allocation.releasedAt || (allocation.metadata?.sourceTerminalId &&
      normalizeSequenceKey(allocation.metadata.sourceTerminalId) !== normalizeSequenceKey(allocation.terminalId))) return false;
  const range = getFiscalRangeForEmission(ranges, type, allocation);
  if (!range || !range.isActive || !hasValidFiscalAllocationPointer(allocation)) return false;
  // The deployed ERP lot contract omits expiry. Never synthesize a date;
  // an explicitly supplied nonblank invalid/expired date remains a denial.
  const suppliedExpiry = String(range.expiryDate ?? '').trim();
  if (suppliedExpiry) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(suppliedExpiry);
    if (!match) return false;
    const expiry = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (expiry.getFullYear() !== Number(match[1]) || expiry.getMonth() !== Number(match[2]) - 1 ||
        expiry.getDate() !== Number(match[3])) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (expiry < today) return false;
  }
  return Number.isSafeInteger(range.startNumber) && Number.isSafeInteger(range.endNumber) &&
    range.startNumber > 0 && range.endNumber >= range.startNumber &&
    allocation.reservedStart >= range.startNumber && allocation.reservedEnd <= range.endNumber &&
    normalizeSequenceKey(range.type) === normalizeSequenceKey(type) &&
    normalizeSequenceKey(range.prefix) === normalizeSequenceKey(allocation.prefix || type);

};

export const isAllocationAllowedByPolicy = (
  allocation: FiscalAllocation, policy: ReturnType<typeof resolveFiscalTerminalPolicyFromConfig>, prepared = false
): boolean => {
  if (policy.assignedRangeIds && !policy.assignedRangeIds.has(allocation.fiscalRangeId)) return false;
  if (!policy.configuredAllocations) return true;
  return policy.configuredAllocations.some(source => source.id === allocation.id &&
    normalizeSequenceKey(source.terminalId) === normalizeSequenceKey(policy.authorityId) &&
    source.fiscalRangeId === allocation.fiscalRangeId && source.ncfType === allocation.ncfType &&
    Number(source.reservedStart) === allocation.reservedStart && Number(source.reservedEnd) === allocation.reservedEnd &&
    hasValidFiscalAllocationPointer(source) && !source.releasedAt &&
    (source.status === 'ACTIVE' || (prepared && source.status === 'EXHAUSTED')) &&
    (!source.prefix || normalizeSequenceKey(source.prefix) === normalizeSequenceKey(allocation.prefix || allocation.ncfType)));
};


export function validateFiscalBufferReservation(input:{business:BusinessConfig;terminalId:string;type:FiscalDocumentCode;
 buffer:LocalFiscalBuffer;allocation:FiscalAllocation;range:FiscalRangeDGII;ncf:string}):LocalFiscalBuffer {
 const {business,terminalId,type,buffer,allocation,range,ncf}=input;
 const policy=resolveFiscalTerminalPolicyFromConfig(business,terminalId,[allocation]);
 const terminal=business.terminals?.find(t=>t.id===terminalId || t.config?.erpTerminalId===terminalId);
 const valid=policy.enabled && terminal?.config?.fiscal?.mode==='LEGACY_B'
  && isAllocationAllowedByPolicy(allocation,policy,true) && hasValidAllocatedFiscalRange([range],allocation,type)
  && ['ACTIVE','EXHAUSTED'].includes(allocation.status) && !allocation.releasedAt
  && normalizeSequenceKey(allocation.terminalId)===normalizeSequenceKey(policy.authorityId)
  && allocation.ncfType===type && buffer.terminalId===policy.authorityId && buffer.type===type
  && buffer.allocationId===allocation.id && buffer.fiscalRangeId===range.id
  && buffer.prefix===(allocation.prefix || type) && buffer.prefix===range.prefix
  && buffer.expiryDate===(range.expiryDate || '')
  && Number.isSafeInteger(buffer.currentNumber) && Number.isSafeInteger(buffer.endNumber) && Number.isSafeInteger(buffer.startNumber)
  && buffer.startNumber!>=allocation.reservedStart && buffer.endNumber<=allocation.reservedEnd
  && buffer.currentNumber>=buffer.startNumber! && buffer.currentNumber<=buffer.endNumber
  && buffer.currentNumber<allocation.nextNumber
  && `${buffer.prefix}${String(buffer.currentNumber).padStart(8,'0')}`===ncf;
 if(!valid) throw new Error('POS_FORMAT_FISCAL_ALLOCATION_REQUIRED');
 return {...buffer,currentNumber:buffer.currentNumber+1};
}
