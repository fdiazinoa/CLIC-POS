import React, { useEffect, useMemo, useState } from 'react';
import { Printer, X } from 'lucide-react';
import type { BusinessConfig, CashMovement, Transaction, ZReport } from '../types';
import { db } from '../utils/db';
import { buildPosReportDocument, filterPosReportSource, localDate, POS_REPORT_NAMES, validReportDates } from '../utils/posReports';
import type { PosReportKind, PosReportSource } from '../utils/posReports';
import { QUERY_THERMAL_80MM, queryReportPlainText } from '../services/printer/PosReportThermalLayout';
import { printPosReport } from '../services/printer/PosReportPrinter';
import { generateZReportReceipt } from '../services/printer/templates/ZReportReceipt';
import { ThermalPrinterService } from '../services/printer/ThermalPrinterService';
import { resolveTerminalDisplayName } from '../utils/transactionHistoryPresentation';

interface Props {
  config: BusinessConfig;
  transactions: Transaction[];
  terminalId?: string;
  canReprintZ: boolean;
  onClose: () => void;
}

const REPORT_DESCRIPTIONS: Record<PosReportKind, string> = {
  SALES: 'Totales, tickets e impuestos',
  PAYMENTS: 'Importes aplicados por método',
  PRODUCTS: 'Cantidades y productos más vendidos',
  CASHIERS: 'Ventas y ticket promedio por cajero',
  HOURS: 'Actividad por franja horaria',
  ADJUSTMENTS: 'Detalle, importes y motivos',
  CASH: 'Entradas y salidas por moneda',
  Z_HISTORY: 'Consultar y reimprimir cierres',
};

