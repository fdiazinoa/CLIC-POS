import {
  DeviceFormFactor,
  DeviceOrientation,
  DeviceProfile,
  DeviceRole,
} from '../types';

type UnknownRecord = Record<string, unknown>;

const asObject = (value: unknown): UnknownRecord => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
);

const normalizeKey = (value: unknown): string => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

export const resolveDeviceFormFactor = (
  value: unknown,
  fallback: DeviceFormFactor = DeviceFormFactor.DESKTOP_POS,
): DeviceFormFactor => {
  const normalized = normalizeKey(value);
  if (['TABLET', 'TABLETA', 'ANDROID_TABLET', 'IPAD'].includes(normalized)) {
    return DeviceFormFactor.TABLET;
  }
  if (['HANDHELD', 'MOBILE', 'PHONE', 'SMARTPHONE', 'PDA'].includes(normalized)) {
    return DeviceFormFactor.HANDHELD;
  }
  if (['KIOSK', 'KIOSCO', 'SELF_CHECKOUT'].includes(normalized)) {
    return DeviceFormFactor.KIOSK;
  }
  if (['DESKTOP_POS', 'DESKTOP', 'POS', 'FIXED_POS', 'POS_NORMAL', 'TERMINAL_POS'].includes(normalized)) {
    return DeviceFormFactor.DESKTOP_POS;
  }
  return fallback;
};

export const resolveDeviceOrientation = (
  value: unknown,
  fallback: DeviceOrientation = DeviceOrientation.AUTO,
): DeviceOrientation => {
  const normalized = normalizeKey(value);
  if (['PORTRAIT', 'VERTICAL'].includes(normalized)) return DeviceOrientation.PORTRAIT;
  if (['LANDSCAPE', 'HORIZONTAL'].includes(normalized)) return DeviceOrientation.LANDSCAPE;
  if (['AUTO', 'AUTOMATIC', 'AUTOMATICA', 'AUTOMATICO'].includes(normalized)) return DeviceOrientation.AUTO;
  return fallback;
};

export const getDefaultDeviceProfile = (role: DeviceRole = DeviceRole.STANDARD_POS): DeviceProfile => {
  if (role === DeviceRole.HANDHELD_INVENTORY) {
    return {
      formFactor: DeviceFormFactor.HANDHELD,
      orientation: DeviceOrientation.PORTRAIT,
      touchOptimized: true,
    };
  }
  if (role === DeviceRole.SELF_CHECKOUT || role === DeviceRole.PRICE_CHECKER) {
    return {
      formFactor: DeviceFormFactor.KIOSK,
      orientation: DeviceOrientation.AUTO,
      touchOptimized: true,
    };
  }
  return {
    formFactor: DeviceFormFactor.DESKTOP_POS,
    orientation: DeviceOrientation.AUTO,
    touchOptimized: role === DeviceRole.ORDER_TAKER,
  };
};

const readProfileObject = (candidate: unknown): UnknownRecord => {
  const source = asObject(candidate);
  const nested = asObject(source.deviceProfile ?? source.device_profile);
  return Object.keys(nested).length > 0 ? nested : source;
};

export const resolveDeviceProfile = (
  candidates: unknown[],
  role: DeviceRole = DeviceRole.STANDARD_POS,
): DeviceProfile => {
  const defaults = getDefaultDeviceProfile(role);

  for (const candidate of candidates) {
    const profile = readProfileObject(candidate);
    if (Object.keys(profile).length === 0) continue;

    const rawFormFactor = profile.formFactor
      ?? profile.form_factor
      ?? profile.deviceFormFactor
      ?? profile.device_form_factor;
    const rawOrientation = profile.orientation
      ?? profile.deviceOrientation
      ?? profile.device_orientation;
    const rawTouchOptimized = profile.touchOptimized ?? profile.touch_optimized;
    const hasExplicitValue = rawFormFactor !== undefined
      || rawOrientation !== undefined
      || rawTouchOptimized !== undefined;
    if (!hasExplicitValue) continue;

    return {
      formFactor: resolveDeviceFormFactor(rawFormFactor, defaults.formFactor),
      orientation: resolveDeviceOrientation(rawOrientation, defaults.orientation),
      touchOptimized: typeof rawTouchOptimized === 'boolean'
        ? rawTouchOptimized
        : defaults.touchOptimized,
    };
  }

  return defaults;
};

export const resolveTerminalDeviceProfile = (
  terminal: unknown,
  role: DeviceRole = DeviceRole.STANDARD_POS,
): DeviceProfile => {
  const source = asObject(terminal);
  const config = asObject(source.config);
  const metadata = asObject(source.metadata ?? config.metadata);
  const terminalConfig = asObject(source.terminal_config ?? source.terminalConfig);
  const resolved = asObject(terminalConfig.resolved);
  const identity = asObject(resolved.identity);
  const resolvedTerminal = asObject(resolved.terminal);

  return resolveDeviceProfile([
    source.deviceProfile,
    source.device_profile,
    config.deviceProfile,
    config.device_profile,
    metadata.deviceProfile,
    metadata.device_profile,
    identity.deviceProfile,
    identity.device_profile,
    resolvedTerminal.deviceProfile,
    resolvedTerminal.device_profile,
    resolved.deviceProfile,
    resolved.device_profile,
  ], role);
};

export const toDeviceProfileContract = (profile: DeviceProfile) => ({
  deviceProfile: profile,
  device_profile: {
    form_factor: profile.formFactor,
    orientation: profile.orientation,
    touch_optimized: profile.touchOptimized,
  },
});
