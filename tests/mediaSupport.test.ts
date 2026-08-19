import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCustomerDisplayConfig } from '../utils/customerDisplay';
import { inferMediaType, isValidRemoteMediaUrl } from '../utils/media';

test('mantiene anuncios históricos como imágenes e identifica videos por extensión', () => {
  const config = normalizeCustomerDisplayConfig({
    ads: [
      { id: 'legacy', url: 'https://cdn.test/banner.jpg', active: true },
      { id: 'video', url: 'https://cdn.test/oferta.mp4?version=2', active: true },
    ],
  });
  assert.equal(config.ads[0].type, 'IMAGE');
  assert.equal(config.ads[1].type, 'VIDEO');
  assert.equal(inferMediaType('https://cdn.test/promo.webm'), 'VIDEO');
});

test('solo acepta URLs remotas HTTP(S) para multimedia', () => {
  assert.equal(isValidRemoteMediaUrl('https://cdn.test/promo.mp4'), true);
  assert.equal(isValidRemoteMediaUrl('file:///tmp/promo.mp4'), false);
  assert.equal(isValidRemoteMediaUrl('javascript:alert(1)'), false);
});
