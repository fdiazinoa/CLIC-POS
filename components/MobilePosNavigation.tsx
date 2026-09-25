import React from 'react';
import { ChefHat, Layout, Layers, Save } from 'lucide-react';

interface MobilePosNavigationProps {
  onOpenTables?: () => void;
  onOpenActions: () => void;
  onDispatchOrder?: () => void;
  onSaveOrder?: (inputTimeStamp: number) => void;
  hasOrderItems?: boolean;
}

/** Direct navigation from the catalog, including when the ticket is empty. */
export const MobilePosNavigation = ({ onOpenTables, onOpenActions, onDispatchOrder, onSaveOrder, hasOrderItems = false }: MobilePosNavigationProps) => (
  <nav aria-label={onSaveOrder ? 'Toma de pedido' : 'Opciones del POS'} className="flex shrink-0 gap-2 border-b border-gray-200 bg-white px-3 py-2">
    {onOpenTables && (
      <button type="button" onClick={onOpenTables} data-testid="mobile-open-tables"
        className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-orange-500 px-3 text-sm font-bold text-white">
        <Layout size={18} /> Mesas
      </button>
    )}
    {onDispatchOrder && (
      <button type="button" onClick={onDispatchOrder} disabled={!hasOrderItems} data-testid="mobile-dispatch-order"
        className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-orange-500 px-2 text-xs font-bold text-white disabled:opacity-40">
        <ChefHat size={17} /> Cocina
      </button>
    )}
    {onSaveOrder && (
      <button type="button" onClick={(event) => onSaveOrder(event.timeStamp)} disabled={!hasOrderItems} data-testid="mobile-save-order"
        className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-blue-600 px-2 text-xs font-bold text-white disabled:opacity-40">
        <Save size={17} /> Guardar pedido
      </button>
    )}
    <button type="button" onClick={onOpenActions} data-testid="mobile-open-actions"
      className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-50 px-3 text-sm font-bold text-blue-700">
      <Layers size={18} /> Opciones
    </button>
  </nav>
);
