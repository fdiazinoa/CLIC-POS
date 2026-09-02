// Isolated visual QA fixture: no API, no persistence, no sales.
import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../index.css';
import ProductTableSupermarket from '../../components/ProductTableSupermarket';
import SupermarketTicketSummary from '../../components/SupermarketTicketSummary';
import ActionGrid from '../../components/ActionGrid';
import type {CartItem, BusinessConfig} from '../../types';
const config = {taxRate: .18} as BusinessConfig;
const cart = [
  {id: 'p1', cartId: '1', name: 'ZAPATO MUJER', barcode: '2000000002187', variantInfo: 'Talla: 38 · Color: Negro', price: 1500, quantity: 1},
  {id: 'p2', cartId: '2', name: 'ZAPATO HOMBRE CON NOMBRE LARGO PARA COMPROBAR AJUSTE', sku: 'REF-0003', variantInfo: 'Talla: 42 · Color: Azul marino', price: 1125, quantity: 2},
  {id: 'p3', cartId: '3', name: 'IMPORTE GRANDE / DEVOLUCIÓN', barcode: '123456789012345678901234567890', price: 123456789.12, quantity: -1},
] as CartItem[];
const actionProps = {config, onAction: (id: string) => { document.body.dataset.lastAction = id; }, parkedTicketsCount: 2, isReturnMode: false, hasCartItems: true, globalDiscountValue: 0, showLogout: false, showTakeout: true};
createRoot(document.getElementById('root')!).render(<main className="h-screen flex flex-col bg-white">
  <header className="p-5 text-xl font-bold border-b">Supermercado — QA visual sin operaciones</header>
  <ProductTableSupermarket cart={cart} config={config} currencySymbol="RD$" lastAddedCartId={null} onRemoveItem={()=>{}} taxIncluded />
  <footer className="supermarket-footer flex-none border-t p-4">
    <div className="supermarket-footer-secondary min-w-0"><ActionGrid {...actionProps} actionRegion="other" /></div>
    <SupermarketTicketSummary symbol="RD$" subtotal={2625} discount={0} tax={400.42} total={2625} units={3} points={262} />
    <div className="supermarket-checkout"><ActionGrid {...actionProps} actionRegion="ticket" /><div className="supermarket-checkout-buttons"><button className="h-14 rounded-xl bg-red-50 text-red-700 font-bold">Salir</button><button className="h-14 rounded-xl bg-slate-900 text-white font-bold">COBRAR</button></div></div>
  </footer>
</main>);
