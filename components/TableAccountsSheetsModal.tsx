import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, Check, CreditCard, Maximize2, Minimize2, Pencil, Plus, Printer, X } from 'lucide-react';
import type { BusinessConfig, CartItem, Customer, ParkedTicket, Table, TerminalConfig } from '../types';
import { buildTableAccountFiscalSummary, getPaymentFractionFiscalDifference } from '../utils/tableAccountFiscalSummary';
import { buildTableAccountDisplayEntries, getTableAccountLabel, getTableOpenElapsedLabel, sortTableAccountsForDisplay, summarizeOpenTableAccounts } from '../utils/tableAccountPresentation';
import { isFullyPaidParkedTicket } from '../utils/paymentFractions';
import { hasKitchenDispatchEvidence } from '../utils/restaurantHotReversal';

type Props = {
  table: Table;
  tickets: ParkedTicket[];
  currencySymbol: string;
  fiscalConfig?: BusinessConfig;
  terminalTaxConfig?: TerminalConfig;
  terminalId?: string;
  customers?: Customer[];
  isTaxIncluded?: boolean;
  canAdjustQuantity?: boolean;
  canRetireItem?: boolean;
  onClose: () => void;
  onOpenAccount: (ticket: ParkedTicket, inputTimeStamp?: number, itemAction?: AccountItemActionRequest) => void | Promise<void>;
  onCreateAccount: (name: string) => void | Promise<void>;
  onRenameAccount: (ticket: ParkedTicket, name: string, fractionIndex?: number) => void | Promise<void>;
  onPrint: (ticketIds: string[]) => Promise<boolean> | boolean;
  onTransfer: (sourceId: string, targetId: string, quantities: Record<string, number>) => Promise<void>;
};

export type AccountItemActionRequest = { ticketId: string; cartId: string; action: 'ADJUST' | 'RETURN' };

