import React from 'react';
import { Building2, ShoppingBag, Truck, Percent, type LucideIcon } from 'lucide-react';
import { OrderServiceType, ServiceTaxPolicy, ServiceTaxPolicyMap, TaxDefinition } from '../types';

interface ServiceTaxPolicyEditorProps {
  taxes: TaxDefinition[];
  value?: ServiceTaxPolicyMap;
  fallback?: ServiceTaxPolicyMap;
  onChange: (value: ServiceTaxPolicyMap) => void;
  disabled?: boolean;
  allowInherit?: boolean;
}

const OPTIONS: Array<{
  serviceType: OrderServiceType;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  { serviceType: 'DINE_IN', label: 'En local', description: 'Consumo dentro del establecimiento.', icon: Building2 },
  { serviceType: 'TAKEOUT', label: 'Para llevar', description: 'Pedido retirado y consumido fuera.', icon: ShoppingBag },
  { serviceType: 'DELIVERY', label: 'Delivery', description: 'Pedido entregado por canal propio o marketplace.', icon: Truck },
];

const ServiceTaxPolicyEditor: React.FC<ServiceTaxPolicyEditorProps> = ({
  taxes,
  value = {},
  fallback = {},
  onChange,
  disabled = false,
  allowInherit = false,
}) => {
  const setPolicy = (serviceType: OrderServiceType, policy: ServiceTaxPolicy | undefined) => {
    const next = { ...value };
    if (policy) next[serviceType] = policy;
    else delete next[serviceType];
    onChange(next);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      {OPTIONS.map(({ serviceType, label, description, icon: Icon }) => {
        const ownPolicy = value[serviceType];
        const inheritedPolicy = fallback[serviceType] || {};
        const isInherited = allowInherit && !ownPolicy;
        const policy = ownPolicy || inheritedPolicy;
        const selectedTaxIds = policy.taxIds;
        const legalTip = policy.legalTip || { enabled: false, percentage: 0 };

        return (
          <section key={serviceType} className={`rounded-3xl border p-5 ${isInherited ? 'border-dashed border-slate-300 bg-slate-50/70' : 'border-emerald-200 bg-white'}`}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-2xl bg-emerald-100 text-emerald-700"><Icon size={20} /></div>
                <div>
                  <h3 className="font-black text-slate-800">{label}</h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{description}</p>
                </div>
              </div>
              {allowInherit && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setPolicy(serviceType, ownPolicy ? undefined : { ...inheritedPolicy })}
                  className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase ${isInherited ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}
                >
                  {isInherited ? 'Heredada' : 'Propia'}
                </button>
              )}
            </div>

            <div className={`space-y-4 ${isInherited ? 'opacity-70' : ''}`}>
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Impuestos permitidos</p>
                  <button
                    type="button"
                    disabled={disabled || isInherited}
                    onClick={() => setPolicy(serviceType, { ...policy, taxIds: undefined })}
                    className="text-[10px] font-black text-emerald-700 disabled:opacity-40"
                  >
                    Usar artículo
                  </button>
                </div>
                <div className="space-y-2">
                  {taxes.map((tax) => {
                    const selected = selectedTaxIds === undefined || selectedTaxIds.includes(tax.id);
                    return (
                      <label key={tax.id} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={disabled || isInherited}
                          onChange={() => {
                            const current = selectedTaxIds === undefined ? taxes.map((item) => item.id) : selectedTaxIds;
                            const nextTaxIds = selected
                              ? current.filter((id) => id !== tax.id)
                              : [...current, tax.id];
                            setPolicy(serviceType, { ...policy, taxIds: Array.from(new Set(nextTaxIds)) });
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                        />
                        <span className="flex-1">{tax.name}</span>
                        <span className="text-slate-400">{(Number(tax.rate || 0) * 100).toFixed(2)}%</span>
                      </label>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10px] font-medium text-slate-400">
                  {selectedTaxIds === undefined
                    ? 'Respeta los impuestos asignados a cada artículo.'
                    : `${selectedTaxIds.length} impuesto(s) habilitado(s) como máximo.`}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                <label className="flex items-center gap-2 text-xs font-black text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(legalTip.enabled)}
                    disabled={disabled || isInherited}
                    onChange={(event) => setPolicy(serviceType, {
                      ...policy,
                      legalTip: { ...legalTip, enabled: event.target.checked },
                    })}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                  />
                  <Percent size={15} className="text-emerald-600" />
                  Aplicar propina legal
                </label>
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={Number(legalTip.percentage || 0)}
                    disabled={disabled || isInherited || !legalTip.enabled}
                    onChange={(event) => setPolicy(serviceType, {
                      ...policy,
                      legalTip: {
                        enabled: legalTip.enabled,
                        percentage: Math.max(0, Math.min(100, Number(event.target.value || 0))),
                      },
                    })}
                    className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black disabled:opacity-40"
                  />
                  <span className="text-sm font-black text-slate-500">%</span>
                </div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default ServiceTaxPolicyEditor;
