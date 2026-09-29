import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Promotion } from '../types';
import {
  mergePromotionCollection,
  mergePromotionsPreservingMedia,
  resolveRestaurantPromotionCreative,
} from '../utils/promotionMedia';
import RestaurantPromotionBanner from '../components/kiosk/RestaurantPromotionBanner';
import RestaurantKioskOrderPanel from '../components/kiosk/RestaurantKioskOrderPanel';

const config = {
  vertical: 'RESTAURANT',
  terminals: [{ id: 'T1', config: { operational: { vertical_negocio: 'RESTAURANT' } } }],
  productGroups: [{ id: 'g1', name: 'Combos', productIds: ['p1'] }],
} as any;
const product = { id: 'p1', name: 'Hamburguesa', category: 'Comida', price: 10 } as any;
const promotion = (overrides: Partial<Promotion> = {}): Promotion => ({
  id: 'promo-1', name: 'Best Lunch', type: 'DISCOUNT', priority: 1,
  targetType: 'PRODUCT', targetValue: 'p1', benefitValue: 10,
  schedule: { days: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], startTime: '00:00', endTime: '23:59', isActive: true },
  terminalIds: ['T1'],
  media: [{ id: 'hero', type: 'IMAGE', url: 'https://cdn.example/lunch.jpg', active: true, sortOrder: 2 }],
  ...overrides,
});

test('selects only active applicable commercial promotion images with stable sort order', () => {
  const inactive = promotion({ id: 'inactive', schedule: { ...promotion().schedule, isActive: false }, media: [{ id: 'a', type: 'IMAGE', url: 'https://cdn.example/a.jpg', sortOrder: 0 }] });
  const wrongProduct = promotion({ id: 'wrong', targetValue: 'p2', media: [{ id: 'b', type: 'IMAGE', url: 'https://cdn.example/b.jpg', sortOrder: 0 }] });
  const video = promotion({ id: 'video', media: [{ id: 'v', type: 'VIDEO', url: 'https://cdn.example/ad.mp4', sortOrder: 0 }] });
  const selected = resolveRestaurantPromotionCreative([inactive, wrongProduct, video, promotion()], [product], config, 'T1', new Date('2026-09-29T12:00:00'));
  assert.equal(selected?.promotionId, 'promo-1');
  assert.deepEqual(selected?.productIds, ['p1']);
});

test('conditioned promotion is hidden without customer and selected with an eligible customer', () => {
  const conditioned = promotion({
    conditions: [{ type: 'CUSTOMER_TIER', value: 'GOLD' }],
    priority: 50,
  });
  const now = new Date('2026-09-29T16:00:00.000Z');
  assert.equal(resolveRestaurantPromotionCreative([conditioned], [product], config, 'T1', now), null);
  const selected = resolveRestaurantPromotionCreative(
    [conditioned], [product], config, 'T1', now, { id: 'c1', name: 'Ana', tier: 'GOLD' } as any,
  );
  assert.equal(selected?.promotionId, 'promo-1');
});

test('promotion priority wins before media sortOrder with stable ties', () => {
  const low = promotion({
    id: 'low',
    priority: 1,
    media: [{ id: 'low-image', type: 'IMAGE', url: 'https://cdn.example/low.jpg', sortOrder: 0 }],
  });
  const high = promotion({
    id: 'high',
    priority: 20,
    media: [{ id: 'high-image', type: 'IMAGE', url: 'https://cdn.example/high.jpg', sortOrder: 99 }],
  });
  const selected = resolveRestaurantPromotionCreative([low, high], [product], config, 'T1', new Date('2026-09-29T16:00:00.000Z'));
  assert.equal(selected?.promotionId, 'high');
});

test('date, weekday and 21:00 schedule use the Santo Domingo local calendar consistently', () => {
  const night = promotion({
    id: 'night',
    schedule: {
      days: ['M'],
      startDate: '2026-09-29',
      endDate: '2026-09-29',
      startTime: '20:00',
      endTime: '22:00',
      isActive: true,
    },
  });
  // 01:00 UTC on Sep 30 is 21:00 on Sep 29 in Santo Domingo.
  const selected = resolveRestaurantPromotionCreative([night], [product], config, 'T1', new Date('2026-09-30T01:00:00.000Z'));
  assert.equal(selected?.promotionId, 'night');
});

test('promotion media merge preserves omitted media and treats empty media as authoritative', () => {
  const existing = [promotion()];
  const { media: _media, ...withoutMedia } = promotion();
  const preserved = mergePromotionCollection(existing, [{ ...withoutMedia, name: 'Renombrada' }]);
  assert.equal(preserved[0].media?.[0].url, 'https://cdn.example/lunch.jpg');
  const cleared = mergePromotionCollection(existing, [{ ...withoutMedia, promotion_media: [] }]);
  assert.deepEqual(cleared[0].media, []);
  const snake = mergePromotionCollection([], [{ ...withoutMedia, promotion_media: [{ id: 's', media_type: 'IMAGE', media_url: 'https://cdn.example/s.jpg', sort_order: 4, is_active: true }] }]);
  assert.equal(snake[0].media?.[0].sortOrder, 4);
});

test('offline bootstrap merge keeps configured and persisted promotions with persisted media first', () => {
  const configured = promotion({ id: 'configured' });
  const persisted = promotion({
    id: 'offline',
    media: [{ id: 'offline-image', type: 'IMAGE', url: 'https://cdn.example/offline.jpg' }],
  });
  const merged = mergePromotionsPreservingMedia([configured], [persisted]);
  assert.deepEqual(merged.map((entry) => entry.id), ['offline', 'configured']);
  assert.equal(merged[0].media?.[0].url, 'https://cdn.example/offline.jpg');
});

test('App memoizes promotion creative by durable inputs and a minute time bucket', async () => {
  const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../App.tsx', import.meta.url), 'utf8'));
  assert.match(source, /kioskRestaurantPromotionCreative = useMemo/);
  assert.match(source, /promotionCreativeMinuteBucket = Math\.floor\(Date\.now\(\) \/ 60_000\)/);
  assert.match(source, /mergePromotionsPreservingMedia\([\s\S]{0,120}persistedPromotions/);
});

test('restaurant promotional banner renders horizontally only when resolver returns an applicable offer', () => {
  const creative = resolveRestaurantPromotionCreative([promotion()], [product], config, 'T1', new Date('2026-09-29T12:00:00'));
  const banner = renderToStaticMarkup(<RestaurantPromotionBanner creative={creative} onSelect={() => undefined} />);
  assert.match(banner, /Oferta destacada/);
  assert.match(banner, /min-h-\[150px\]/);
  assert.equal(renderToStaticMarkup(<RestaurantPromotionBanner creative={null} onSelect={() => undefined} />), '');
});

test('restaurant order review exposes touch controls and the compact order button', () => {
  const cart = [{ ...product, quantity: 2, cartId: 'line-1' }] as any;
  const markup = renderToStaticMarkup(<RestaurantKioskOrderPanel open cart={cart} itemCount={2} total={20} formatMoney={(value) => `$${value.toFixed(2)}`} onOpen={() => undefined} onClose={() => undefined} onDecrease={() => undefined} onIncrease={() => undefined} onRemove={() => undefined} onCheckout={() => undefined} />);
  assert.match(markup, /Ver pedido/);
  assert.match(markup, /2 unidades/);
  assert.match(markup, /Revisa antes de pagar/);
  assert.match(markup, /Continuar al pago/);
});
