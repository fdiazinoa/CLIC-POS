import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Percent, Plus, Save, ShieldAlert, Trash2 } from 'lucide-react';
import { BusinessConfig, Product, TaxDefinition } from '../types';
import { apiSyncAdapter } from '../services/sync/ApiSyncAdapter';
import { syncPolicy } from '../services/sync/SyncProfile';

interface TaxSettingsProps {
  config: BusinessConfig;
  products: Product[];
  onUpdateConfig: (newConfig: BusinessConfig, restart?: boolean) => void;
  onUpdateProducts: (products: Product[]) => void;
  onClose: () => void;
  currentUser?: { id: string; name: string } | null;
  terminalId?: string;
}

const TAX_TYPE_OPTIONS: Array<{ value: TaxDefinition['type']; label: string }> = [
  { value: 'VAT', label: 'ITBIS / IVA' },
  { value: 'SERVICE_CHARGE', label: 'Cargo de servicio' },
  { value: 'EXEMPT', label: 'Exento' },
  { value: 'OTHER', label: 'Otro' },
];

const createTaxId = () => `tax-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const resolveInitialDefaultTaxId = (config: BusinessConfig): string => {
  const taxes = Array.isArray(config.taxes) ? config.taxes : [];
  const matchingVat = taxes.find((tax) => tax.type === 'VAT' && Math.abs((tax.rate || 0) - (config.taxRate || 0)) < 0.0001);
  return matchingVat?.id || taxes.find((tax) => tax.type === 'VAT')?.id || taxes[0]?.id || '';
};

const formatRateInput = (rate: number) => {
  const percent = (Number(rate) || 0) * 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2);
};

const normalizePercentInput = (value: string): number => {
  const parsed = Number(value.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed / 100;
};

const TaxSettings: React.FC<TaxSettingsProps> = ({
  config,
  products,
  onUpdateConfig,
  onUpdateProducts,
  onClose,
  currentUser,
  terminalId,
}) => {
  const [draftTaxes, setDraftTaxes] = useState<TaxDefinition[]>(config.taxes || []);
  const [defaultTaxId, setDefaultTaxId] = useState<string>(resolveInitialDefaultTaxId(config));

  useEffect(() => {
    setDraftTaxes(config.taxes || []);
    setDefaultTaxId(resolveInitialDefaultTaxId(config));
  }, [config]);

  const productUsageByTaxId = useMemo(() => {
    const usage = new Map<string, number>();
    (products || []).forEach((product) => {
      (product.appliedTaxIds || []).forEach((taxId) => {
        usage.set(taxId, (usage.get(taxId) || 0) + 1);
      });
    });
    return usage;
  }, [products]);

  const handleTaxChange = <K extends keyof TaxDefinition>(taxId: string, field: K, value: TaxDefinition[K]) => {
    setDraftTaxes((prev) => prev.map((tax) => (tax.id === taxId ? { ...tax, [field]: value } : tax)));
  };

  const handleAddTax = () => {
    const nextTax: TaxDefinition = {
      id: createTaxId(),
      name: 'Nuevo impuesto',
      rate: 0,
      type: 'VAT',
    };

    setDraftTaxes((prev) => [...prev, nextTax]);
    if (!defaultTaxId) {
      setDefaultTaxId(nextTax.id);
    }
  };

  const handleDeleteTax = (taxId: string) => {
    if (draftTaxes.length === 1) {
      alert('Debe existir al menos una definición de impuesto.');
      return;
    }

    setDraftTaxes((prev) => prev.filter((tax) => tax.id !== taxId));
    if (defaultTaxId === taxId) {
      const replacement = draftTaxes.find((tax) => tax.id !== taxId && tax.type === 'VAT') || draftTaxes.find((tax) => tax.id !== taxId);
      setDefaultTaxId(replacement?.id || '');
    }
  };

  const handleSave = async () => {
    const normalizedTaxes = draftTaxes.map((tax, index) => ({
      ...tax,
      id: tax.id || createTaxId(),
      name: tax.name.trim() || `Impuesto ${index + 1}`,
      rate: Number.isFinite(Number(tax.rate)) ? Math.max(0, Number(tax.rate)) : 0,
    }));

    if (normalizedTaxes.length === 0) {
      alert('Debe configurar al menos un impuesto.');
      return;
    }

    const duplicatedNames = normalizedTaxes
      .map((tax) => tax.name.toLowerCase())
      .filter((name, index, source) => source.indexOf(name) !== index);

    if (duplicatedNames.length > 0) {
      alert('Hay impuestos con nombres duplicados. Ajuste los nombres antes de guardar.');
      return;
    }

    const primaryTax =
      normalizedTaxes.find((tax) => tax.id === defaultTaxId && tax.type === 'VAT') ||
      normalizedTaxes.find((tax) => tax.type === 'VAT') ||
      normalizedTaxes.find((tax) => tax.id === defaultTaxId) ||
      normalizedTaxes[0];

    const nextTaxRate = primaryTax?.type === 'VAT'
      ? primaryTax.rate
      : normalizedTaxes.find((tax) => tax.type === 'VAT')?.rate || 0;

    const remainingTaxIds = new Set(normalizedTaxes.map((tax) => tax.id));
    const fallbackTaxId =
      normalizedTaxes.find((tax) => tax.type === 'EXEMPT')?.id ||
      primaryTax?.id ||
      normalizedTaxes[0]?.id;

    let productsChanged = false;
    const nextProducts = (products || []).map((product) => {
      const currentTaxIds = Array.isArray(product.appliedTaxIds) ? product.appliedTaxIds : [];
      const filteredTaxIds = currentTaxIds.filter((taxId) => remainingTaxIds.has(taxId));
      const nextAppliedTaxIds = filteredTaxIds.length > 0
        ? filteredTaxIds
        : (fallbackTaxId ? [fallbackTaxId] : []);

      if (JSON.stringify(currentTaxIds) === JSON.stringify(nextAppliedTaxIds)) {
        return product;
      }

      productsChanged = true;
      return {
        ...product,
        appliedTaxIds: nextAppliedTaxIds,
      };
    });

    try {
      if (syncPolicy.targetKind() === 'ERP_ACTIVE') {
        await apiSyncAdapter.saveTaxes(normalizedTaxes, {
          userId: currentUser?.id || 'POS',
          userName: currentUser?.name || 'POS',
          terminalId,
        });
      }
      if (productsChanged) await Promise.resolve(onUpdateProducts(nextProducts));
      await Promise.resolve(onUpdateConfig({
        ...config,
        taxRate: nextTaxRate,
        taxes: normalizedTaxes,
      }));
      alert('Configuración de impuestos guardada correctamente.');
    } catch (error: any) {
      alert(`No se pudieron sincronizar los impuestos: ${error?.message || 'error desconocido'}`);
    }
  };

  const primaryTaxPreview =
    draftTaxes.find((tax) => tax.id === defaultTaxId && tax.type === 'VAT') ||
    draftTaxes.find((tax) => tax.type === 'VAT') ||
    draftTaxes.find((tax) => tax.id === defaultTaxId) ||
    draftTaxes[0];

  const primaryTaxName = primaryTaxPreview?.name || 'Sin definir';
  const primaryTaxRate = primaryTaxPreview?.rate || 0;

  return (
    <div
      className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar"
      style={{
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y',
      }}
    >
      <div className="max-w-6xl mx-auto w-full p-4 md:p-8 pb-24 md:pb-16 animate-in fade-in min-h-full">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-8">
          <div>
            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-white border border-slate-200 shadow-sm text-slate-700 font-bold hover:bg-slate-50 transition-colors mb-5"
            >
              <ArrowLeft size={18} />
              Volver
            </button>
            <div className="flex items-start gap-3 mb-2">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                <Percent size={28} />
              </div>
              <div>
                <h1 className="text-3xl font-black text-slate-800">Impuestos</h1>
                <p className="text-slate-500 mt-1">Administra ITBIS, exentos y cargos aplicables a productos y reportes.</p>
              </div>
            </div>
          </div>

          <button
            onClick={handleSave}
            className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black shadow-lg shadow-emerald-200 hover:bg-emerald-500 active:scale-95 transition-all"
          >
            <Save size={18} />
            Guardar Cambios
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_0.8fr] gap-6">
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6 md:p-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
              <div>
                <h2 className="text-xl font-black text-slate-800">Definiciones</h2>
                <p className="text-sm text-slate-500 mt-1">Cada artículo puede usar una o varias tasas.</p>
              </div>
              <button
                onClick={handleAddTax}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-black transition-colors"
              >
                <Plus size={16} />
                Nuevo
              </button>
            </div>

            <div className="space-y-4">
              {draftTaxes.map((tax) => {
                const usageCount = productUsageByTaxId.get(tax.id) || 0;
                const isPrimary = defaultTaxId === tax.id;

                return (
                  <div key={tax.id} className={`rounded-[1.75rem] border p-5 transition-colors ${isPrimary ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50/70'}`}>
                    <div className="grid grid-cols-1 md:grid-cols-[1.3fr_0.9fr_0.8fr_auto] gap-4 items-start">
                      <div>
                        <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Nombre</label>
                        <input
                          type="text"
                          value={tax.name}
                          onChange={(event) => handleTaxChange(tax.id, 'name', event.target.value)}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Tipo</label>
                        <select
                          value={tax.type}
                          onChange={(event) => handleTaxChange(tax.id, 'type', event.target.value as TaxDefinition['type'])}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        >
                          {TAX_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Tasa %</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={formatRateInput(tax.rate)}
                          onChange={(event) => handleTaxChange(tax.id, 'rate', normalizePercentInput(event.target.value))}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        />
                      </div>

                      <div className="flex md:flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => setDefaultTaxId(tax.id)}
                          className={`px-4 py-3 rounded-2xl font-bold transition-colors ${isPrimary ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'}`}
                        >
                          Base
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTax(tax.id)}
                          className="px-4 py-3 rounded-2xl bg-red-50 text-red-600 font-bold hover:bg-red-100 transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 mt-4">
                      <span className="inline-flex items-center rounded-full px-3 py-1 bg-white border border-slate-200 text-xs font-black uppercase tracking-wide text-slate-500">
                        {usageCount} productos usan esta tasa
                      </span>
                      {isPrimary && (
                        <span className="inline-flex items-center rounded-full px-3 py-1 bg-emerald-600 text-xs font-black uppercase tracking-wide text-white">
                          Tasa base del POS
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm p-6">
              <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Resumen Operativo</p>
              <div className="space-y-4">
                <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                  <p className="text-sm text-slate-500 mb-1">Tasa base usada por cálculos globales</p>
                  <p className="text-xl font-black text-slate-800">{primaryTaxName}</p>
                  <p className="text-sm text-emerald-600 font-bold mt-1">{(primaryTaxRate * 100).toFixed(2)}%</p>
                </div>
                <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                  <p className="text-sm text-slate-500 mb-1">Definiciones activas</p>
                  <p className="text-3xl font-black text-slate-800">{draftTaxes.length}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                  <p className="text-sm text-slate-500 mb-1">Productos con impuestos asignados</p>
                  <p className="text-3xl font-black text-slate-800">
                    {products.filter((product) => (product.appliedTaxIds || []).length > 0).length}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-[2rem] p-6">
              <div className="flex items-start gap-3">
                <ShieldAlert className="text-amber-600 shrink-0 mt-0.5" size={20} />
                <div>
                  <h3 className="font-black text-amber-900 mb-2">Impacto del cambio</h3>
                  <p className="text-sm text-amber-800 leading-relaxed">
                    Si elimina un impuesto, los productos que lo usaban se reasignarán a la tasa exenta o a la tasa base disponible para no dejarlos sin configuración fiscal.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaxSettings;
