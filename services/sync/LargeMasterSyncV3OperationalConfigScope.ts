import type { BusinessConfig } from '../../types';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

type Selector = { localTerminalId?: string; terminalId?: string; deviceId?: string; tenantId?: string };
/** The complete immutable authority scope; presentation metadata is intentionally retained. */
export function v3OperationalConfigContext(config: BusinessConfig, selector: Selector) {
  const matches = config?.terminals?.filter(row =>
    (selector.localTerminalId === undefined || row.id === selector.localTerminalId)
    && (selector.terminalId === undefined || (row.config.erpTerminalId || row.id) === selector.terminalId)
    && (selector.deviceId === undefined || row.config.currentDeviceId === selector.deviceId)
    && (selector.tenantId === undefined || row.config.erpBinding?.tenantId === selector.tenantId));
  if (matches?.length !== 1) throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
  const terminal = matches[0];
  const scope = JSON.stringify([terminal.config.erpBinding?.companyId,
    terminal.config.inventoryScope, terminal.config.pricing, terminal.config.fiscal]);
  return { terminal, scope, key: JSON.stringify([terminal.id, terminal.config.currentDeviceId,
    terminal.config.erpTerminalId, terminal.config.erpBinding?.tenantId, scope]) };
}
