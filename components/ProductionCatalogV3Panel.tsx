import React, { useEffect, useRef, useState } from 'react';
import { ProductionCatalogV3, enqueueProductionRouting, productionRoutingStates } from '../services/sync/ProductionCatalogV3';
import { apiSyncAdapter } from '../services/sync/ApiSyncAdapter';
import { subscribeLargeMasterSyncV3CatalogUpdates } from '../services/sync/LargeMasterSyncV3CatalogUpdates';
import type { V3ProductionCatalogPage, V3ProductionArticle } from '../services/sync/LargeMasterSyncV3Types';

export default function ProductionCatalogV3Panel({ areas, actorId, contextKey = '' }: {
  areas: Array<{id:string;nombre:string}>; actorId?:string; contextKey?:string;
}) {
  const [areaId,setAreaId]=useState('');
  const [query,setQuery]=useState(''); const [category,setCategory]=useState<string>();
  const [cursors,setCursors]=useState<Array<string|null>>([null]);
  const [page,setPage]=useState<V3ProductionCatalogPage>();
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const [capable,setCapable]=useState(false); const [states,setStates]=useState<Record<string,string>>({});
  const [revision,setRevision]=useState(0);
  const contextRef=useRef(contextKey);contextRef.current=contextKey;
  const reader=useRef<ProductionCatalogV3>(); const generation=useRef(0);
  const staleRetries=useRef(0);
  const pageRef=useRef(page);pageRef.current=page;
  const invalidate=()=>{generation.current++;reader.current=undefined;setPage(undefined);setError('');};
  useEffect(()=>{
    const refresh=()=>{staleRetries.current=0;invalidate();setCursors([null]);setRevision(value=>value+1);};
    const unsubscribe=subscribeLargeMasterSyncV3CatalogUpdates(refresh);
    const queueUpdate=()=>{
      const opened=reader.current,current= generation.current,visible=pageRef.current;
      if (opened && visible) void productionRoutingStates(opened,visible.rows).then(next=>{
        if (generation.current===current) setStates(next);
      }).catch(()=>{ /* The next catalogue invalidation reopens a stale reader. */ });
    };
    window.addEventListener('productionRoutingQueueUpdated',queueUpdate);
    return ()=>{generation.current++;unsubscribe();window.removeEventListener('productionRoutingQueueUpdated',queueUpdate);};
  },[]);
  useEffect(()=>{
    if (!areas.some(area=>area.id===areaId)) setAreaId(areas[0]?.id || '');
  },[areas,areaId]);
  useEffect(()=>{
    const current=++generation.current;
    let disposed=false;
    setPage(undefined);setError('');
    void (async()=>{
      try {
        const opened=await ProductionCatalogV3.open(undefined,()=>contextRef.current);
        const result=await opened.page({query,categoryId:category,afterId:cursors[cursors.length-1],limit:80});
        const pending=await productionRoutingStates(opened,result.rows);
        await opened.assertCurrent();
        if (disposed || generation.current!==current) return;
        reader.current=opened;setPage(result);setStates(pending);
      } catch (cause) {
        if (disposed || generation.current!==current) return;
        reader.current=undefined;
        const code=(cause as {code?:string})?.code;
        if (['SYNC_V3_CATALOG_VERSION_CHANGED','SYNC_V3_CATALOG_CONTEXT_CHANGED'].includes(code || '') && staleRetries.current<1) {
          staleRetries.current++;setCursors([null]);setRevision(value=>value+1);return;
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return ()=>{disposed=true;};
  },[query,category,cursors,revision,areaId]);
  useEffect(()=>{
    let disposed=false;setCapable(false);
    void apiSyncAdapter.productionRoutingCapability(true).then(value=>{if(!disposed)setCapable(value);});
    return ()=>{disposed=true;};
  },[revision]);
  const change=async(rows:V3ProductionArticle[],target:string|null)=>{
    const opened=reader.current;
    if (!capable || !actorId || !areaId || !opened || !page || busy) return;
    const current=generation.current;
    const frozen=rows.map(row=>({...row}));
    setBusy(true);setError('');
    try {
      await opened.assertCurrent();
      if (generation.current!==current) throw new Error('El catálogo cambió. Vuelve a seleccionar los artículos.');
      await enqueueProductionRouting(opened,frozen,target,actorId);
      if (generation.current===current) setRevision(value=>value+1);
    } catch(cause) {if (generation.current===current)setError(cause instanceof Error ? cause.message : String(cause));}
    finally {setBusy(false);}
  };
  const disabled=!capable || !actorId || !areaId || !page || busy;
  const reset=()=>{staleRetries.current=0;invalidate();setCursors([null]);};
  return <section aria-label="Artículos de producción V3" className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
    <h3 className="font-black">Artículos del centro · Catálogo ERP V3</h3>
    <p className="text-sm">Las asignaciones se confirman cuando el catálogo actualizado del ERP llega a esta caja.</p>
    <div className="my-3 flex flex-wrap gap-3">
      <label>Centro<select aria-label="Centro de producción" value={areaId} onChange={event=>{invalidate();setAreaId(event.target.value);}} className="block border rounded p-2">
        {!areas.length && <option value="">Sin centros</option>}{areas.map(area=><option key={area.id} value={area.id}>{area.nombre}</option>)}</select></label>
      <label>Buscar<input aria-label="Buscar artículos de producción" value={query} maxLength={120} onChange={event=>{reset();setQuery(event.target.value);}} placeholder="Nombre, referencia o código" className="block border rounded p-2" /></label>
      <label>Categoría<select aria-label="Categoría de producción" value={category ?? '__ALL__'} onChange={event=>{reset();setCategory(event.target.value==='__ALL__'?undefined:event.target.value);}} className="block border rounded p-2">
        <option value="__ALL__">Todas</option>{page?.categories.map(row=><option key={row.id} value={row.id}>{row.label} ({row.count})</option>)}
        {category!==undefined && !page?.categories.some(row=>row.id===category) && <option value={category}>{category || 'Sin categoría'}</option>}
      </select></label>
    </div>
    {!capable && <p role="status" className="text-amber-800">El ERP aún no habilita asignaciones desde POS para esta terminal. Puedes asignarlas en el ERP y sincronizar. Se requiere actualizar el contrato del servidor y permitir cambios de catálogo.</p>}
    {!actorId && <p role="status">Inicia sesión con un usuario para asignar artículos.</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!page && !error && <p role="status">Leyendo catálogo V3…</p>}
    {page && <>
      <p>{page.total} artículos · {page.filteredTotal} resultados · {page.rows.length} visibles · {page.assignedCounts[areaId] || 0} asignados a este centro</p>
      <div className="my-3 flex gap-3"><button disabled={disabled || !page.rows.length} onClick={()=>void change(page.rows,areaId)} className="border rounded p-2">Aplicar visibles</button>
        <button disabled={disabled || !page.rows.some(row=>row.productionAreaId===areaId)} onClick={()=>void change(page.rows.filter(row=>row.productionAreaId===areaId),null)} className="border rounded p-2">Quitar visibles de este centro</button></div>
      <div className="max-h-96 overflow-auto">{!page.rows.length && <p>Sin artículos para este filtro.</p>}
        {page.rows.map(row=><div key={row.id} className="border-t p-2 flex justify-between gap-3">
          <div><strong>{row.name}</strong><p className="text-xs">{row.sku || row.id} · Centro: {row.productionAreaId || 'Sin asignar'}</p>
            {row.unsupported && <p className="text-xs text-amber-800">Configuración de restaurante avanzada: requiere soporte del catálogo de venta.</p>}
            {states[row.id] && <p className="text-xs" role="status">{states[row.id]}</p>}</div>
          <button disabled={disabled || Boolean(states[row.id] && states[row.id]!=='Confirmado por catálogo ERP')} onClick={()=>void change([row],row.productionAreaId===areaId?null:areaId)} className="border rounded p-2">{row.productionAreaId===areaId?'Quitar':'Asignar'}</button>
        </div>)}
      </div>
      <nav aria-label="Páginas de producción" className="flex gap-3 mt-3"><button disabled={busy || cursors.length===1} onClick={()=>{invalidate();setCursors(value=>value.slice(0,-1));}}>Anterior</button>
        <button disabled={busy || !page.nextCursor} onClick={()=>{const next=page.nextCursor;if(next){invalidate();setCursors(value=>[...value,next]);}}}>Siguiente</button></nav>
    </>}
    <button className="mt-3 underline" onClick={()=>{reset();setRevision(value=>value+1);}}>Actualizar catálogo local</button>
    <p className="mt-2 text-xs text-slate-500">Los conflictos y rechazos se revisan en el monitor de sincronización. El modo de salida y la impresora se guardan en la configuración del centro.</p>
  </section>;
}
