import React, { useEffect, useState } from "react";
import { recoveryCloseController } from "../services/recovery/recoveryService";
import type { RecoveryCloseInput } from "../services/recovery/RecoveryCloseController";
export default function RecoveryCloseDialog({
  input,
  onClose,
  onPublished,
  controller = recoveryCloseController,
}: {
  input?: RecoveryCloseInput;
  onClose: () => void;
  onPublished: () => void;
  controller?: typeof recoveryCloseController;
}) {
  const [jobs, setJobs] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [completed, setCompleted] = useState(false),
    [financialState, setFinancialState] = useState<string | null>(null),
    [available, setAvailable] = useState(false),
    [availabilityMessage, setAvailabilityMessage] = useState("");
  const refresh = async () =>
    setJobs((await controller.list()).filter((j) => !j.published));
  const checkAvailability = async () => {
    try {
      await controller.availability();
      setAvailable(true);
      setAvailabilityMessage("");
    } catch (error) {
      setAvailable(false);
      setAvailabilityMessage(
        error instanceof Error && /DISABLED|UNAVAILABLE/.test(error.message)
          ? "ERP todavía no tiene habilitado el cierre de esta jornada. Tus movimientos siguen conservados."
          : "No se pudo comprobar la disponibilidad del cierre en ERP. Revisa la conexión; tus movimientos siguen conservados.",
      );
    }
  };
  useEffect(() => {
    void refresh().catch(() =>
      setError("No se pudo leer el cierre pendiente."),
    );
    void checkAvailability();
  }, [controller]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo completar el cierre.",
      );
    } finally {
      await refresh().catch(() => {});
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[100000] bg-slate-950/70 flex items-center justify-center p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovered-close-title"
        className="bg-white rounded-2xl p-6 max-w-xl w-full max-h-[90vh] overflow-y-auto"
      >
        <h2 id="recovered-close-title" className="text-xl font-bold">
          Cierre Z
        </h2>
        <p className="my-3">
          Se cerrarán los movimientos que ERP recibió. Los que nunca se enviaron
          no pueden recuperarse.
        </p>
        {completed ? (
          <p role="status" className="my-3">
            ERP confirmó el cierre y quedó guardado en este POS.
            {financialState && (
              <span className="block mt-2">
                La verificación financiera de esta jornada en ERP sigue{" "}
                {financialState === "FAILED"
                  ? "con errores pendientes de resolver"
                  : "pendiente"}
                . Recuperar no vuelve a aplicar estos movimientos.
              </span>
            )}
          </p>
        ) : (
          <>
            {!jobs.length && (
              <p className="text-sm text-slate-600 my-3">
                ERP verificará la jornada completa. Si contiene operaciones
                incompatibles o movimientos nuevos sin respaldar, el cierre
                quedará bloqueado.
              </p>
            )}
            {jobs.map((job) => {
              const packet = job.candidate
                ? JSON.parse(job.candidate.observed.packetJson)
                : null;
              return (
                <div
                  key={job.preparationId}
                  className="border rounded p-3 my-3"
                >
                  <p>
                    {job.ack
                      ? "ERP ya confirmó. Falta terminar el guardado en este equipo."
                      : packet
                        ? "Revisión lista. Confirma para enviar el cierre a ERP."
                        : "Hay una revisión pendiente de completar."}
                  </p>
                  {!job.candidate && (
                    <button
                      disabled={busy}
                      className="underline text-sm my-2"
                      onClick={() =>
                        run(async () => {
                          await controller.discardUnsentReview(
                            job.preparationId,
                          );
                        })
                      }
                    >
                      Descartar esta revisión sin envío
                    </button>
                  )}
                  {packet && (
                    <p className="font-semibold my-2">
                      {
                        job.receiptBindings.filter(
                          (b: any) => b.group === "members",
                        ).length
                      }{" "}
                      movimientos · Ventas:{" "}
                      {Number(packet.summary.total_sales).toFixed(2)}{" "}
                      {packet.report.baseCurrency}
                    </p>
                  )}
                  {packet?.financialState && (
                    <p className="text-sm my-2">
                      La verificación financiera de esta jornada en ERP sigue{" "}
                      {packet.financialState === "FAILED"
                        ? "con errores"
                        : "pendiente"}
                      . Confirmar este Z no vuelve a aplicar los movimientos.
                    </p>
                  )}
                  {packet?.report.cashExpected && (
                    <ul className="text-sm my-2">
                      {Object.entries(packet.report.cashExpected).map(
                        ([currency, amount]) => (
                          <li key={currency}>
                            Efectivo esperado {currency}:{" "}
                            {Number(amount).toFixed(2)}
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                  <button
                    disabled={busy || !available}
                    className="bg-blue-700 text-white rounded px-4 py-2 mt-2 disabled:opacity-50"
                    onClick={() =>
                      run(async () => {
                        if (!job.candidate) {
                          await controller.resumeReview(job.preparationId);
                          return;
                        }
                        const ack = await controller.confirm(job.preparationId);
                        setFinancialState(ack?.financialState || null);
                        setCompleted(true);
                      })
                    }
                  >
                    {job.ack
                      ? "Terminar guardado"
                      : packet
                        ? "Confirmar o consultar cierre"
                        : "Reanudar revisión"}
                  </button>
                </div>
              );
            })}
            {input && !jobs.length && (
              <button
                disabled={busy || !available}
                className="bg-blue-700 text-white rounded px-4 py-2 disabled:opacity-50"
                onClick={() =>
                  run(async () => {
                    await controller.review(input);
                  })
                }
              >
                Revisar jornada con ERP
              </button>
            )}
            {!input && !jobs.length && (
              <p>
                No hay cierres pendientes. Para preparar uno, utiliza la
                pantalla habitual de cierre Z.
              </p>
            )}
          </>
        )}
        {!available && !completed && (
          <div className="bg-amber-50 p-3 mt-3">
            <p>{availabilityMessage}</p>
            <button
              disabled={busy}
              className="underline mt-2"
              onClick={() => run(checkAvailability)}
            >
              Comprobar conexión y disponibilidad
            </button>
          </div>
        )}
        {busy && (
          <p role="status" className="mt-3">
            Procesando…
          </p>
        )}
        {error && (
          <div role="alert" className="bg-amber-50 p-3 my-3">
            <p>
              No se pudo completar este paso. Puedes consultar o reanudar el
              mismo cierre; no prepares otro para sustituirlo.
            </p>
            <details className="text-sm mt-2 break-words">
              <summary>Detalle técnico</summary>
              {error}
            </details>
          </div>
        )}
        <button
          disabled={busy}
          className="border rounded px-4 py-2 mt-4 disabled:opacity-50"
          onClick={completed ? onPublished : onClose}
        >
          {completed ? "Actualizar POS" : "Volver"}
        </button>
      </section>
    </div>
  );
}
