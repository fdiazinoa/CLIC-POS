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

test('el modal permite renombrar cada cuenta o cuota y persiste el cambio', () => {
  assert.match(source, /onRenameTab\?: \(ticket: ParkedTicket, name: string, fractionIndex\?: number\)/);
  assert.match(source, /setEditingEntryKey\(entry\.key\)/);
  assert.match(source, /onRenameTab\?\.\(ticket, nextValue, entry\.fractionIndex\)/);
  assert.match(source, /aria-label={`Renombrar \$\{entry\.accountLabel\}`}/);
  assert.match(source, /aria-label="Nombre de la cuenta"/);
  assert.match(source, /renameTableAccountTicket\(ticket, getTableLabel\(table\), requestedName, fractionIndex\)/);
  assert.match(source, /onUpdateParkedTickets\?\.\(nextTickets\)/);
});

test('el modal neutraliza el fondo gris nativo de Android', () => {
  assert.match(source, /table-account-action/);
  assert.match(source, /appearance-none/);
  assert.match(source, /border-0 bg-white/);
});

test('las sillas usan asiento y respaldo separados como la opción C', () => {
  assert.match(source, /absolute inset-x-0 bottom-0 h-\[1\.15rem\]/);
  assert.match(source, /absolute left-1\/2 top-0 h-2 w-7/);
  assert.match(source, /from-slate-100 to-slate-400/);
});
