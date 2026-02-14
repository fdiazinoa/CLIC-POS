import type { NativePrinterBridge } from '../services/printer/NativePrintContract';

declare global {
  interface Window {
    ClicPOSNativePrinter?: NativePrinterBridge;
    AndroidPrinter?: NativePrinterBridge;
    electronAPI?: {
      printer?: NativePrinterBridge;
      [key: string]: unknown;
    };
    electron?: {
      printer?: NativePrinterBridge;
      [key: string]: unknown;
    };
  }
}

export {};
