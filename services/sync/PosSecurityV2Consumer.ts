import type { DatabaseAdapter } from '../db/DatabaseAdapter';
import type { RoleDefinition, User } from '../../types';
import { buildAuthoritativeErpSecuritySnapshot } from '../../utils/erpSecuritySnapshot';
import { assertSameSecurityBinding, assertSecurityBinding, assertSecurityOffer, canonicalSecurityJSON, compareSecurityRevision, isRecord, sameSecurityValue, securityAnnouncement, securityFail, securityPartition, validateSecurityControl, validateSecurityEnvelope, validateSecurityReference, validateStoredSecurityReference, type SecurityBinding, type SecurityControl, type SecurityReference } from './PosSecurityV2Contract';

export const SECURITY_STATE_KIND = 'POS_SECURITY_V2_CHECKPOINT';
export interface PosSecurityRecord {
  id: string; kind: typeof SECURITY_STATE_KIND; tenantId: string; terminalId: string;
  protocolFloor: 0 | 2; control: SecurityControl;
  checkpoints: Record<string, SecurityReference>;
  appliedReference: SecurityReference | null;
  localBlock?: string;
}
/** Authenticated integration port. HTTP implementation and runtime injection live in PosSecurityV2Transport/Sync. */
export interface PosSecurityV2Transport {
  authorizedBinding(): Promise<SecurityBinding>;
  offer(body: ReturnType<typeof securityAnnouncement>): Promise<unknown>;
  accept(body: ReturnType<typeof securityAnnouncement> & { offerId: string }): Promise<unknown>;
  state(): Promise<unknown>;
  capability(body: { agreementId: string; binding: SecurityBinding; available: false; reason: 'CAPABILITY_LOST' | 'ROLLBACK' }): Promise<unknown>;
  currentReference(): Promise<unknown>;
  download(reference: SecurityReference, partition: string): Promise<unknown>;
}
export const securityScopeId = (binding: Pick<SecurityBinding, 'tenantId' | 'terminalId'>): string => `pos-security-state:${JSON.stringify([binding.tenantId, binding.terminalId])}`;
const agreementKey = (binding: SecurityBinding, agreementId: string, digest: string): string => canonicalSecurityJSON([binding, agreementId, digest, 2]);
export async function readPosSecurityRecords(adapter: DatabaseAdapter): Promise<PosSecurityRecord[]> {
  if (!adapter.readPosSecurityState) return securityFail('POS_SECURITY_DURABLE_READ_UNAVAILABLE');
  const rows = await adapter.readPosSecurityState();
  return rows.map(raw => {
    if (!isRecord(raw) || raw.kind !== SECURITY_STATE_KIND || typeof raw.id !== 'string' || ![0, 2].includes(raw.protocolFloor as number) || !isRecord(raw.control) || !isRecord(raw.checkpoints)) return securityFail('POS_SECURITY_PERSISTED_STATE_INVALID');
    const record = raw as unknown as PosSecurityRecord;
    const control = validateSecurityControl(record.control, record.control.negotiation.binding);
    if (record.id !== securityScopeId(control.negotiation.binding) || record.tenantId !== control.negotiation.binding.tenantId || record.terminalId !== control.negotiation.binding.terminalId || record.protocolFloor !== control.negotiation.protocolFloor) securityFail('POS_SECURITY_PERSISTED_STATE_INVALID');
    for (const [key, value] of Object.entries(record.checkpoints)) {
      const reference = validateStoredSecurityReference(value);
      if (reference.binding.tenantId !== record.tenantId || reference.binding.terminalId !== record.terminalId || key !== agreementKey(reference.binding, reference.agreementId, reference.contractDigest)) securityFail('POS_SECURITY_PERSISTED_STATE_INVALID');
    }
    if (!Object.hasOwn(record, 'appliedReference')) securityFail('POS_SECURITY_PERSISTED_STATE_INVALID');
    if (record.appliedReference !== null) {
      const reference = validateStoredSecurityReference(record.appliedReference);
      if (!sameSecurityValue(record.checkpoints[agreementKey(reference.binding, reference.agreementId, reference.contractDigest)], reference)) securityFail('POS_SECURITY_PERSISTED_STATE_INVALID');
    }
    if (record.localBlock !== undefined && !['CAPABILITY_LOST', 'ROLLBACK'].includes(record.localBlock)) securityFail('POS_SECURITY_PERSISTED_STATE_INVALID');
    return record;
  });
}
export async function assertLegacySecurityWriteAllowed(adapter: DatabaseAdapter, collection: string): Promise<void> {
  if (!['roles', 'users'].includes(collection) || !adapter.readPosSecurityState) return;
  if ((await readPosSecurityRecords(adapter)).some(row => row.protocolFloor === 2)) securityFail('POS_SECURITY_LEGACY_WRITE_BLOCKED');
}
export function extractPosSecurityConfigCarrier(body: unknown, carrier: 'initial-config' | 'terminal-config' | 'config-snapshot'): { pos_security: unknown } {
    const container = isRecord(body) ? (carrier === 'config-snapshot'
      ? (isRecord(body.domains) ? body.domains.catalog : undefined) : body.terminal_config) : undefined;
    if (!isRecord(container) || !Object.hasOwn(container, 'pos_security') || ['pos_roles', 'pos_users', 'roles', 'users'].some(key => Object.hasOwn(container, key))
      || (isRecord(container.masters) && ['pos_roles', 'pos_users'].some(key => Object.hasOwn(container.masters as object, key)))) return securityFail('POS_SECURITY_CARRIER_INVALID');
    return { pos_security: container.pos_security };
}
/** Prepared client; receiving ACTIVE is not creating an approval. The transport must authenticate its server/context. */
export class PosSecurityV2Consumer {
  constructor(private adapter: DatabaseAdapter, private transport: PosSecurityV2Transport) {}
  private async context() {
    const binding = await this.transport.authorizedBinding(); assertSecurityBinding(binding);
    const records = await readPosSecurityRecords(this.adapter);
    return { binding, record: records.find(row => row.id === securityScopeId(binding)) || null };
  }
  private async unchanged(record: PosSecurityRecord, binding: SecurityBinding): Promise<void> {
    const current = await this.context();
    assertSameSecurityBinding(current.binding, binding);
    if (!current.record || !sameSecurityValue(current.record, record)) securityFail('POS_SECURITY_CONTEXT_CHANGED');
  }
  private async commit(record: PosSecurityRecord, previous: PosSecurityRecord | null, roles?: RoleDefinition[], users?: User[]) {
    if (!this.adapter.saveDocumentsAtomically) securityFail('POS_SECURITY_ATOMIC_STORAGE_UNAVAILABLE');
    const documents = [{ collectionName: 'syncMetadata', document: record,
      ...(previous ? { expectedDocument: JSON.stringify(previous) } : { requireAbsent: true }) },
      ...(roles || []).map(document => ({ collectionName: 'roles', document })),
      ...(users || []).map(document => ({ collectionName: 'users', document }))];
    await this.adapter.saveDocumentsAtomically!(documents, false, roles === undefined ? [] : ['roles', 'users']);
    if (roles !== undefined && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('rolesUpdated')); window.dispatchEvent(new CustomEvent('usersUpdated'));
    }
  }
  private async consumeControl(response: unknown): Promise<SecurityControl> {
    const { binding, record } = await this.context();
    const control = validateSecurityControl(response, binding);
    if (record) {
      if (control.negotiation.protocolFloor < record.protocolFloor || control.negotiation.stateRevision < record.control.negotiation.stateRevision) securityFail('POS_SECURITY_CONTROL_STALE');
      if (control.negotiation.stateRevision === record.control.negotiation.stateRevision) {
        if (!sameSecurityValue(record.control, control)) securityFail('POS_SECURITY_CONTROL_CONFLICT');
        return control;
      }
      const oldBinding = record.control.negotiation.binding;
      if (!sameSecurityValue(binding, oldBinding) && binding.bindingEpoch <= oldBinding.bindingEpoch) securityFail('POS_SECURITY_BINDING_EPOCH_STALE');
    }
    const next: PosSecurityRecord = { id: securityScopeId(binding), kind: SECURITY_STATE_KIND, tenantId: binding.tenantId, terminalId: binding.terminalId,
      protocolFloor: control.negotiation.protocolFloor, control, checkpoints: record?.checkpoints || {}, appliedReference: record?.appliedReference || null };
    await this.commit(next, record); return control;
  }
  async announce(): Promise<SecurityControl> { const { binding } = await this.context(); return this.consumeControl(await this.transport.offer(securityAnnouncement(binding))); }
  async accept(): Promise<SecurityControl> {
    const { binding, record } = await this.context(); const offer = record?.control.negotiation.offer;
    assertSecurityOffer(offer, binding);
    return this.consumeControl(await this.transport.accept({ offerId: offer.offerId, ...securityAnnouncement(binding) }));
  }
  async refreshControl(): Promise<SecurityControl> { return this.consumeControl(await this.transport.state()); }
  async reportLoss(reason: 'CAPABILITY_LOST' | 'ROLLBACK'): Promise<SecurityControl> {
    const { binding, record } = await this.context();
    const agreementId = record?.control.negotiation.offer?.agreementId;
    if (!agreementId || !['CAPABILITY_LOST', 'ROLLBACK'].includes(reason)) return securityFail('POS_SECURITY_CAPABILITY_REPORT_INVALID');
    // Deny locally before sending; a network failure must not leave an ACTIVE return guard.
    await this.commit({ ...record!, localBlock: reason }, record);
    return this.consumeControl(await this.transport.capability({ agreementId, binding, available: false, reason }));
  }
  async applyCarrier(carrier: unknown, expectedReference?: unknown): Promise<'APPLIED' | 'DUPLICATE'> {
    const { binding, record } = await this.context();
    if (!record || record.control.negotiation.status !== 'ACTIVE' || record.control.selection.mode !== 'V2' || (record as unknown as Record<string, unknown>).localBlock) return securityFail('POS_SECURITY_NOT_ACTIVE');
    const current = validateSecurityReference(await this.transport.currentReference(), binding, record.control);
    if (expectedReference !== undefined && !sameSecurityValue(validateSecurityReference(expectedReference, binding, record.control), current)) securityFail('POS_SECURITY_REFERENCE_MISMATCH');
    const key = agreementKey(binding, current.agreementId, current.contractDigest);
    const previous = record.checkpoints[key];
    const validated = await validateSecurityEnvelope(carrier, binding, record.control, current, previous);
    if (previous && sameSecurityValue(previous, validated.reference)) { await this.unchanged(record, binding); return 'DUPLICATE'; }
    const snapshot = buildAuthoritativeErpSecuritySnapshot({ roleRows: validated.block.roles as unknown[], userRows: validated.block.users as unknown[], existingRoles: [], existingUsers: [], permissionContractVersion: 2 });
    const next = { ...record, checkpoints: { ...record.checkpoints, [key]: validated.reference }, appliedReference: validated.reference };
    // Recheck the authenticated context after asynchronous hashing/download work, before CAS publication.
    assertSameSecurityBinding(await this.transport.authorizedBinding(), binding);
    await this.commit(next, record, snapshot.roles, snapshot.users); return 'APPLIED';
  }
  async receiveConfig(body: unknown, carrier: 'initial-config' | 'terminal-config' | 'config-snapshot'): Promise<'APPLIED' | 'DUPLICATE'> {
    return this.applyCarrier(extractPosSecurityConfigCarrier(body, carrier));
  }

  async receiveConfigPush(payload: unknown): Promise<'APPLIED' | 'DUPLICATE'> {
    if (!isRecord(payload) || !Object.hasOwn(payload, 'security_contract') || ['roles', 'users', 'pos_roles', 'pos_users', 'pos_security'].some(key => Object.hasOwn(payload, key))) return securityFail('POS_SECURITY_CARRIER_INVALID');
    return this.receiveReference(payload.security_contract);
  }
  async receiveManifest(manifest: unknown): Promise<'APPLIED' | 'DUPLICATE'> {
    if (!isRecord(manifest) || !Object.hasOwn(manifest, 'security_contract')) return securityFail('POS_SECURITY_CARRIER_INVALID');
    return this.receiveReference(manifest.security_contract);
  }
  async receiveReference(reference: unknown): Promise<'APPLIED' | 'DUPLICATE'> {
    const { binding, record } = await this.context();
    if (!record || record.localBlock || record.control.negotiation.status !== 'ACTIVE' || record.control.selection.mode !== 'V2') return securityFail('POS_SECURITY_NOT_ACTIVE');
    const current = validateSecurityReference(await this.transport.currentReference(), binding, record.control);
    const candidate = validateSecurityReference(reference, binding, record.control);
    if (!sameSecurityValue(candidate, current)) securityFail('POS_SECURITY_REFERENCE_MISMATCH');
    const prior = record.checkpoints[agreementKey(binding, candidate.agreementId, candidate.contractDigest)];
    if (prior) compareSecurityRevision(candidate, prior);
    const partition = await securityPartition(candidate);
    if (prior && sameSecurityValue(prior, candidate) && sameSecurityValue(record.appliedReference, candidate)) { await this.unchanged(record, binding); return 'DUPLICATE'; }
    const downloaded = await this.transport.download(candidate, partition);
    // A transport 304 is only valid for the exact already-applied partition; there is no generic-cache fallback.
    if (isRecord(downloaded) && downloaded.notModified === true) return securityFail('POS_SECURITY_NOT_MODIFIED_WITHOUT_CHECKPOINT');
    return this.applyCarrier(downloaded, candidate);
  }
}
