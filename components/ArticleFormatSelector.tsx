import React from 'react';
import type { ArticleFormat, ArticleFormatsDTO } from '../services/articleFormats/contract';
import { availability, formatPrice, saleFormats } from '../services/articleFormats/domain';

interface Props {
  itemName: string;
  dto: ArticleFormatsDTO;
  variantId: string | null;
  tariffId: string;
  baseTariffPrice: number;
  stockBase: number;
  currencySymbol: string;
  onSelect: (format: ArticleFormat, price: number) => void;
  onClose: () => void;
}

export default function ArticleFormatSelector(props: Props) {
  const formats = saleFormats(props.dto,props.variantId);
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Presentación de venta">
    <div className="bg-white rounded-2xl p-6 w-full max-w-lg">
      <div className="flex justify-between items-center mb-4"><h2 className="font-bold text-lg">{props.itemName} · Presentación</h2>
        <button onClick={props.onClose} aria-label="Cerrar">✕</button></div>
      {formats.length === 0 && <p>No hay presentaciones habilitadas para esta variante.</p>}
      <div className="space-y-2">{formats.map(format => {
        const price = formatPrice(format,props.tariffId,props.baseTariffPrice);
        return <button key={format.id} autoFocus={format.default_sale} onClick={() => props.onSelect(format,price)} className="w-full text-left border rounded-xl p-3 hover:bg-blue-50">
          <span className="font-bold">{format.name} ({format.abbreviation})</span>
          {format.default_sale && <span className="ml-2 text-xs text-blue-600">Predeterminada</span>}
          <div>{props.currencySymbol}{price.toFixed(2)} · {format.factor} unidades base</div>
          <div className="text-sm text-gray-500">Disponibles: {Math.max(0,availability(props.stockBase,format.factor))}</div>
        </button>;
      })}</div>
    </div>
  </div>;
}
