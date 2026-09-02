import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Hash, RefreshCw } from 'lucide-react';
import { getMasterNumberRangeDiagnostics } from '../services/sync/MasterNumberRangeService';
import { formatMasterNumberCode } from '../services/sync/masterNumberRangeContract';

type Diagnostic = Awaited<ReturnType<typeof getMasterNumberRangeDiagnostics>>[number];

const LABELS: Record<string, string> = {
  CUSTOMER: 'Clientes',
  SUPPLIER: 'Proveedores',
  ITEM: 'Artículos',
};

const MasterNumberRangeDiagnostics: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [rows, setRows] = useState<Diagnostic[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      setRows(await getMasterNumberRangeDiagnostics());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    const listener = () => void reload();
    window.addEventListener('masterNumberRangesUpdated', listener);
    return () => window.removeEventListener('masterNumberRangesUpdated', listener);
  }, []);

  return (
    <div className="min-h-full bg-slate-50 p-5 md:p-8 overflow-y-auto">
      <div className="mx-auto max-w-6xl">
        <div className="mb-7 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="rounded-xl bg-white p-3 text-slate-600 shadow-sm"><ArrowLeft /></button>
            <div>
              <h1 className="text-2xl font-black text-slate-900">Rangos de maestros</h1>
              <p className="text-sm text-slate-500">Diagnóstico local de códigos offline. Solo lectura.</p>
            </div>
          </div>
          <button onClick={() => void reload()} className="rounded-xl bg-blue-600 p-3 text-white"><RefreshCw size={20} /></button>
        </div>

        {loading ? (
          <div className="rounded-2xl bg-white p-10 text-center text-slate-500">Cargando rangos…</div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
            Esta terminal todavía no ha recibido rangos numéricos del ERP.
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {rows.map(row => (
              <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-blue-50 p-3 text-blue-700"><Hash size={21} /></div>
                    <div>
                      <h2 className="font-black text-slate-900">{LABELS[row.entityType] || row.entityType}</h2>
                      <p className="text-xs text-slate-400">{row.id}</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${row.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}`}>
                    {row.status}
                  </span>
                </div>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-500">Rango</dt><dd className="font-bold">{formatMasterNumberCode(row, row.startNumber)} – {formatMasterNumberCode(row, row.endNumber)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Próximo</dt><dd className="font-black text-blue-700">{row.nextCode || 'Agotado'}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Disponibles</dt><dd className="font-bold">{row.remaining}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Consumido</dt><dd className="font-bold">{row.consumedPercent}%</dd></div>
                </dl>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-blue-600" style={{ width: `${row.consumedPercent}%` }} />
                </div>
                {row.warning && (
                  <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
                    <AlertTriangle size={17} /> Queda 20% o menos del rango.
                  </div>
                )}
                {row.progressPending && (
                  <p className="mt-3 text-xs font-semibold text-blue-700">
                    Progreso pendiente de confirmar con el ERP después de sincronizar los maestros.
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MasterNumberRangeDiagnostics;
