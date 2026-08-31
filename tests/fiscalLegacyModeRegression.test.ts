import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { DEFAULT_TERMINAL_CONFIG } from '../constants';
import {
  getEffectiveFiscalComplianceConfig,
  isTerminalFiscalReceiptRequired,
  resolveTerminalFiscalMode,
} from '../utils/fiscal/fiscalHelpers';
import { applyTerminalConfigSnapshot, extractTerminalOperationalDocumentState, normalizeDocumentSeries } from '../utils/terminalConfigSnapshot';

const terminalId = '0f77877f-66b2-4820-b956-997cd5b4b575';
const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');

const buildLegacyTerminalConfig = () => ({
  ...structuredClone(DEFAULT_TERMINAL_CONFIG),
  erpTerminalId: terminalId,
  terminalName: 'CAJA-2',
  stationNumber: 'POS-002',
  fiscal: {
    ...structuredClone(DEFAULT_TERMINAL_CONFIG.fiscal),
    enabled: false,
    providerId: 'NONE',
  },
  erpSnapshot: {
    terminal_id: terminalId,
    fiscalMode: 'LEGACY_B',
    fiscal_mode: 'LEGACY_B',
    config: {
      fiscal: {
        enabled: false,
        providerId: 'NONE',
        mode: 'LEGACY_B',
        fiscalMode: 'LEGACY_B',
      },
    },
    resolved: {
      terminalFiscalConfig: {
        canIssueFiscalDocuments: true,
        requiresFiscalReceipt: true,
      },
    },
  },
} as any);

const buildBusinessConfig = (terminalConfig = buildLegacyTerminalConfig()) => ({
  fiscalCompliance: {
    mode: 'LEGACY_B',
    defaultProvider: 'NONE',
    allowLegacyFallback: false,
    providers: [],
  },
  terminals: [{
    id: terminalId,
    name: 'CAJA-2',
    config: terminalConfig,
  }],
} as any);

test('LEGACY_B conserva NCF aunque providerId sea NONE y enabled venga false', () => {
  const terminalConfig = buildLegacyTerminalConfig();
  const effective = getEffectiveFiscalComplianceConfig(buildBusinessConfig(), terminalConfig);

  assert.equal(resolveTerminalFiscalMode(terminalConfig), 'LEGACY_B');
  assert.equal(isTerminalFiscalReceiptRequired(terminalConfig), true);
  assert.equal(effective.mode, 'LEGACY_B');
  assert.equal(effective.defaultProvider, 'NONE');
});

test('normaliza el snapshot contradictorio de Caja 2 como fiscal LEGACY_B activo', () => {
  const snapshot = {
    terminal_id: terminalId,
    terminal_name: 'CAJA-2',
    station_number: 'POS-002',
    fiscalMode: 'LEGACY_B',
    fiscal_mode: 'LEGACY_B',
    config: {
      fiscal: {
        enabled: false,
        providerId: 'NONE',
        mode: 'LEGACY_B',
      },
    },
    resolved: {
      terminalFiscalConfig: {
        canIssueFiscalDocuments: true,
        requiresFiscalReceipt: true,
      },
      documents: {
        fiscal_ranges: [{
          id: 'range-b02',
          ncf_type: 'B02',
          prefix: 'B02',
          start_number: 1,
          end_number: 5000,
          next_number: 10,
          active: true,
          expires_at: '2026-12-31',
        }],
        fiscal_allocations: [{
          id: 'allocation-b02',
          terminal_id: terminalId,
          fiscal_range_id: 'range-b02',
          ncf_type: 'B02',
          prefix: 'B02',
          reserved_start: 3001,
          reserved_end: 5000,
          next_number: 3001,
          status: 'ACTIVE',
          active: true,
          expires_at: '2026-12-31',
        }],
      },
    },
  } as any;

  const applied = applyTerminalConfigSnapshot(buildBusinessConfig(), {
    terminalId,
    incomingSnapshot: snapshot,
  });
  const terminalConfig = applied.config.terminals.find((terminal) => terminal.id === terminalId)!.config;
  const effective = getEffectiveFiscalComplianceConfig(applied.config, terminalConfig);

  assert.equal(terminalConfig.fiscal.enabled, true);
  assert.equal(terminalConfig.fiscal.providerId, undefined);
  assert.equal(terminalConfig.fiscal.mode, 'LEGACY_B');
  assert.equal(terminalConfig.fiscal.fiscalRanges?.length, 1);
  assert.equal(terminalConfig.fiscal.fiscalAllocations?.length, 1);
  assert.equal(effective.mode, 'LEGACY_B');
});

