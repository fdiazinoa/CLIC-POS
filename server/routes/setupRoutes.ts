import express from 'express';
import { getCollection, getSetting, saveSetting } from '../db.js';

const router = express.Router();

const resolveTenantId = (config: any, requestedTenantId?: string): string => {
  return (
    requestedTenantId ||
    getSetting('active_tenant_id') ||
    getSetting('tenant_id') ||
    getSetting('tenantId') ||
    config?.tenantId ||
    config?.tenant?.id ||
    'default-tenant'
  );
};

const getTerminalName = (terminalId: string): string => {
  const numericSuffix = terminalId.replace(/^[^\d]*/i, '');
  if (numericSuffix) return `Caja ${numericSuffix}`;
  return `Caja ${terminalId.toUpperCase()}`;
};

const getTerminalLocation = (terminal: any): string => {
  if (terminal?.config?.isPrimaryNode) return 'Servidor principal';
  return 'Punto de venta';
};

router.get('/terminals', (req, res) => {
  const config = getSetting('config');
  const requestedDeviceId = typeof req.query.pos_device_id === 'string' ? req.query.pos_device_id : undefined;

  if (!config || !Array.isArray(config.terminals)) {
    return res.status(404).json({ error: 'No se encontró la configuración de terminales.' });
  }

  const terminals = config.terminals.map((terminal: any) => {
    const currentDeviceId = terminal?.config?.currentDeviceId;
    const occupied = Boolean(currentDeviceId && currentDeviceId !== requestedDeviceId);

    return {
      id: terminal.id,
      name: getTerminalName(terminal.id),
      location: getTerminalLocation(terminal),
      occupied,
      currentDeviceId,
      config: terminal.config || {},
    };
  });

  res.json({
    tenant_id: resolveTenantId(config),
    terminals,
  });
});

router.post('/bind-terminal', (req, res) => {
  const { terminal_id, pos_device_id, force_transfer = false, tenant_id } = req.body || {};
  const config = getSetting('config');

  if (!terminal_id || !pos_device_id) {
    return res.status(400).json({ error: 'terminal_id y pos_device_id son obligatorios.' });
  }

  if (!config || !Array.isArray(config.terminals)) {
    return res.status(404).json({ error: 'No se encontró la configuración de terminales.' });
  }

  const existingTerminal = config.terminals.find((terminal: any) => terminal.id === terminal_id);
  if (!existingTerminal) {
    return res.status(404).json({ error: 'La terminal seleccionada no existe.' });
  }

  const currentDeviceId = existingTerminal?.config?.currentDeviceId;
  if (currentDeviceId && currentDeviceId !== pos_device_id && !force_transfer) {
    return res.status(409).json({
      code: 'TERMINAL_OCCUPIED',
      error: 'La terminal ya está ocupada por otro equipo.',
      terminal: {
        id: existingTerminal.id,
        name: getTerminalName(existingTerminal.id),
        location: getTerminalLocation(existingTerminal),
        currentDeviceId,
      },
    });
  }

  const updatedTerminals = config.terminals.map((terminal: any) => {
    const terminalConfig = terminal?.config || {};

    if (terminalConfig.currentDeviceId === pos_device_id) {
      return {
        ...terminal,
        config: {
          ...terminalConfig,
          currentDeviceId: undefined,
        },
      };
    }

    if (terminal.id === terminal_id) {
      return {
        ...terminal,
        config: {
          ...terminalConfig,
          currentDeviceId: pos_device_id,
          lastPairingDate: new Date().toISOString(),
        },
      };
    }

    return terminal;
  });

  const updatedConfig = {
    ...config,
    terminals: updatedTerminals,
  };

  saveSetting('config', updatedConfig);

  res.json({
    success: true,
    tenant_id: resolveTenantId(updatedConfig, tenant_id),
    terminal_id,
    transferred: Boolean(currentDeviceId && currentDeviceId !== pos_device_id),
    config: updatedConfig,
    users: getCollection('users'),
  });
});

export default router;
