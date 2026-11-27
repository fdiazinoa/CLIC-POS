import { subscribeLargeMasterSyncV3CatalogUpdates } from '../services/sync/LargeMasterSyncV3CatalogUpdates';
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { BusinessConfig, Warehouse } from '../types';
import { LargeMasterSyncV3CatalogRead } from '../services/sync/LargeMasterSyncV3CatalogRead';
import { normalizeV3CategoryKey } from '../services/sync/LargeMasterSyncV3Categories';
import type { V3CatalogArticle, V3CatalogPageRequest } from '../services/sync/LargeMasterSyncV3Types';
import { createV3CatalogView, type V3CatalogViewState } from '../services/sync/LargeMasterSyncV3CatalogView';

type ClassificationMasters = Pick<BusinessConfig, 'departments' | 'sections' | 'families' | 'brands' | 'posCategories'>;
const classificationFields = [
  { key: 'departmentId', label: 'Departamento', master: 'departments' },
  { key: 'sectionId', label: 'Sección', master: 'sections' },
  { key: 'familyId', label: 'Familia', master: 'families' },
  { key: 'brandId', label: 'Marca', master: 'brands' },
  { key: 'posCategoryId', label: 'Categoría POS', master: 'posCategories' },
] as const;


/** Inline stroke icons keep the lazy chunk free of extra renderer dependencies. */
function CatalogIcon({ name, className }: { name: 'search' | 'layers' | 'info' | 'x' | 'sliders'; className?: string }) {
  const shared = { 'aria-hidden': true, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className };
  if (name === 'search') return <svg {...shared}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.7-3.7" /></svg>;
  if (name === 'sliders') return <svg {...shared}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>;
  if (name === 'layers') return <svg {...shared}><path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z" /><path d="m3.5 12 8.5 4.5 8.5-4.5" /><path d="m3.5 16.5 8.5 4.5 8.5-4.5" /></svg>;
  if (name === 'x') return <svg {...shared}><path d="M6 6l12 12M18 6 6 18" /></svg>;
  return <svg {...shared}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
}

/** Read-only tariff/warehouse context resolved by the manager; never invented per row. */
export type V3CatalogPricingContext = { tariffName?: string; currency?: string; currencySymbol?: string; warehouseName?: string };

const NOT_AVAILABLE = 'No disponible';
const numeric = (value: number | null | undefined): number | undefined => typeof value === 'number' ? value : undefined;
/** Local and ERP stock are mutually exclusive in V3; the other source is honestly unavailable. */
const localStockOf = (row: V3CatalogArticle) => row.stockSource === 'ERP' ? undefined : numeric(row.stock);
const erpStockOf = (row: V3CatalogArticle) => row.stockSource === 'ERP' ? numeric(row.stock) : undefined;
const money = (price: number | null) => price === null ? 'Sin precio' : price.toFixed(2);
/** Detail view prefixes the configured symbol; the compact list stays numeric. */
const displayPrice = (price: number | null, currencySymbol?: string) => price === null ? money(price) : `${currencySymbol || 'RD$'} ${price.toFixed(2)}`;
const quantity = (value: number | undefined) => value === undefined ? NOT_AVAILABLE : String(value);
const stockTone = (value: number | undefined) => value === undefined ? 'text-slate-400' : value < 0 ? 'text-rose-600' : value === 0 ? 'text-slate-400' : 'text-emerald-600';
const resolvedClassification = (row: V3CatalogArticle, key: typeof classificationFields[number]['key'], index: number,
  masters: ReadonlyArray<Map<string, string | undefined>>) => {
  const raw = row[key];
  const id = key === 'posCategoryId' ? normalizeV3CategoryKey(raw) : raw;
  return { raw: id ? raw : undefined, id, name: id ? masters[index].get(id) : undefined };
};

