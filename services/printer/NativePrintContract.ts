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

export interface NativePrinterBridge {
  platform?: string;

  discoverPrinters?: (payload?: { connection?: ConnectionType }) => Promise<NativePrinterDevice[] | { devices?: NativePrinterDevice[]; printers?: NativePrinterDevice[] }> | NativePrinterDevice[] | { devices?: NativePrinterDevice[]; printers?: NativePrinterDevice[] };
  scanPrinters?: (payload?: { connection?: ConnectionType }) => Promise<NativePrinterDevice[] | { devices?: NativePrinterDevice[]; printers?: NativePrinterDevice[] }> | NativePrinterDevice[] | { devices?: NativePrinterDevice[]; printers?: NativePrinterDevice[] };
  listPrinters?: (payload?: { connection?: ConnectionType }) => Promise<NativePrinterDevice[] | { devices?: NativePrinterDevice[]; printers?: NativePrinterDevice[] }> | NativePrinterDevice[] | { devices?: NativePrinterDevice[]; printers?: NativePrinterDevice[] };

  pairPrinter?: (payload?: Partial<NativePrinterDevice>) => Promise<NativePrinterDevice | { printer?: NativePrinterDevice }> | NativePrinterDevice | { printer?: NativePrinterDevice };
  connectPrinter?: (payload?: Partial<NativePrinterDevice>) => Promise<NativePrinterDevice | { printer?: NativePrinterDevice }> | NativePrinterDevice | { printer?: NativePrinterDevice };
  bindPrinter?: (payload?: Partial<NativePrinterDevice>) => Promise<NativePrinterDevice | { printer?: NativePrinterDevice }> | NativePrinterDevice | { printer?: NativePrinterDevice };

  printEscPos?: (payload: NativeEscPosBridgePayload) => Promise<boolean | NativePrintResult> | boolean | NativePrintResult;
  printEscpos?: (payload: NativeEscPosBridgePayload) => Promise<boolean | NativePrintResult> | boolean | NativePrintResult;
  printRaw?: (payload: NativeEscPosBridgePayload) => Promise<boolean | NativePrintResult> | boolean | NativePrintResult;

  printHtml?: (payload: NativeHtmlBridgePayload) => Promise<boolean | NativePrintResult> | boolean | NativePrintResult;
  print?: (payload: NativeHtmlBridgePayload) => Promise<boolean | NativePrintResult> | boolean | NativePrintResult;

  getDeviceProfile?: () => Promise<{ profile?: string; integratedPrinter?: boolean }> | { profile?: string; integratedPrinter?: boolean };
  getDeviceInfo?: () => Promise<{ profile?: string; integratedPrinter?: boolean }> | { profile?: string; integratedPrinter?: boolean };
}

export interface NativeBridgeContractStatus {
  available: boolean;
  printCapable: boolean;
  peripheralCapable: boolean;
  detectedMethods: string[];
  missingRecommended: string[];
}
