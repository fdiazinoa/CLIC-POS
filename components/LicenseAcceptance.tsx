import React, { useState } from 'react';
import { LICENSE_PDF_PATH, licenseClause } from '../legal/licenseClause';
import { type AcceptanceIdentity, recordLicenseAcceptance } from '../utils/licenseAcceptance';

interface Props {
    identity: AcceptanceIdentity;
    onAccepted: () => void;
}
export default function LicenseAcceptance({ identity, onAccepted }: Props) {
    const [confirmed, setConfirmed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const accept = async () => {
        if (!confirmed || saving) return;
        setSaving(true);
        setError(null);
        // Yield so the saving state is visible before the synchronous local write.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        try {
            recordLicenseAcceptance(localStorage, identity, confirmed);
            onAccepted();
        } catch {
            setError('No se pudo guardar o confirmar la aceptación en este dispositivo. Reintenta; el sistema todavía no está activado.');
        } finally { setSaving(false); }
    };
    return <section className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
        <div className="mx-auto max-w-3xl space-y-5">
            <h1 className="text-2xl sm:text-3xl font-bold">{licenseClause.title}</h1>
            <div className="space-y-1 text-sm text-slate-300 break-words">
                <p>Proveedor: {licenseClause.provider}</p><p>Cliente: {identity.legalName}</p>
                <p>Versión: {licenseClause.version}</p>
                <p>Fecha de aceptación: se registrará al pulsar «Aceptar y continuar», con la hora UTC de este dispositivo.</p>
            </div>
            <a className="inline-block underline text-blue-300 py-3" href={LICENSE_PDF_PATH} download>Descargar cláusula completa en PDF</a>
            <article aria-label="Texto completo de la cláusula" className="rounded-2xl bg-slate-900 p-4 sm:p-6 space-y-6 text-base leading-relaxed">
                {licenseClause.sections.map((section) => <section key={section.title}><h2 className="font-bold mb-2">{section.title}</h2><p>{section.text}</p></section>)}
            </article>
            <label className="flex items-start gap-3 p-3 cursor-pointer">
                <input className="mt-1 h-5 w-5 shrink-0" type="checkbox" checked={confirmed} disabled={saving} onChange={(event) => setConfirmed(event.target.checked)} />
                <span>{licenseClause.checkbox}</span>
            </label>
            {error && <p role="alert" className="rounded-xl bg-red-950 p-4 text-red-200">{error}</p>}
            <button type="button" disabled={!confirmed || saving} onClick={() => void accept()} className="w-full rounded-xl bg-blue-600 p-4 font-bold disabled:opacity-40">{saving ? 'Guardando aceptación…' : 'Aceptar y continuar'}</button>
            <p className="text-sm text-slate-400 pb-4">La aceptación se conserva localmente para este cliente y versión en este dispositivo. El PDF contiene el texto de la cláusula.</p>
        </div>
    </section>;
}
