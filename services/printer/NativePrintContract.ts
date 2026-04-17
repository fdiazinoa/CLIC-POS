import { ConnectionType } from '../../types';

export type NativePrinterStatus = 'CONNECTED' | 'DISCONNECTED';
export type NativePrinterType = 'TICKET' | 'LABEL' | 'KITCHEN' | 'LOGISTICS';

export interface NativePrinterDevice {
  id: string;
  name: string;
  connection?: ConnectionType;
  address?: string;
  status?: NativePrinterStatus;
  type?: NativePrinterType;
}

export interface NativePrintBasePayload {
  printerId?: string;
  printerName?: string;
  printerAddress?: string;
  connection?: string;
  role?: string;
  jobType?: string;
  referenceId?: string;
  copies?: number;
}

export interface NativeHtmlBridgePayload extends NativePrintBasePayload {
  html: string;
}

export interface NativeEscPosBridgePayload extends NativePrintBasePayload {
  dataBase64: string;
}

export interface NativePrintResult {
  status?: 'success' | 'printed' | 'queued' | 'ok' | 'error';
  success?: boolean;
  printed?: boolean;
  message?: string;
  errorCode?: string;
}

export interface NativePrinterHealthResult {
  status?: 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | 'CONNECTED' | 'DISCONNECTED' | 'READY' | 'ERROR';
  success?: boolean;
  message?: string;
}

export interface NativePrinterBridge {
  platform?: string;
  validateDgiiRnc?: (payload?: { rnc?: string }) => Promise<{
    rnc?: string;
    name?: string;
    commercialName?: string;
    status?: 'ACTIVO' | 'INACTIVO' | 'NO_REGISTRADO';
    regimeType?: string;
    economicActivity?: string;
    error?: string;
  }> | {
    rnc?: string;
    name?: string;
    commercialName?: string;
    status?: 'ACTIVO' | 'INACTIVO' | 'NO_REGISTRADO';
    regimeType?: string;
    economicActivity?: string;
    error?: string;
  };

  discoverPrinters?: (payload?: { connection?: ConnectionType }) => Promise<NativePrinterDevice[] | { devices?: NativePrinterDevice[]; printers?: NativePrinterDevice[] }> | NativePrinterDevice[] | { devices?: NativePrinterDevice[]; printers?: NativePrinterDevice[] };
  scanPrinters?: (payload?: { connection?: ConnectionType }) => Promise<NativePrinterDevice[] | { devices?: NativePrinterDevice[]; printers?: NativePrinterDevice[] }> | NativePrinterDevice[] | { devices?: NativePrinterDevice[]; printers?: NativePrinterDevice[] };
  listPrinters?: (payload?: { connection?: ConnectionType }) => Promise<NativePrinterDevice[] | { devices?: NativePrinterDevice[]; printers?: NativePrinterDevice[] }> | NativePrinterDevice[] | { devices?: NativePrinterDevice[]; printers?: NativePrinterDevice[] };

  pairPrinter?: (payload?: Partial<NativePrinterDevice>) => Promise<NativePrinterDevice | { printer?: NativePrinterDevice }> | NativePrinterDevice | { printer?: NativePrinterDevice };
  connectPrinter?: (payload?: Partial<NativePrinterDevice>) => Promise<NativePrinterDevice | { printer?: NativePrinterDevice }> | NativePrinterDevice | { printer?: NativePrinterDevice };
  bindPrinter?: (payload?: Partial<NativePrinterDevice>) => Promise<NativePrinterDevice | { printer?: NativePrinterDevice }> | NativePrinterDevice | { printer?: NativePrinterDevice };
  testPrinter?: (payload?: Partial<NativePrinterDevice>) => Promise<NativePrinterHealthResult> | NativePrinterHealthResult;
  testPrinterConnection?: (payload?: Partial<NativePrinterDevice>) => Promise<NativePrinterHealthResult> | NativePrinterHealthResult;
  getPrinterStatus?: (payload?: Partial<NativePrinterDevice> | { printerId?: string }) => Promise<NativePrinterHealthResult> | NativePrinterHealthResult;
  checkStatus?: (payload?: Partial<NativePrinterDevice> | { printerId?: string }) => Promise<NativePrinterHealthResult> | NativePrinterHealthResult;

  printEscPos?: (payload: NativeEscPosBridgePayload) => Promise<boolean | NativePrintResult> | boolean | NativePrintResult;
  printEscpos?: (payload: NativeEscPosBridgePayload) => Promise<boolean | NativePrintResult> | boolean | NativePrintResult;
  printRaw?: (payload: NativeEscPosBridgePayload) => Promise<boolean | NativePrintResult> | boolean | NativePrintResult;

  printHtml?: (payload: NativeHtmlBridgePayload) => Promise<boolean | NativePrintResult> | boolean | NativePrintResult;
  print?: (payload: NativeHtmlBridgePayload) => Promise<boolean | NativePrintResult> | boolean | NativePrintResult;

  getDeviceProfile?: () => Promise<{ profile?: string; integratedPrinter?: boolean }> | { profile?: string; integratedPrinter?: boolean };
  getDeviceInfo?: () => Promise<{ profile?: string; integratedPrinter?: boolean }> | { profile?: string; integratedPrinter?: boolean };

  /** Enumeración de lectores biométricos USB/red (Android nativo). */
  discoverFingerprintReaders?: (payload?: { connection?: ConnectionType }) => Promise<unknown>;
  scanFingerprintReaders?: (payload?: { connection?: ConnectionType }) => Promise<unknown>;
  testFingerprintReader?: (payload?: { address?: string; id?: string; connection?: string }) => Promise<unknown>;
}

export interface NativeBridgeContractStatus {
  available: boolean;
  printCapable: boolean;
  peripheralCapable: boolean;
  detectedMethods: string[];
  missingRecommended: string[];
}
