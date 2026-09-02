// Visual fixture only: no POS data, APIs, sales or persistence.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Layers, ShoppingBag, Trash2 } from 'lucide-react';
import '../../index.css';
import OrderServiceTypeButton from '../../components/OrderServiceTypeButton';
import OrderServiceTypeDialog from '../../components/OrderServiceTypeDialog';
import type { OrderServiceType } from '../../types';

function Fixture() {
  const [value, setValue] = useState<OrderServiceType>('DINE_IN');
  const [open, setOpen] = useState(false);
  return <main className="bg-slate-100 min-h-screen">
    <div className="p-5 bg-white max-w-full" data-testid="fixture-header">
      <div className="flex w-full items-center justify-between gap-1" data-testid="fixture-toolbar">
        <div className="flex min-w-0 shrink-0 items-center"><div className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-2.5 py-1.5"><span className="text-[0.72rem] font-black tracking-[0.22em] text-slate-100">CLIC</span><span className="text-[0.72rem] font-black tracking-[0.22em] text-sky-400">POS</span></div></div>
        <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
          <button className="h-12 w-12 shrink-0 rounded-2xl border"><Trash2 /></button>
          <button className="h-12 w-12 shrink-0 rounded-2xl border"><ShoppingBag /></button>
          <button aria-label="Abrir acciones rápidas" className="h-12 w-12 shrink-0 rounded-2xl border"><Layers /></button>
          <OrderServiceTypeButton value={value} onClick={() => setOpen(true)} />
        </div>
      </div>
    </div>
    {open && <OrderServiceTypeDialog value={value} onSelect={v => { setValue(v); setOpen(false); }} onClose={() => setOpen(false)} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
