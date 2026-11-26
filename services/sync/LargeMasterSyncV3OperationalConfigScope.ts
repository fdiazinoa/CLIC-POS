import type { BusinessConfig } from '../../types';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

type Selector = { localTerminalId?: string; terminalId?: string; deviceId?: string; tenantId?: string };
const sortObjectKeys = (_key: string, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left === right ? 0 : 1))
  : value;

export function v3ConfigScopeChangeReason(expected: string, current: string): 'CONFIG_SCOPE' | 'OWNER' {
  const [company, store] = JSON.parse(expected);
  const [currentCompany, currentStore] = JSON.parse(current);
  return company === currentCompany && store === currentStore ? 'CONFIG_SCOPE' : 'OWNER';
}
/** The complete immutable authority scope; presentation metadata is intentionally retained. */
export function v3OperationalConfigContext(config: BusinessConfig, selector: Selector) {
  const matches = config?.terminals?.filter(row =>
    (selector.localTerminalId === undefined || row.id === selector.localTerminalId)
    && (selector.terminalId === undefined || (row.config.erpTerminalId || row.id) === selector.terminalId)
    && (selector.deviceId === undefined || row.config.currentDeviceId === selector.deviceId)
    && (selector.tenantId === undefined || row.config.erpBinding?.tenantId === selector.tenantId));
  if (matches?.length !== 1) throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
  const terminal = matches[0];
  const { erpBinding, inventoryScope, pricing, fiscal } = terminal.config;
  // Cursor advancement is ordinary reservation/receipt activity. The native allocation guard
  // checks the actual number, grant, status and bounds independently of the UI fingerprint.
  const fiscalPolicy = fiscal && {
    ...fiscal,
    fiscalRanges: fiscal.fiscalRanges?.map(({ currentGlobal: _cursor, ...range }) => range),
    fiscalAllocations: fiscal.fiscalAllocations?.map(({ nextNumber: _cursor, ...allocation }) => allocation),
  };
  const scope = JSON.stringify([erpBinding?.companyId, erpBinding?.storeId, inventoryScope, pricing, fiscalPolicy], sortObjectKeys);
  const identity = [terminal.id, terminal.config.currentDeviceId, terminal.config.erpTerminalId, erpBinding?.tenantId];
  return {
    terminal,
    scope,
    key: JSON.stringify([...identity, scope]),
    get checkoutKey() {
      return JSON.stringify([...identity, erpBinding?.companyId, erpBinding?.storeId, inventoryScope,
        pricing?.defaultTariffId, [...(pricing?.allowedTariffIds || [])].sort(), fiscalPolicy], sortObjectKeys);
    },
  };
}
