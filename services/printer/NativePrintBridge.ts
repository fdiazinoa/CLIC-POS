import { ConnectionType, FingerprintDiscoveredDevice, PrinterDevice } from '../../types';
import { PrintOutputError, notifyPrintQueued } from './PrintFeedback';
import { NativeBridgeContractStatus, NativePrinterBridge } from './NativePrintContract';

export type NativePrintRuntime = 'WEB' | 'ANDROID' | 'WINDOWS' | 'ELECTRON';
export type NativeHostProfile = 'ALL_IN_ONE' | 'HANDHELD' | 'DESKTOP' | 'UNKNOWN';

export interface NativePrintPayload {
  printerId?: string;
  printerName?: string;
  printerAddress?: string;
  connection?: string;
  role?: string;
  jobType?: string;
  referenceId?: string;
  copies?: number;
}

export interface NativeEscPosPayload extends NativePrintPayload {
  dataBase64: string;
}

export interface NativeHtmlPayload extends NativePrintPayload {
  html: string;
}

export interface FingerprintReaderTestResult {
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  success: boolean;
  captured: boolean;
  message: string;
  width?: number;
  height?: number;
  capturedLines?: number;
  encrypted?: boolean;
  contrast?: number;
}

interface NativeBridgeContext {
  runtime: NativePrintRuntime;
  bridge: NativePrinterBridge;
}

const toRuntime = (source: string): NativePrintRuntime => {
  if (source === 'ClicPOSNativePrinter') {
    const platform = String((window as any).ClicPOSNativePrinter?.platform || '').toLowerCase();
    if (platform.includes('android')) return 'ANDROID';
    if (platform.includes('windows')) return 'WINDOWS';
    if (platform.includes('electron')) return 'ELECTRON';
    return 'ELECTRON';
  }

  if (source.toLowerCase().includes('electron')) return 'ELECTRON';
  if (source.toLowerCase().includes('android')) return 'ANDROID';
  return 'WEB';
};

const resolveBridge = (): NativeBridgeContext | null => {
  const candidates: Array<{ key: string; value: NativePrinterBridge | undefined }> = [
    { key: 'ClicPOSNativePrinter', value: (window as any).ClicPOSNativePrinter },
    { key: 'electronAPI.printer', value: (window as any).electronAPI?.printer },
    { key: 'electron.printer', value: (window as any).electron?.printer },
    { key: 'AndroidPrinter', value: (window as any).AndroidPrinter }
  ];

  const found = candidates.find(candidate => candidate.value && typeof candidate.value === 'object');
  if (!found) return null;

  return {
    runtime: toRuntime(found.key),
    bridge: found.value
  };
};

const hasMethod = (bridge: NativePrinterBridge, methodNames: string[]): boolean => {
  return methodNames.some(method => typeof bridge?.[method] === 'function');
};

const runBridgeMethod = async (bridge: NativePrinterBridge, methodNames: string[], payload?: any): Promise<any> => {
  for (const method of methodNames) {
    if (typeof bridge?.[method] !== 'function') continue;
    try {
      console.log(`🔌 NativePrintBridge: Calling ${method} ...`);
      const result = await bridge[method](payload);
      console.log(`🔌 NativePrintBridge: ${method} returned`, result);
      return result;
    } catch (e) {
      console.error(`🔌 NativePrintBridge: Error in ${method}:`, e);
      throw e;
    }
  }
  return null;
};

const normalizePrintedResult = (result: any): boolean => {
  if (result === true) return true;
  if (!result) return false;

  const status = String(result?.status || '').toLowerCase();
  if (status === 'error' || result?.success === false) return false;
  if (status === 'success' || status === 'printed' || status === 'queued' || status === 'ok') return true;

  if (typeof result?.success === 'boolean') return result.success;
  if (typeof result?.printed === 'boolean') return result.printed;

  return false;
};

const sanitizeConnection = (connection?: string): ConnectionType => {
  switch ((connection || '').toUpperCase()) {
    case 'BLUETOOTH':
    case 'USB':
    case 'NETWORK':
    case 'SERIAL':
    case 'VIRTUAL':
      return connection!.toUpperCase() as ConnectionType;
    default:
      return 'BLUETOOTH';
  }
};

