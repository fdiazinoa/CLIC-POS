import assert from 'node:assert/strict';
import test from 'node:test';

import { getInitialConfig } from '../constants';
import { applyTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';

const terminalId = 'terminal-company-contract';

const baseConfig = () => {
  const config = getInitialConfig('Supermercado' as any);
  config.companyInfo = {
    name: 'Mercasend',
    rnc: '131-12345-1',
    phone: '809-555-POS1',
    address: 'Av. Principal #1, Santo Domingo',
    email: 'demo@example.test',
    website: 'https://demo.example.test',
  };
  config.receiptConfig = {
    ...(config.receiptConfig || {}),
    logo: 'local-logo.png',
  };
  return config;
};

test('resolved.company reemplaza los valores demo y admite snake_case', () => {
  const applied = applyTerminalConfigSnapshot(baseConfig(), {
    terminalId,
    incomingSnapshot: {
      terminal_id: terminalId,
      resolved: {
        company: {
          name: 'Nombre operativo',
          legal_name: 'Empresa Legal, SRL',
          trade_name: 'Comercial ERP',
          tax_id: '1-01-99999-9',
          phone: '809-555-0199',
          address_line: 'Calle ERP #10',
          email: 'empresa@erp.test',
          website: 'https://erp.test',
        },
      },
    },
  });

  assert.deepEqual(applied.config.companyInfo, {
    name: 'Comercial ERP',
    rnc: '1-01-99999-9',
    phone: '809-555-0199',
    address: 'Calle ERP #10',
    email: 'empresa@erp.test',
    website: 'https://erp.test',
  });
  assert.equal(applied.config.receiptConfig?.logo, 'local-logo.png');
});

test('admite camelCase y respeta la prioridad de receiptLogoUrl', () => {
  const applied = applyTerminalConfigSnapshot(baseConfig(), {
    terminalId,
    incomingSnapshot: {
      terminal_id: terminalId,
      resolved: {
        company: {
          legalName: 'Empresa Legal ERP',
          tradeName: 'Marca ERP',
          taxId: '101999999',
          addressLine: 'Avenida Camel #20',
          receiptLogoUrl: 'https://cdn.erp.test/receipt.png',
          logoUrl: 'https://cdn.erp.test/general.png',
        },
      },
    },
  });

  assert.equal(applied.config.companyInfo.name, 'Marca ERP');
  assert.equal(applied.config.companyInfo.rnc, '101999999');
  assert.equal(applied.config.companyInfo.address, 'Avenida Camel #20');
  assert.equal(applied.config.receiptConfig?.logo, 'https://cdn.erp.test/receipt.png');
});

test('sin bloque company conserva companyInfo y logo locales', () => {
  const original = baseConfig();
  const applied = applyTerminalConfigSnapshot(original, {
    terminalId,
    incomingSnapshot: {
      terminal_id: terminalId,
      resolved: { pricing: { tariffs: [] } },
    },
  });

  assert.deepEqual(applied.config.companyInfo, original.companyInfo);
  assert.equal(applied.config.receiptConfig?.logo, 'local-logo.png');
});

const companySourceCases: Array<[string, Record<string, unknown>]> = [
  ['terminal_config.company', { terminal_config: { company: { trade_name: 'Empresa terminal_config.company' } } }],
  ['snapshot.company', { company: { trade_name: 'Empresa snapshot.company' } }],
  ['resolved.company_info', { resolved: { company_info: { trade_name: 'Empresa resolved.company_info' } } }],
  ['snapshot.companyInfo', { companyInfo: { tradeName: 'Empresa snapshot.companyInfo' } }],
  ['config.company_info', { config: { company_info: { trade_name: 'Empresa config.company_info' } } }],
  ['business_config.companyInfo', { business_config: { companyInfo: { tradeName: 'Empresa business_config.companyInfo' } } }],
];

companySourceCases.forEach(([source, snapshot]) => {
  test(`detecta información de empresa desde ${source}`, () => {
    const applied = applyTerminalConfigSnapshot(baseConfig(), {
      terminalId,
      incomingSnapshot: {
        terminal_id: terminalId,
        ...snapshot,
      } as any,
    });

    assert.equal(applied.config.companyInfo.name, `Empresa ${source}`);
  });
});

test('respeta la prioridad resolved.company sobre las fuentes de respaldo', () => {
  const applied = applyTerminalConfigSnapshot(baseConfig(), {
    terminalId,
    incomingSnapshot: {
      terminal_id: terminalId,
      resolved: {
        company: { name: 'Empresa prioritaria' },
        company_info: { name: 'Empresa resolved.company_info' },
      },
      company: { name: 'Empresa snapshot.company' },
      config: { company_info: { name: 'Empresa config.company_info' } },
      business_config: { company_info: { name: 'Empresa business_config.company_info' } },
    } as any,
  });

  assert.equal(applied.config.companyInfo.name, 'Empresa prioritaria');
});

test('campos remotos explícitamente vacíos limpian el valor anterior', () => {
  const applied = applyTerminalConfigSnapshot(baseConfig(), {
    terminalId,
    incomingSnapshot: {
      terminal_id: terminalId,
      company_info: {
        trade_name: '',
        name: '',
        legal_name: '',
        phone: '',
        email: '',
        receipt_logo_url: '',
      },
    },
  });

  assert.equal(applied.config.companyInfo.name, '');
  assert.equal(applied.config.companyInfo.phone, '');
  assert.equal(applied.config.companyInfo.email, '');
  assert.equal(applied.config.companyInfo.rnc, '131-12345-1');
  assert.equal(applied.config.receiptConfig?.logo, '');
});

test('aplicar dos veces el mismo perfil de empresa es idempotente', () => {
  const snapshot = {
    terminal_id: terminalId,
    config: {
      companyInfo: {
        name: 'Empresa Idempotente',
        rnc: '130000001',
        phone: '809-555-0101',
      },
    },
  };
  const first = applyTerminalConfigSnapshot(baseConfig(), {
    terminalId,
    incomingSnapshot: snapshot,
  });
  const second = applyTerminalConfigSnapshot(first.config, {
    terminalId,
    incomingSnapshot: snapshot,
  });

  assert.deepEqual(second.config, first.config);
});
