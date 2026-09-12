import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Package, X } from 'lucide-react';

export type ProductEditorTab = {
  id: string;
  label: string;
  icon: LucideIcon;
};

interface ProductEditorHeaderProps {
  isNew: boolean;
  isActive: boolean;
  productType: string;
  sku?: string;
  updatedAt?: string;
  onClose: () => void;
}

const formatProductType = (value: string) => ({
  PRODUCT: 'Producto',
  SERVICE: 'Servicio',
  MATERIA_PRIMA: 'Materia prima',
  PRODUCTO_TERMINADO: 'Producto terminado',
  RECETA: 'Receta',
  KIT: 'Kit',
  SIMPLE: 'Producto',
  COMBO: 'Combo',
  FRACTIONABLE: 'Fraccionable',
}[value] || value);

export const ProductEditorHeader: React.FC<ProductEditorHeaderProps> = ({
  isNew,
  isActive,
  productType,
  sku,
  updatedAt,
  onClose,
}) => (
  <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
    <div className="flex items-center gap-3">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
        <Package size={24} />
      </div>
      <div className="min-w-0">
        <h2 className="truncate text-lg font-black text-slate-900 sm:text-xl">
          {isNew ? 'Nuevo Artículo' : 'Editar Artículo'}
        </h2>
        <p className="text-xs text-slate-500">Gestiona la información de tu producto</p>
      </div>

      <div className="ml-auto hidden items-center gap-2 lg:flex">
        <span className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
          {isActive ? '● Activo' : 'Inactivo'}
        </span>
        <span className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">
          {formatProductType(productType)}
        </span>
        {sku && <span className="px-2 text-xs text-slate-600">SKU: <strong className="text-slate-900">{sku}</strong></span>}
        {updatedAt && (
          <span className="border-l border-slate-200 pl-4 text-xs text-slate-500">
            Última modificación: <strong className="font-semibold text-slate-700">{new Date(updatedAt).toLocaleString()}</strong>
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar editor de artículo"
        className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200"
      >
        <X size={22} />
      </button>
    </div>

    <div className="mt-3 flex flex-wrap items-center gap-2 lg:hidden">
      <span className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
        {isActive ? '● Activo' : 'Inactivo'}
      </span>
      <span className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
        {formatProductType(productType)}
      </span>
      {sku && <span className="text-[11px] text-slate-600">SKU: <strong>{sku}</strong></span>}
    </div>
  </header>
);

interface ProductEditorTabsProps {
  tabs: ProductEditorTab[];
  activeId: string;
  onSelect: (id: string) => void;
  label?: string;
  compact?: boolean;
}

export const ProductEditorTabs: React.FC<ProductEditorTabsProps> = ({ tabs, activeId, onSelect, label = 'Secciones del artículo', compact = false }) => (
  <nav aria-label={label} className={`${compact ? 'sticky top-0 z-20 rounded-xl border border-slate-200 bg-white px-2' : 'shrink-0 border-b border-slate-200 bg-white px-3 sm:px-5'}`}>
    <div className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const selected = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            aria-current={selected ? 'page' : undefined}
            className={`flex min-h-11 shrink-0 appearance-none items-center gap-2 border-b-2 bg-white px-3 text-xs font-bold transition-colors sm:text-sm ${selected ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            <Icon size={17} />
            {tab.label}
          </button>
        );
      })}
    </div>
  </nav>
);
