import assert from 'node:assert/strict';
import test from 'node:test';

import { formatKdsIdentityLabel, hasPendingKdsDispatch } from '../utils/kdsPresentation';

test('detecta una comanda pendiente dentro de cualquier cuenta de la mesa', () => {
  assert.equal(hasPendingKdsDispatch({ items: [{ kdsStatus: 'PENDIENTE' } as any] }), true);
  assert.equal(hasPendingKdsDispatch({ items: [{ kdsStatus: 'ENVIADO' } as any] }), false);
});

test('combina código y nombre legible sin repetir valores', () => {
  assert.equal(formatKdsIdentityLabel('PTC-001', 'Pantalla Cocina Terraza'), 'PTC-001 - Pantalla Cocina Terraza');
  assert.equal(formatKdsIdentityLabel('PTC-001', 'PTC-001'), 'PTC-001');
  assert.equal(formatKdsIdentityLabel('T-9ffc6771-7845-4976-afd3-20cebc3cc6e8', ''), 'Terminal cocina');
});
