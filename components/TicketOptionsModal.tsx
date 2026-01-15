
import React from 'react';
import { 
  UserPlus, Split, PieChart, Percent, Clock, X, Save, Trash2, 
  Coins, Receipt, History, ArrowDownToLine, Printer, Wallet, UserCheck
} from 'lucide-react';

interface TicketOptionsModalProps {
  onClose: () => void;
  onAction: (actionId: string) => void;
}

interface ActionItem {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  bg: string;
}

const TicketOptionsModal: React.FC<TicketOptionsModalProps> = ({ onClose, onAction }) => {
  
  const actions: ActionItem[] = [
    // Gestión de Cuenta
    { 
      id: 'SPLIT_BILL', 
      label: 'Dividir', 
      icon: Split, 
      color: 'text-orange-600',
      bg: 'bg-orange-50'
    },
    { 
      id: 'FRACTION', 
      label: 'Fraccionar', 
      icon: PieChart, 
      color: 'text-purple-600',
      bg: 'bg-purple-50'
    },
    // Pagos y Tarifas
    { 
      id: 'DISCOUNT', 
      label: 'Descuento', 
      icon: Percent, 
      color: 'text-rose-600',
      bg: 'bg-rose-50'
    },
    // Vendedor Global
    { 
      id: 'ASSIGN_SELLER', 
      label: 'Vendedor', 
      icon: UserCheck, 
      color: 'text-blue-600',
      bg: 'bg-blue-50'
    },
    // Print Subtotal (Proforma)
    { 
      id: 'PRINT_SUBTOTAL',
      label: 'Proforma', 
      icon: Printer, 
      color: 'text-cyan-600',
      bg: 'bg-cyan-50'
    },
    // Finanzas (Nueva ubicación)
    { 
      id: 'FINANCE', 
      label: 'Finanzas', 
      icon: Wallet, 
      color: 'text-emerald-600',
      bg: 'bg-emerald-50'
    },
    // Utilidades
    { 
      id: 'SHOW_TIME', 
      label: 'Tiempo', 
      icon: Clock, 
      color: 'text-teal-600',
      bg: 'bg-teal-50'
    }
  ];

  return (
    <div className="fixed inset-0 z-[70] flex justify-center items-end sm:items-center bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-200">
      
      {/* Click overlay to close */}
      <div className="absolute inset-0" onClick={onClose}></div>

      {/* Bottom Sheet Container */}
      <div className="relative w-full max-w-md bg-white rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.2)] overflow-hidden animate-in slide-in-from-bottom-10 duration-300">
        
        {/* Handle Bar (Visual cue for dragging) */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-gray-200 rounded-full" />

        {/* Header */}
        <div className="pt-8 pb-4 px-8 flex justify-between items-center">
          <div>
            <h3 className="text-xl font-black text-slate-800 tracking-tight">Acciones</h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Opciones avanzadas del ticket</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 bg-gray-50 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Action Grid */}
        <div className="px-6 pb-8">
          <div className="grid grid-cols-3 gap-y-6 gap-x-2">
            {actions.map((action) => (
              <button
                key={action.id}
                onClick={() => onAction(action.id)}
                className="group flex flex-col items-center gap-2 outline-none"
              >
                {/* Icon Container with Micro-interaction */}
                <div 
                  className={`
                    w-16 h-16 rounded-[1.2rem] flex items-center justify-center 
                    ${action.bg} ${action.color} 
                    shadow-sm group-hover:shadow-md group-active:scale-90 
                    transition-all duration-200 ease-out border border-white
                  `}
                >
                  <action.icon size={28} strokeWidth={2} />
                </div>
                
                {/* Label */}
                <span className="text-[11px] font-semibold text-slate-600 group-hover:text-slate-900 tracking-wide text-center leading-tight">
                  {action.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Pro Tip Footer (Optional visual filler) */}
        <div className="bg-slate-50 py-3 text-center border-t border-slate-100">
           <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">CLIC OS 2.0</p>
        </div>

      </div>
    </div>
  );
};

export default TicketOptionsModal;