test('hidrata la serie TICKET publicada en resolved.terminalFiscalConfig', () => {
  const ticketSeriesId = 'e982957a-6f02-4872-aaa2-9cadedc1027b';
  const snapshot = {
    terminal_id: terminalId,
    terminal_name: 'CAJA-2',
    station_number: 'POS-002',
    resolved: {
      terminalFiscalConfig: {
        documentSeries: [{
          id: ticketSeriesId,
          code: 'TCKS0012',
          serie: 'TCKS0012',
          prefix: 'TCKS0012',
          document_type: 'TICKET',
          active: true,
          next_number: 1,
          current_number: 0,
        }],
      },
      documents: {
        assignments: { TICKET: ticketSeriesId },
        internalSequences: [],
      },
    },
  } as any;

  const applied = applyTerminalConfigSnapshot(buildBusinessConfig(), {
    terminalId,
    incomingSnapshot: snapshot,
  });
  const terminalConfig = applied.config.terminals.find((terminal) => terminal.id === terminalId)!.config;
  const operationalState = extractTerminalOperationalDocumentState(applied.config, terminalId);

  assert.equal(terminalConfig.documentAssignments?.TICKET, ticketSeriesId);
  assert.equal(terminalConfig.documentSeries?.[0]?.id, ticketSeriesId);
  assert.equal(terminalConfig.documentSeries?.[0]?.documentType, 'TICKET');
  assert.equal(operationalState.documentSeries[0]?.id, ticketSeriesId);
});

test('normaliza la serie persistida para recuperación offline antes del siguiente sync', () => {
  const series = normalizeDocumentSeries({
    id: 'e982957a-6f02-4872-aaa2-9cadedc1027b',
    code: 'TCKS0012',
    document_type: 'TICKET',
    active: true,
    next_number: 1,
  }, 0);

  assert.equal(series?.id, 'e982957a-6f02-4872-aaa2-9cadedc1027b');
  assert.equal(series?.documentType, 'TICKET');
  assert.equal(series?.prefix, 'TCKS0012');
  assert.equal(series?.nextNumber, 1);
  assert.equal(series?.source, 'ERP_TERMINAL_CONFIG');
});

test('el modo NONE explícito continúa deshabilitando comprobantes fiscales', () => {
  const terminalConfig = buildLegacyTerminalConfig();
  terminalConfig.erpSnapshot.fiscalMode = 'NONE';
  terminalConfig.erpSnapshot.fiscal_mode = 'NONE';
  terminalConfig.erpSnapshot.config.fiscal.mode = 'NONE';

  const config = buildBusinessConfig(terminalConfig);
  config.fiscalCompliance.mode = 'NONE';
  const effective = getEffectiveFiscalComplianceConfig(config, terminalConfig);

  assert.equal(resolveTerminalFiscalMode(terminalConfig), 'NONE');
  assert.equal(isTerminalFiscalReceiptRequired(terminalConfig), false);
  assert.equal(effective.mode, 'NONE');
});

test('el checkout contiene un fail-safe contra facturas fiscales sin NCF', () => {
  assert.match(posSource, /isTerminalFiscalReceiptRequired\(activeTerminalConfig\)/);
  assert.match(posSource, /La venta fue bloqueada para evitar una factura sin NCF/);
});
