import { DeviceRole, type BusinessConfig, type TerminalConfig } from '../types';
import { resolveDeviceRoleValue } from './deviceRoleHelpers';

const asRecord = (value: unknown): Record<string, any> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
);

const compactId = (value: unknown): string => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const terminalReferences = (terminal: Record<string, any>): string[] => {
  const config = asRecord(terminal.config);
  const erpBinding = asRecord(config.erpBinding);
  return [
    terminal.id,
    terminal.terminalId,
    terminal.terminal_id,
    terminal.erpTerminalId,
    terminal.erp_terminal_id,
    config.terminalId,
    config.terminal_id,
    config.erpTerminalId,
    config.erp_terminal_id,
    erpBinding.terminalId,
    erpBinding.terminal_id,
  ].map(compactId).filter(Boolean);
};

const runtimeAuthTokens = (config: BusinessConfig | Record<string, any>): string[] => {
  const source = asRecord(config);
  const metadata = asRecord(source.metadata);
  const syncAuth = asRecord(metadata.syncAuth);
  return [
    metadata.deviceToken,
    metadata.device_token,
    syncAuth.deviceToken,
    syncAuth.device_token,
  ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
};

export const resolveServingTerminalFromConfig = (
  config: BusinessConfig | Record<string, any>,
): Record<string, any> | null => {
  const source = asRecord(config);
  const terminals = Array.isArray(source.terminals) ? source.terminals.map(asRecord) : [];
  const runtime = asRecord(source.runtime);
  const explicitRuntimeTerminalId = compactId(
    source.runtimeTerminalId
    || source.runtime_terminal_id
    || runtime.terminalId
    || runtime.terminal_id
  );

  if (explicitRuntimeTerminalId) {
    const explicitMatch = terminals.find(terminal => terminalReferences(terminal).includes(explicitRuntimeTerminalId));
    if (explicitMatch) return explicitMatch;
  }

  // Los tokens ERP llevan el UUID canónico de la terminal que ejecuta este APK.
  // Esto distingue una Master real de un KDS que conserva una copia de su config.
  const tokens = runtimeAuthTokens(source);
  if (tokens.length === 0) return null;
  return terminals.find(terminal => (
    terminalReferences(terminal).some(reference => {
      // El formato actual del token incluye los primeros 24 caracteres hex del UUID.
      const tokenReference = reference.length >= 24 ? reference.slice(0, 24) : reference;
      return tokenReference.length >= 12 && tokens.some(token => token.includes(tokenReference));
    })
  )) || null;
};

export const resolveTerminalRuntimeRole = (
  terminal?: { config?: TerminalConfig } | Record<string, any> | null,
): DeviceRole | undefined => {
  const source = asRecord(terminal);
  const config = asRecord(source.config);
  return resolveDeviceRoleValue([
    source,
    config,
    source.terminalType,
    source.terminal_type,
    source.deviceType,
    source.device_type,
    config.erpBinding,
    config.deviceRole,
    config.role,
    config.roleCode,
    config.role_code,
    config.terminalType,
    config.terminal_type,
    config.deviceType,
    config.device_type,
  ], undefined);
};

export const isEligibleOperationalMasterTerminal = (
  terminal?: { config?: TerminalConfig } | Record<string, any> | null,
): boolean => {
  if (!terminal) return false;
  const source = asRecord(terminal);
  const config = asRecord(source.config);
  const role = resolveTerminalRuntimeRole(source);
  if (role && role !== DeviceRole.STANDARD_POS) return false;
  if (config.isPrimaryNode === false) return false;
  if (config.governedByMaster === true) return false;
  return true;
};

export const isEligibleOperationalMasterConfig = (
  config: BusinessConfig | Record<string, any>,
): boolean => {
  const servingTerminal = resolveServingTerminalFromConfig(config);
  // Compatibilidad con servidores antiguos sin identidad runtime resoluble.
  return servingTerminal ? isEligibleOperationalMasterTerminal(servingTerminal) : true;
};
