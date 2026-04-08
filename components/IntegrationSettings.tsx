import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  History,
  Key,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings2,
  Smartphone,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import {
  BusinessConfig,
  PaymentIntegrationDefinition,
  PaymentIntegrationEnvironment,
  PaymentIntegrationAuditEvent,
  PaymentIntegrationProvider,
} from '../types';
import IntegrationAuditModal from './IntegrationAuditModal';
import { AzulGatewayError, azulMcmService } from '../services/payments/AzulMcmService';
import {
  appendAuditEventToIntegration,
  appendAuditEventToIntegrations,
  createPaymentIntegrationAuditEvent,
  persistConfigUpdate,
} from '../services/payments/paymentIntegrationAudit';

interface IntegrationSettingsProps {
  config: BusinessConfig;
  onUpdateConfig: (newConfig: BusinessConfig) => void;
  onClose: () => void;
}

type TestResult = {
  success: boolean;
  message: string;
} | null;

const PROVIDER_LABELS: Record<PaymentIntegrationProvider, string> = {
  AZUL: 'AZUL',
  CARDNET: 'CardNet',
  CARNET: 'Carnet',
  VISANET: 'VisaNet',
  STRIPE: 'Stripe',
};

const createDefaultIntegration = (
  provider: PaymentIntegrationProvider = 'AZUL',
  environment: PaymentIntegrationEnvironment = 'TEST'
): PaymentIntegrationDefinition => ({
  id: `int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: provider === 'AZUL' ? 'AZUL Desarrollo' : `Nueva integración ${PROVIDER_LABELS[provider]}`,
  provider,
  isEnabled: true,
  environment,
  baseUrl: provider === 'AZUL'
    ? (environment === 'TEST'
      ? 'https://pruebas.azul.com.do/POSWebServices/JSON/default.aspx'
      : 'https://pagos.azul.com.do/POSWebServices/JSON/default.aspx')
    : '',
  secondaryBaseUrl: '',
  merchantId: '',
  terminalId: '',
  auth1: '',
  auth2: '',
  timeoutMs: 160000,
  capabilities: {
    sale: true,
    getLastTrx: true,
    refund: true,
    void: true,
    pinpadInit: true,
  },
  metadata: {},
  auditEvents: [],
});

const IntegrationSettings: React.FC<IntegrationSettingsProps> = ({ config, onUpdateConfig, onClose }) => {
  const [integrations, setIntegrations] = useState<PaymentIntegrationDefinition[]>(config.integrations || []);
  const [editingIntegration, setEditingIntegration] = useState<PaymentIntegrationDefinition | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [auditIntegrationId, setAuditIntegrationId] = useState<string | null>(null);

  const enabledCount = useMemo(() => integrations.filter(integration => integration.isEnabled).length, [integrations]);
  const selectedAuditIntegration = useMemo(
    () => integrations.find(integration => integration.id === auditIntegrationId) || null,
    [auditIntegrationId, integrations]
  );

  useEffect(() => {
    setIntegrations(config.integrations || []);
  }, [config.integrations]);

  const handleCreate = () => {
    setEditingIntegration(createDefaultIntegration());
    setTestResult(null);
    setIsEditorOpen(true);
  };

  const handleEdit = (integration: PaymentIntegrationDefinition) => {
    setEditingIntegration({
      ...integration,
      metadata: { ...(integration.metadata || {}) },
      auditEvents: [...(integration.auditEvents || [])],
    });
    setTestResult(null);
    setIsEditorOpen(true);
  };

  const handleDelete = (integrationId: string) => {
    if (!window.confirm('¿Eliminar esta integración de pago?')) return;
    setIntegrations(prev => prev.filter(integration => integration.id !== integrationId));
  };

  const handleSaveIntegration = () => {
    if (!editingIntegration) return;

    const normalized = {
      ...editingIntegration,
      name: editingIntegration.name.trim() || PROVIDER_LABELS[editingIntegration.provider],
      baseUrl: editingIntegration.baseUrl.trim(),
      secondaryBaseUrl: editingIntegration.secondaryBaseUrl?.trim() || '',
      merchantId: editingIntegration.merchantId?.trim() || '',
      terminalId: editingIntegration.terminalId?.trim() || '',
      auth1: editingIntegration.auth1?.trim() || '',
      auth2: editingIntegration.auth2?.trim() || '',
      timeoutMs: Math.max(1000, Number(editingIntegration.timeoutMs) || 160000),
      auditEvents: editingIntegration.auditEvents || [],
    };

    setIntegrations(prev => {
      const existing = prev.some(integration => integration.id === normalized.id);
      if (existing) {
        return prev.map(integration => integration.id === normalized.id ? normalized : integration);
      }
      return [...prev, normalized];
    });
    setIsEditorOpen(false);
  };

  const handleSaveChanges = () => {
    onUpdateConfig({
      ...config,
      integrations,
    });
    alert('Integraciones guardadas correctamente.');
    onClose();
  };

  const handleProviderChange = (provider: PaymentIntegrationProvider) => {
    if (!editingIntegration) return;
    const draft = createDefaultIntegration(provider, editingIntegration.environment);
    setEditingIntegration({
      ...editingIntegration,
      provider,
      name: editingIntegration.name || draft.name,
      baseUrl: editingIntegration.baseUrl || draft.baseUrl,
      timeoutMs: editingIntegration.timeoutMs || draft.timeoutMs,
    });
    setTestResult(null);
  };

  const handleEnvironmentChange = (environment: PaymentIntegrationEnvironment) => {
    if (!editingIntegration) return;
    const defaults = createDefaultIntegration(editingIntegration.provider, environment);
    setEditingIntegration({
      ...editingIntegration,
      environment,
      baseUrl: editingIntegration.provider === 'AZUL' ? defaults.baseUrl : editingIntegration.baseUrl,
    });
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    if (!editingIntegration) return;

    const updateAuditState = async (event: PaymentIntegrationAuditEvent) => {
      setEditingIntegration(prev => (
        prev && prev.id === event.integrationId
          ? appendAuditEventToIntegration(prev, event)
          : prev
      ));
      const nextIntegrations = appendAuditEventToIntegrations(integrations, event.integrationId, event);
      setIntegrations(nextIntegrations);

      const integrationExists = integrations.some(integration => integration.id === event.integrationId);
      if (!integrationExists) return;

      await persistConfigUpdate({
        ...config,
        integrations: nextIntegrations,
      });
    };

    setIsTesting(true);
    setTestResult(null);
    try {
      if (editingIntegration.provider !== 'AZUL') {
        const unsupportedResult = {
          success: false,
          message: 'La prueba en vivo todavía solo está disponible para AZUL.',
        };
        await updateAuditState(createPaymentIntegrationAuditEvent(editingIntegration, {
          action: 'GET_LAST_TRX',
          status: 'FAILED',
          message: unsupportedResult.message,
          requestDetails: {
            Origen: 'Prueba de conexión',
          },
          responseDetails: {
            Motivo: 'Proveedor todavía no soportado en caja',
          },
        }));
        setTestResult(unsupportedResult);
        return;
      }

      const result = await azulMcmService.testConnection(editingIntegration);
      await updateAuditState(createPaymentIntegrationAuditEvent(editingIntegration, {
        action: 'GET_LAST_TRX',
        status: result.success ? 'SUCCESS' : 'FAILED',
        message: result.message,
        requestDetails: {
          Origen: 'Prueba de conexión',
          TrxType: 'Sale',
        },
        responseDetails: {
          MerchantId: result.merchantId || editingIntegration.merchantId || '',
          TerminalId: result.terminalId || editingIntegration.terminalId || '',
          Estado: result.success ? 'Conectado' : 'Fallido',
        },
        responseCode: result.responseCode,
        responseMessage: result.responseMessage,
        merchantId: result.merchantId,
        terminalId: result.terminalId,
      }));
      setTestResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo probar la conexión.';
      const gatewayError = error instanceof AzulGatewayError ? error : null;
      await updateAuditState(createPaymentIntegrationAuditEvent(editingIntegration, {
        action: 'GET_LAST_TRX',
        status: 'FAILED',
        message,
        requestDetails: {
          Origen: 'Prueba de conexión',
          TrxType: 'Sale',
        },
        responseDetails: {
          MerchantId: gatewayError?.normalized?.merchantId || editingIntegration.merchantId || '',
          TerminalId: gatewayError?.normalized?.terminalId || editingIntegration.terminalId || '',
          Estado: 'Error',
        },
        responseCode: gatewayError?.normalized?.responseCode || gatewayError?.response?.ResponseCode,
        responseMessage: gatewayError?.normalized?.responseMessage || gatewayError?.response?.ResponseMessage,
        merchantId: gatewayError?.normalized?.merchantId,
        terminalId: gatewayError?.normalized?.terminalId,
      }));
      setTestResult({
        success: false,
        message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const updateEditingIntegration = (patch: Partial<PaymentIntegrationDefinition>) => {
    if (!editingIntegration) return;
    setEditingIntegration({
      ...editingIntegration,
      ...patch,
    });
    setTestResult(null);
  };

  return (
    <div className="flex h-full flex-col bg-gray-50 animate-in fade-in">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-8 py-6">
        <div>
          <h1 className="text-2xl font-black text-gray-800">Integraciones</h1>
          <p className="text-sm text-gray-500">Configura proveedores de cobro para asignarlos luego a las formas de pago.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="rounded-lg px-4 py-2 font-bold text-gray-500 hover:bg-gray-100">
            Cancelar
          </button>
          <button
            onClick={handleSaveChanges}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 font-bold text-white transition-all hover:bg-blue-700"
          >
            <Save size={18} /> Guardar Cambios
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-5xl space-y-8">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-blue-100 bg-blue-50 p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-blue-500">Proveedores</p>
              <p className="mt-2 text-3xl font-black text-blue-900">{integrations.length}</p>
              <p className="mt-1 text-sm text-blue-700">Configurados en esta terminal.</p>
            </div>
            <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-500">Activos</p>
              <p className="mt-2 text-3xl font-black text-emerald-900">{enabledCount}</p>
              <p className="mt-1 text-sm text-emerald-700">Listos para asignarse a tarjeta integrada.</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Escalable</p>
              <p className="mt-2 text-lg font-black text-slate-800">AZUL hoy, CardNet después</p>
              <p className="mt-1 text-sm text-slate-500">El POS ya queda preparado para múltiples adquirentes.</p>
            </div>
          </div>

          <section>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold text-gray-700">
                <Settings2 size={20} className="text-blue-500" /> Proveedores configurados
              </h2>
              <button
                onClick={handleCreate}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
              >
                <Plus size={18} /> Nueva Integración
              </button>
            </div>

            {integrations.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-gray-300 bg-white p-10 text-center">
                <CreditCard className="mx-auto mb-3 text-gray-300" size={32} />
                <h3 className="text-lg font-black text-gray-700">Todavía no hay integraciones</h3>
                <p className="mt-2 text-sm text-gray-500">Crea primero AZUL aquí y luego podrás asignarla en Métodos de Pago.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {integrations.map((integration) => (
                  <div
                    key={integration.id}
                    className="flex items-center gap-5 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:shadow-md"
                  >
                    <div className={`flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-md ${integration.provider === 'AZUL' ? 'bg-blue-600' : 'bg-slate-700'}`}>
                      <CreditCard size={28} />
                    </div>

                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-gray-800">{integration.name}</h3>
                        <span className="rounded border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700">
                          {PROVIDER_LABELS[integration.provider]}
                        </span>
                        <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${integration.isEnabled ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                          {integration.isEnabled ? 'Activa' : 'Inactiva'}
                        </span>
                        <span className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-500">
                          {integration.environment}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-500">{integration.baseUrl || 'Sin URL base configurada.'}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-medium text-gray-500">
                        {integration.merchantId && <span>Merchant: {integration.merchantId}</span>}
                        {integration.terminalId && <span>Terminal: {integration.terminalId}</span>}
                        <span>Timeout: {Math.round((integration.timeoutMs || 160000) / 1000)}s</span>
                        <span>Eventos: {(integration.auditEvents || []).length}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setAuditIntegrationId(integration.id)}
                        className="rounded-lg bg-gray-50 px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-sky-50 hover:text-sky-700"
                      >
                        <span className="flex items-center gap-2">
                          <History size={16} /> Auditoría
                        </span>
                      </button>
                      <button
                        onClick={() => handleEdit(integration)}
                        className="rounded-lg bg-gray-50 p-2 text-gray-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
                      >
                        <Settings2 size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(integration.id)}
                        className="rounded-lg bg-gray-50 p-2 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {isEditorOpen && editingIntegration && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white p-5">
              <div>
                <h3 className="text-lg font-bold text-gray-800">Editar Integración</h3>
                <p className="text-sm text-gray-500">Define la conexión técnica del adquirente.</p>
              </div>
              <button onClick={() => setIsEditorOpen(false)} className="rounded-full bg-gray-100 p-2 hover:bg-gray-200">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6 overflow-y-auto p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-gray-500">Nombre</label>
                  <input
                    type="text"
                    value={editingIntegration.name}
                    onChange={(event) => updateEditingIntegration({ name: event.target.value })}
                    className="w-full rounded-xl bg-gray-50 p-3 outline-none ring-0 transition-all focus:ring-2 focus:ring-blue-500"
                    placeholder="AZUL Caja Principal"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-gray-500">Proveedor</label>
                  <select
                    value={editingIntegration.provider}
                    onChange={(event) => handleProviderChange(event.target.value as PaymentIntegrationProvider)}
                    className="w-full rounded-xl bg-gray-50 p-3 outline-none ring-0 transition-all focus:ring-2 focus:ring-blue-500"
                  >
                    {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-gray-500">Ambiente</label>
                  <select
                    value={editingIntegration.environment}
                    onChange={(event) => handleEnvironmentChange(event.target.value as PaymentIntegrationEnvironment)}
                    className="w-full rounded-xl bg-gray-50 p-3 outline-none ring-0 transition-all focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="TEST">Pruebas</option>
                    <option value="PRODUCTION">Producción</option>
                  </select>
                </div>
                <div
                  onClick={() => updateEditingIntegration({ isEnabled: !editingIntegration.isEnabled })}
                  className="flex cursor-pointer items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-4"
                >
                  <div>
                    <p className="text-sm font-bold text-gray-700">Integración activa</p>
                    <p className="text-xs text-gray-500">Disponible para métodos de pago integrados.</p>
                  </div>
                  <div className={`h-6 w-12 rounded-full transition-colors ${editingIntegration.isEnabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <div className={`mt-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${editingIntegration.isEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Wifi size={18} className="text-indigo-600" />
                  <h4 className="text-sm font-bold uppercase tracking-wide text-indigo-800">Conectividad</h4>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">URL Base JSON</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={editingIntegration.baseUrl}
                        onChange={(event) => updateEditingIntegration({ baseUrl: event.target.value })}
                        className="w-full rounded-xl border border-indigo-100 bg-white p-3 pl-10 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                        placeholder="https://pruebas.azul.com.do/POSWebServices/JSON/default.aspx"
                      />
                      <Server className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">URL Secundaria / Failover</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={editingIntegration.secondaryBaseUrl || ''}
                        onChange={(event) => updateEditingIntegration({ secondaryBaseUrl: event.target.value })}
                        className="w-full rounded-xl border border-indigo-100 bg-white p-3 pl-10 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                        placeholder="Opcional"
                      />
                      <RefreshCw className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">Merchant ID</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={editingIntegration.merchantId || ''}
                        onChange={(event) => updateEditingIntegration({ merchantId: event.target.value })}
                        className="w-full rounded-xl border border-indigo-100 bg-white p-3 pl-10 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                        placeholder="39036630010"
                      />
                      <Server className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">Terminal ID</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={editingIntegration.terminalId || ''}
                        onChange={(event) => updateEditingIntegration({ terminalId: event.target.value })}
                        className="w-full rounded-xl border border-indigo-100 bg-white p-3 pl-10 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                        placeholder="01290010"
                      />
                      <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">Auth1</label>
                    <div className="relative">
                      <input
                        type="password"
                        value={editingIntegration.auth1 || ''}
                        onChange={(event) => updateEditingIntegration({ auth1: event.target.value })}
                        className="w-full rounded-xl border border-indigo-100 bg-white p-3 pl-10 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                        placeholder="••••••"
                      />
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">Auth2</label>
                    <div className="relative">
                      <input
                        type="password"
                        value={editingIntegration.auth2 || ''}
                        onChange={(event) => updateEditingIntegration({ auth2: event.target.value })}
                        className="w-full rounded-xl border border-indigo-100 bg-white p-3 pl-10 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                        placeholder="••••••"
                      />
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-300" size={16} />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold uppercase text-indigo-400">Timeout (ms)</label>
                    <input
                      type="number"
                      min={1000}
                      step={1000}
                      value={editingIntegration.timeoutMs || 160000}
                      onChange={(event) => updateEditingIntegration({ timeoutMs: Number(event.target.value) || 160000 })}
                      className="w-full rounded-xl border border-indigo-100 bg-white p-3 outline-none transition-all focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <button
                    onClick={handleTestConnection}
                    disabled={isTesting}
                    className={`flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-bold transition-all ${
                      testResult?.success
                        ? 'border-emerald-200 bg-emerald-100 text-emerald-700'
                        : testResult && !testResult.success
                          ? 'border-red-200 bg-red-100 text-red-700'
                          : 'border-indigo-200 bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                    }`}
                  >
                    {isTesting ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" /> Probando conexión...
                      </>
                    ) : testResult?.success ? (
                      <>
                        <CheckCircle2 size={16} /> Conexión exitosa
                      </>
                    ) : testResult ? (
                      <>
                        <AlertCircle size={16} /> Falló la conexión
                      </>
                    ) : (
                      <>
                        <Wifi size={16} /> Probar conexión
                      </>
                    )}
                  </button>

                  {testResult && (
                    <div className={`rounded-xl border px-4 py-3 text-sm ${testResult.success ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                      {testResult.message}
                    </div>
                  )}
                </div>
              </div>

              {editingIntegration.provider !== 'AZUL' && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                  Esta primera entrega deja el modelo listo para múltiples adquirentes, pero el flujo operativo en caja está implementado ahora mismo para <strong>AZUL</strong>.
                </div>
              )}
            </div>

            <div className="sticky bottom-0 z-10 flex justify-end gap-3 border-t border-gray-100 bg-gray-50 p-5">
              <button
                onClick={() => setIsEditorOpen(false)}
                className="rounded-xl px-5 py-2.5 font-bold text-gray-500 hover:bg-gray-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveIntegration}
                className="rounded-xl bg-blue-600 px-6 py-2.5 font-bold text-white hover:bg-blue-700"
              >
                Guardar Integración
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedAuditIntegration && (
        <IntegrationAuditModal
          integration={selectedAuditIntegration}
          onClose={() => setAuditIntegrationId(null)}
        />
      )}
    </div>
  );
};

export default IntegrationSettings;
