import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { DEFAULT_PRINT_COPIES, MAX_PRINT_COPIES, normalizePrintCopies } from '../utils/printCopies';

interface PrintCopiesStepperProps {
   label: string;
   value: number | undefined;
   onChange: (copies: number) => void;
}

/** A bounded touch control: changing copies never requires Android's keyboard. */
const PrintCopiesStepper: React.FC<PrintCopiesStepperProps> = ({ label, value, onChange }) => {
   const copies = normalizePrintCopies(value);
   return (
      <div role="group" aria-label={`Copias de ${label}`} className="flex shrink-0 items-center gap-1 rounded-xl border border-gray-300 bg-white p-1">
         <button
            type="button"
            aria-label={`Reducir copias de ${label}`}
            disabled={copies <= DEFAULT_PRINT_COPIES}
            onClick={() => onChange(normalizePrintCopies(copies - 1))}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-emerald-700 active:bg-emerald-100 disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-emerald-500"
         >
            <Minus size={20} aria-hidden="true" />
         </button>
         <output aria-live="polite" aria-label={`Cantidad de copias de ${label}`} className="min-w-7 text-center text-base font-black tabular-nums text-slate-800">
            {copies}
         </output>
         <button
            type="button"
            aria-label={`Aumentar copias de ${label}`}
            disabled={copies >= MAX_PRINT_COPIES}
            onClick={() => onChange(normalizePrintCopies(copies + 1))}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-emerald-700 active:bg-emerald-100 disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-emerald-500"
         >
            <Plus size={20} aria-hidden="true" />
         </button>
      </div>
   );
};

export default PrintCopiesStepper;
