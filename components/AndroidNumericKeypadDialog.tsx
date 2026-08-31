import React from 'react';
import { Check, X } from 'lucide-react';
import NumericKeypad from './NumericKeypad';

interface AndroidNumericKeypadDialogProps {
  title: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  allowDecimal?: boolean;
}

const AndroidNumericKeypadDialog: React.FC<AndroidNumericKeypadDialogProps> = ({
  title,
  value,
  onChange,
  onClose,
  allowDecimal = true,
}) => (
  <div
    className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
    onClick={onClose}
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <div className="w-full max-w-sm rounded-[2rem] bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-black text-slate-900">{title}</h3>
        <button type="button" onClick={onClose} className="rounded-xl bg-slate-100 p-2 text-slate-500" aria-label="Cerrar teclado numérico">
          <X size={20} />
        </button>
      </div>
      <div className="mb-4 min-h-16 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right text-3xl font-black text-slate-900">
        {value || '0'}
      </div>
      <NumericKeypad value={value} onChange={onChange} allowDecimal={allowDecimal} />
      <button type="button" onClick={onClose} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 font-black text-white">
        <Check size={18} /> Listo
      </button>
    </div>
  </div>
);

export default AndroidNumericKeypadDialog;