const normalizeDiscoveredFingerprints = (raw: any): FingerprintDiscoveredDevice[] => {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.devices)
      ? raw.devices
      : Array.isArray(raw?.fingerprints)
        ? raw.fingerprints
        : [];

  return list
    .filter((item: any) => item)
    .map((item: any, index: number): FingerprintDiscoveredDevice => ({
      id: String(item.id || item.deviceId || item.address || `fp-${index}`),
      name: String(item.name || item.deviceName || `Lector ${index + 1}`),
      connection: sanitizeConnection(item.connection || item.transport || 'USB'),
      address: String(item.address || item.deviceName || item.id || ''),
      vendorId: typeof item.vendorId === 'number' ? item.vendorId : undefined,
      productId: typeof item.productId === 'number' ? item.productId : undefined,
      status: item.status ? String(item.status) : undefined
    }));
};

const normalizeDiscoveredPrinters = (raw: any): PrinterDevice[] => {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.devices)
      ? raw.devices
      : Array.isArray(raw?.printers)
        ? raw.printers
        : [];

  return list
    .filter((item: any) => item)
    .map((item: any, index: number): PrinterDevice => ({
      id: String(item.id || item.deviceId || item.address || `native-printer-${index}`),
      name: String(item.name || item.deviceName || `Printer ${index + 1}`),
      connection: sanitizeConnection(item.connection || item.transport),
      address: item.address || item.mac || item.ip,
      status: (String(item.status || '').toUpperCase() === 'CONNECTED' ? 'CONNECTED' : 'DISCONNECTED'),
      type: (['TICKET', 'LABEL', 'KITCHEN', 'LOGISTICS'].includes(String(item.type || '').toUpperCase())
        ? String(item.type).toUpperCase()
        : 'TICKET') as PrinterDevice['type']
    }));
};

const normalizePairedPrinter = (raw: any): PrinterDevice | null => {
  if (!raw) return null;

  const source = raw.printer || raw.device || raw;
  const name = source.name || source.deviceName;
  if (!name && !source.id && !source.address) return null;

  return {
    id: String(source.id || source.deviceId || source.address || `native-paired-${Date.now()}`),
    name: String(name || 'Impresora vinculada'),
    connection: sanitizeConnection(source.connection || source.transport),
    address: source.address || source.mac || source.ip,
    status: 'CONNECTED',
    type: (['TICKET', 'LABEL', 'KITCHEN', 'LOGISTICS'].includes(String(source.type || '').toUpperCase())
      ? String(source.type).toUpperCase()
      : 'TICKET') as PrinterDevice['type']
  };
};

const normalizeConnectionHealth = (result: any): 'ONLINE' | 'OFFLINE' | 'UNKNOWN' => {
  if (!result) return 'UNKNOWN';

  const status = String(result.status || result?.message || result).toUpperCase();
  if (status.includes('ONLINE') || status.includes('READY') || status.includes('CONNECTED') || status.includes('SUCCESS')) return 'ONLINE';
  if (status.includes('OFFLINE') || status.includes('ERROR') || status.includes('DISCONNECTED') || status.includes('TIMEOUT') || status.includes('UNREACHABLE')) return 'OFFLINE';

  if (typeof result?.success === 'boolean') {
    return result.success ? 'ONLINE' : 'OFFLINE';
  }

  return 'UNKNOWN';
};

const normalizeFingerprintTestResult = (result: any): FingerprintReaderTestResult => {
  const status = normalizeConnectionHealth(result);
  return {
    status,
    success: result?.success === true,
    captured: result?.captured === true,
    message: String(result?.message || (status === 'ONLINE'
      ? 'Lector disponible.'
      : 'No se pudo completar la prueba del lector.')),
    width: typeof result?.width === 'number' ? result.width : undefined,
    height: typeof result?.height === 'number' ? result.height : undefined,
    capturedLines: typeof result?.capturedLines === 'number' ? result.capturedLines : undefined,
    encrypted: typeof result?.encrypted === 'boolean' ? result.encrypted : undefined,
    contrast: typeof result?.contrast === 'number' ? result.contrast : undefined,
  };
};

