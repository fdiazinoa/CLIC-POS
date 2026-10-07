import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { BusinessConfig, Warehouse } from '../types';
import { LargeMasterSyncV3CatalogRead } from '../services/sync/LargeMasterSyncV3CatalogRead';
import { createV3CatalogView, type V3CatalogViewState } from '../services/sync/LargeMasterSyncV3CatalogView';

export function V3CatalogPageView({ state }: { state: V3CatalogViewState }) {
  if (state.status === 'loading') return <p role="status">Leyendo catálogo V3...</p>;
  if (state.status === 'error') return <p role="alert">Catálogo V3 no disponible: {state.error}</p>;
  const page = state.page!;
  return <>
    <p>Todos ({page.total}) · Resultados: {page.filteredTotal} · Mostrando: {page.rows.length}</p>
    {!page.rows.length && <p>{page.total === 0 ? 'El catálogo V3 está vacío.' : 'Sin resultados para este filtro.'}</p>}
    <div className="overflow-auto"><table className="w-full text-left"><thead><tr>
      <th>Producto / referencia</th><th>Estado</th><th>Precio de tarifa</th><th>Balance del almacén</th>
    </tr></thead><tbody>{page.rows.map(row => <tr key={row.id} className="border-t">
      <td className="p-3">{row.name}<div className="text-xs">{row.sku || row.id}{row.barcode ? ` · ${row.barcode}` : ''}
        {row.categoryId?.trim() ? ` · Categoría ERP: ${row.categoryId}` : ' · Sin categoría'}{row.type ? ` · ${row.type}` : ''}</div></td>
      <td>{row.active ? 'Activo' : 'Inactivo'} · {row.sellable ? 'Vendible' : 'No vendible'}</td>
      <td>{row.price === null ? 'Sin precio' : row.price.toFixed(2)}</td>
      <td>{row.balance === null ? 'Desconocido' : row.balance}</td>
    </tr>)}</tbody></table></div>
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
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const terminal = props.config.terminals.find(row => row.id === props.terminalId);
  const contextKey = JSON.stringify([props.terminalId, terminal?.config.currentDeviceId, terminal?.config.erpTerminalId,
    terminal?.config.pricing?.defaultTariffId, terminal?.config.inventoryScope?.defaultSalesWarehouseId,
    props.warehouses]);
  const oldContext = useRef(contextKey);
  const reader = useRef<Promise<LargeMasterSyncV3CatalogRead>>();
  useEffect(() => {
    view.cancel(); reader.current = undefined;
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
        return current.page({ query: debouncedQuery, category, afterId: (cursors[cursors.length - 1] ?? null), limit: 25 });
    });
    return () => { view.cancel(); };
  }, [query, debouncedQuery, category, cursors, contextKey, view]);
  // A changed context must not paint the old page while effects reset its cursor/reader.
  const visible = oldContext.current === contextKey ? state : { status: 'loading' as const };
  return <section className="h-full overflow-auto bg-white p-6 text-slate-900">
    <header className="flex justify-between"><h1>Productos V3 · Sólo lectura</h1><button onClick={props.onClose}>Cerrar</button></header>
    <p className="text-sm">Orden estable por ID. Tarifa y almacén configurados en esta terminal. El balance es informativo, no autoriza ventas.</p>
    <div className="flex gap-3 my-4">
      <input aria-label="Buscar productos" maxLength={120} value={query} onChange={event => {
        view.cancel(); setQuery(event.target.value); setCursors([null]);
      }} placeholder="Nombre, referencia o código" className="border rounded p-2" />
      <select aria-label="Categoría" value={category} onChange={event => {
        view.cancel(); setCategory(event.target.value as 'ALL' | 'NONE'); setCursors([null]);
      }}><option value="ALL">Todos</option><option value="NONE">Sin categoría</option></select>
    </div>
    <V3CatalogPageView state={visible} />
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
