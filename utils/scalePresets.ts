import type { ScaleDevice } from '../types';

interface SerialScalePreset {
  id: string; brand: string; model: string; baud: number; data: number;
  parity: string; protocol: string; icon: string; driver?: 'SERIAL';
}
interface ZebraScalePreset {
  id: 'ZEBRA_MP7000'; brand: string; model: string; icon: string; driver: 'ZEBRA_USB';
}
export type ScalePreset = SerialScalePreset | ZebraScalePreset;
export const SCALE_PRESETS: ScalePreset[] = [
  { id: 'ZEBRA_MP7000', brand: 'Zebra', model: 'MP7000 · USB SNAPI', icon: '🔌', driver: 'ZEBRA_USB' },
  { id: 'CAS_PD2', brand: 'CAS', model: 'PD-II / ER', baud: 9600, data: 7, parity: 'Even', protocol: 'NCI', icon: '⚖️' },
  { id: 'TOLEDO_8217', brand: 'Toledo', model: 'Mettler 8217', baud: 9600, data: 7, parity: 'Even', protocol: 'Standard', icon: '⚖️' },
  { id: 'DIBAL_G310', brand: 'Dibal', model: 'G-310 / G-325', baud: 9600, data: 8, parity: 'None', protocol: 'Protocolo T', icon: '⚖️' },
  { id: 'BIZERBA', brand: 'Bizerba', model: 'SC-II / BC-II', baud: 9600, data: 8, parity: 'None', protocol: 'Dialog 06', icon: '⚖️' },
  { id: 'ISHIDA', brand: 'Ishida', model: 'Uni-7 / Uni-5', baud: 9600, data: 8, parity: 'None', protocol: 'Standard', icon: '⚖️' },
  { id: 'MANUAL', brand: 'Genérica', model: 'Configuración Manual', baud: 9600, data: 8, parity: 'None', protocol: 'NCI', icon: '⚙️' },
];
export const ZEBRA_USB_CONFIG = { connection: 'USB', port: 'USB_AUTO', protocol: 'SNAPI' } as const;

/** Selection edits a draft only. USB never becomes a shared ScaleDevice config.
 * Keep the serial values intact so switching back cannot leave a USB port behind. */
export function applyScalePreset(scale: ScaleDevice, preset: ScalePreset) {
  if (preset.driver === 'ZEBRA_USB') return { scale, driver: 'ZEBRA_USB' as const, usb: ZEBRA_USB_CONFIG };
  return {
    driver: 'SERIAL' as const,
    scale: {
      ...scale,
      name: preset.id === 'MANUAL' ? scale.name : `${preset.brand} ${preset.model}`,
      directConfig: {
        port: scale.directConfig?.port || 'COM1', baudRate: preset.baud,
        dataBits: preset.data, protocol: preset.protocol,
      },
    },
  };
}

export interface LocalZebraScope { platform: string; selectedTerminalId?: string | null; localTerminalId?: string | null }
export function canConfigureLocalZebra(scope: LocalZebraScope): boolean {
  return scope.platform === 'android' && Boolean(scope.localTerminalId?.trim()) &&
    scope.localTerminalId === scope.selectedTerminalId;
}
/** The sole commit action is explicit and local; selecting/cancelling a preset
 * has no dependency on this setter and never changes shared scales. */
export async function applyLocalZebraSetting(
  scope: LocalZebraScope, enabled: boolean, setEnabled: (enabled: boolean) => Promise<void>,
): Promise<void> {
  if (!canConfigureLocalZebra(scope)) throw new Error('Zebra USB solo se configura en el APK Android de esta terminal activa.');
  await setEnabled(enabled);
}