const money = (amount: number, symbol: string) => `${symbol}${amount.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lineKey = (item: CartItem, index: number) => String(item.cartId || `${item.id}-${index}`);
const EMPTY_CUSTOMERS: Customer[] = [];

const TableAccountsSheetsModal: React.FC<Props> = ({
  table, tickets, currencySymbol, fiscalConfig, terminalTaxConfig, terminalId = 'T1', customers = EMPTY_CUSTOMERS, isTaxIncluded = false, canAdjustQuantity = false, canRetireItem = false, onClose, onOpenAccount,
  onCreateAccount, onRenameAccount, onPrint, onTransfer,
}) => {
  const openSheets = useMemo(() => sortTableAccountsForDisplay(tickets.filter(ticket => !isFullyPaidParkedTicket(ticket))), [tickets]);
  const entries = useMemo(() => buildTableAccountDisplayEntries(openSheets), [openSheets]);
  const fiscalByTicket = useMemo(() => {
    const byId = new Map<string, ReturnType<typeof buildTableAccountFiscalSummary>>();
    if (!fiscalConfig) return byId;
    for (const ticket of tickets) {
      byId.set(String(ticket.id), buildTableAccountFiscalSummary(ticket, table, fiscalConfig, terminalTaxConfig, isTaxIncluded, terminalId, customers.find(customer => String(customer.id) === String(ticket.customerId || ''))));
    }
    return byId;
  }, [tickets, table, fiscalConfig, terminalTaxConfig, terminalId, customers, isTaxIncluded]);
  const summary = useMemo(() => {
    const open = summarizeOpenTableAccounts(entries);
    return { ...open, count: openSheets.length, total: entries.reduce((sum, entry) => sum + (entry.fractionIndex ? entry.amount : fiscalByTicket.get(String(entry.ticket.id))?.total ?? entry.amount), 0) };
  }, [entries, fiscalByTicket, openSheets]);
  const tableTotal = useMemo(() => openSheets.reduce((sum, ticket) => sum + (
    fiscalByTicket.get(String(ticket.id))?.total ?? Number(ticket.total || 0)
  ), 0), [openSheets, fiscalByTicket]);
  const unsafeFractionIds = useMemo(() => new Set(tickets.filter(ticket => (
    getPaymentFractionFiscalDifference(ticket, fiscalByTicket.get(String(ticket.id))?.total ?? Number(ticket.total || 0)) > 0
  )).map(ticket => String(ticket.id))), [tickets, fiscalByTicket]);
  const partiallyPaidIds = useMemo(() => new Set(tickets.filter(ticket => (
    ticket.paymentFraction?.parts.some(part => part.status === 'PAID')
  )).map(ticket => String(ticket.id))), [tickets]);
  const [newName, setNewName] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  const [transferSource, setTransferSource] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsedLabel = getTableOpenElapsedLabel(table.timeSeated, tickets.map(ticket => ticket.timestamp), now);
  const printableIds = openSheets.filter(ticket => ticket.items?.length).map(ticket => String(ticket.id));
  const transferableTickets = tickets.filter(ticket => !ticket.paymentFraction && ticket.items?.length);
  const transferDestinations = openSheets.filter(ticket => !ticket.paymentFraction && ticket.id !== transferSource);
  const expandedTicket = openSheets.find(ticket => String(ticket.id) === expandedTicketId);

  const run = async (action: () => unknown | Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación.'); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/45 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-busy={busy} aria-label={`Cuentas de ${table.nombre || table.name}`}>
      <div className="flex max-h-[94vh] w-full max-w-[1780px] flex-col overflow-hidden rounded-[2rem] border border-sky-100 bg-[#f4f9ff] shadow-2xl">
        <header className="grid shrink-0 grid-cols-1 items-center gap-4 border-b border-sky-100 bg-white px-6 py-5 sm:grid-cols-[minmax(220px,1fr)_auto] xl:grid-cols-[minmax(280px,29%)_minmax(180px,1fr)_auto]">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">Cuentas de la mesa</p>
            <h2 className="text-3xl font-black text-slate-900">{table.nombre || table.name || 'Mesa'}</h2>
            <p className="text-sm font-bold text-slate-500">{elapsedLabel} · {summary.count} cuenta(s) pendiente(s)</p>
          </div>
          <div className="justify-self-start sm:justify-self-end xl:justify-self-start">
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-right" aria-label={`Total de la mesa ${money(tableTotal, currencySymbol)}`}>
              <span className="block text-[10px] font-black uppercase tracking-widest text-blue-700">Total mesa</span>
              <strong className="block text-2xl font-black tabular-nums text-slate-900">{money(tableTotal, currencySymbol)}</strong>
              {Math.abs(tableTotal - summary.total) > 0.009 && <span className="block text-xs font-bold text-blue-700">Saldo pendiente {money(summary.total, currencySymbol)}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 sm:col-span-2 sm:justify-end xl:col-span-1">
            <input aria-label="Nombre de nueva cuenta" value={newName} onChange={event => setNewName(event.target.value)} placeholder={`Cuenta ${tickets.length + 1}`} className="w-40 rounded-xl border border-sky-200 bg-white px-3 py-2 font-semibold text-slate-900" />
            <button type="button" disabled={busy} onClick={() => void run(async () => { await onCreateAccount(newName.trim() || `Cuenta ${tickets.length + 1}`); setNewName(''); })} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 font-bold text-white disabled:opacity-50"><Plus size={18} /> Nueva cuenta</button>
            <button type="button" disabled={busy || printableIds.length === 0 || unsafeFractionIds.size > 0 || partiallyPaidIds.size > 0} onClick={() => void run(() => onPrint(printableIds))} className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 font-bold text-blue-700 disabled:opacity-50"><Printer size={18} /> Pre-cuenta todas</button>
            <button type="button" disabled={busy} onClick={() => { if (!busyRef.current) onClose(); }} aria-label="Cerrar cuentas" className="rounded-full bg-slate-100 p-2 text-slate-600 disabled:opacity-40"><X size={22} /></button>
          </div>
        </header>
        {error && <p role="alert" className="mx-6 mt-3 rounded-xl bg-red-50 px-4 py-2 font-semibold text-red-700">{error}</p>}
        {unsafeFractionIds.size > 0 && <p role="alert" className="mx-6 mt-3 rounded-xl bg-amber-50 px-4 py-2 font-semibold text-amber-800">Una cuenta fraccionada no coincide con su total fiscal. Se bloqueó Cobrar y Pre-cuenta desde esta vista; abra la cuenta en el POS para reconciliarla.</p>}
        {partiallyPaidIds.size > 0 && <p role="alert" className="mx-6 mt-3 rounded-xl bg-amber-50 px-4 py-2 font-semibold text-amber-800">Hay cuotas pagadas. La pre-cuenta completa no representa el saldo pendiente y se bloqueó su impresión; consulte el saldo en el POS.</p>}
        {transferSource && (
          <div className="flex shrink-0 flex-wrap items-end gap-3 border-b border-blue-100 bg-blue-50 px-6 py-3">
            <label className="text-sm font-semibold text-slate-700">Cuenta destino
              <select value={transferTarget} disabled={busy} onChange={event => setTransferTarget(event.target.value)} className="ml-2 rounded-lg border border-blue-200 bg-white p-2 text-slate-900"><option value="">Seleccione cuenta</option>{transferDestinations.map(ticket => <option key={ticket.id} value={ticket.id}>{getTableAccountLabel(ticket, openSheets.indexOf(ticket))}</option>)}</select>
            </label>
            <button type="button" disabled={busy || !transferTarget || !Object.values(quantities).some(quantity => quantity > 0)} onClick={() => void run(async () => { await onTransfer(transferSource, transferTarget, quantities); setTransferSource(null); setTransferTarget(''); setQuantities({}); })} className="rounded-lg bg-blue-600 px-4 py-2 font-bold text-white disabled:opacity-50">Confirmar transferencia</button>
            <button type="button" disabled={busy} onClick={() => { if (busyRef.current) return; setTransferSource(null); setQuantities({}); }} className="rounded-lg bg-white px-4 py-2 font-bold text-slate-600 disabled:opacity-40">Cancelar</button>
          </div>
        )}
        <div className="overflow-auto p-5">
          <div className={`grid min-w-0 grid-cols-1 gap-4 ${expandedTicket ? '' : 'md:grid-cols-2 xl:grid-cols-4'}`}>
            {openSheets.filter(ticket => !expandedTicket || ticket.id === expandedTicket.id).map((ticket) => {
              const index = openSheets.indexOf(ticket);
              const label = getTableAccountLabel(ticket, index);
              const pendingParts = ticket.paymentFraction?.parts.filter(part => part.status === 'PENDING') || [];
              const pendingAmount = pendingParts.reduce((sum, part) => sum + Number(part.amount || 0), 0);
              const fiscal = fiscalByTicket.get(String(ticket.id));
              const fractionDifference = getPaymentFractionFiscalDifference(ticket, fiscal?.total ?? Number(ticket.total || 0));
              const hasPaidParts = partiallyPaidIds.has(String(ticket.id));
              const hasSubtotal = ticket.items?.some(item => Boolean(item.subtotalizedAt)) ?? false;
              return (
                <section key={ticket.id} className={`flex min-h-[510px] min-w-0 flex-col overflow-hidden rounded-[1.5rem] border bg-white shadow-sm ${hasSubtotal ? 'border-amber-300' : 'border-sky-100'}`}>
                  <div className={`border-b px-4 py-3 ${hasSubtotal ? 'border-amber-200 bg-amber-50' : 'border-sky-100 bg-sky-50'}`}>
                    <div className="flex items-center justify-between gap-2"><span className="text-xs font-black uppercase tracking-wider text-blue-600">Cuenta {index + 1}</span><div className="flex items-center gap-1"><button type="button" disabled={busy} aria-label={`${expandedTicket ? 'Restaurar' : 'Maximizar'} ${label}`} onClick={() => setExpandedTicketId(expandedTicket ? null : String(ticket.id))} className="rounded-lg p-1 text-blue-600 disabled:opacity-40">{expandedTicket ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button><button type="button" disabled={busy} aria-label={`Renombrar ${label}`} onClick={() => { setEditingKey(String(ticket.id)); setEditingName(label); }} className="rounded-lg p-1 text-blue-600 disabled:opacity-40"><Pencil size={17} /></button></div></div>
                    {hasSubtotal && <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">Pre-cuenta solicitada</span>}
                    {editingKey === String(ticket.id) ? <form onSubmit={event => { event.preventDefault(); void run(async () => { if (!editingName.trim()) return; await onRenameAccount(ticket, editingName.trim()); setEditingKey(null); }); }} className="mt-2 flex gap-1"><input autoFocus aria-label="Nombre del comensal" value={editingName} onChange={event => setEditingName(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-2 py-1 font-semibold text-slate-900" /><button type="submit" aria-label="Guardar nombre" className="rounded-lg bg-blue-600 p-2 text-white"><Check size={16} /></button></form> : <h3 className="truncate text-xl font-black text-slate-900">{label}</h3>}
                    <p className="text-xs font-semibold text-slate-500">{ticket.items?.length || 0} líneas · {new Date(ticket.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    {fractionDifference > 0 && <p className="mt-1 text-xs font-bold text-red-700">Cuotas y total fiscal difieren en {money(fractionDifference, currencySymbol)}. Reconciliar en POS.</p>}
                  </div>
                  <div className={`min-h-0 flex-1 overflow-y-auto px-4 py-2 ${expandedTicket ? 'xl:max-h-[56vh]' : 'xl:max-h-[42vh]'}`}>
                    {(fiscal?.items || ticket.items || []).map((item, itemIndex) => {
                      const addedAfterSubtotal = hasSubtotal && !item.subtotalizedAt;
                      const cartId = String(item.cartId || '');
                      const kitchenDispatched = hasKitchenDispatchEvidence(item);
                      const kitchenPending = kitchenDispatched && !item.dispatched;
                      const alreadyReturned = String(item.kdsStatus || '').toUpperCase() === 'DEVUELTO' || Boolean(item.kdsReturnedAt);
                      return <div key={`${ticket.id}-${lineKey(item, itemIndex)}`} className={`flex justify-between gap-2 border-b border-dashed py-2 text-sm ${addedAfterSubtotal ? 'border-emerald-200 bg-emerald-50 px-2' : 'border-slate-100'}`}><div className="min-w-0"><span className="font-semibold text-slate-800">{item.quantity} × {item.name}</span>{item.note && <p className="text-xs text-slate-500">{item.note}</p>}{item.modifiers?.length ? <p className="text-xs text-slate-500">{item.modifiers.join(', ')}</p> : null}{transferSource === ticket.id && !ticket.paymentFraction && <label className="mt-1 block text-xs text-blue-700">Mover <input aria-label={`Cantidad a transferir de ${item.name}`} type="number" min="0" max={Number(item.quantity || 0)} step="0.001" value={quantities[lineKey(item, itemIndex)] || 0} onChange={event => setQuantities(current => ({ ...current, [lineKey(item, itemIndex)]: Math.max(0, Math.min(Number(item.quantity || 0), Number(event.target.value || 0))) }))} className="ml-1 w-16 rounded border border-blue-200 px-1 py-0.5" /></label>}{expandedTicket && <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy || !cartId || !canAdjustQuantity || kitchenDispatched || !!ticket.paymentFraction} title={!canAdjustQuantity ? 'Sin permiso para ajustar cantidad' : kitchenDispatched ? 'La línea enviada a cocina no permite cambiar cantidad' : undefined} onClick={event => { const inputTimeStamp = event.timeStamp; void run(() => onOpenAccount(ticket, inputTimeStamp, { ticketId: String(ticket.id), cartId, action: 'ADJUST' })); }} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 disabled:opacity-50">Ajustar cantidad</button><button type="button" disabled={busy || !cartId || (!item.dispatched && !canRetireItem) || kitchenPending || alreadyReturned || !!ticket.paymentFraction} title={kitchenPending ? 'Espere la confirmación de cocina antes de devolver' : !item.dispatched && !canRetireItem ? 'Sin permiso para retirar artículos' : undefined} onClick={event => { const inputTimeStamp = event.timeStamp; void run(() => onOpenAccount(ticket, inputTimeStamp, { ticketId: String(ticket.id), cartId, action: 'RETURN' })); }} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 disabled:opacity-50">{kitchenPending ? 'Pendiente en cocina' : item.dispatched ? 'Devolver en cocina' : 'Retirar artículo'}</button></div>}</div><span className="shrink-0 font-bold text-slate-700">{money(Number(item.price || 0) * Number(item.quantity || 0), currencySymbol)}</span></div>;
                    })}
                    {ticket.paymentFraction && <div className="mt-3 rounded-xl bg-blue-50 p-2 text-xs font-semibold text-slate-700"><p className="mb-1 font-black text-blue-700">Cuotas de esta cuenta</p>{ticket.paymentFraction.parts.map(part => <div key={part.index} className="flex justify-between gap-2 border-t border-blue-100 py-1"><span>{part.name || `Cuota ${part.index}`} · {part.status === 'PAID' ? 'Pagada' : 'Pendiente'}</span><span>{money(Number(part.amount || 0), currencySymbol)}</span></div>)}</div>}
                  </div>
                  <div className="border-t border-sky-100 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-2 text-base font-black text-slate-900"><span>Total cuenta{ticket.paymentFraction && <small className="ml-2 text-xs font-semibold text-blue-700">Saldo pendiente {money(pendingAmount, currencySymbol)}</small>}</span><span>{money(fiscal?.total ?? Number(ticket.total || 0), currencySymbol)}</span></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 p-3"><button type="button" disabled={busy || fractionDifference > 0} onClick={event => { const inputTimeStamp = event.timeStamp; void run(() => onOpenAccount(ticket, inputTimeStamp)); }} className="table-account-action table-account-checkout col-span-2 flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-2 font-black text-white disabled:opacity-50">{ticket.items?.length ? <CreditCard size={17} /> : <Plus size={17} />} {ticket.items?.length ? 'Cobrar en POS' : 'Abrir cuenta'}</button>{fractionDifference > 0 && <button type="button" disabled={busy} onClick={event => { const inputTimeStamp = event.timeStamp; void run(() => onOpenAccount(ticket, inputTimeStamp)); }} className="col-span-2 rounded-xl bg-amber-100 py-2 font-bold text-amber-900 disabled:opacity-50">Abrir en POS para reconciliar</button>}<button type="button" aria-label={`Imprimir pre-cuenta de ${label}`} disabled={busy || !ticket.items?.length || fractionDifference > 0 || hasPaidParts} onClick={() => void run(() => onPrint([String(ticket.id)]))} className="rounded-xl border border-blue-200 bg-blue-50 px-2 py-2 text-xs font-bold text-blue-700 disabled:opacity-50"><Printer size={15} className="mr-1 inline" />Pre-cuenta</button><button type="button" disabled={busy || !!ticket.paymentFraction || transferableTickets.length < 1 || transferDestinations.length < 1} title={ticket.paymentFraction ? 'No disponible para cuentas fraccionadas' : transferDestinations.length < 1 ? 'Cree otra cuenta para transferir' : 'Transferir artículos'} onClick={() => { if (busyRef.current) return; setTransferSource(String(ticket.id)); setTransferTarget(''); setQuantities({}); }} className="rounded-xl border border-slate-200 px-2 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"><ArrowRightLeft size={15} className="mr-1 inline" />Transferir</button>{ticket.paymentFraction && <p className="col-span-2 text-xs font-semibold text-amber-700">Transferencia no disponible para cuotas fraccionadas.</p>}</div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TableAccountsSheetsModal;
