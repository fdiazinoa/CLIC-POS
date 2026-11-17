import type { BusinessConfig, PrinterDevice, TerminalConfig } from '../../types';

// The confirmed Symbol SNAPI barcode reader exposes a vendor-specific OUT
// endpoint. That endpoint does not make it a thermal printer.
export const isKnownUsbScanner = (device: Partial<PrinterDevice>): boolean =>
  device.connection === 'USB' && (
    /^usb:1504:6400(?::|$)/i.test(device.id || '') ||
    /bar\s*code\s+scanner/i.test(device.name || '')
  );

export const eligiblePrinters = (printers: PrinterDevice[] = []): PrinterDevice[] =>
  printers.filter(device => !isKnownUsbScanner(device));

export const receiptPrinterPreference = (hardware?: TerminalConfig['hardware']): string =>
  hardware?.printerAssignments?.TICKET || hardware?.receiptPrinterId || '';

/** Called only by explicit Hardware Save. No device I/O or persistence here. */
export const withPrinterPreferences = (
  config: BusinessConfig,
  terminalId: string,
  draftPrinters: PrinterDevice[],
  defaultPrinterId: string,
): BusinessConfig => {
  if (!config.terminals?.some(terminal => terminal.id === terminalId)) {
    throw new Error('Selecciona una terminal válida.');
  }
  const printers = eligiblePrinters(draftPrinters);
  const retainedIds = new Set(printers.map(printer => printer.id));
  const removedIds = new Set((config.availablePrinters || []).filter(printer => !retainedIds.has(printer.id)).map(printer => printer.id));
  // Deleting a printer (including a legacy scanner registration) clears only
  // references to that removed device, including references on other terminals.
  const selectedId = removedIds.has(defaultPrinterId) ? '' : defaultPrinterId;
  if (selectedId && !printers.some(printer => printer.id === selectedId && printer.type === 'TICKET')) {
    throw new Error('La tickera predeterminada ya no está disponible. Selecciona otra o usa Automática por tipo.');
  }
  return {
    ...config,
    availablePrinters: printers,
    terminals: config.terminals.map(terminal => {
      const original = terminal.config.hardware || ({} as TerminalConfig['hardware']);
      const assignments = Object.fromEntries(Object.entries(original.printerAssignments || {}).filter(([, id]) => !removedIds.has(id)));
      const receiptId = original.receiptPrinterId;
      const removedReceipt = receiptId && removedIds.has(receiptId);
      const changedAssignments = Object.keys(assignments).length !== Object.keys(original.printerAssignments || {}).length;
      if (terminal.id !== terminalId && !removedReceipt && !changedAssignments) return terminal;
      const hardware = { ...original, printerAssignments: assignments };
      if (removedReceipt) delete hardware.receiptPrinterId;
      if (terminal.id === terminalId) {
        delete hardware.printerAssignments.TICKET;
        delete hardware.receiptPrinterId;
        if (selectedId) {
          hardware.printerAssignments.TICKET = selectedId;
          hardware.receiptPrinterId = selectedId;
        }
      }
      return { ...terminal, config: { ...terminal.config, hardware } };
    }),
  };
};