function ArticleDetail({ row, masters, pricing }: {
  row: V3CatalogArticle; masters: ReadonlyArray<Map<string, string | undefined>>; pricing?: V3CatalogPricingContext;
}) {
  const local = localStockOf(row); const erp = erpStockOf(row); const available = numeric(row.balance);
  const category = row.categoryId?.trim();
  return <>
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-b from-[#f1ebff] to-[#e8ddff] text-[15px] font-black text-[#6d28d9]">
        {(row.name.trim().charAt(0) || '?').toUpperCase()}
      </span>
      <div className="min-w-0">
        <h2 className="text-[15px] font-black leading-tight tracking-[-0.02em] text-slate-900">{row.name}</h2>
        <p className="mt-0.5 break-all text-[10px] font-semibold text-slate-400">
          <span className="sr-only">Referencia: </span>{row.sku || row.id}{row.barcode ? ` · ${row.barcode}` : ''}{category ? ` · Categoría ERP: ${category}` : ''}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className={`inline-flex h-[18px] items-center rounded-[5px] px-1.5 text-[8px] font-black uppercase tracking-[0.04em] ${row.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{row.active ? 'Activo' : 'Inactivo'}</span>
          <span className={`inline-flex h-[18px] items-center rounded-[5px] px-1.5 text-[8px] font-black uppercase tracking-[0.04em] ${row.sellable ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>{row.sellable ? 'Vendible' : 'No vendible'}</span>
          <span className="inline-flex h-[18px] items-center rounded-[5px] bg-slate-100 px-1.5 text-[8px] font-black uppercase tracking-[0.04em] text-slate-500">{row.type || 'Sin tipo'}</span>
        </div>
      </div>
    </div>

    <div className="rounded-2xl border border-[#ece6fb] bg-white px-3.5 py-3">
      <p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">Precio de tarifa{pricing?.tariffName ? ` · ${pricing.tariffName}` : ''}</p>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <b className="text-2xl font-black tracking-[-0.04em] text-slate-900">{displayPrice(row.price, pricing?.currencySymbol)}</b>
        {row.price !== null && pricing?.currency && <small className="text-[9px] font-extrabold text-slate-400">{pricing.currency}</small>}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[9px] font-extrabold text-slate-400">Disponible en {pricing?.warehouseName || 'el almacén de la terminal'}</span>
        <span className={`inline-flex h-[21px] items-center rounded-md px-1.5 text-[9px] font-black ${available === undefined || available < 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'}`}>{quantity(available)}</span>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-[11px] border border-[#edf1f7] bg-white px-2.5 py-2">
        <p className="text-[7.5px] font-black uppercase tracking-[0.1em] text-slate-400">Stock local</p>
        <b className={`mt-0.5 block text-[13px] font-black ${stockTone(local)}`}>{quantity(local)}</b>
      </div>
      <div className="rounded-[11px] border border-[#edf1f7] bg-white px-2.5 py-2">
        <p className="text-[7.5px] font-black uppercase tracking-[0.1em] text-slate-400">Stock ERP</p>
        <b className={`mt-0.5 block text-[13px] font-black ${stockTone(erp)}`}>{quantity(erp)}</b>
      </div>
      <div className="rounded-[11px] border border-[#edf1f7] bg-white px-2.5 py-2">
        <p className="text-[7.5px] font-black uppercase tracking-[0.1em] text-slate-400">Disponible</p>
        <b className={`mt-0.5 block text-[13px] font-black ${stockTone(available)}`}>{quantity(available)}</b>
      </div>
      <div className="rounded-[11px] border border-[#edf1f7] bg-white px-2.5 py-2">
        <p className="text-[7.5px] font-black uppercase tracking-[0.1em] text-slate-400">Categoría ERP</p>
        <b className="mt-0.5 block break-all text-[10px] font-black text-slate-700">{category || 'Sin asignar'}</b>
      </div>
    </div>

    <div>
      <h3 className="text-[8px] font-black uppercase tracking-[0.13em] text-slate-400">Clasificación</h3>
      <dl className="mt-1 space-y-1.5">
        {classificationFields.map(({ key, label }, index) => {
          const resolved = resolvedClassification(row, key, index, masters);
          return <div key={key} className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-[9.5px] font-bold text-slate-500">{label}</dt>
            <dd className="min-w-0 break-words text-right text-[9.5px] font-extrabold text-slate-700">
              {!resolved.id ? 'Sin asignar' : resolved.name || <>{'Nombre no disponible'} <span className="block break-all text-[8.5px] font-semibold text-slate-400">ID: {resolved.raw}</span></>}
            </dd>
          </div>;
        })}
      </dl>
    </div>

    <div className="flex items-start gap-2 rounded-[10px] border border-[#eef2f7] bg-white px-2.5 py-2 text-[9px] font-semibold leading-snug text-slate-400">
      <CatalogIcon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
      <p><b className="block text-[9.5px] font-extrabold text-slate-600">Saldos informativos</b> ERP: último saldo sincronizado · Local: movimientos de la caja.</p>
    </div>

    {/* Native disclosure keeps the full record readable without extra state or mutations. */}
    <details className="mt-auto rounded-[10px] bg-[#5b21f0]">
      <summary className="cursor-pointer list-none rounded-[10px] px-3 py-2.5 text-center text-[11px] font-black tracking-[0.03em] text-white marker:hidden [&::-webkit-details-marker]:hidden">
        Ver ficha completa
      </summary>
      <dl className="mt-1 grid grid-cols-2 gap-2 rounded-[10px] bg-white px-3 py-2.5 text-[9.5px] [&>div]:min-w-0">
        <div><dt className="font-bold text-slate-400">ID</dt><dd className="break-all font-extrabold text-slate-700">{row.id}</dd></div>
        <div><dt className="font-bold text-slate-400">SKU</dt><dd className="break-all font-extrabold text-slate-700">{row.sku || 'Sin SKU'}</dd></div>
        <div><dt className="font-bold text-slate-400">Código de barras</dt><dd className="break-all font-extrabold text-slate-700">{row.barcode || 'Sin código'}</dd></div>
        <div><dt className="font-bold text-slate-400">Tipo</dt><dd className="break-all font-extrabold text-slate-700">{row.type || 'Sin tipo'}</dd></div>
        <div><dt className="font-bold text-slate-400">Estado</dt><dd className="font-extrabold text-slate-700">{row.active ? 'Activo' : 'Inactivo'} · {row.sellable ? 'Vendible' : 'No vendible'}</dd></div>
        <div><dt className="font-bold text-slate-400">Categoría ERP</dt><dd className="break-all font-extrabold text-slate-700">{category || 'Sin categoría'}</dd></div>
        <div><dt className="font-bold text-slate-400">Precio de tarifa</dt><dd className="font-extrabold text-slate-700">{displayPrice(row.price, pricing?.currencySymbol)}</dd></div>
        <div><dt className="font-bold text-slate-400">Saldos</dt><dd className="font-extrabold text-slate-700">Local {quantity(local)} · ERP {quantity(erp)} · Disponible {quantity(available)}</dd></div>
      </dl>
    </details>
  </>;
}

export function V3CatalogPageView({ state, config, pricing }: {
  state: V3CatalogViewState; config?: ClassificationMasters; pricing?: V3CatalogPricingContext;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rowButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const masters = useMemo(() => classificationFields.map(({ key, master }) => {
    const names = new Map<string, string | undefined>();
    for (const row of config?.[master] || []) {
      const id = key === 'posCategoryId' ? normalizeV3CategoryKey(row.id) : row.id;
      names.set(id, names.has(id) ? undefined : row.name?.trim() || undefined);
    }
    return names;
  }), [config?.departments, config?.sections, config?.families, config?.brands, config?.posCategories]);
  if (state.status === 'loading') return <p role="status" className="p-6 text-sm font-semibold text-slate-500">Leyendo catálogo V3...</p>;
  if (state.status === 'error') return <p role="alert" className="p-6 text-sm font-semibold text-rose-600">Catálogo V3 no disponible: {state.error}</p>;
  const page = state.page!;
  const selected = page.rows.find(row => row.id === selectedId);
  return <>
    {!page.rows.length
      ? <div className="flex flex-1 items-center justify-center p-8">
          <p className="text-center text-sm font-semibold text-slate-500">{page.total === 0 ? 'El catálogo V3 está vacío.' : 'Sin resultados para este filtro.'}</p>
        </div>
      : <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_404px]">
          <section aria-label="Lista de artículos" className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-left [&>tbody>tr>td:nth-child(2)]:text-right [&>tbody>tr>td:nth-child(3)]:text-right [&>tbody>tr>td:nth-child(4)]:whitespace-nowrap [&>tbody>tr>td:nth-child(4)]:px-3 [&>tbody>tr>td:nth-child(4)]:py-2 [&>tbody>tr>td:nth-child(4)]:text-right [&>tbody>tr>td:nth-child(4)]:text-[11px] [&>tbody>tr>td:nth-child(4)]:font-black [&>tbody>tr>td:nth-child(4)]:text-slate-700">
                <thead className="sticky top-0 z-10 bg-[#fcfdff]">
                  <tr>
                    <th scope="col" className="border-b border-[#eef2f7] px-3 py-2 text-[8.5px] font-black uppercase tracking-[0.1em] text-slate-400">Producto / referencia</th>
                    <th scope="col" className="border-b border-[#eef2f7] px-2 py-2 text-right text-[8.5px] font-black uppercase tracking-[0.1em] text-slate-400">Precio</th>
                    <th scope="col" className="border-b border-[#eef2f7] px-2 py-2 text-right text-[8.5px] font-black uppercase tracking-[0.1em] text-slate-400">Stock</th>
                    <th scope="col" className="border-b border-[#eef2f7] px-3 py-2 text-right text-[8.5px] font-black uppercase tracking-[0.1em] text-slate-400">Disponible</th>
                  </tr>
                </thead>
                <tbody>{page.rows.map((row, index) => {
                  const active = selected?.id === row.id;
                  return <tr key={row.id} className={`border-b border-[#f3f6fa] ${active ? 'bg-gradient-to-r from-[#faf7ff] to-white' : 'bg-white'}`}>
                    <td className={`border-l-[3px] px-3 py-2 ${active ? 'border-[#5b21f0]' : 'border-transparent'}`}>
                      <button type="button" ref={(element) => { rowButtons.current[index] = element; }}
                        onClick={() => setSelectedId(row.id)} onFocus={() => setSelectedId(row.id)}
                        aria-expanded={active} aria-controls="v3-article-detail"
                        onKeyDown={event => {
                          const focusAt = (target: number) => {
                            if (target < 0 || target >= page.rows.length) return;
                            event.preventDefault();
                            setSelectedId(page.rows[target].id);
                            rowButtons.current[target]?.focus();
                          };
                          if (event.key === 'ArrowDown') focusAt(index + 1);
                          else if (event.key === 'ArrowUp') focusAt(index - 1);
                          else if (event.key === 'Home') focusAt(0);
                          else if (event.key === 'End') focusAt(page.rows.length - 1);
                        }}
                        className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b21f0]">
                        <span className="block truncate text-[11.5px] font-extrabold tracking-[-0.01em] text-slate-900">{row.name}</span>
                        <span className="mt-0.5 block truncate text-[8.8px] font-semibold text-slate-400">
                          {row.sku || row.id}{row.barcode ? ` · ${row.barcode}` : ''} · {row.categoryId?.trim() || 'Sin categoría'}
                        </span>
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-[11.5px] font-black text-slate-900">{money(row.price)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-[11px] font-black">
                      <span className={stockTone(numeric(row.stock))}>{quantity(numeric(row.stock))}</span>{' '}
                      <small className="text-[8px] font-extrabold uppercase text-slate-400">{row.stockSource === 'ERP' ? 'ERP' : 'Local'}</small>
                    </td>
                    {/* Contract cell: keep the plain <td> the catalog tests assert for zero balances. */}
                    <td>{quantity(numeric(row.balance))}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </section>
          <aside id="v3-article-detail" role="region" aria-label={selected ? `Ficha de ${selected.name}` : 'Ficha del artículo'}
            className="flex min-h-0 flex-col gap-3 overflow-y-auto border-t border-[#e8edf5] bg-[#fbfcff] p-4 lg:border-l lg:border-t-0 lg:p-5">
            {selected
              ? <ArticleDetail row={selected} masters={masters} pricing={pricing} />
              : <p className="p-2 text-sm font-semibold text-slate-500">Selecciona un artículo de la lista para ver su ficha.</p>}
          </aside>
        </div>}
  </>;
}

/** Deliberately accepts no mutation callbacks or legacy products. */
export default function LargeMasterSyncV3CatalogManager(props: {
  config: BusinessConfig; terminalId?: string; warehouses: Warehouse[]; onClose(): void;
}) {
  const latest = useRef(props); latest.current = props;
  const [view] = useState(createV3CatalogView);
  const state = useSyncExternalStore(view.subscribe, view.getSnapshot, view.getSnapshot);
  const [query, setQuery] = useState(''); const [category, setCategory] = useState<'ALL' | 'NONE'>('ALL');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  type ClassificationKey = 'departmentId' | 'sectionId' | 'familyId' | 'brandId' | 'posCategoryId';
  const [filters, setFilters] = useState<Pick<V3CatalogPageRequest, ClassificationKey>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const classifications = classificationFields.map(field => ({ ...field, rows: props.config[field.master] }));
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const terminal = props.config.terminals.find(row => row.id === props.terminalId);
  const contextKey = JSON.stringify([props.terminalId, terminal?.config.currentDeviceId, terminal?.config.erpTerminalId,
    terminal?.config.erpBinding?.tenantId, terminal?.config.erpBinding?.companyId, terminal?.config.erpBinding?.storeId,
    terminal?.config.pricing?.defaultTariffId, terminal?.config.inventoryScope, props.warehouses]);
  const [catalogRevision, setCatalogRevision] = useState(0);
  useEffect(() => {
    const refresh = () => {
      view.cancel(); reader.current = undefined;
      setCursors([null]); setCatalogRevision(previous => previous + 1);
    };
    const unsubscribe = subscribeLargeMasterSyncV3CatalogUpdates(refresh);
    window.addEventListener('v3ErpStockDisplayUpdated', refresh);
    return () => { unsubscribe(); window.removeEventListener('v3ErpStockDisplayUpdated', refresh); };
  }, [view]);
  const oldContext = useRef(contextKey);
  const reader = useRef<Promise<LargeMasterSyncV3CatalogRead>>();
  useEffect(() => {
    view.cancel(); reader.current = undefined;
    setFilters(previous => Object.keys(previous).length === 0 ? previous : {}); setCategory('ALL');
    setCursors(previous => previous.length === 1 && previous[0] === null ? previous : [null]);
    oldContext.current = contextKey;
    return () => { view.cancel(); };
  }, [contextKey, view]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    view.cancel();
    if (query !== debouncedQuery || (!reader.current && (cursors[cursors.length - 1] ?? null) !== null)) return;
    void view.load(async () => {
        if (!reader.current) reader.current = LargeMasterSyncV3CatalogRead.open(() => ({ config: latest.current.config,
          terminalId: latest.current.terminalId || '', warehouses: latest.current.warehouses }));
        const current = await reader.current;
        return current.page({ query: debouncedQuery, category, ...filters, afterId: (cursors[cursors.length - 1] ?? null), limit: 25 });
    });
    return () => { view.cancel(); };
  }, [query, debouncedQuery, category, filters, cursors, contextKey, catalogRevision, view]);
  // A changed context must not paint the old page while effects reset its cursor/reader.
  const visible = oldContext.current === contextKey ? state : { status: 'loading' as const };
  // F-2: never surface a raw terminal UUID in the header.
  const terminalLabel = (() => {
    const configured = terminal?.config;
    const name = configured?.terminalName?.trim();
    if (name) return name;
    const station = configured?.stationNumber === null || configured?.stationNumber === undefined
      ? '' : String(configured.stationNumber).trim();
    if (station) return `Caja ${station}`;
    const erpTerminal = configured?.erpTerminalId?.trim();
    const looksLikeUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    if (erpTerminal && !looksLikeUuid(erpTerminal)) return erpTerminal;
    const rawId = props.terminalId?.trim() || '';
    if (rawId && !looksLikeUuid(rawId)) return rawId;
    return '';
  })();
  const defaultTariffId = terminal?.config.pricing?.defaultTariffId;
  const tariff = (props.config.tariffs || []).find(row => row.id === defaultTariffId);
  const defaultWarehouseId = terminal?.config.inventoryScope?.defaultSalesWarehouseId;
  const warehouse = (props.warehouses || []).find(row => row.id === defaultWarehouseId)
    || (props.warehouses || []).find(row => row.isMain) || (props.warehouses || [])[0];
  const activeFilterCount = classifications.filter(({ key }) => Boolean(filters[key])).length + (category === 'ALL' ? 0 : 1);
  const classificationSelect = (key: ClassificationKey, ariaLabel: string, className: string) => {
    const field = classificationFields.find(item => item.key === key)!;
    const rows = classifications.find(item => item.key === key)?.rows || [];
    return <label className={className}>
      <span className="sr-only">{field.label}</span>
      <select aria-label={ariaLabel} value={filters[key] || ''} onChange={event => {
        view.cancel(); setFilters(previous => ({ ...previous, [key]: event.target.value }));
        setCursors([null]);
      }} className="h-9 min-w-[150px] rounded-[10px] border border-[#e6ebf3] bg-white px-2.5 text-[10px] font-extrabold text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b21f0]">
        <option value="">{field.label}: Todos</option>
        {Boolean(filters[key]) && !rows.some(row => row.id === filters[key]) && <option value={filters[key]}>{filters[key]}</option>}
        {rows.map(row => <option key={row.id} value={row.id}>{row.name || row.code || row.id}</option>)}
      </select>
    </label>;
  };
  const firstVisible = (cursors.length - 1) * 25 + 1;
  const lastVisible = visible.status === 'ready' ? firstVisible + (visible.page?.rows.length || 0) - 1 : firstVisible - 1;
  return <section className="relative flex h-full min-h-[480px] flex-col bg-white text-slate-900" aria-labelledby="v3-catalog-title">
    <header className="flex items-center justify-between gap-4 border-b border-[#e8edf5] px-5 py-3 lg:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#f1ebff] text-[#5b21f0]"><CatalogIcon name="layers" className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="truncate text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">POS · Terminal{terminalLabel ? ' ' : ''}{terminalLabel ? <b className="text-[#5b21f0]">{terminalLabel}</b> : null}</p>
          <h1 id="v3-catalog-title" className="text-xl font-black tracking-[-0.02em] text-slate-900">Maestro de Artículos</h1>
          <p className="truncate text-[11px] font-semibold text-slate-500">
            {tariff?.name || 'Tarifa de la terminal'} · {warehouse?.name || 'Almacén de la terminal'} · {visible.status === 'ready' ? visible.page?.total ?? 0 : '—'} artículos
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-full border border-[#eee3ff] bg-[#fbf8ff] px-3 py-1.5 text-[10px] font-extrabold text-[#6d28d9] sm:inline-flex">
          <CatalogIcon name="info" className="h-3.5 w-3.5" /> Saldos ERP / Local
        </span>
        <button type="button" onClick={props.onClose} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[#e6ebf3] bg-white px-3 text-[11px] font-black text-slate-700 hover:bg-slate-50">
          <CatalogIcon name="x" className="h-3.5 w-3.5" /> Cerrar
        </button>
      </div>
    </header>
    <div className="flex flex-wrap items-center gap-2 border-b border-[#f1f4f9] bg-[#fcfdff] px-5 py-2.5 lg:px-6">
      <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-[10px] border border-[#e6ebf3] bg-white px-2.5">
        <CatalogIcon name="search" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <input aria-label="Buscar productos" maxLength={120} value={query} onChange={event => {
          view.cancel(); setQuery(event.target.value); setCursors([null]);
        }} placeholder="Nombre, referencia o código" className="h-full w-full bg-transparent text-[11px] font-semibold text-slate-700 placeholder:text-slate-400 focus:outline-none" />
      </div>
      {/* DOM order keeps the pre-existing category filter first; CSS order places it after the named filters. */}
      <label className="order-last flex flex-col">
        <span className="sr-only">Categoría ERP</span>
        <select aria-label="Categoría ERP sin asignar" value={category} onChange={event => {
          view.cancel(); setCategory(event.target.value as 'ALL' | 'NONE');
          setCursors([null]);
        }} className="h-9 min-w-[150px] rounded-[10px] border border-[#e6ebf3] bg-white px-2.5 text-[10px] font-extrabold text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b21f0]">
          <option value="ALL">Categoría ERP: Todas</option><option value="NONE">Categoría ERP sin asignar</option>
        </select>
      </label>
      {classificationSelect('departmentId', 'Departamento', 'flex flex-col')}
      {classificationSelect('posCategoryId', 'Categoría POS', 'flex flex-col')}
      <button type="button" aria-expanded={filtersOpen} aria-controls="v3-catalog-filters" onClick={() => setFiltersOpen(open => !open)}
        className={`inline-flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-[10px] font-black ${activeFilterCount ? 'border-[#ddd0ff] bg-[#fbf8ff] text-[#6d28d9]' : 'border-[#e6ebf3] bg-white text-slate-600'} hover:bg-slate-50`}>
        <CatalogIcon name="sliders" className="h-3.5 w-3.5" /> Filtros <b className="text-[9px]">{activeFilterCount}</b>
      </button>
    </div>
    {activeFilterCount > 0 && <div className="flex flex-wrap items-center gap-1.5 border-b border-[#f1f4f9] bg-white px-5 py-2 lg:px-6" aria-label="Filtros aplicados">
      {classificationFields.filter(({ key }) => Boolean(filters[key])).map(({ key, label }) => {
        const applied = filters[key] as string;
        const named = (classifications.find(item => item.key === key)?.rows || []).find(row => row.id === applied)?.name;
        return <span key={key} className="inline-flex items-center gap-1 rounded-full border border-[#ddd0ff] bg-[#fbf8ff] px-2.5 py-1 text-[10px] font-extrabold text-[#6d28d9]">
          {label}: {named || applied}
          <button type="button" aria-label={`Quitar filtro ${label}`} onClick={() => {
            view.cancel(); setFilters(previous => { const next = { ...previous }; delete next[key]; return next; }); setCursors([null]);
          }} className="rounded-full px-0.5 text-[11px] font-black text-[#8b5cf6] hover:text-[#5b21f0]">×</button>
        </span>;
      })}
      {category !== 'ALL' && <span className="inline-flex items-center gap-1 rounded-full border border-[#ddd0ff] bg-[#fbf8ff] px-2.5 py-1 text-[10px] font-extrabold text-[#6d28d9]">
        Categoría ERP: Sin asignar
        <button type="button" aria-label="Quitar filtro Categoría ERP" onClick={() => { view.cancel(); setCategory('ALL'); setCursors([null]); }}
          className="rounded-full px-0.5 text-[11px] font-black text-[#8b5cf6] hover:text-[#5b21f0]">×</button>
      </span>}
      <button type="button" onClick={() => {
        view.cancel(); setFilters({}); setCategory('ALL'); setQuery(''); setCursors([null]);
      }} className="rounded-full border border-[#e6ebf3] bg-white px-2.5 py-1 text-[10px] font-black text-slate-600 hover:bg-slate-50">Limpiar filtros</button>
    </div>}
    {filtersOpen && <div id="v3-catalog-filters" className="flex flex-wrap items-end gap-3 border-b border-[#f1f4f9] bg-[#fcfdff] px-5 py-3 lg:px-6">
      {classificationSelect('sectionId', 'Sección', 'flex flex-col gap-1 text-[9px] font-black uppercase tracking-[0.08em] text-slate-400')}
      {classificationSelect('familyId', 'Familia', 'flex flex-col gap-1 text-[9px] font-black uppercase tracking-[0.08em] text-slate-400')}
      {classificationSelect('brandId', 'Marca', 'flex flex-col gap-1 text-[9px] font-black uppercase tracking-[0.08em] text-slate-400')}
      <button type="button" onClick={() => {
        view.cancel(); setFilters({}); setCategory('ALL'); setQuery(''); setCursors([null]);
      }} className="h-9 rounded-[10px] border border-[#e6ebf3] bg-white px-3 text-[10px] font-black text-slate-600 hover:bg-slate-50">Limpiar filtros</button>
    </div>}
    <V3CatalogPageView state={visible} config={props.config}
      pricing={{ tariffName: tariff?.name, currency: tariff?.currency, currencySymbol: props.config.currencySymbol, warehouseName: warehouse?.name }} />
    <footer className="flex items-center justify-between gap-3 border-t border-[#e8edf5] bg-white px-4 py-2">
      <p className="text-[10px] font-bold text-slate-400">
        {visible.status === 'ready' && visible.page
          ? visible.page.filteredTotal === 0 || visible.page.rows.length === 0
            ? <><b className="text-slate-600">Mostrando 0</b> de <b className="text-slate-600">0</b> · 25 por página</>
            : <><b className="text-slate-600">Mostrando {firstVisible}–{Math.max(firstVisible, lastVisible)}</b> de <b className="text-slate-600">{visible.page.filteredTotal}</b> · 25 por página</>
          : 'Cargando artículos…'}
      </p>
      <nav className="flex items-center gap-1.5" aria-label="Páginas del catálogo">
        <button type="button" disabled={visible.status !== 'ready' || cursors.length === 1} onClick={() => {
          view.cancel(); setCursors(previous => previous.slice(0, -1));
        }} className="inline-flex h-9 items-center rounded-lg border border-[#e8edf5] px-2.5 text-[10px] font-black text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Anterior</button>
        <span aria-current="page" className="inline-flex h-9 min-w-[32px] items-center justify-center rounded-lg bg-[#5b21f0] px-1.5 text-[10px] font-black text-white">{cursors.length}</span>
        <button type="button" disabled={visible.status !== 'ready' || !visible.page?.nextCursor} onClick={() => {
          const cursor = visible.page?.nextCursor; if (cursor) { view.cancel(); setCursors(previous => [...previous, cursor]); }
        }} className="inline-flex h-9 items-center rounded-lg border border-[#e8edf5] px-2.5 text-[10px] font-black text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Siguiente</button>
      </nav>
    </footer>
  </section>;
}
