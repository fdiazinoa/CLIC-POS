import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');

test('el modal expande las cuotas persistidas y resume solo las cuentas abiertas', () => {
  assert.match(source, /buildTableAccountDisplayEntries\(tickets\)/);
  assert.match(source, /summarizeOpenTableAccounts\(accountEntries\)/);
  assert.match(source, /accountEntries\.map\(\(entry\)/);
  assert.match(source, /entry\.status === 'PAID'/);
});

test('el modal permite renombrar una cuenta existente y persiste el cambio', () => {
  assert.match(source, /onRenameTab\?: \(ticket: ParkedTicket, name: string\)/);
  assert.match(source, /aria-label={`Renombrar \$\{entry\.accountLabel\}`}/);
  assert.match(source, /aria-label="Nombre de la cuenta"/);
  assert.match(source, /renameTableAccountTicket\(ticket, getTableLabel\(table\), requestedName\)/);
  assert.match(source, /onUpdateParkedTickets\?\.\(nextTickets\)/);
});
