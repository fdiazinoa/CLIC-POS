// Shared production presentation components; no API, persistence or operational actions.
import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../index.css';
import '../../components/supermarketTicket.css';
import {FiscalStatusBadge, SyncStatusBadge, TicketStatusControls, TicketTotalStatusRow} from '../../components/POSStatusIndicators';
import SupermarketTicketSummary from '../../components/SupermarketTicketSummary';
const params = new URLSearchParams(window.location.search);
const state = {pendingCount: Number(params.get('pending') || 3), blockedCount: Number(params.get('blocked') || 0), hasError: params.has('error')};
const online = !params.has('offline');
const total = params.has('large') ? 123456789.12 : 2625;
const mobile = params.has('mobile');
const sync = <SyncStatusBadge online={online} state={state} />;
const fiscal = <FiscalStatusBadge compact visible allowed={!params.has('exhausted')} status={{type:'B02', hasNCF: !params.has('exhausted'), isTerminalBlock: true}} />;
const controls = <><button className="h-12 w-12 shrink-0 rounded-xl border">Bolsa</button><button className="h-12 w-12 shrink-0 rounded-xl border">Acción</button><button className="h-12 px-3 shrink-0 rounded-xl border">En local</button></>;
createRoot(document.getElementById('root')!).render(<main className="min-h-screen flex flex-col bg-white">
  <p className="text-xs p-2">Fixture de presentación compartida — sin operaciones</p>
  {mobile ? <header className="p-4 border-b"><TicketStatusControls className="flex items-center justify-end gap-2" status={fiscal}>{controls}</TicketStatusControls></header> : <header className="p-5 border-b"><div className="supermarket-ticket-toolbar flex w-full items-center justify-between gap-1"><strong>CLIC POS</strong><input aria-label="Buscar" placeholder="Escanear o buscar…" className="min-w-0 max-w-xl flex-1 bg-gray-100 rounded-xl p-3" /><TicketStatusControls className="ml-auto flex shrink-0 items-center justify-end gap-1" status={fiscal}>{controls}</TicketStatusControls></div></header>}
  <div className="flex-1 p-5 text-slate-500">Cantidad · Descripción · Precio · ITBIS · Total</div>
  {mobile ? <footer className="fixed left-0 right-0 bottom-0 p-4 bg-white border-t"><div className="supermarket-mobile-checkout flex items-center gap-4"><TicketTotalStatusRow className="flex-1 min-w-0" status={sync}><div className="min-w-0"><span>Total</span><p className="text-3xl font-black break-words">RD${total.toLocaleString('en-US', {minimumFractionDigits:2})}</p></div></TicketTotalStatusRow><button className="h-14 px-8 rounded-xl bg-blue-600 text-white">COBRAR</button></div></footer> : <footer className="supermarket-footer flex-none p-4 border-t"><div className="supermarket-footer-secondary">Acciones secundarias</div><SupermarketTicketSummary symbol="RD$" subtotal={total} discount={0} tax={400.42} total={total} units={3} points={262} status={sync} /><div className="supermarket-checkout"><div>Acciones del ticket</div><div className="supermarket-checkout-buttons"><button className="h-14 rounded-xl bg-red-50 text-red-700">Salir</button><button className="h-14 rounded-xl bg-slate-900 text-white">COBRAR</button></div></div></footer>}
</main>);
