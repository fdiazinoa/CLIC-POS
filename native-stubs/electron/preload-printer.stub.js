/**
 * Electron Preload stub para exponer contrato de impresion nativa.
 *
 * Integracion:
 * - Incluir este codigo en tu preload real.
 * - Requiere handlers IPC definidos en main-printer.stub.js.
 */

const { contextBridge, ipcRenderer } = require('electron');

const printerBridge = {
  platform: 'electron',

  discoverPrinters: (payload) => ipcRenderer.invoke('printer:discover', payload || {}),
  scanPrinters: (payload) => ipcRenderer.invoke('printer:discover', payload || {}),
  listPrinters: (payload) => ipcRenderer.invoke('printer:discover', payload || {}),

  pairPrinter: (payload) => ipcRenderer.invoke('printer:pair', payload || {}),
  connectPrinter: (payload) => ipcRenderer.invoke('printer:pair', payload || {}),
  bindPrinter: (payload) => ipcRenderer.invoke('printer:pair', payload || {}),

  printEscPos: (payload) => ipcRenderer.invoke('printer:print-escpos', payload || {}),
  printEscpos: (payload) => ipcRenderer.invoke('printer:print-escpos', payload || {}),
  printRaw: (payload) => ipcRenderer.invoke('printer:print-escpos', payload || {}),

  printHtml: (payload) => ipcRenderer.invoke('printer:print-html', payload || {}),
  print: (payload) => ipcRenderer.invoke('printer:print-html', payload || {}),

  getDeviceProfile: () => ipcRenderer.invoke('printer:profile'),
  getDeviceInfo: () => ipcRenderer.invoke('printer:profile')
};

contextBridge.exposeInMainWorld('electronAPI', {
  printer: printerBridge
});

contextBridge.exposeInMainWorld('ClicPOSNativePrinter', printerBridge);
