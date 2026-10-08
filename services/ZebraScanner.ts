import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { zebraWeightKg, type ZebraWeightResponse } from '../utils/zebraWeight';

interface ZebraScannerPlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
  readWeight(): Promise<ZebraWeightResponse>;
  addListener(event: 'barcode', callback: (event: { barcode: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'connection', callback: (event: { connected: boolean }) => void): Promise<PluginListenerHandle>;
}

const native = registerPlugin<ZebraScannerPlugin>('ZebraScanner');
const settingKey = 'clicpos.zebra.mp7000.enabled';
export const zebraSettingEvent = 'clicpos:zebra-setting';
let settingGeneration = 0;

export function isZebraEnabled(): boolean {
  try { return Capacitor.getPlatform() === 'android' && localStorage.getItem(settingKey) === 'true'; }
  catch { return false; }
}

export async function startZebra(): Promise<void> {
  if (!isZebraEnabled()) return;
  await native.start();
}

export async function setZebraEnabled(enabled: boolean): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') throw new Error('Disponible en el APK Android');
  localStorage.setItem(settingKey, String(enabled));
  settingGeneration++;
  window.dispatchEvent(new Event(zebraSettingEvent));
  if (enabled) await startZebra();
  else await native.stop();
}

export async function listenZebraBarcode(callback: (barcode: string) => void): Promise<PluginListenerHandle> {
  return native.addListener('barcode', event => {
    if (isZebraEnabled() && event.barcode) callback(event.barcode);
  });
}

export function listenZebraConnection(callback: (connected: boolean) => void): Promise<PluginListenerHandle> {
  return native.addListener('connection', event => callback(event.connected));
}

export async function readZebraWeight(): Promise<number> {
  if (!isZebraEnabled()) throw new Error('Activa Zebra MP7000 en Ajustes → Hardware → Balanzas');
  const generation = settingGeneration;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      (async () => { await startZebra(); return native.readWeight(); })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('La báscula no respondió. Revisa USB y vuelve a leer.')), 8000);
      }),
    ]);
    if (generation !== settingGeneration || !isZebraEnabled()) throw new Error('Báscula desactivada durante la lectura');
    return zebraWeightKg(response);
  } finally { if (timer) clearTimeout(timer); }
}
