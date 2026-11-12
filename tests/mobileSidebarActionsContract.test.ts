import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const posInterfaceSource = readFileSync(
  new URL('../components/POSInterface.tsx', import.meta.url),
  'utf8',
);

test('la vista móvil expone selectores accesibles para carrito y acciones', () => {
  assert.match(posInterfaceSource, /data-testid="mobile-cart-tab-button"/);
  assert.match(posInterfaceSource, /data-testid="mobile-actions-tab-button"/);
  assert.match(posInterfaceSource, /aria-pressed=\{rightSidebarTab === 'CART'\}/);
  assert.match(posInterfaceSource, /aria-pressed=\{rightSidebarTab === 'ACTIONS'\}/);
});

test('acciones móviles reemplaza el carrito y oculta el pie de cobro', () => {
  assert.match(
    posInterfaceSource,
    /rightSidebarTab === 'ACTIONS' && isMobile \? \([\s\S]*data-testid="mobile-quick-actions-panel"/,
  );
  assert.match(
    posInterfaceSource,
    /isMobile && mobileView === 'TICKET' && rightSidebarTab === 'CART' && \(/,
  );
  assert.match(
    posInterfaceSource,
    /setRightSidebarTab\('CART'\);\s*setMobileView\('TICKET'\);/,
  );
});


test('el panel abierto conserva un botón visible para regresar al ticket sin depender del pie de cobro', () => {
  const panel = posInterfaceSource.slice(posInterfaceSource.indexOf('const renderQuickActionsPanel'), posInterfaceSource.indexOf('const renderDesktopTicketFooterActions'));
  assert.match(panel, /sticky top-0/);
  assert.match(panel, /aria-label="Ocultar acciones y volver al ticket"/);
  assert.match(panel, /<Layers size=\{22\}/);
  assert.match(panel, /onClick=\{\(\) => setRightSidebarTab\(tab => tab === 'ACTIONS' \? 'CART' : 'ACTIONS'\)\}/);
  const mobileButton = posInterfaceSource.slice(posInterfaceSource.indexOf('data-testid="mobile-actions-tab-button"'), posInterfaceSource.indexOf('data-testid="mobile-actions-tab-button"') + 650);
  assert.match(mobileButton, /setRightSidebarTab\(tab => tab === 'ACTIONS' \? 'CART' : 'ACTIONS'\)/);
});
