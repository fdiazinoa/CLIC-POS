import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');

test('mover mesa no trata una referencia de orden obsoleta como una mesa destino ocupada', () => {
  assert.match(source, /const belongsToTable = \(ticket: ParkedTicket\) =>/);
  assert.match(source, /const ticketTableId = String\(ticket\.tableId \?\? ''\);/);
  assert.match(source, /ticketTableId === tableId/);
  assert.match(source, /String\(ticket\.id\) === String\(table\.currentOrderId\)\s*&&\s*belongsToTable\(ticket\)/);
  assert.match(source, /currentOrderId puede quedar obsoleto después de liberar o mover una mesa/);
});

test('mover mesa acepta una mesa ERP sin status como destino libre', () => {
  assert.match(source, /const isTableMoveTargetOccupied = useCallback/);
  assert.match(source, /visualStatus === 'OCCUPIED'\s*\|\|\s*visualStatus === 'RESERVED'/);
  assert.match(source, /ausencia de estado equivale a libre/);
  assert.doesNotMatch(source, /getVisualTableState\(table\)\.status !== 'FREE'/);
});
