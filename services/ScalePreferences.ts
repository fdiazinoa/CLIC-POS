import type { BusinessConfig, ScaleDevice, ScaleWeightUnit } from '../types';
import { readTerminalCredentialsSync } from './sync/TerminalCredentialStore';
import { resolveLocalDeviceId } from '../utils/deviceRevocation';
import { isZebraEnabled, zebraSettingEvent } from './ZebraScanner';

export type ResolvedScale = { id: string; name: string; displayUnit: ScaleWeightUnit; driver: 'ZEBRA' | 'MANUAL' };
export const LOCAL_ZEBRA_ID = 'local-zebra-mp7000';
export const scalePreferencesEvent = 'clic:scale-preferences-changed';
export const scaleScopeKey = (tenantId: string, companyId: string, terminalId: string, deviceId: string): string => {
  if (!tenantId || !companyId || !terminalId || !deviceId) throw new Error('Falta identidad de empresa, terminal o dispositivo para configurar la balanza.');
  return `clic_scale_units:${JSON.stringify([tenantId, companyId, terminalId, deviceId])}`;
};
export function currentScaleScope(terminalId: string): string {
  const credentials = readTerminalCredentialsSync();
  return scaleScopeKey(credentials.erpTenantId || credentials.tenantId || '', credentials.companyId || '', terminalId, resolveLocalDeviceId());
}
type Preference = { zebraUnit?: ScaleWeightUnit; defaultScaleId?: string };
export function readLocalScalePreference(terminalId: string): Preference {
  let key: string;
  try { key = currentScaleScope(terminalId); } catch { return {}; }
  const raw = localStorage.getItem(key);
  if (!raw) return {};
  let value: Preference;
  try { value = JSON.parse(raw); } catch { throw new Error('Configuración de balanza dañada; vuelve a guardarla.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (value.zebraUnit !== undefined && value.zebraUnit !== 'kg' && value.zebraUnit !== 'lb')
    || (value.defaultScaleId !== undefined && typeof value.defaultScaleId !== 'string')) {
    throw new Error('Configuración de unidad de balanza inválida; vuelve a guardarla.');
  }
  return value;
}
export function saveLocalScalePreference(terminalId: string, preference: Preference): void {
  if ((preference.zebraUnit !== undefined && preference.zebraUnit !== 'kg' && preference.zebraUnit !== 'lb')
    || (preference.defaultScaleId !== undefined && typeof preference.defaultScaleId !== 'string')) throw new Error('Preferencia de balanza inválida.');
  const credentials = readTerminalCredentialsSync();
  if ((credentials.erpTerminalId || credentials.terminalId) !== terminalId) throw new Error('Solo puedes configurar la balanza local de esta terminal.');
  const key = currentScaleScope(terminalId);
  const value = JSON.stringify(preference);
  const previous = localStorage.getItem(key);
  try {
    localStorage.setItem(key, value);
    if (localStorage.getItem(key) !== value || currentScaleScope(terminalId) !== key) throw new Error('No se pudo verificar la configuración de balanza.');
  } catch (error) {
    try { if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous); }
    catch { throw new Error('No se pudo guardar ni restaurar la preferencia de balanza; verifica la configuración.'); }
    throw error;
  }
  window.dispatchEvent(new Event(scalePreferencesEvent));
}
export function resolveSaleScales(config: BusinessConfig, terminalId: string): { scales: ResolvedScale[]; defaultScaleId?: string; scope: string } {
  const hardware = config.terminals?.find(row => row.id === terminalId)?.config.hardware;
  const local = readLocalScalePreference(terminalId);
  const credentials = readTerminalCredentialsSync();
  const localTerminalId = credentials.erpTerminalId || credentials.terminalId;
  const scales: ResolvedScale[] = (hardware?.scales || config.scales || [])
    .filter((scale: ScaleDevice) => scale.isEnabled && scale.technology === 'DIRECT' && scale.id !== LOCAL_ZEBRA_ID)
    .map(scale => {
      if (scale.displayUnit !== undefined && scale.displayUnit !== 'kg' && scale.displayUnit !== 'lb') throw new Error('Unidad de balanza inválida.');
      return { id: scale.id, name: scale.name, displayUnit: scale.displayUnit || 'kg', driver: 'MANUAL' as const };
    });
  if (terminalId === localTerminalId && isZebraEnabled()) scales.push({ id: LOCAL_ZEBRA_ID, name: 'Zebra MP7000', displayUnit: local.zebraUnit || 'kg', driver: 'ZEBRA' });
  if (!scales.length) scales.push({ id: 'manual', name: 'Entrada manual', displayUnit: 'kg', driver: 'MANUAL' });
  const preferred = local.defaultScaleId || hardware?.defaultScaleId;
  const defaultScaleId = scales.some(scale => scale.id === preferred) ? preferred : !preferred && scales.length === 1 ? scales[0].id : undefined;
  let scope = '';
  try { scope = currentScaleScope(terminalId); } catch { scope = terminalId; }
  return { scales, defaultScaleId, scope };
}
export const scaleChangeEvents = [scalePreferencesEvent, zebraSettingEvent];

export function assertCurrentScaleContext(captured: ReturnType<typeof resolveSaleScales>, config: BusinessConfig, terminalId: string): void {
  if (JSON.stringify(resolveSaleScales(config, terminalId)) !== JSON.stringify(captured)) {
    throw new Error('La configuración o identidad de la balanza cambió. Selecciona el artículo nuevamente.');
  }
}
