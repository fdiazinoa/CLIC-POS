/**
 * Electron Main stub para bridge de impresoras.
 *
 * Integracion:
 * 1) Llamar registerPrinterIpc(ipcMain) en tu main process.
 * 2) Completar TODOs para transporte real (USB/BT/TCP) y discovery.
 */

function asResult(status, message, extra) {
  return Object.assign(
    {
      status,
      success: status !== 'error',
      printed: status === 'success' || status === 'printed',
      message: message || ''
    },
    extra || {}
  );
}

function normalizeConnection(value) {
  const allowed = ['BLUETOOTH', 'USB', 'NETWORK', 'SERIAL', 'VIRTUAL'];
  const upper = String(value || 'USB').toUpperCase();
  return allowed.includes(upper) ? upper : 'USB';
}

function registerPrinterIpc(ipcMain) {
  ipcMain.handle('printer:discover', async (_event, payload) => {
    const connection = normalizeConnection(payload && payload.connection);

    // TODO: discovery real por tipo de conexion.
    return {
      devices: [
        {
          id: `electron-demo-${connection.toLowerCase()}`,
          name: `Electron Demo ${connection}`,
          connection,
          address: connection === 'NETWORK' ? '192.168.1.80' : 'USB001',
          status: 'CONNECTED',
          type: 'LABEL'
        }
      ]
    };
  });

  ipcMain.handle('printer:pair', async (_event, payload) => {
    // TODO: vincular dispositivo real si aplica.
    return {
      printer: {
        id: String((payload && payload.id) || `electron-printer-${Date.now()}`),
        name: String((payload && payload.name) || 'Electron Thermal Printer'),
        connection: normalizeConnection(payload && payload.connection),
        address: (payload && payload.address) || '',
        status: 'CONNECTED',
        type: String((payload && payload.type) || 'TICKET').toUpperCase()
      }
    };
  });

  ipcMain.handle('printer:print-escpos', async (_event, payload) => {
    try {
      const dataBase64 = payload && payload.dataBase64;
      if (!dataBase64) return asResult('error', 'Missing dataBase64', { errorCode: 'PAYLOAD_INVALID' });

      const raw = Buffer.from(dataBase64, 'base64');

      // TODO: enviar raw a impresora real.
      // Ejemplo TCP: net.Socket().write(raw)
      // Ejemplo USB: node-usb/node-escpos adapter
      if (!raw.length) return asResult('error', 'Invalid ESC/POS payload', { errorCode: 'PAYLOAD_INVALID' });

      return asResult('success', 'Printed ESC/POS');
    } catch (error) {
      return asResult('error', String(error && error.message ? error.message : error), { errorCode: 'PRINT_ESC_POS_ERROR' });
    }
  });

  ipcMain.handle('printer:print-html', async (_event, payload) => {
    try {
      const html = payload && payload.html;
      if (!html) return asResult('error', 'Missing html', { errorCode: 'PAYLOAD_INVALID' });

      // TODO: renderizar HTML para imprimir silencioso desde main process.
      // Recomendado: BrowserWindow offscreen + webContents.print(...)
      return asResult('success', 'Printed HTML');
    } catch (error) {
      return asResult('error', String(error && error.message ? error.message : error), { errorCode: 'PRINT_HTML_ERROR' });
    }
  });

  ipcMain.handle('printer:profile', async () => {
    return {
      profile: 'DESKTOP',
      integratedPrinter: false
    };
  });
}

module.exports = {
  registerPrinterIpc
};
