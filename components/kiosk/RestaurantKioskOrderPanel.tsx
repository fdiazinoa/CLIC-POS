import React from 'react';
import { CreditCard, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import type { CartItem } from '../../types';

type RestaurantKioskOrderPanelProps = {
  open: boolean;
  cart: CartItem[];
  itemCount: number;
  total: number;
  formatMoney: (amount: number) => string;
  checkoutError?: string;
  onOpen: () => void;
  onClose: () => void;
  onDecrease: (item: CartItem) => void;
  onIncrease: (item: CartItem) => void;
  onRemove: (cartIdentity: string) => void;
  onCheckout: () => void;
};

const RestaurantKioskOrderPanel: React.FC<RestaurantKioskOrderPanelProps> = ({
  open,
  cart,
  itemCount,
  total,
  formatMoney,
  checkoutError,
  onOpen,
  onClose,
  onDecrease,
  onIncrease,
  onRemove,
  onCheckout,
}) => (
  <>
    <div className="absolute bottom-5 right-5 z-30">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[56px] items-center gap-3 rounded-2xl bg-orange-600 px-5 py-3 font-black text-white shadow-2xl shadow-orange-900/25 active:scale-[0.98]"
      >
        <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
          <ShoppingBag size={24} />
          {itemCount > 0 && (
            <span className="absolute -right-2 -top-2 min-w-6 rounded-full bg-white px-1.5 py-0.5 text-center text-xs text-orange-700">
              {itemCount}
            </span>
          )}
        </span>
        <span className="text-left">
          <span className="block text-base">Ver pedido</span>
          <span className="block text-xs text-orange-100">{itemCount} unidades · {formatMoney(total)}</span>
        </span>
      </button>
    </div>

    {open && (
      <div className="fixed inset-0 z-50 flex flex-col bg-slate-50" role="dialog" aria-modal="true" aria-label="Revisar pedido">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">Tu pedido</p>
            <h2 className="text-3xl font-black text-slate-950">Revisa antes de pagar</h2>
          </div>
          <button type="button" onClick={onClose} className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-700" aria-label="Cerrar pedido">
            <X size={24} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
              <ShoppingBag size={64} />
              <p className="mt-4 text-2xl font-black">Aún no agregaste productos</p>
            </div>
          ) : (
            <div className="mx-auto grid w-full max-w-4xl gap-4">
              {cart.map((item) => (
                <article key={item.cartId || item.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="text-xl font-black text-slate-900">{item.name}</h3>
                      {item.modifiers?.length ? <p className="mt-1 text-sm font-semibold text-slate-500">{item.modifiers.join(' · ')}</p> : null}
                      <p className="mt-2 text-lg font-black text-orange-700">{formatMoney(item.price * item.quantity)}</p>
                    </div>
                    <button type="button" onClick={() => onRemove(item.cartId || item.id)} className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-600" aria-label={`Eliminar ${item.name}`}>
                      <Trash2 size={21} />
                    </button>
                  </div>
                  <div className="mt-4 flex items-center justify-end gap-3">
                    <button type="button" onClick={() => onDecrease(item)} className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-800" aria-label={`Restar ${item.name}`}><Minus size={21} /></button>
                    <span className="min-w-10 text-center text-xl font-black text-slate-900">{item.quantity}</span>
                    <button type="button" onClick={() => onIncrease(item)} className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-600 text-white" aria-label={`Sumar ${item.name}`}><Plus size={21} /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <footer className="border-t border-slate-200 bg-white p-5">
          <div className="mx-auto flex w-full max-w-4xl items-center gap-5">
            <div className="min-w-44">
              <p className="text-sm font-bold text-slate-500">Total</p>
              <p className="text-3xl font-black text-slate-950">{formatMoney(total)}</p>
            </div>
            <button type="button" onClick={onCheckout} disabled={cart.length === 0} className="flex min-h-[64px] flex-1 items-center justify-center gap-3 rounded-2xl bg-emerald-600 text-2xl font-black text-white disabled:bg-slate-300">
              <CreditCard size={28} /> Continuar al pago
            </button>
          </div>
          {checkoutError && <p role="alert" className="mx-auto mt-3 max-w-4xl rounded-xl bg-red-50 px-4 py-3 text-center text-sm font-black text-red-700">{checkoutError}</p>}
        </footer>
      </div>
    )}
  </>
);

export default RestaurantKioskOrderPanel;