const PosReports: React.FC<Props> = ({ config, transactions, terminalId, canReprintZ, onClose }) => {
  const [kind, setKind] = useState<PosReportKind>('SALES');
  const [period, setPeriod] = useState('TODAY');
  const [start, setStart] = useState(() => localDate());
  const [end, setEnd] = useState(() => localDate());
  const [selectedTerminal, setSelectedTerminal] = useState(terminalId || '');
  const [productLimit, setProductLimit] = useState(10);
  const [source, setSource] = useState<PosReportSource>({ transactions: [], movements: [], reports: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);
  const [reload, setReload] = useState(0);
  const [issuedAt, setIssuedAt] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([db.get('transactionHistory'), db.get('transactions'), db.get('cashMovements'), db.get('zReports')])
      .then(([history, active, movements, reports]) => {
        if (cancelled) return;
        setSource({ transactions: [...((history || []) as Transaction[]), ...transactions, ...((active || []) as Transaction[])], movements: (movements || []) as CashMovement[], reports: (reports || []) as ZReport[] });
        setIssuedAt(new Date());
      }).catch(() => { if (!cancelled) setError('No se pudieron cargar los datos locales. Vuelve a intentar.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [transactions, reload]);

  const filters = useMemo(() => ({ start, end, terminalId: selectedTerminal, productLimit }), [start, end, selectedTerminal, productLimit]);
  const filtered = useMemo(() => filterPosReportSource(source, filters, config), [source, filters, config]);
  const document = useMemo(() => kind === 'Z_HISTORY' ? null : buildPosReportDocument(kind, filtered, filters, config, issuedAt), [kind, filtered, filters, config, issuedAt]);
  const presentation = useMemo(() => {
    try { return { text: document ? queryReportPlainText(document) : '', error: '' }; }
    catch (cause) { return { text: '', error: cause instanceof Error ? cause.message : 'No se pudo preparar el formato térmico.' }; }
  }, [document]);
  const preview = presentation.text;
  const valid = validReportDates(filters);
  const ready = valid && !loading && !error && !presentation.error && !printing;
  const changePeriod = (value: string) => {
    setPeriod(value);
    if (value === 'CUSTOM') return;
    const date = new Date();
    if (value === 'YESTERDAY') date.setDate(date.getDate() - 1);
    setStart(localDate(date)); setEnd(localDate(date));
  };
  const print = async (report?: PosReportSource['reports'][number]) => {
    if (!ready || (report && !canReprintZ)) return;
    setPrinting(true);
    try {
      if (report) await ThermalPrinterService.printZReport(report, [], config, { terminalId });
      else if (document) await printPosReport(document, config, terminalId);
    } finally { setPrinting(false); }
  };
  const inputClass = 'w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
  return <div className="w-full min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto bg-slate-50 p-4 md:p-6">
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div><h1 className="text-2xl font-black text-slate-900">Informes POS</h1><p className="mt-1 text-sm text-slate-600">Consulta e impresión de datos disponibles en este POS. No cierra caja.</p></div>
        <button type="button" onClick={onClose} aria-label="Cerrar informes POS" className="shrink-0 rounded-full bg-white p-3"><X /></button>
      </header>
      <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4" role="group" aria-label="Tipo de informe">
        {(Object.entries(POS_REPORT_NAMES) as [PosReportKind, string][]).filter(([key]) => key !== 'Z_HISTORY' || canReprintZ).map(([key, name]) =>
          <button type="button" key={key} aria-pressed={kind === key} onClick={() => setKind(key)} className={`min-w-0 rounded-xl border p-3 text-left transition-colors ${kind === key ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-400'}`}><span className="block break-words text-sm font-bold leading-5">{name}</span><span className={`mt-1 block text-xs leading-4 ${kind === key ? 'text-blue-100' : 'text-slate-500'}`}>{REPORT_DESCRIPTIONS[key]}</span></button>)}
      </div>
      <div className="grid min-w-0 grid-cols-2 items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:grid-cols-3 xl:grid-cols-6">
        <label className="grid min-w-0 gap-1 text-sm">Período<select className={inputClass} value={period} onChange={e => changePeriod(e.target.value)}><option value="TODAY">Hoy</option><option value="YESTERDAY">Ayer</option><option value="CUSTOM">Rango de fechas</option></select></label>
        <label className="grid min-w-0 gap-1 text-sm">Desde<input type="date" className={inputClass} value={start} onChange={e => { setPeriod('CUSTOM'); setStart(e.target.value); }} /></label>
        <label className="grid min-w-0 gap-1 text-sm">Hasta<input type="date" className={inputClass} value={end} onChange={e => { setPeriod('CUSTOM'); setEnd(e.target.value); }} /></label>
        <label className="grid min-w-0 gap-1 text-sm">Caja<select className={inputClass} value={selectedTerminal} onChange={e => setSelectedTerminal(e.target.value)}><option value="">Todas las cajas disponibles</option>{(config.terminals || []).map(t => <option key={t.id} value={t.id}>{resolveTerminalDisplayName(t.id, config.terminals)}</option>)}{terminalId && !config.terminals?.some(t => t.id === terminalId) && <option value={terminalId}>{resolveTerminalDisplayName(terminalId, config.terminals)}</option>}</select></label>
        {kind === 'PRODUCTS' && <label className="grid min-w-0 gap-1 text-sm">Mostrar<select className={inputClass} value={productLimit} onChange={e => setProductLimit(Number(e.target.value))}><option value={10}>Top 10</option><option value={20}>Top 20</option><option value={0}>Todos</option></select></label>}
        <button type="button" disabled={loading || printing} onClick={() => setReload(value => value + 1)} className={inputClass}>Actualizar</button>
      </div>
      {!valid && <p role="alert" className="text-red-700">Selecciona un rango válido: la fecha inicial debe ser anterior o igual a la final.</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {presentation.error && <p role="alert" className="text-red-700">No se puede imprimir este informe: {presentation.error}</p>}
      {loading ? <p role="status">Cargando informes…</p> : !error && !presentation.error && valid && (kind === 'Z_HISTORY' ?
        <div className="space-y-3">{filtered.reports.length === 0 && <p>No hay cierres Z en este período.</p>}{filtered.reports.map(report => <article key={report.id} className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-bold">{report.sequenceNumber} · {resolveTerminalDisplayName(report.terminalId, config.terminals)}</h2>
          <p className="text-sm text-slate-600">{new Date(report.closedAt).toLocaleString()} · {report.closedByUserName} · {report.transactionCount} tickets</p>
          <details className="mt-3"><summary className="cursor-pointer text-sm font-bold">Vista previa del cierre guardado</summary><iframe title={`Vista previa ${report.sequenceNumber}`} sandbox="" srcDoc={generateZReportReceipt(report, [], config)} className="mt-3 h-96 w-full rounded-xl border border-slate-200 bg-white" /></details>
          <button type="button" disabled={!ready || !canReprintZ} onClick={() => void print(report)} className="mt-3 rounded-xl bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">{printing ? 'Enviando…' : 'Reimprimir cierre Z'}</button>
        </article>)}</div> :
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
            <div className="min-w-0"><h2 className="font-bold text-slate-900">{POS_REPORT_NAMES[kind]}</h2><p className="mt-1 text-xs text-slate-500">Vista previa · 80 mm · Font A · {QUERY_THERMAL_80MM.columns} columnas</p></div>
            <button type="button" disabled={!ready} onClick={() => void print()} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"><Printer size={18} />{printing ? 'Enviando…' : 'Imprimir ticket'}</button>
          </header>
          <div className="min-w-0 bg-slate-100 p-3 md:p-5"><pre className="mx-auto w-full min-w-0 max-w-sm overflow-x-auto whitespace-pre bg-white p-4 font-mono text-xs leading-5 text-black shadow-sm">{preview}</pre></div>
        </section>)}
    </div>
  </div>;
};
export default PosReports;
