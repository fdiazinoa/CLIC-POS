import React from 'react';
import { Layers, Settings, ShoppingBag } from 'lucide-react';

interface HandheldPOSHeaderProps {
  restaurant: boolean;
  operator: string;
  terminal: string;
  table?: string;
  view: 'PRODUCTS' | 'TICKET';
  quantity: string;
  status: React.ReactNode;
  onView: (view: 'PRODUCTS' | 'TICKET') => void;
  onActions: () => void;
  onSettings: () => void;
  onTables?: () => void;
}

/** Only presentation and navigation; checkout and table mutations stay in POSInterface. */
export function HandheldPOSHeader(props: HandheldPOSHeaderProps) {
  return <header className="handheld-header">
    <div className="handheld-title-row">
      <span className="handheld-brand" aria-label="CLIC">c.</span>
      <div className="handheld-title">
        <h1>{props.restaurant ? 'Restaurante' : 'Nueva venta'}</h1>
        <p>{props.operator} · {props.terminal}</p>
      </div>
      <button type="button" className="handheld-icon-button" aria-label="Abrir ajustes" onClick={props.onSettings}><Settings size={19} /></button>
    </div>
    <div className="handheld-status-row">{props.status}</div>
    {props.table && <p className="handheld-table-context">{props.table}</p>}
    <nav aria-label="Navegación de venta" className="handheld-tabs">
      {props.onTables && <button type="button" onClick={props.onTables}>Mesas</button>}
      <button type="button" aria-pressed={props.view === 'PRODUCTS'} onClick={() => props.onView('PRODUCTS')}>{props.restaurant ? 'Pedido' : 'Productos'}</button>
      <button type="button" aria-pressed={props.view === 'TICKET'} onClick={() => props.onView('TICKET')}>{props.restaurant ? 'Cuenta' : 'Ticket'} <span>{props.quantity}</span></button>
      <button type="button" aria-label="Abrir acciones rápidas" onClick={props.onActions}><Layers size={17} /><span className="sr-only">Opciones</span></button>
    </nav>
  </header>;
}

export function HandheldCartSummary({ total, quantity, restaurant, onOpen }: {
  total: string; quantity: string; restaurant: boolean; onOpen: () => void;
}) {
  return <footer className="handheld-cart-summary">
    <div><span>Total · {quantity} artículos</span><strong>{total}</strong></div>
    <button type="button" onClick={onOpen}><ShoppingBag size={17} />{restaurant ? 'Ver cuenta' : 'Ver ticket'}<span>{quantity}</span></button>
  </footer>;
}