export const nativePrintBridge = {
  getRuntime(): NativePrintRuntime {
    const resolved = resolveBridge();
    return resolved?.runtime || 'WEB';
  },

  isAvailable(): boolean {
    const resolved = resolveBridge();
    if (!resolved) return false;

    return hasMethod(resolved.bridge, [
      'printEscPos',
      'printEscpos',
      'printRaw',
      'printHtml',
      'print'
    ]);
  },

  supportsPeripheralBinding(): boolean {
    const resolved = resolveBridge();
    if (!resolved) return false;

    return hasMethod(resolved.bridge, [
      'discoverPrinters',
      'scanPrinters',
      'pairPrinter',
      'connectPrinter'
    ]);
  },

  supportsFingerprintDiscovery(): boolean {
    const resolved = resolveBridge();
    if (!resolved) return false;
    return hasMethod(resolved.bridge, ['discoverFingerprintReaders', 'scanFingerprintReaders']);
  },

  getContractStatus(): NativeBridgeContractStatus {
    const resolved = resolveBridge();
    if (!resolved) {
      return {
        available: false,
        printCapable: false,
        peripheralCapable: false,
        detectedMethods: [],
        missingRecommended: ['printEscPos|printEscpos|printRaw|printHtml|print', 'discoverPrinters|scanPrinters|listPrinters']
      };
    }

    const methodCandidates = [
      'printEscPos', 'printEscpos', 'printRaw', 'printHtml', 'print',
      'discoverPrinters', 'scanPrinters', 'listPrinters',
      'discoverFingerprintReaders', 'scanFingerprintReaders', 'testFingerprintReader', 'verifyFingerprintAsync',
      'pairPrinter', 'connectPrinter', 'bindPrinter',
      'getDeviceProfile', 'getDeviceInfo'
    ] as const;

    const detectedMethods = methodCandidates.filter(method => typeof resolved.bridge?.[method] === 'function');
    const printCapable = hasMethod(resolved.bridge, ['printEscPos', 'printEscpos', 'printRaw', 'printHtml', 'print']);
    const peripheralCapable = hasMethod(resolved.bridge, ['discoverPrinters', 'scanPrinters', 'listPrinters']);

    const missingRecommended: string[] = [];
    if (!printCapable) missingRecommended.push('printEscPos|printEscpos|printRaw|printHtml|print');
    if (!peripheralCapable) missingRecommended.push('discoverPrinters|scanPrinters|listPrinters');

    return {
      available: true,
      printCapable,
      peripheralCapable,
      detectedMethods,
      missingRecommended
    };
  },

  async discoverPrinters(connection?: ConnectionType): Promise<PrinterDevice[]> {
    const resolved = resolveBridge();
    if (!resolved) return [];

    try {
      const result = await runBridgeMethod(resolved.bridge, ['discoverPrinters', 'scanPrinters', 'listPrinters'], {
        connection
      });
      return normalizeDiscoveredPrinters(result);
    } catch (error) {
      console.warn('Native printer discovery failed:', error);
      return [];
    }
  },

  async discoverFingerprintReaders(connection: ConnectionType = 'USB'): Promise<FingerprintDiscoveredDevice[]> {
    const resolved = resolveBridge();
    if (!resolved) return [];

    try {
      const result = await runBridgeMethod(resolved.bridge, ['discoverFingerprintReaders', 'scanFingerprintReaders'], {
        connection
      });
      return normalizeDiscoveredFingerprints(result);
    } catch (error) {
      console.warn('Native fingerprint discovery failed:', error);
      return [];
    }
  },

  async testFingerprintReader(payload: { address?: string; id?: string; connection?: string }): Promise<FingerprintReaderTestResult> {
    const resolved = resolveBridge();
    if (!resolved) return normalizeFingerprintTestResult(null);

    try {
      const result = await runBridgeMethod(resolved.bridge, ['testFingerprintReader'], payload);
      return normalizeFingerprintTestResult(result);
    } catch (error) {
      console.warn('Native fingerprint reader test failed:', error);
      return {
        status: 'OFFLINE', success: false, captured: false,
        message: error instanceof Error ? error.message : 'No se pudo completar la prueba del lector.',
      };
    }
  },

  async pairPrinter(printer: Partial<PrinterDevice>): Promise<PrinterDevice | null> {
    const resolved = resolveBridge();
    if (!resolved) return null;

    try {
      const result = await runBridgeMethod(resolved.bridge, ['pairPrinter', 'connectPrinter', 'bindPrinter'], printer);
      return normalizePairedPrinter(result || printer);
    } catch (error) {
      console.warn('Native printer pairing failed:', error);
      return null;
    }
  },

  async testPrinterConnection(printer: Partial<PrinterDevice>): Promise<'ONLINE' | 'OFFLINE' | 'UNKNOWN'> {
    const resolved = resolveBridge();
    if (!resolved) return 'UNKNOWN';

    try {
      const result = await runBridgeMethod(resolved.bridge, ['testPrinter', 'testPrinterConnection', 'getPrinterStatus', 'checkStatus'], {
        printerId: printer.id,
        printerName: printer.name,
        printerAddress: printer.address,
        connection: printer.connection,
        type: printer.type
      });
      return normalizeConnectionHealth(result);
    } catch (error) {
      console.warn('Native printer connection test failed:', error);
      return 'OFFLINE';
    }
  },

  async printHtml(payload: NativeHtmlPayload, reportErrors = false): Promise<boolean> {
    const resolved = resolveBridge();
    if (!resolved) return false;

    try {
      const result = await runBridgeMethod(resolved.bridge, ['printHtml', 'print'], payload);
      const accepted = normalizePrintedResult(result);
      if (!accepted && reportErrors) throw new PrintOutputError(result?.errorCode);
      if (accepted && reportErrors && String(result?.status).toLowerCase() === 'queued') notifyPrintQueued();
      return accepted;
    } catch (error) {
      if (reportErrors) throw error instanceof PrintOutputError ? error : new PrintOutputError();
      console.warn('Native HTML print failed:', error);
      return false;
    }
  },

  async printEscPos(payload: NativeEscPosPayload, reportErrors = false): Promise<boolean> {
    const resolved = resolveBridge();
    if (!resolved) return false;

    try {
      const result = await runBridgeMethod(resolved.bridge, ['printEscPos', 'printEscpos', 'printRaw'], payload);
      const accepted = normalizePrintedResult(result);
      if (!accepted && reportErrors) throw new PrintOutputError(result?.errorCode);
      if (accepted && reportErrors && String(result?.status).toLowerCase() === 'queued') notifyPrintQueued();
      return accepted;
    } catch (error) {
      if (reportErrors) throw error instanceof PrintOutputError ? error : new PrintOutputError();
      console.warn('Native ESC/POS print failed:', error);
      return false;
    }
  },

  async getHostProfile(): Promise<NativeHostProfile> {
    const resolved = resolveBridge();
    if (!resolved) return 'UNKNOWN';

    try {
      const data = await runBridgeMethod(resolved.bridge, ['getDeviceProfile', 'getDeviceInfo']);
      const profile = String(data?.profile || data?.deviceProfile || '').toUpperCase();

      if (profile.includes('ALL') || data?.integratedPrinter === true) return 'ALL_IN_ONE';
      if (profile.includes('HANDHELD') || profile.includes('MOBILE')) return 'HANDHELD';
      if (profile.includes('DESKTOP') || profile.includes('WINDOWS')) return 'DESKTOP';

      if (resolved.runtime === 'ANDROID') return 'HANDHELD';
      if (resolved.runtime === 'ELECTRON' || resolved.runtime === 'WINDOWS') return 'DESKTOP';

      return 'UNKNOWN';
    } catch (error) {
      console.warn('Native host profile detection failed:', error);
      return 'UNKNOWN';
    }
  },

  async checkPrinterStatus(printerId: string): Promise<'ONLINE' | 'OFFLINE' | 'UNKNOWN'> {
    const resolved = resolveBridge();
    if (!resolved) return 'UNKNOWN';

    try {
      const result = await runBridgeMethod(resolved.bridge, ['getPrinterStatus', 'checkStatus', 'testPrinter', 'testPrinterConnection'], { printerId });
      return normalizeConnectionHealth(result);
    } catch (error) {
      console.warn('Native printer status check failed:', error);
      return 'UNKNOWN';
    }
  }
};
