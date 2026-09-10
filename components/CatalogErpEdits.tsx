import React, { useEffect, useState } from 'react';
import { db } from '../utils/db';
import { apiSyncAdapter } from '../services/sync/ApiSyncAdapter';
import { loadSyncProfile } from '../services/sync/SyncProfile';
import { catalogEditQueue, catalogScopeMatches, queueCatalogEdit, readCatalogEdits } from '../services/sync/catalogEdits';
import type { CatalogDomain, CatalogEdit, CatalogScope } from '../services/sync/CatalogEditQueue';
type RecordRow = { id: string; nombre: string; precio_venta?: number | null; codigo?: string | null; tipo?: string };
type Catalog = { id: string; domain: CatalogDomain; scope: CatalogScope; records: RecordRow[] };
const labels = { PENDING: 'Pendiente', APPLIED: 'Aplicado en ERP', CONFLICT: 'Conflicto', REJECTED: 'Rechazado' };
export default function CatalogErpEdits({ actorId, onClose }: { actorId: string; onClose(): void }) {
    const [domain, setDomain] = useState<CatalogDomain>('prices');
    const [search, setSearch] = useState('');
    const [catalog, setCatalog] = useState<Catalog | null>(null);
    const [selected, setSelected] = useState<RecordRow | null>(null);
    const [field, setField] = useState('precio_venta');
    const [value, setValue] = useState('');
    const [edits, setEdits] = useState<CatalogEdit[]>([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    useEffect(() => {
        let active = true;
        const refresh = async () => { const rows = await readCatalogEdits(); if (active) setEdits(rows.filter(e => catalogScopeMatches(e.scope))); };
        void refresh().catch(() => undefined);
        const interval = setInterval(() => { void refresh().catch(() => undefined); }, 3000);
        return () => { active = false; clearInterval(interval); };
    }, []);
    useEffect(() => {
        let active = true;
        void db.get('catalogEditCache').then(rows => {
            const cached = (rows as Catalog[]).find(row => row.domain === domain && catalogScopeMatches(row.scope));
            if (active && cached) setCatalog(current => current ?? cached);
        }).catch(() => undefined);
        return () => { active = false; };
    }, [domain]);
    const consult = async () => {
        setBusy(true); setMessage(''); setSelected(null);
        try {
            const data = await apiSyncAdapter.getCatalogEditRecords(domain, search);
            const profile = loadSyncProfile();
            const scope = { terminalId: data.terminalId, tenantId: data.tenantId, companyId: data.companyId, deviceId: data.deviceId,
                baseUrl: profile.erpBaseUrl || profile.cloudBaseUrl || '' };
            if (!catalogScopeMatches(scope)) throw new Error('La respuesta no corresponde a la vinculación actual.');
            const next: Catalog = { id: `${scope.terminalId}:${scope.tenantId}:${domain}`, domain, scope, records: data.records };
            await db.saveDocument('catalogEditCache', next); setCatalog(next);
            setMessage('Catálogo actualizado. Se muestran hasta 100 coincidencias; usa la búsqueda para acotar.');
        } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo consultar el ERP.'); }
        finally { setBusy(false); }
    };
    const save = async () => {
        if (!catalog || !selected) return;
        setBusy(true);
        try {
            const after = catalog.domain === 'prices' ? Number(value) : value.trim();
            if (!value.trim() || (typeof after === 'number' && (!Number.isFinite(after) || after < 0 || after > 1e12))) throw new Error('Introduce un valor válido.');
            const before = selected[field as keyof RecordRow] ?? null;
            await queueCatalogEdit(catalog.scope, { recordId: selected.id, domain: catalog.domain, field,
                before: before as string | number | null, after, actorId }, selected.nombre);
            setSelected(null); setMessage('Cambio guardado para enviar al ERP. El precio operativo se actualizará al recibir la configuración aceptada.');
            setEdits((await readCatalogEdits()).filter(e => catalogScopeMatches(e.scope)));
        } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo guardar.'); }
        finally { setBusy(false); }
    };
    return <div className="p-6 bg-white min-h-full space-y-5">
        <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Cambios al ERP</h1><button onClick={onClose} className="p-3 bg-slate-100 rounded-xl">Volver</button></div>
        <p>Modifica el precio base de un artículo o el nombre/código de una clasificación existente de tu empresa. Las tarifas, altas y eliminaciones se incorporarán en una fase posterior.</p>
        <p className="text-sm text-slate-600">El ERP valida cada propuesta antes de distribuirla. Sin conexión puedes proponer cambios sobre la última consulta guardada; los reintentos son automáticos.</p>
        <div className="flex flex-wrap gap-3">
            <select aria-label="Tipo de dato" disabled={busy} value={domain} onChange={e => { setDomain(e.target.value as CatalogDomain); setCatalog(null); setSelected(null); }} className="border rounded-lg p-3"><option value="prices">Precios base</option><option value="classifications">Clasificaciones</option></select>
            <input aria-label="Buscar por nombre" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre" className="border rounded-lg p-3" />
            <button disabled={busy} onClick={() => void consult()} className="bg-blue-600 text-white px-4 rounded-lg disabled:opacity-50">Consultar ERP</button>
        </div>
        {message && <p role="status" className="p-3 bg-blue-50 rounded-lg">{message}</p>}
        {catalog && <div className="max-h-72 overflow-auto border rounded-lg"><table className="w-full text-left"><thead><tr><th className="p-3">Nombre</th><th>Valor / tipo</th><th /></tr></thead><tbody>{catalog.records.map(row => <tr key={row.id} className="border-t"><td className="p-3">{row.nombre}</td><td>{catalog.domain === 'prices' ? row.precio_venta : `${row.codigo || ''} · ${row.tipo || ''}`}</td><td><button disabled={busy} className="p-3 text-blue-700" onClick={() => { setSelected(row); setField(catalog.domain === 'prices' ? 'precio_venta' : 'nombre'); setValue(String(catalog.domain === 'prices' ? row.precio_venta ?? '' : row.nombre)); }}>Modificar</button></td></tr>)}</tbody></table></div>}
        {selected && <div className="flex flex-wrap items-center gap-3 border p-4 rounded-lg"><strong>{selected.nombre}</strong>
            {catalog?.domain === 'classifications' && <select aria-label="Campo" value={field} onChange={e => { setField(e.target.value); setValue(String(selected[e.target.value as keyof RecordRow] ?? '')); }}><option value="nombre">Nombre</option><option value="codigo">Código</option></select>}
            <input aria-label="Nuevo valor" type={catalog?.domain === 'prices' ? 'number' : 'text'} min="0" step="any" maxLength={120} value={value} onChange={e => setValue(e.target.value)} className="border p-3 rounded-lg" />
            <button disabled={busy} onClick={() => void save()} className="bg-blue-600 text-white p-3 rounded-lg disabled:opacity-50">Guardar propuesta</button>
        </div>}
        <h2 className="font-bold text-lg">Cambios enviados y pendientes</h2>
        <button disabled={busy} onClick={() => { void catalogEditQueue.process().catch(() => setMessage('No se pudo procesar la cola.')); }} className="text-blue-700">Procesar pendientes</button>
        {edits.length === 0 && <p>No hay cambios en esta terminal.</p>}
        {edits.slice().reverse().map(edit => <div key={edit.id} className="border rounded-lg p-3"><strong>{edit.label}</strong> · {String(edit.mutation.before ?? 'vacío')} → {String(edit.mutation.after)}<p>{labels[edit.status]}{edit.message ? `: ${edit.message}` : ''}</p></div>)}
    </div>;
}
