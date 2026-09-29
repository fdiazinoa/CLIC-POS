import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isRestaurantBusiness, resolveEffectiveBusinessVertical } from '../utils/businessVertical';

test('terminal restaurant vertical wins over the POS fallback and accepts the legacy Spanish value', () => {
  const retailConfig = { vertical: 'RETAIL' } as any;
  assert.equal(resolveEffectiveBusinessVertical(retailConfig, {
    operational: { vertical_negocio: 'RESTAURANTE' },
  } as any), 'RESTAURANT');
  assert.equal(isRestaurantBusiness({ vertical: 'RESTAURANT' } as any, null), true);
  assert.equal(resolveEffectiveBusinessVertical({ vertical: 'RETAIL' } as any, null), 'RETAIL');
});

test('restaurant kiosk keeps service selection and modifier flow separate from retail behavior', () => {
  const welcome = readFileSync(new URL('../components/kiosk/KioskWelcome.tsx', import.meta.url), 'utf8');
  const browser = readFileSync(new URL('../components/kiosk/KioskProductBrowser.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

  assert.match(welcome, /onSelectServiceType\?\.\('DINE_IN'\)/);
  assert.match(welcome, /onSelectServiceType\?\.\('TAKEOUT'\)/);
  assert.match(browser, /restaurantMode && productHasRestaurantConfiguration/);
  assert.match(browser, /<ModifierModal/);
  assert.match(browser, /no tiene centro de producción configurado/);
  assert.match(app, /setKioskServiceType\(null\)/);
  assert.match(app, /cartId: sourceCartId \|\| uuidv4\(\)/);
});
