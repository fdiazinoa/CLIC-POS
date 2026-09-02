import React, { useEffect } from 'react';
import { Building2, ShoppingBag, Truck, Check, X } from 'lucide-react';
import { OrderServiceType } from '../types';

export const SERVICE_TYPE_OPTIONS = [
   { value: 'DINE_IN', label: 'En local', description: 'Consumo dentro del establecimiento.', icon: Building2 },
   { value: 'TAKEOUT', label: 'Para llevar', description: 'El cliente recoge el pedido.', icon: ShoppingBag },
   { value: 'DELIVERY', label: 'Delivery', description: 'Entrega a domicilio, por teléfono o WhatsApp.', icon: Truck },
] as const;

interface Props {
   value: OrderServiceType;
   locked?: boolean;
   onSelect: (value: OrderServiceType) => void;
   onClose: () => void;
}

export default function OrderServiceTypeDialog({ value, locked = false, onSelect, onClose }: Props) {
   useEffect(() => {
      const handleKey = (event: KeyboardEvent) => {
         if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      };
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
   }, [onClose]);

   return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
         <section role="dialog" aria-modal="true" aria-label="Tipo de servicio" className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
            <header className="mb-4 flex items-center justify-between gap-3">
               <h2 className="text-xl font-black text-slate-900">Tipo de servicio</h2>
               <button autoFocus type="button" aria-label="Cerrar tipo de servicio" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100"><X size={22} /></button>
            </header>
            <p className="mb-4 text-sm text-slate-500">Se aplicarán los impuestos y la propina configurados para el servicio elegido.</p>
            {locked && <p role="status" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">Este pedido de Uber Eats está identificado como Delivery y no se puede reclasificar.</p>}
            <div className="space-y-3">
               {SERVICE_TYPE_OPTIONS.map(({ value: option, label, description, icon: Icon }) => (
                  <button key={option} type="button" aria-pressed={value === option} disabled={locked} onClick={() => { if (!locked) onSelect(option); }}
                     className={`flex w-full items-center gap-3 rounded-2xl border-2 p-4 text-left disabled:opacity-60 ${value === option ? 'border-violet-600 bg-violet-50 text-violet-800' : 'border-slate-200 text-slate-700'}`}>
                     <Icon size={24} className="shrink-0" />
                     <span className="flex-1"><span className="block font-black">{label}</span><span className="text-xs">{description}</span></span>
                     {value === option && <Check size={20} aria-hidden="true" />}
                  </button>
               ))}
            </div>
         </section>
      </div>
   );
}
