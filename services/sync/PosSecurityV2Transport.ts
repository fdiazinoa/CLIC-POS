import { requestJson, type RequestJsonInput, type RequestJsonResult } from '../network/httpClient';
import { readLargeMasterSyncV3BoundIdentity, validatedLargeMasterSyncV3ErpSyncBase, type LargeMasterSyncV3BoundIdentity } from './LargeMasterSyncV3BoundTransport';
import { extractPosSecurityConfigCarrier, type PosSecurityV2Transport } from './PosSecurityV2Consumer';
import { assertSameSecurityBinding, assertSecurityBinding, isRecord, sameSecurityValue, securityFail, securityPartition, validateSecurityControl, validateSecurityReference, type SecurityBinding, type SecurityControl, type SecurityReference, type securityAnnouncement } from './PosSecurityV2Contract';

type Request = (input: RequestJsonInput) => Promise<RequestJsonResult<unknown>>;
/** Uses the existing read-only ERP credential/target guard and the shared web/native HTTP client.
 * No auth exchange, negotiation, cache, snapshot identity or activation is implicit here. */
export class AuthenticatedPosSecurityV2Transport implements PosSecurityV2Transport {
  constructor(
    private readIdentity = readLargeMasterSyncV3BoundIdentity,
    private request: Request = requestJson,
  ) {}
  private identity(): LargeMasterSyncV3BoundIdentity {
    const identity = this.readIdentity();
    if (!identity.syncToken || identity.syncToken.trim() !== identity.syncToken || /[\r\n\t]/.test(identity.syncToken)) securityFail('POS_SECURITY_AUTH_REQUIRED');
    return { ...identity, erpSyncBaseUrl: validatedLargeMasterSyncV3ErpSyncBase(identity.erpSyncBaseUrl) };
  }
  private async http(path: string, body?: unknown): Promise<unknown> {
    const identity = this.identity();
    let response: RequestJsonResult<unknown>;
    try {
      response = await this.request({
        url: `${identity.erpSyncBaseUrl}/terminals/${encodeURIComponent(identity.terminalId)}${path}`,
        method: body === undefined ? 'GET' : 'POST',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-store',
          'X-Sync-Token': identity.syncToken, 'X-Device-Id': identity.deviceId, 'X-POS-Device-Id': identity.deviceId,
          'X-Tenant-Id': identity.tenantId, 'X-Terminal-Id': identity.terminalId,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), timeoutMs: 15000, rejectRedirects: true,
      });
    } catch { return securityFail('POS_SECURITY_NETWORK_UNAVAILABLE'); }
    if (!sameSecurityValue(this.identity(), identity)) securityFail('POS_SECURITY_CONTEXT_CHANGED');
    // A generic config 304 never proves this binding/agreement/partition is applied.
    if (!response.ok || response.status === 304) securityFail(`POS_SECURITY_HTTP_${response.status}`);
    if (!isRecord(response.data)) securityFail('POS_SECURITY_HTTP_BODY_INVALID');
    return response.data;
  }
  async state(): Promise<SecurityControl> {
    const identity = this.identity();
    const response = await this.http('/security-contract');
    if (!sameSecurityValue(this.identity(), identity)) securityFail('POS_SECURITY_CONTEXT_CHANGED');
    const binding = isRecord(response) && isRecord(response.negotiation) ? response.negotiation.binding : null;
    assertSecurityBinding(binding);
    if (binding.tenantId !== identity.tenantId || binding.terminalId !== identity.terminalId || binding.deviceId !== identity.deviceId) securityFail('POS_SECURITY_BINDING_MISMATCH');
    return validateSecurityControl(response, binding);
  }
  async authorizedBinding(): Promise<SecurityBinding> { return (await this.state()).negotiation.binding; }
  private async post(path: string, body: { binding: SecurityBinding }): Promise<unknown> {
    assertSameSecurityBinding(body.binding, await this.authorizedBinding());
    const response = await this.http(`/security-contract/${path}`, body);
    return validateSecurityControl(response, await this.authorizedBinding());
  }
  offer(body: ReturnType<typeof securityAnnouncement>): Promise<unknown> { return this.post('offer', body); }
  accept(body: ReturnType<typeof securityAnnouncement> & { offerId: string }): Promise<unknown> { return this.post('accept', body); }
  capability(body: { agreementId: string; binding: SecurityBinding; available: false; reason: 'CAPABILITY_LOST' | 'ROLLBACK' }): Promise<unknown> { return this.post('capability', body); }
  async currentReference(): Promise<unknown> {
    const body = await this.http('/manifest');
    if (!isRecord(body) || !isRecord(body.manifest)) return securityFail('POS_SECURITY_CARRIER_INVALID');
    return body.manifest.security_contract;
  }
  async download(reference: SecurityReference, partition: string): Promise<unknown> {
    const control = await this.state();
    validateSecurityReference(reference, control.negotiation.binding, control);
    if (partition !== await securityPartition(reference)) securityFail('POS_SECURITY_PARTITION_MISMATCH');
    const body = await this.http('/config');
    return extractPosSecurityConfigCarrier(body, 'terminal-config');
  }
}

/** Setup may run before pairing. Send an existing token only to its already-bound authority/scope. */
export function posSecurityV2SetupHeaders(input: { baseUrl: string; terminalId: string; tenantId?: string | null; deviceId?: string | null }): Record<string, string> {
  try {
    const bound = readLargeMasterSyncV3BoundIdentity();
    const base = validatedLargeMasterSyncV3ErpSyncBase(bound.erpSyncBaseUrl);
    if (`${input.baseUrl.replace(/\/(?:api\/sync|api)\/?$/, '').replace(/\/+$/, '')}/api/sync` !== base
      || input.tenantId !== bound.tenantId || input.terminalId !== bound.terminalId || input.deviceId !== bound.deviceId) return {};
    return { 'X-Sync-Token': bound.syncToken };
  } catch { return {}; }
}
