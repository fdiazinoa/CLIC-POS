import React from 'react';
import { Layout, Layers } from 'lucide-react';

interface MobilePosNavigationProps {
  onOpenTables?: () => void;
  onOpenActions: () => void;
}

/** Direct navigation from the catalog, including when the ticket is empty. */
export const MobilePosNavigation = ({ onOpenTables, onOpenActions }: MobilePosNavigationProps) => (
  <nav aria-label="Opciones del POS" className="flex shrink-0 gap-2 border-b border-gray-200 bg-white px-3 py-2">
    {onOpenTables && (
      <button type="button" onClick={onOpenTables} data-testid="mobile-open-tables"
        className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-orange-500 px-3 text-sm font-bold text-white">
        <Layout size={18} /> Mesas
      </button>
    )}
    <button type="button" onClick={onOpenActions} data-testid="mobile-open-actions"
      className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-50 px-3 text-sm font-bold text-blue-700">
      <Layers size={18} /> Opciones
    </button>
  </nav>
);
