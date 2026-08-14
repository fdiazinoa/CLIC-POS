export const UNIDENTIFIED_COMPANY_NAME = 'Empresa sin identificar';
export const UNIDENTIFIED_STORE_NAME = 'Sucursal sin identificar';

export interface TerminalBindingRecord {
  id: string;
  erpTerminalId: string;
  tenantId?: string;
  companyId?: string;
  companyName: string;
  storeId?: string;
  storeName: string;
  name: string;
  terminalCode?: string;
  bindingStatus?: string;
  occupied: boolean;
  canReauthorize: boolean;
  currentDeviceId?: string;
  config: Record<string, any>;
  [key: string]: any;
}

export interface TerminalStoreGroup<T extends TerminalBindingRecord> {
  key: string;
  id?: string;
  name: string;
  terminals: T[];
}

export interface TerminalCompanyGroup<T extends TerminalBindingRecord> {
  key: string;
  id?: string;
  name: string;
  stores: TerminalStoreGroup<T>[];
}

const cleanText = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
);

const readBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return undefined;
};

const firstText = (...values: unknown[]): string => {
  for (const value of values) {
    const normalized = cleanText(value);
    if (normalized && normalized.toLowerCase() !== 'null' && normalized.toLowerCase() !== 'undefined') {
      return normalized;
    }
  }
  return '';
};

export const normalizeTerminalBindingRecord = (
  raw: Record<string, any>,
  options: { deviceId?: string; tenantId?: string } = {},
): TerminalBindingRecord => {
  const config = raw?.config && typeof raw.config === 'object' ? raw.config : {};
  const id = firstText(raw.erpTerminalId, raw.erp_terminal_id, raw.id, raw.terminal_id);
  const currentDeviceId = firstText(raw.currentDeviceId, raw.current_device_id, raw.device_id) || undefined;
  const bindingStatus = firstText(raw.binding_status, raw.bindingStatus).toUpperCase() || undefined;
  const explicitOccupied = readBoolean(raw.is_occupied ?? raw.occupied);
  const occupied = explicitOccupied ?? (
    bindingStatus === 'OCCUPIED'
    || Boolean(currentDeviceId && currentDeviceId !== cleanText(options.deviceId))
  );
  const explicitCanReauthorize = readBoolean(raw.can_reauthorize ?? raw.canReauthorize);

  return {
    ...raw,
    id,
    erpTerminalId: firstText(raw.erpTerminalId, raw.erp_terminal_id, id),
    tenantId: firstText(raw.tenant_id, raw.tenantId, options.tenantId) || undefined,
    companyId: firstText(raw.company_id, raw.companyId) || undefined,
    companyName: firstText(raw.company_name, raw.companyName) || UNIDENTIFIED_COMPANY_NAME,
    storeId: firstText(raw.store_id, raw.storeId) || undefined,
    storeName: firstText(raw.store_name, raw.storeName, raw.sucursal, raw.location) || UNIDENTIFIED_STORE_NAME,
    name: firstText(raw.terminal_name, raw.terminalName, raw.nombre, raw.name, id),
    terminalCode: firstText(raw.terminal_code, raw.terminalCode, config.stationNumber) || undefined,
    bindingStatus,
    occupied,
    canReauthorize: explicitCanReauthorize ?? occupied,
    currentDeviceId,
    config,
  };
};

export const groupTerminalBindingRecords = <T extends TerminalBindingRecord>(
  terminals: T[],
): TerminalCompanyGroup<T>[] => {
  const companies = new Map<string, TerminalCompanyGroup<T> & { storeMap: Map<string, TerminalStoreGroup<T>> }>();

  terminals.forEach((terminal, index) => {
    const companyKey = terminal.companyId ? `company:${terminal.companyId}` : 'company:unidentified';
    let company = companies.get(companyKey);
    if (!company) {
      company = {
        key: companyKey,
        id: terminal.companyId,
        name: terminal.companyName,
        stores: [],
        storeMap: new Map(),
      };
      companies.set(companyKey, company);
    }

    // A legacy response without store_id gets an identity-based group. This avoids
    // using a repeated display name as an authoritative grouping key.
    const storeKey = terminal.storeId
      ? `${companyKey}:store:${terminal.storeId}`
      : `${companyKey}:legacy-store:${terminal.id || index}`;
    let store = company.storeMap.get(storeKey);
    if (!store) {
      store = { key: storeKey, id: terminal.storeId, name: terminal.storeName, terminals: [] };
      company.storeMap.set(storeKey, store);
      company.stores.push(store);
    }
    store.terminals.push(terminal);
  });

  return Array.from(companies.values()).map(({ storeMap: _storeMap, ...company }) => company);
};

export const formatTerminalBindingLabel = (terminal: Pick<TerminalBindingRecord, 'name' | 'terminalCode'>): string => (
  [cleanText(terminal.name), cleanText(terminal.terminalCode)].filter(Boolean).join(' · ')
);

export const formatTerminalBindingStatus = (terminal: Pick<TerminalBindingRecord, 'bindingStatus' | 'occupied'>): string => {
  if (terminal.bindingStatus === 'AVAILABLE') return 'Disponible';
  if (terminal.bindingStatus === 'OCCUPIED') return 'Vinculada';
  if (terminal.bindingStatus) {
    const readable = terminal.bindingStatus.toLowerCase().replace(/[_-]+/g, ' ');
    return readable.charAt(0).toUpperCase() + readable.slice(1);
  }
  return terminal.occupied ? 'Vinculada' : 'Disponible';
};

export const isTerminalBindingSelectable = (
  terminal: Pick<TerminalBindingRecord, 'occupied' | 'canReauthorize'>,
): boolean => !terminal.occupied || terminal.canReauthorize;

export const buildTerminalBindIdentityPayload = (
  terminal: Pick<TerminalBindingRecord, 'id'>,
  deviceId: string,
  deviceName?: string,
): { terminal_id: string; new_device_id: string; device_name?: string } => ({
  terminal_id: terminal.id,
  new_device_id: deviceId,
  ...(cleanText(deviceName) ? { device_name: cleanText(deviceName) } : {}),
});
