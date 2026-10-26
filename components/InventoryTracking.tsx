import React from 'react';
import { ArrowLeft, Boxes } from 'lucide-react';

/**
 * Rastreo (seriales / lotes) todavía no tiene una lectura autorizada para UI.
 * Se retiró la maqueta anterior con datos inventados: aquí solo se muestra el estado real
 * (vacío) hasta que exista el lector de autoridades de tracking.
 */
export default function InventoryTracking({ onClose }: { onClose: () => void; initialProductId?: string }) {
  return (
    <section className="flex h-full flex-col gap-4 overflow-auto bg-white p-6 text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <Boxes size={20} className="text-slate-500" />
          <h1 className="text-xl font-black">Rastreo</h1>
        </div>
        <button type="button" onClick={onClose}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
          <ArrowLeft size={15} /> Volver
        </button>
      </header>

      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        <p className="text-sm font-bold text-slate-700">Sin datos de rastreo para mostrar</p>
        <p className="mx-auto mt-2 max-w-xl text-xs text-slate-500">
          Esta pantalla ya no muestra información de ejemplo. Las series y lotes vendidos se registran
          con su autoridad de tracking en cada venta; para consultar un artículo concreto usa
          <span className="font-bold"> Artículos y Tarifas → abrir la ficha → Kardex</span>.
        </p>
      </div>
    </section>
  );
}
