import React from 'react';

interface Props {
  symbol: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  units: number;
  points: number;
}

export default function SupermarketTicketSummary({ symbol, subtotal, discount, tax, total, units, points }: Props) {
  const money = (value: number) => symbol + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <section className="supermarket-footer-summary" aria-label="Resumen del ticket">
    <div className="flex flex-wrap gap-2 mb-3">
      <div className="rounded-lg bg-blue-100 px-3 py-2 text-blue-900">
        <span className="text-xl font-black tabular-nums">{units}</span>
        <span className="ml-2 text-xs font-bold">{units === 1 ? 'unidad' : 'unidades'}</span>
      </div>
      {points > 0 && <div className="rounded-lg bg-purple-100 px-3 py-2 text-purple-800 text-sm font-bold">Ganarás <strong className="text-lg tabular-nums">{points}</strong> puntos</div>}
    </div>
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
      <div><dt>Subtotal</dt><dd className="text-sm font-bold text-slate-700 tabular-nums">{money(subtotal)}</dd></div>
      {discount > 0 && <div className="text-red-600"><dt>Descuento</dt><dd className="text-sm font-bold tabular-nums">-{money(discount)}</dd></div>}
      <div><dt>Impuestos</dt><dd className="text-sm font-bold text-slate-700 tabular-nums">{money(tax)}</dd></div>
    </dl>
    <div className="border-t border-slate-200 mt-3 pt-3">
      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Total a pagar</p>
      <p className="supermarket-payable font-black text-slate-900 tabular-nums mt-1">{money(total)}</p>
    </div>
  </section>;
}
