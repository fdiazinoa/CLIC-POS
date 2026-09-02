import React, { useEffect, useState } from 'react';
import { ArrowLeft, Save, ShoppingBag } from 'lucide-react';
import { BusinessConfig, ServiceTaxPolicyMap } from '../types';
import {
  buildServiceTaxPolicyConfigUpdate,
  resolveEditableServiceTaxPolicies,
} from '../utils/serviceTaxPolicy';
import ServiceTaxPolicyEditor from './ServiceTaxPolicyEditor';

interface ServiceTypeSettingsProps {
  config: BusinessConfig;
  onUpdateConfig: (newConfig: BusinessConfig, restart?: boolean) => void;
  onClose: () => void;
}

const ServiceTypeSettings: React.FC<ServiceTypeSettingsProps> = ({
  config,
  onUpdateConfig,
  onClose,
}) => {
  const [draftPolicies, setDraftPolicies] = useState<ServiceTaxPolicyMap>(() => (
    resolveEditableServiceTaxPolicies(config)
  ));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraftPolicies(resolveEditableServiceTaxPolicies(config));
  }, [config]);

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const nextConfig = buildServiceTaxPolicyConfigUpdate(config, draftPolicies, config.taxes || []);
      await Promise.resolve(onUpdateConfig(nextConfig));
      alert('Tipos de servicio guardados correctamente.');
    } catch (error: any) {
      alert(`No se pudieron guardar los tipos de servicio: ${error?.message || 'error desconocido'}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar">
      <div className="mx-auto min-h-full w-full max-w-7xl p-4 pb-24 md:p-8 md:pb-16 animate-in fade-in">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <button
              type="button"
              onClick={onClose}
              className="mb-5 inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <ArrowLeft size={18} /> Volver
            </button>
            <div className="flex items-start gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                <ShoppingBag size={28} />
              </div>
              <div>
                <h1 className="text-3xl font-black text-slate-800">Tipo de servicio</h1>
                <p className="mt-1 text-slate-500">
                  Configura impuestos y propina legal para En local, Para llevar y Delivery.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-6 py-3 font-black text-white shadow-lg shadow-violet-200 transition-all hover:bg-violet-500 active:scale-95 disabled:opacity-60 md:w-auto"
          >
            <Save size={18} /> {isSaving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </header>

        <section className="rounded-[2rem] border border-violet-100 bg-violet-50/40 p-6 shadow-sm md:p-8">
          <div className="mb-5">
            <h2 className="text-xl font-black text-slate-800">Política por tipo de servicio</h2>
            <p className="mt-1 text-sm text-slate-500">
              La selección se guarda localmente y funciona offline. Un artículo exento continúa exento.
            </p>
          </div>
          <ServiceTaxPolicyEditor
            taxes={config.taxes || []}
            value={draftPolicies}
            onChange={setDraftPolicies}
          />
        </section>
      </div>
    </div>
  );
};

export default ServiceTypeSettings;
