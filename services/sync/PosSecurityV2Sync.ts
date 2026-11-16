import type { DatabaseAdapter } from '../db/DatabaseAdapter';
import { PosSecurityV2Consumer, readPosSecurityRecords, type PosSecurityV2Transport } from './PosSecurityV2Consumer';
import { isRecord, securityFail } from './PosSecurityV2Contract';
import { configureReturnSecurityContext } from './PosSecurityV2Runtime';
import { AuthenticatedPosSecurityV2Transport } from './PosSecurityV2Transport';

export type SecurityCarrier = 'initial-config' | 'terminal-config' | 'config-snapshot' | 'manifest' | 'config-push';
export class PosSecurityV2Sync {
  readonly consumer: PosSecurityV2Consumer;
  constructor(private adapter: DatabaseAdapter, readonly transport: PosSecurityV2Transport) {
    this.consumer = new PosSecurityV2Consumer(adapter, transport);
  }
  async receive(body: unknown, carrier: SecurityCarrier): Promise<'CURRENT' | 'APPLIED' | 'DUPLICATE'> {
    const value = isRecord(body) ? body : {};
    const container = carrier === 'config-snapshot' ? (isRecord(value.domains) ? value.domains.catalog : null)
      : carrier === 'manifest' ? value.manifest : carrier === 'config-push' ? value : value.terminal_config;
    const hasCarrier = isRecord(container) && Object.hasOwn(container,
      carrier === 'manifest' || carrier === 'config-push' ? 'security_contract' : 'pos_security');
    const records = await readPosSecurityRecords(this.adapter);
    // Preserve CURRENT before activation. Plain legacy traffic never announces or accepts an agreement.
    if (!hasCarrier && !records.some(row => row.protocolFloor === 2)) return 'CURRENT';
    const control = await this.consumer.refreshControl();
    if (control.selection.mode !== 'V2') return securityFail('POS_SECURITY_NOT_ACTIVE');
    if (carrier === 'manifest') return this.consumer.receiveManifest(value.manifest);
    if (carrier === 'config-push') return this.consumer.receiveConfigPush(body);
    return this.consumer.receiveConfig(body, carrier);
  }
  async authorizedBinding() {
    // Persist suspension/rebind from the server before allowing the return guard to use a checkpoint.
    await this.consumer.refreshControl();
    return this.transport.authorizedBinding();
  }
}
let runtime: Promise<PosSecurityV2Sync> | undefined;
export function getPosSecurityV2Sync(): Promise<PosSecurityV2Sync> {
  return runtime ??= import('../db').then(({ dbAdapter }) => {
    const sync = new PosSecurityV2Sync(dbAdapter, new AuthenticatedPosSecurityV2Transport());
    configureReturnSecurityContext(() => sync.authorizedBinding());
    return sync;
  });
}
export const receivePosSecurityV2 = async (body: unknown, carrier: SecurityCarrier) =>
  (await getPosSecurityV2Sync()).receive(body, carrier);
