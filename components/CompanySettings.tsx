import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Globe,
  Hash,
  Mail,
  MapPin,
  Phone,
  Save,
  ShieldCheck
} from 'lucide-react';
import { BusinessConfig, CompanyInfo } from '../types';
import {
  getDefaultFiscalProvider,
  getFiscalProviderCredentialKey,
  normalizeFiscalCredentialKey
} from '../utils/fiscal/fiscalHelpers';

interface CompanySettingsProps {
  config: BusinessConfig;
  onUpdateConfig: (newConfig: BusinessConfig) => void;
  onClose: () => void;
}

const buildDraft = (config: BusinessConfig): CompanyInfo => ({
  name: config.companyInfo?.name || '',
  rnc: config.companyInfo?.rnc || '',
  phone: config.companyInfo?.phone || '',
  address: config.companyInfo?.address || '',
  email: config.companyInfo?.email || '',
  website: config.companyInfo?.website || ''
});

const normalizeCompany = (company: CompanyInfo): CompanyInfo => ({
  name: company.name.trim(),
  rnc: company.rnc.trim(),
  phone: company.phone.trim(),
  address: company.address.trim(),
  email: company.email?.trim() || undefined,
  website: company.website?.trim() || undefined
});

const CompanySettings: React.FC<CompanySettingsProps> = ({ config, onUpdateConfig, onClose }) => {
  const [company, setCompany] = useState<CompanyInfo>(() => buildDraft(config));
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setCompany(buildDraft(config));
  }, [config.companyInfo]);

  const activeProviderId = getDefaultFiscalProvider(config);
  const resolvedCredentialKey = getFiscalProviderCredentialKey(config, activeProviderId);
  const normalizedCompanyRnc = normalizeFiscalCredentialKey(company.rnc);
  const normalizedCredentialKey = normalizeFiscalCredentialKey(resolvedCredentialKey);
  const hasCredentialMismatch = Boolean(
    normalizedCompanyRnc &&
    normalizedCredentialKey &&
    normalizedCompanyRnc !== normalizedCredentialKey
  );

  const impactedAreas = useMemo(() => [
    'Emisor fiscal para e-CF y Polaris',
    'Cabecera de tickets y facturas',
    'Correo y documentos impresos',
    'Identidad visible en kiosco y reportes'
  ], []);

  const handleChange = (field: keyof CompanyInfo, value: string) => {
    setFeedback(null);
    setCompany(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    const normalizedCompany = normalizeCompany(company);
    const requiresFiscalRnc = activeProviderId !== 'NONE';

    if (!normalizedCompany.name) {
      setFeedback({ kind: 'error', message: 'Agrega el nombre comercial antes de guardar.' });
      return;
    }

    if (requiresFiscalRnc && !normalizedCompany.rnc) {
      setFeedback({ kind: 'error', message: 'El RNC es obligatorio mientras la facturacion fiscal este activa.' });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      await Promise.resolve(onUpdateConfig({
        ...config,
        companyInfo: normalizedCompany
      }));

      setFeedback({ kind: 'success', message: 'Datos de la empresa guardados correctamente.' });
    } catch (error: any) {
      console.error('Failed to save company settings:', error);
      setFeedback({ kind: 'error', message: error?.message || 'No se pudieron guardar los datos de la empresa.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in fade-in">
      <div className="bg-white px-8 py-6 border-b border-gray-200 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-3">
            <Building2 className="text-blue-600" />
            Datos de la Empresa
          </h1>
          <p className="text-sm text-gray-500">Administra el emisor legal y la informacion comercial usada por el sistema.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="px-5 py-3 rounded-xl bg-gray-100 text-gray-700 font-bold hover:bg-gray-200 transition-colors"
          >
            Volver
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={`px-6 py-3 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2 ${isSaving ? 'bg-blue-300 text-white cursor-wait' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
          >
            <Save size={18} />
            {isSaving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Identidad legal y comercial</h2>
                <p className="text-sm text-gray-500 mt-1">Estos datos alimentan tickets, e-CF, correos y reportes.</p>
              </div>
              <div className="px-3 py-2 rounded-2xl bg-blue-50 text-blue-700 text-xs font-black uppercase tracking-[0.2em]">
                Emisor activo
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <label className="block">
                <span className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2 mb-2">
                  <Building2 size={14} /> Nombre comercial
                </span>
                <input
                  type="text"
                  value={company.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className="w-full p-4 rounded-2xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-4 focus:ring-blue-50 outline-none transition-all font-bold"
                  placeholder="Ej. MercaSend Retail"
                />
              </label>

              <label className="block">
                <span className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2 mb-2">
                  <Hash size={14} /> RNC / Cedula
                </span>
                <input
                  type="text"
                  value={company.rnc}
                  onChange={(e) => handleChange('rnc', e.target.value)}
                  className="w-full p-4 rounded-2xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-4 focus:ring-blue-50 outline-none transition-all font-mono"
                  placeholder="130090752"
                />
              </label>

              <label className="block">
                <span className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2 mb-2">
                  <Phone size={14} /> Telefono
                </span>
                <input
                  type="text"
                  value={company.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  className="w-full p-4 rounded-2xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-4 focus:ring-blue-50 outline-none transition-all"
                  placeholder="809-531-2676"
                />
              </label>

              <label className="block">
                <span className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2 mb-2">
                  <Mail size={14} /> Correo
                </span>
                <input
                  type="email"
                  value={company.email || ''}
                  onChange={(e) => handleChange('email', e.target.value)}
                  className="w-full p-4 rounded-2xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-4 focus:ring-blue-50 outline-none transition-all"
                  placeholder="facturacion@empresa.com"
                />
              </label>

              <label className="block md:col-span-2">
                <span className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2 mb-2">
                  <MapPin size={14} /> Direccion
                </span>
                <input
                  type="text"
                  value={company.address}
                  onChange={(e) => handleChange('address', e.target.value)}
                  className="w-full p-4 rounded-2xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-4 focus:ring-blue-50 outline-none transition-all"
                  placeholder="Calle Principal #123, Santo Domingo"
                />
              </label>

              <label className="block md:col-span-2">
                <span className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2 mb-2">
                  <Globe size={14} /> Sitio web
                </span>
                <input
                  type="text"
                  value={company.website || ''}
                  onChange={(e) => handleChange('website', e.target.value)}
                  className="w-full p-4 rounded-2xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-4 focus:ring-blue-50 outline-none transition-all"
                  placeholder="https://www.miempresa.com"
                />
              </label>
            </div>
          </section>

          {feedback && (
            <div className={`rounded-3xl border px-5 py-4 font-bold ${feedback.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {feedback.message}
            </div>
          )}
        </div>

        <aside className="w-full lg:w-[430px] border-t lg:border-t-0 lg:border-l border-gray-200 bg-white p-8 overflow-y-auto space-y-6">
          <div className="rounded-3xl border border-blue-100 bg-blue-50 p-6">
            <h3 className="text-sm font-black text-blue-900 uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
              <ShieldCheck size={16} />
              Emisor fiscal
            </h3>
            <div className="space-y-3 text-sm text-blue-950">
              <p><span className="font-bold">Empresa:</span> {company.name || 'Sin definir'}</p>
              <p><span className="font-bold">RNC resuelto:</span> {company.rnc || 'Sin definir'}</p>
              <p><span className="font-bold">Proveedor activo:</span> {activeProviderId}</p>
              <p><span className="font-bold">Credencial fiscal:</span> {resolvedCredentialKey || 'Sin credencial resuelta'}</p>
            </div>
          </div>

          {hasCredentialMismatch ? (
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
              <h3 className="text-sm font-black text-amber-900 uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
                <AlertTriangle size={16} />
                Alerta de compatibilidad
              </h3>
              <p className="text-sm text-amber-900 leading-relaxed">
                El RNC del emisor no coincide con la credencial fiscal activa. Polaris rechazara la emision mientras el emisor use <span className="font-mono font-bold">{company.rnc || 'N/D'}</span> y la credencial siga en <span className="font-mono font-bold">{resolvedCredentialKey || 'N/D'}</span>.
              </p>
            </div>
          ) : (
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6">
              <h3 className="text-sm font-black text-emerald-900 uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
                <ShieldCheck size={16} />
                Estado del emisor
              </h3>
              <p className="text-sm text-emerald-900 leading-relaxed">
                El perfil de empresa esta alineado con la credencial fiscal resuelta o todavia no hay una credencial activa configurada.
              </p>
            </div>
          )}

          <div className="rounded-3xl border border-gray-200 bg-gray-50 p-6">
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-[0.2em] mb-4">Impacta en</h3>
            <div className="space-y-3">
              {impactedAreas.map(area => (
                <div key={area} className="flex items-center gap-3 text-sm font-semibold text-gray-700">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  <span>{area}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default CompanySettings;
