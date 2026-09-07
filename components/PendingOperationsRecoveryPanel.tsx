import React, { useState } from "react";
import { pendingOperationsRecovery } from "../services/recovery/recoveryService";
import { isSyncFeatureEnabled } from "../services/sync/SyncFeatureFlags";
export default function PendingOperationsRecoveryPanel() {
  const [busy, setBusy] = useState(false),
    [downloaded, setDownloaded] = useState(false),
    [restored, setRestored] = useState(false);
  const [message, setMessage] = useState("");
  if (!isSyncFeatureEnabled("pending_operations_recovery")) return null;
  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "No se pudo completar la recuperación.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="m-4 p-4 bg-white border rounded-xl"
      aria-label="Recuperación de movimientos"
    >
      <h2 className="font-bold">Recuperar movimientos de esta terminal</h2>
      <p className="text-sm my-2">
        Descarga lo que ERP recibió antes de perder la base local. Los
        movimientos nuevos de este equipo se conservan. ERP todavía no confirma
        que la jornada esté completa; el cierre exacto queda pendiente.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          disabled={busy || restored}
          className="px-4 py-2 border rounded disabled:opacity-50"
          onClick={() =>
            perform(async () => {
              const s = await pendingOperationsRecovery.download();
              setDownloaded(true);
              setMessage(
                `${s.totalRecords} originales y revisiones verificados. Puedes restaurar sin volver a aplicar ventas o cobros.`,
              );
            })
          }
        >
          {busy ? "Procesando…" : "Descargar o reanudar"}
        </button>
        <button
          disabled={busy || restored}
          className="px-4 py-2 border rounded disabled:opacity-50"
          onClick={() =>
            perform(async () => {
              setDownloaded(false);
              const s = await pendingOperationsRecovery.download(true);
              setDownloaded(true);
              setMessage(
                `${s.totalRecords} originales y revisiones verificados en una nueva descarga.`,
              );
            })
          }
        >
          Nueva descarga
        </button>
        <button
          disabled={busy || !downloaded || restored}
          className="px-4 py-2 bg-blue-700 text-white rounded disabled:opacity-50"
          onClick={() =>
            perform(async () => {
              const n = await pendingOperationsRecovery.restore();
              setRestored(true);
              setMessage(
                `${n} documentos restaurados. Se conserva su estado recibido; la aplicación comercial y el cierre siguen pendientes de confirmación ERP.`,
              );
            })
          }
        >
          Restaurar movimientos recibidos
        </button>
        <button
          disabled={busy || !downloaded}
          className="px-4 py-2 border rounded disabled:opacity-50"
          onClick={() =>
            perform(async () => {
              const { counts } =
                await pendingOperationsRecovery.checkCommercialStates();
              setMessage(
                `Estado ERP de las revisiones descargadas: ${counts.APPLIED} aplicadas, ${counts.PENDING} pendientes, ${counts.PROCESSING} en proceso, ${counts.FAILED} fallidas y ${counts.UNKNOWN} sin evidencia suficiente. Esto no autoriza el cierre ni confirma que la jornada esté completa.`,
              );
            })
          }
        >
          Consultar estado ERP
        </button>
        {restored && (
          <button
            className="px-4 py-2 border rounded"
            onClick={() => window.location.reload()}
          >
            Actualizar POS
          </button>
        )}
      </div>
      {message && (
        <p role="status" className="text-sm mt-3 whitespace-pre-wrap">
          {message}
        </p>
      )}
    </section>
  );
}
