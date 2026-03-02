import { nativePrintBridge } from './NativePrintBridge';

const resolveCapacitorPlatform = (): string => {
  const capacitor = (window as any)?.Capacitor;
  if (!capacitor) return '';

  try {
    if (typeof capacitor.getPlatform === 'function') {
      return String(capacitor.getPlatform() || '').toLowerCase();
    }
  } catch (error) {
    console.warn('Unable to resolve Capacitor platform:', error);
  }

  return String(capacitor.platform || '').toLowerCase();
};

export const isAndroidNativePrintRuntime = (): boolean => {
  if (nativePrintBridge.getRuntime() === 'ANDROID') {
    return true;
  }

  return resolveCapacitorPlatform() === 'android';
};

export const shouldSuppressBrowserPrintFallback = (): boolean => {
  return isAndroidNativePrintRuntime();
};
