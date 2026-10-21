import { subscribeLargeMasterSyncV3CatalogUpdates } from '../services/sync/LargeMasterSyncV3CatalogUpdates';
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { BusinessConfig, Warehouse } from '../types';
import { LargeMasterSyncV3CatalogRead } from '../services/sync/LargeMasterSyncV3CatalogRead';
import { normalizeV3CategoryKey } from '../services/sync/LargeMasterSyncV3Categories';
import type { V3CatalogPageRequest } from '../services/sync/LargeMasterSyncV3Types';
import { createV3CatalogView, type V3CatalogViewState } from '../services/sync/LargeMasterSyncV3CatalogView';

type ClassificationMasters = Pick<BusinessConfig, 'departments' | 'sections' | 'families' | 'brands' | 'posCategories'>;
const classificationFields = [
  { key: 'departmentId', label: 'Departamento', master: 'departments' },
  { key: 'sectionId', label: 'Sección', master: 'sections' },
  { key: 'familyId', label: 'Familia', master: 'families' },
  { key: 'brandId', label: 'Marca', master: 'brands' },
  { key: 'posCategoryId', label: 'Categoría POS', master: 'posCategories' },
] as const;

export function V3CatalogPageView({ state, config }: { state: V3CatalogViewState; config?: ClassificationMasters }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const masters = useMemo(() => classificationFields.map(({ key, master }) => {
    const names = new Map<string, string | undefined>();
    for (const row of config?.[master] || []) {
      const id = key === 'posCategoryId' ? normalizeV3CategoryKey(row.id) : row.id;
      names.set(id, names.has(id) ? undefined : row.name?.trim() || undefined);
    }
    return names;
  }), [config?.departments, config?.sections, config?.families, config?.brands, config?.posCategories]);
  if (state.status === 'loading') return <p role="status">Leyendo catálogo V3...</p>;
  if (state.status === 'error') return <p role="alert">Catálogo V3 no disponible: {state.error}</p>;
  const page = state.page!;
  const selected = page.rows.find(row => row.id === selectedId);
  return <>
    <p>Todos ({page.total}) · Resultados: {page.filteredTotal} · Mostrando: {page.rows.length}</p>
    {!page.rows.length && <p>{page.total === 0 ? 'El catálogo V3 está vacío.' : 'Sin resultados para este filtro.'}</p>}
    <div className="overflow-auto"><table className="w-full text-left"><thead><tr>
      <th>Producto / referencia</th><th>Estado</th><th>Precio de tarifa</th><th>Stock del almacén</th><th>Disponible</th>
    </tr></thead><tbody>{page.rows.map(row => <tr key={row.id} className="border-t">
      <td className="p-3"><button type="button" onClick={() => setSelectedId(row.id)} onFocus={() => setSelectedId(row.id)}
        aria-expanded={selectedId === row.id} aria-controls="v3-article-classification" className="text-left font-bold text-blue-700 underline decoration-dotted underline-offset-4">{row.name}</button><div className="text-xs">{row.sku || row.id}{row.barcode ? ` · ${row.barcode}` : ''}
        {row.categoryId?.trim() ? ` · Categoría ERP: ${row.categoryId}` : ' · Categoría ERP sin asignar'}{row.type ? ` · ${row.type}` : ''}</div></td>
      <td>{row.active ? 'Activo' : 'Inactivo'} · {row.sellable ? 'Vendible' : 'No vendible'}</td>
      <td>{row.price === null ? 'Sin precio' : row.price.toFixed(2)}</td>
      <td>{row.stock ?? 0}</td>
      <td>{row.balance ?? 0}</td>
    </tr>)}</tbody></table></div>
    {selected ? <section id="v3-article-classification" aria-label={`Clasificación de ${selected.name}`} className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h2 className="font-bold">Clasificación · {selected.name}</h2>
      <p className="text-xs break-all">Referencia: {selected.sku || selected.id}</p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{classificationFields.map(({ key, label }, index) => {
        const raw = selected[key];
        const id = key === 'posCategoryId' ? normalizeV3CategoryKey(raw) : raw;
        const name = id ? masters[index].get(id) : undefined;
        return <div key={key} className="min-w-0"><dt className="font-bold">{label}</dt>
          <dd className="break-words">{id ? name || 'Nombre no disponible' : 'Sin asignar'}
            {id && <span className="block text-xs text-slate-500 break-all">ID: {raw}</span>}</dd></div>;
      })}</dl>
    </section> : <p className="mt-4 text-sm text-slate-600">Selecciona un artículo para ver su clasificación.</p>}
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
  const classifications = classificationFields.map(field => ({ ...field, rows: props.config[field.master] }));
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const terminal = props.config.terminals.find(row => row.id === props.terminalId);
  const contextKey = JSON.stringify([props.terminalId, terminal?.config.currentDeviceId, terminal?.config.erpTerminalId,
    terminal?.config.pricing?.defaultTariffId, terminal?.config.inventoryScope?.defaultSalesWarehouseId,
    props.warehouses]);
  const [catalogRevision, setCatalogRevision] = useState(0);
  useEffect(() => {
    const refresh = () => {
      view.cancel(); reader.current = undefined;
      setCursors([null]); setCatalogRevision(previous => previous + 1);
    };
    return subscribeLargeMasterSyncV3CatalogUpdates(refresh);
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
  return <section className="h-full overflow-auto bg-white p-6 text-slate-900">
    <header className="flex justify-between"><h1>Productos V3 · Sólo lectura</h1><button onClick={props.onClose}>Cerrar</button></header>
    <p className="text-sm">Orden estable por ID. Tarifa y almacén configurados en esta terminal. Stock: existencia física más movimientos locales. Disponible: stock menos reservas y compromisos. Si no se recibió saldo para este almacén se muestra 0. Estos valores son informativos.</p>
    <div className="flex flex-wrap gap-3 my-4">
      <input aria-label="Buscar productos" maxLength={120} value={query} onChange={event => {
        view.cancel(); setQuery(event.target.value); setCursors([null]);
      }} placeholder="Nombre, referencia o código" className="border rounded p-2" />
      <select aria-label="Categoría ERP sin asignar" value={category} onChange={event => {
        view.cancel(); setCategory(event.target.value as 'ALL' | 'NONE');
        setCursors([null]);
      }}><option value="ALL">Todos</option><option value="NONE">Categoría ERP sin asignar</option></select>
      {classifications.map(({ key, label, rows }) => <label key={key} className="flex flex-col text-sm gap-1">
        {label}
        <select aria-label={label} className="border rounded p-2" value={filters[key] || ''} onChange={event => {
          view.cancel(); setFilters(previous => ({ ...previous, [key]: event.target.value }));
          setCursors([null]);
        }}>
          <option value="">Todos</option>
          {(rows || []).map(row => <option key={row.id} value={row.id}>{row.name || row.code || row.id}</option>)}
        </select>
      </label>)}
      <button type="button" className="border rounded p-2" onClick={() => {
        view.cancel(); setFilters({}); setCategory('ALL'); setQuery(''); setCursors([null]);
      }}>Limpiar filtros</button>
    </div>
    <V3CatalogPageView state={visible} config={props.config} />
    <nav className="flex gap-4 mt-4" aria-label="Páginas del catálogo">
      <button disabled={visible.status !== 'ready' || cursors.length === 1} onClick={() => {
        view.cancel(); setCursors(previous => previous.slice(0, -1));
      }}>Anterior</button>
      <button disabled={visible.status !== 'ready' || !visible.page?.nextCursor} onClick={() => {
        const cursor = visible.page?.nextCursor; if (cursor) { view.cancel(); setCursors(previous => [...previous, cursor]); }
      }}>Siguiente</button>
    </nav>
  </section>;
}
