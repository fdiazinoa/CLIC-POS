import assert from 'node:assert/strict';
import test from 'node:test';

import { validateTerminalDocument } from '../utils/validation';
import { resolveTerminalDocumentSeriesId, validateTerminalSeries } from '../utils/seriesValidation';

const buildConfig = (terminals: any[]) => ({ terminals } as any);

test('reconoce la asignación documental de la terminal ERP activa por UUID', () => {
  const terminalId = '9ffc6771-7845-4976-afd3-20cebc3cc6e8';
  const config = buildConfig([{
    id: terminalId,
    config: {
      terminalName: 'Caja 003',
      stationNumber: 'POS-003',
      erpTerminalId: terminalId,
      documentAssignments: { TICKET: 'df9f8856-4143-4770-878c-9abbbff79b08' },
    },
  }]);

  assert.deepEqual(validateTerminalDocument(config, terminalId, 'TICKET'), { isValid: true });
  assert.deepEqual(validateTerminalDocument(config, 'POS-003', 'TICKET'), { isValid: true });
});

test('acepta una serie terminal autoritativa mientras se hidrata el mapa de asignaciones', () => {
  const config = buildConfig([{
    id: 'terminal-1',
    config: {
      terminalName: 'Caja 003',
      documentSeries: [{
        id: 'ticket-erp',
        documentType: 'TICKET',
        prefix: 'TCK03',
        source: 'ERP_TERMINAL_CONFIG',
        active: true,
      }],
    },
  }]);

  assert.deepEqual(validateTerminalDocument(config, 'terminal-1', 'TICKET'), { isValid: true });
  assert.equal(resolveTerminalDocumentSeriesId(config.terminals[0].config, 'TICKET'), 'ticket-erp');
  assert.deepEqual(validateTerminalSeries(config.terminals[0].config, 'TICKET'), { isValid: true });
});

test('resuelve la asignación desde el snapshot ERP aunque el mapa superior aún no esté hidratado', () => {
  const terminalConfig = {
    erpSnapshot: {
      resolved: {
        documents: {
          assignments: { TICKET: 'ticket-snapshot' },
          document_series: [{
            id: 'ticket-snapshot',
            documentType: 'TICKET',
            prefix: 'TCK03',
            source: 'ERP_TERMINAL_CONFIG',
          }],
        },
      },
    },
  } as any;

  assert.equal(resolveTerminalDocumentSeriesId(terminalConfig, 'TICKET'), 'ticket-snapshot');
  assert.deepEqual(validateTerminalSeries(terminalConfig, 'TICKET'), { isValid: true });
});

test('no sustituye una terminal desconocida por la primera configurada', () => {
  const config = buildConfig([{
    id: 'terminal-1',
    config: { terminalName: 'Caja 001', documentAssignments: { TICKET: 'ticket-1' } },
  }]);

  const result = validateTerminalDocument(config, 'terminal-inexistente', 'TICKET');
  assert.equal(result.isValid, false);
  assert.match(result.error || '', /identificar la terminal activa/i);
});

test('muestra el nombre operativo y nunca el UUID cuando falta una serie', () => {
  const terminalId = '9ffc6771-7845-4976-afd3-20cebc3cc6e8';
  const config = buildConfig([{
    id: terminalId,
    config: { terminalName: 'Caja 003', stationNumber: 'POS-003' },
  }]);

  const result = validateTerminalDocument(config, terminalId, 'TICKET');
  assert.equal(result.isValid, false);
  assert.match(result.error || '', /Caja 003/);
  assert.doesNotMatch(result.error || '', new RegExp(terminalId, 'i'));
});
