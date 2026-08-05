import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChefHat, X } from 'lucide-react';

export type ProductionRoutingPromptItem = {
  id: string;
  name: string;
  quantity: number;
};

export type ProductionRoutingPromptArea = {
  id: string;
  name: string;
};

interface ProductionRoutingAssignmentModalProps {
  items: ProductionRoutingPromptItem[];
  areas: ProductionRoutingPromptArea[];
  onAssign: (assignments: Record<string, string>) => void;
  onSkip: () => void;
  onCancel: () => void;
}

const ProductionRoutingAssignmentModal: React.FC<ProductionRoutingAssignmentModalProps> = ({
  items,
  areas,
  onAssign,
  onSkip,
  onCancel,
}) => {
  const automaticAreaId = areas.length === 1 ? areas[0].id : '';
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [bulkAreaId, setBulkAreaId] = useState(automaticAreaId);

  useEffect(() => {
    setAssignments(Object.fromEntries(items.map(item => [item.id, automaticAreaId])));
    setBulkAreaId(automaticAreaId);
  }, [automaticAreaId, items]);

  const assignedCount = useMemo(
    () => items.filter(item => Boolean(assignments[item.id])).length,
    [assignments, items],
  );
  const canSubmit = items.length > 0 && assignedCount === items.length;

  const applyBulkArea = (areaId: string) => {
    setBulkAreaId(areaId);
    if (!areaId) return;
    setAssignments(Object.fromEntries(items.map(item => [item.id, areaId])));
  };

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-amber-100 bg-amber-50 p-5">
          <div className="flex gap-3">
            <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
              <AlertTriangle size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900">Artículos sin centro de producción</h2>
              <p className="mt-1 text-sm font-medium text-slate-600">
                Asígnalos ahora. La selección quedará guardada para los próximos pedidos.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cerrar asignación de centros"
            className="rounded-full p-2 text-slate-400 transition hover:bg-white hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {areas.length > 1 && (
            <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">
                Asignar todos a
              </label>
              <select
                value={bulkAreaId}
                onChange={(event) => applyBulkArea(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-amber-400"
              >
                <option value="">Seleccionar centro</option>
                {areas.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}
              </select>
            </div>
          )}

          <div className="space-y-3">
            {items.map(item => (
              <div key={item.id} className="rounded-2xl border border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-900">{item.name}</p>
                    <p className="text-xs font-semibold text-slate-500">Cantidad en el ticket: {item.quantity}</p>
                  </div>
                  <ChefHat className="shrink-0 text-amber-500" size={20} />
                </div>
                <select
                  value={assignments[item.id] || ''}
                  onChange={(event) => setAssignments(current => ({ ...current, [item.id]: event.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-amber-400"
                >
                  <option value="">Seleccionar centro</option>
                  {areas.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-100 bg-white p-5">
          <p className="mb-3 text-xs font-semibold text-slate-500">
            Si continúas sin asignar, estos artículos se guardarán en la mesa pero no se enviarán a producción.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onSkip}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50"
            >
              Continuar sin asignar
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => onAssign(assignments)}
              className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check size={18} />
              Asignar y continuar ({assignedCount}/{items.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductionRoutingAssignmentModal;
