import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
const modalSource = readFileSync(new URL('../components/TableOptionsModal.tsx', import.meta.url), 'utf8');

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

test('el selector recibe destinos calculados por el estado real y no por status obsoleto', () => {
  assert.match(source, /moveTargetTableIds=\{safeTables/);
  assert.match(source, /!isTableMoveTargetOccupied\(candidate\)/);
  assert.doesNotMatch(source, /if \(freeForTools\.length === 0\) \{\s*alert\('No hay mesas libres para recibir el pedido\.'/);
  assert.match(modalSource, /moveTargetTableIds\?: string\[\]/);
  assert.match(modalSource, /explicitMoveTargets\.has\(String\(t\.id\)\)/);
});
