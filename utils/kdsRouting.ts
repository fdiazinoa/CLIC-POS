import { BusinessConfig, DeviceRole, TerminalConfigSnapshot } from '../types';
import { resolveDeviceRoleValue } from './deviceRoleHelpers';

export interface ProductionAreaKdsConfig {
  target_terminal_id?: string;
  kds_host?: string;
  kds_port?: string | number;
  kds_delivery_mode?: 'LAN' | 'WEB' | string;
}

export interface KdsTerminalTarget {
  id: string;
  label: string;
  host?: string;
  port?: string;
  role?: DeviceRole;
  source: 'terminal' | 'snapshot';
  terminal?: any;
  snapshot?: TerminalConfigSnapshot;
}

const DEFAULT_KDS_PORT = '8001';

const asObject = <T extends Record<string, any> = Record<string, any>>(value: unknown): T => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as T : {} as T
);

const asString = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');

const uniqueStrings = (values: unknown[]): string[] => Array.from(
  new Set(values.map(asString).filter(Boolean))
);

const getDeepValue = (source: unknown, path: string): unknown => {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[segment];
  }, source);
};

const normalizeHost = (value: unknown): string => {
  const raw = asString(value);
  if (!raw) return '';

  const withoutProtocol = raw.replace(/^https?:\/\//i, '').replace(/^wss?:\/\//i, '');
  const host = withoutProtocol.split('/')[0]?.trim() || '';
  return host.replace(/\/+$/g, '');
};

const isLoopbackHost = (host: string): boolean => {
  const normalized = host.replace(/:\d+$/, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
};

const firstNetworkHost = (...sources: unknown[]): string => {
  const rawValues = sources.flatMap((source) => Array.isArray(source) ? source : [source]);
  const hosts = uniqueStrings(rawValues).map(normalizeHost).filter(Boolean);
  return hosts.find((host) => !isLoopbackHost(host)) || hosts[0] || '';
};

const firstPort = (...sources: unknown[]): string => {
  const port = uniqueStrings(sources).find((value) => /^\d{2,5}$/.test(value));
  return port || DEFAULT_KDS_PORT;
};

const snapshotIdentityValues = (snapshot?: TerminalConfigSnapshot) => {
  const resolved = asObject(snapshot?.resolved);
  return {
    resolved,
    identity: asObject(resolved.identity),
    terminal: asObject(resolved.terminal),
    config: asObject(snapshot?.config),
  };
};

const resolveTargetRole = (terminal: any, snapshot?: TerminalConfigSnapshot): DeviceRole | undefined => {
  const terminalConfig = asObject(terminal?.config);
  const { resolved, identity, terminal: resolvedTerminal, config: snapshotConfig } = snapshotIdentityValues(snapshot);

  return resolveDeviceRoleValue([
    terminalConfig.deviceRole,
    terminalConfig.deviceRole?.role,
    terminalConfig.device_role,
    terminalConfig.device_role_code,
    terminalConfig.role_code,
    terminalConfig.role,
    terminalConfig.erpBinding?.role,
    terminal?.deviceRole,
    terminal?.device_role,
    terminal?.role_code,
    terminal?.device_role_code,
    terminal?.role,
    (snapshot as any)?.deviceRole,
    (snapshot as any)?.device_role,
    (snapshot as any)?.role_code,
    (snapshot as any)?.device_role_code,
    snapshot?.role,
    snapshotConfig.deviceRole,
    snapshotConfig.device_role,
    snapshotConfig.role_code,
    snapshotConfig.device_role_code,
    snapshotConfig.role,
    resolved.deviceRole,
    resolved.device_role,
    resolved.role_code,
    resolved.device_role_code,
    resolved.role,
    identity.deviceRole,
    identity.device_role,
    identity.role_code,
    identity.device_role_code,
    identity.role,
    resolvedTerminal.deviceRole,
    resolvedTerminal.device_role,
    resolvedTerminal.role_code,
    resolvedTerminal.device_role_code,
    resolvedTerminal.role,
  ]);
};

const resolveTargetIds = (terminal: any, snapshot?: TerminalConfigSnapshot, fallbackId?: string): string[] => {
  const terminalConfig = asObject(terminal?.config);
  const { identity, terminal: resolvedTerminal, config: snapshotConfig } = snapshotIdentityValues(snapshot);

  return uniqueStrings([
    terminal?.id,
    terminalConfig.erpTerminalId,
    terminalConfig.erpBinding?.terminalId,
    terminalConfig.currentDeviceId,
    snapshot?.terminal_id,
    snapshotConfig.terminal_id,
    identity.terminal_id,
    resolvedTerminal.terminal_id,
    identity.device_id,
    fallbackId,
  ]);
};

const resolveTargetLabel = (terminal: any, snapshot?: TerminalConfigSnapshot, fallbackId?: string): string => {
  const terminalConfig = asObject(terminal?.config);
  const { identity, terminal: resolvedTerminal, config: snapshotConfig } = snapshotIdentityValues(snapshot);

  return uniqueStrings([
    terminalConfig.terminalName,
    terminalConfig.erpBinding?.terminalName,
    terminal?.name,
    terminal?.nombre,
    snapshot?.terminal_name,
    snapshotConfig.terminal_name,
    identity.terminal_name,
    resolvedTerminal.terminal_name,
    fallbackId,
  ])[0] || 'Pantalla KDS';
};

export const resolveKdsTerminalNetwork = (terminal: any, snapshot?: TerminalConfigSnapshot): { host?: string; port: string } => {
  const terminalConfig = asObject(terminal?.config);
  const { resolved, identity, terminal: resolvedTerminal, config: snapshotConfig } = snapshotIdentityValues(snapshot);
  const metadata = asObject(terminalConfig.metadata || (terminal as any)?.metadata || snapshotConfig.metadata || (snapshot as any)?.metadata);
  const lan = asObject(terminalConfig.lan || snapshotConfig.lan || metadata.lan || (snapshot as any)?.lan);

  const host = firstNetworkHost(
    terminalConfig.kds_host,
    terminalConfig.kdsHost,
    terminalConfig.ipAddress,
    terminalConfig.ip_address,
    terminalConfig.localIp,
    terminalConfig.local_ip,
    terminalConfig.host,
    terminalConfig.hostname,
    terminal?.ipAddress,
    terminal?.ip_address,
    terminal?.localIp,
    terminal?.local_ip,
    terminal?.host,
    terminal?.hostname,
    snapshotConfig.kds_host,
    snapshotConfig.kdsHost,
    snapshotConfig.ipAddress,
    snapshotConfig.ip_address,
    snapshotConfig.localIp,
    snapshotConfig.local_ip,
    snapshotConfig.host,
    snapshotConfig.hostname,
    metadata.kds_host,
    metadata.kdsHost,
    metadata.ipAddress,
    metadata.ip_address,
    metadata.localIp,
    metadata.local_ip,
    metadata.localIps,
    metadata.local_ips,
    metadata.host,
    metadata.hostname,
    lan.kds_host,
    lan.kdsHost,
    lan.ipAddress,
    lan.ip_address,
    lan.localIp,
    lan.local_ip,
    lan.localIps,
    lan.local_ips,
    lan.host,
    lan.hostname,
    identity.ipAddress,
    identity.ip_address,
    identity.localIp,
    identity.local_ip,
    identity.localIps,
    identity.local_ips,
    resolvedTerminal.ipAddress,
    resolvedTerminal.ip_address,
    resolvedTerminal.localIp,
    resolvedTerminal.local_ip,
    resolvedTerminal.localIps,
    resolvedTerminal.local_ips,
    resolved.ipAddress,
    resolved.ip_address,
    (snapshot as any)?.ipAddress,
    (snapshot as any)?.ip_address,
    (snapshot as any)?.localIp,
    (snapshot as any)?.local_ip,
    (snapshot as any)?.localIps,
    (snapshot as any)?.local_ips
  );

  const port = firstPort(
    terminalConfig.kds_port,
    terminalConfig.kdsPort,
    snapshotConfig.kds_port,
    snapshotConfig.kdsPort,
    metadata.kds_port,
    metadata.kdsPort,
    lan.kds_port,
    lan.kdsPort,
    lan.port,
    getDeepValue(snapshot, 'resolved.terminal.kds_port'),
    getDeepValue(snapshot, 'resolved.identity.kds_port')
  );

  return { host: host || undefined, port };
};

export const getKdsTerminalTargets = (config: BusinessConfig, terminals: any[] = config.terminals || []): KdsTerminalTarget[] => {
  const snapshots = asObject<Record<string, TerminalConfigSnapshot>>(config.terminalSnapshots);
  const byId = new Map<string, KdsTerminalTarget>();

  const addTarget = (candidate: { terminal?: any; snapshot?: TerminalConfigSnapshot; fallbackId?: string; source: KdsTerminalTarget['source'] }) => {
    const role = resolveTargetRole(candidate.terminal, candidate.snapshot);
    if (role !== DeviceRole.KITCHEN_DISPLAY) return;

    const ids = resolveTargetIds(candidate.terminal, candidate.snapshot, candidate.fallbackId);
    const id = ids[0];
    if (!id) return;

    if (ids.some((candidateId) => byId.has(candidateId))) return;

    const network = resolveKdsTerminalNetwork(candidate.terminal, candidate.snapshot);
    const target: KdsTerminalTarget = {
      id,
      label: resolveTargetLabel(candidate.terminal, candidate.snapshot, id),
      host: network.host,
      port: network.port,
      role,
      source: candidate.source,
      terminal: candidate.terminal,
      snapshot: candidate.snapshot,
    };

    ids.forEach((candidateId) => byId.set(candidateId, target));
  };

  (terminals || []).forEach((terminal) => {
    const terminalConfig = asObject(terminal?.config);
    const erpTerminalId = asString(terminalConfig.erpTerminalId || terminalConfig.erpBinding?.terminalId);
    const snapshot = snapshots[terminal?.id] || (erpTerminalId ? snapshots[erpTerminalId] : undefined) || terminalConfig.erpSnapshot;
    addTarget({ terminal, snapshot, fallbackId: terminal?.id || erpTerminalId, source: 'terminal' });
  });

  Object.entries(snapshots).forEach(([id, snapshot]) => {
    addTarget({ snapshot, fallbackId: id, source: 'snapshot' });
  });

  return Array.from(new Set(byId.values())).sort((a, b) => a.label.localeCompare(b.label));
};

export const buildKdsBaseUrl = (area: ProductionAreaKdsConfig): string | null => {
  const rawHost = normalizeHost(area.kds_host);
  if (!rawHost) return null;

  if (/^https?:\/\//i.test(String(area.kds_host || ''))) {
    return String(area.kds_host).trim().replace(/\/+$/, '');
  }

  const port = firstPort(area.kds_port);
  const hasExplicitPort = /:\d+$/.test(rawHost);
  return `http://${rawHost}${hasExplicitPort ? '' : `:${port}`}`;
};

export const resolveKdsBaseUrl = (
  area: ProductionAreaKdsConfig,
  config: BusinessConfig,
  terminals: any[] = config.terminals || []
): string | null => {
  const targetId = asString(area.target_terminal_id);
  if (targetId) {
    const target = getKdsTerminalTargets(config, terminals).find((candidate) => candidate.id === targetId);
    if (target?.host) {
      return buildKdsBaseUrl({ kds_host: target.host, kds_port: target.port || DEFAULT_KDS_PORT });
    }
  }

  return buildKdsBaseUrl(area);
};
