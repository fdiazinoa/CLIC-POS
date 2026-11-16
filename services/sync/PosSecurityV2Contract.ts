import { sha256Utf8 } from './LargeMasterSyncV3Client';

/** Fixed ERP contract 8e2b3353504b964d50f5706a2bed1c983e2aae91. No network or rollout authority. */
export const POS_SECURITY_V2_DIGEST = '4a68c91feb698872db9e3c58975b88a65950b11c8e4e950abc549694a4f80052';
export const POS_SECURITY_V2_MODE = 'complete-authoritative-replacement';
export type SecurityBinding = { tenantId: string; terminalId: string; deviceId: string; bindingEpoch: number };
export type SecurityReference = { binding: SecurityBinding; agreementId: string; contractDigest: string; permissionContractVersion: 2; securityRevision: number; contentHash: string };
export type SecurityOffer = { binding: SecurityBinding; permissionContractVersion: 2; permissionsMode: string; contractDigest: string; offerId: string; agreementId: string; expiresAt: number };
export type SecurityControl = { status: 'success'; negotiation: { status: 'UNNEGOTIATED' | 'OFFERED' | 'ACCEPTED' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED'; stateRevision: number; protocolFloor: 0 | 2; binding: SecurityBinding; offer: SecurityOffer | null }; selection: { mode: 'CURRENT_UNCHANGED' | 'V2' | 'BLOCKED'; currentOperationsUnchanged: boolean; reason?: string; agreementId?: string } };
export class PosSecurityV2Error extends Error { constructor(public code: string) { super(code); this.name = 'PosSecurityV2Error'; } }
export const securityFail = (code: string): never => { throw new PosSecurityV2Error(code); };
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const exactKeys = (value: unknown, keys: string[]): value is Record<string, unknown> => isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.trim() === value;
export const counter = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const hashPattern = /^[a-f0-9]{64}$/;
export function canonicalSecurityJSON(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (item: unknown): string => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object' || ancestors.has(item!) || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) return securityFail('POS_SECURITY_INVALID_JSON');
    ancestors.add(item!);
    const result = Array.isArray(item) ? `[${Array.from(item, encode).join(',')}]` : `{${Object.keys(item!).sort().map(key => `${JSON.stringify(key)}:${encode((item as Record<string, unknown>)[key])}`).join(',')}}`;
    ancestors.delete(item!); return result;
  };
  return encode(value);
}
export const securityHash = (value: unknown): Promise<string> => sha256Utf8(canonicalSecurityJSON(value));
export const sameSecurityValue = (a: unknown, b: unknown): boolean => canonicalSecurityJSON(a) === canonicalSecurityJSON(b);
export function assertSecurityBinding(value: unknown): asserts value is SecurityBinding {
  if (!exactKeys(value, ['tenantId', 'terminalId', 'deviceId', 'bindingEpoch']) || !nonempty(value.tenantId) || !nonempty(value.terminalId) || !nonempty(value.deviceId) || !counter(value.bindingEpoch) || value.bindingEpoch < 1) securityFail('POS_SECURITY_BINDING_INVALID');
}
export function assertSameSecurityBinding(value: unknown, authorized: SecurityBinding): void {
  assertSecurityBinding(value); assertSecurityBinding(authorized);
  if (!sameSecurityValue(value, authorized)) securityFail('POS_SECURITY_BINDING_MISMATCH');
}
export const securityAnnouncement = (binding: SecurityBinding) => { assertSecurityBinding(binding); return { binding: structuredClone(binding), permissionContractVersion: 2 as const, permissionsMode: POS_SECURITY_V2_MODE, contractDigest: POS_SECURITY_V2_DIGEST }; };
export function assertSecurityOffer(value: unknown, binding: SecurityBinding): asserts value is SecurityOffer {
  if (!exactKeys(value, ['binding', 'permissionContractVersion', 'permissionsMode', 'contractDigest', 'offerId', 'agreementId', 'expiresAt']) || value.permissionContractVersion !== 2 || value.permissionsMode !== POS_SECURITY_V2_MODE || value.contractDigest !== POS_SECURITY_V2_DIGEST || !nonempty(value.offerId) || !nonempty(value.agreementId) || !counter(value.expiresAt)) return securityFail('POS_SECURITY_OFFER_INVALID');
  assertSameSecurityBinding(value.binding, binding);
}
export function validateSecurityControl(value: unknown, binding: SecurityBinding): SecurityControl {
  canonicalSecurityJSON(value);
  if (!exactKeys(value, ['status', 'negotiation', 'selection']) || value.status !== 'success' || !exactKeys(value.negotiation, ['status', 'stateRevision', 'protocolFloor', 'binding', 'offer']) || !isRecord(value.selection)) return securityFail('POS_SECURITY_CONTROL_INVALID');
  const n = value.negotiation, s = value.selection;
  if (!['UNNEGOTIATED', 'OFFERED', 'ACCEPTED', 'ACTIVE', 'REJECTED', 'SUSPENDED'].includes(String(n.status)) || !counter(n.stateRevision) || ![0, 2].includes(n.protocolFloor as number)) securityFail('POS_SECURITY_CONTROL_INVALID');
  assertSameSecurityBinding(n.binding, binding);
  if (n.offer !== null) assertSecurityOffer(n.offer, binding);
  if (['OFFERED', 'ACCEPTED', 'ACTIVE'].includes(String(n.status)) && n.offer === null) securityFail('POS_SECURITY_OFFER_INVALID');
  if (n.status === 'ACTIVE') {
    if (n.protocolFloor !== 2 || !exactKeys(s, ['mode', 'currentOperationsUnchanged', 'agreementId']) || s.mode !== 'V2' || s.currentOperationsUnchanged !== false || s.agreementId !== (n.offer as SecurityOffer).agreementId) securityFail('POS_SECURITY_NOT_ACTIVE');
  } else if (n.protocolFloor === 2) {
    if (!exactKeys(s, ['mode', 'currentOperationsUnchanged', 'reason']) || s.mode !== 'BLOCKED' || s.currentOperationsUnchanged !== false || !nonempty(s.reason)) securityFail('POS_SECURITY_FLOOR_VIOLATION');
  } else if (!exactKeys(s, ['mode', 'currentOperationsUnchanged', 'reason']) || s.mode !== 'CURRENT_UNCHANGED' || s.currentOperationsUnchanged !== true || !nonempty(s.reason) || (n.status === 'ACCEPTED' && s.reason !== 'WAIT_ACTIVATION')) securityFail('POS_SECURITY_CONTROL_INVALID');
  return structuredClone(value) as SecurityControl;
}
const referenceKeys = ['binding', 'agreementId', 'contractDigest', 'permissionContractVersion', 'securityRevision', 'contentHash'];
export function validateStoredSecurityReference(value: unknown): SecurityReference {
  if (!exactKeys(value, referenceKeys) || value.permissionContractVersion !== 2 || value.contractDigest !== POS_SECURITY_V2_DIGEST || !nonempty(value.agreementId) || !counter(value.securityRevision) || typeof value.contentHash !== 'string' || !hashPattern.test(value.contentHash)) return securityFail('POS_SECURITY_REFERENCE_INVALID');
  assertSecurityBinding(value.binding); return structuredClone(value) as SecurityReference;
}
export function validateSecurityReference(value: unknown, binding: SecurityBinding, control: SecurityControl): SecurityReference {
  if (control.negotiation.status !== 'ACTIVE' || control.selection.mode !== 'V2') securityFail('POS_SECURITY_NOT_ACTIVE');
  const ref = validateStoredSecurityReference(value);
  if (ref.agreementId !== control.negotiation.offer?.agreementId) securityFail('POS_SECURITY_REFERENCE_INVALID');
  assertSameSecurityBinding(ref.binding, binding); return ref;
}
export function compareSecurityRevision(next: SecurityReference, previous: SecurityReference): void {
  if (next.securityRevision < previous.securityRevision || (next.securityRevision === previous.securityRevision && next.contentHash !== previous.contentHash)) securityFail('POS_SECURITY_REVISION_STALE');
}
const modules = new Set(['FINANCIAL', 'PAYMENTS', 'CASH_DETAILS', 'KPIS', 'AUDIT']);
function validateWireRolesUsers(roles: unknown, users: unknown): void {
  if (!Array.isArray(roles) || !Array.isArray(users)) securityFail('POS_SECURITY_CATALOG_INVALID');
  const roleIds = new Set<string>(), userIds = new Set<string>();
  for (const role of roles as unknown[]) {
    if (!isRecord(role) || !nonempty(role.id) || roleIds.has(role.id.toUpperCase()) || role.permissionContractVersion !== 2 || !Array.isArray(role.permissions) || role.permissions.some(p => !nonempty(p)) || new Set(role.permissions).size !== role.permissions.length || role.permissions.includes('CAN_REFUND') || !Array.isArray(role.permission_keys) || !sameSecurityValue(role.permissions, role.permission_keys)) securityFail('POS_SECURITY_ROLE_INVALID');
    const r = role as Record<string, unknown>; roleIds.add((r.id as string).toUpperCase());
    for (const key of ['isSystem', 'is_system', 'isActive', 'is_active']) if (Object.hasOwn(r, key) && typeof r[key] !== 'boolean') securityFail('POS_SECURITY_ROLE_INVALID');
    if (Object.hasOwn(r, 'version') && (!counter(r.version) || r.version < 1)) securityFail('POS_SECURITY_ROLE_INVALID');
    for (const key of ['maxDiscountPercent', 'max_discount_percent']) if (Object.hasOwn(r, key) && (typeof r[key] !== 'number' || !Number.isFinite(r[key]) || (r[key] as number) < 0 || (r[key] as number) > 100)) securityFail('POS_SECURITY_ROLE_INVALID');
    for (const key of ['zReportConfig', 'z_report_config']) if (Object.hasOwn(r, key) && (key === 'zReportConfig' || r[key] !== null)) {
      const z = r[key]; if (!exactKeys(z, ['hiddenModules']) || !Array.isArray(z.hiddenModules) || z.hiddenModules.length > 5 || z.hiddenModules.some(m => !modules.has(m))) securityFail('POS_SECURITY_ROLE_INVALID');
    }
    for (const [a, b] of [['isSystem', 'is_system'], ['isActive', 'is_active'], ['maxDiscountPercent', 'max_discount_percent'], ['zReportConfig', 'z_report_config']]) if (Object.hasOwn(r, a) && Object.hasOwn(r, b) && !sameSecurityValue(r[a], r[b])) securityFail('POS_SECURITY_ROLE_INVALID');
  }
  for (const user of users as unknown[]) {
    if (!isRecord(user) || !nonempty(user.id) || userIds.has(user.id.toUpperCase()) || !nonempty(user.role_id) || !(roles as Record<string, unknown>[]).some(r => r.id === user.role_id)) securityFail('POS_SECURITY_USER_INVALID');
    userIds.add((user as Record<string, string>).id.toUpperCase());
  }
}
export async function validateSecurityEnvelope(value: unknown, binding: SecurityBinding, control: SecurityControl, current: SecurityReference, previous?: SecurityReference): Promise<{ block: Record<string, unknown>; reference: SecurityReference }> {
  if (!exactKeys(value, ['pos_security']) || !exactKeys(value.pos_security, ['permissionContractVersion', 'permissionsMode', 'contractDigest', 'binding', 'agreementId', 'securityRevision', 'contentHash', 'roles', 'users'])) return securityFail('POS_SECURITY_ENVELOPE_INVALID');
  const block = value.pos_security;
  if (block.permissionsMode !== POS_SECURITY_V2_MODE) securityFail('POS_SECURITY_ENVELOPE_INVALID');
  const ref = Object.fromEntries(referenceKeys.map(key => [key, block[key]]));
  const reference = validateSecurityReference(ref, binding, control);
  validateSecurityReference(current, binding, control);
  if (!sameSecurityValue(reference, current)) securityFail('POS_SECURITY_REFERENCE_MISMATCH');
  validateWireRolesUsers(block.roles, block.users);
  const body = Object.fromEntries(Object.entries(block).filter(([key]) => key !== 'contentHash'));
  if (await securityHash(body) !== block.contentHash) securityFail('POS_SECURITY_CONTENT_HASH_MISMATCH');
  if (previous) { validateSecurityReference(previous, binding, control); compareSecurityRevision(reference, previous); }
  return { block, reference };
}
export const securityPartition = async (reference: SecurityReference): Promise<string> => `pos-security-v2:${await securityHash(reference)}`;
