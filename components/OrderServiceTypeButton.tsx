import React from 'react';
import { Building2, ShoppingBag, Truck } from 'lucide-react';
import { OrderServiceType } from '../types';

export default function OrderServiceTypeButton({ value, onClick }: { value: OrderServiceType; onClick: () => void }) {
   const label = value === 'DINE_IN' ? 'En local' : value === 'TAKEOUT' ? 'Para llevar' : 'Delivery';
   const Icon = value === 'DINE_IN' ? Building2 : value === 'TAKEOUT' ? ShoppingBag : Truck;
   return (
      <button type="button" data-testid="ticket-service-type-button" aria-label={`Tipo de servicio: ${label}`} aria-haspopup="dialog" title={`Tipo de servicio: ${label}`} onClick={onClick}
         className="flex h-12 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl border border-violet-200 bg-violet-50 px-1 text-violet-700 hover:bg-violet-100 focus-visible:ring-2 focus-visible:ring-violet-500">
         <Icon size={18} aria-hidden="true" />
         <span className="text-[9px] font-black leading-tight text-center">{label}</span>
      </button>
   );
}
