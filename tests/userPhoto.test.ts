import assert from 'node:assert/strict';
import test from 'node:test';
import { isGeneratedAvatarPlaceholder } from '../utils/userPhoto';

test('login y selector de vendedor omiten avatares generados como fotos reales', () => {
  assert.equal(isGeneratedAvatarPlaceholder('https://api.dicebear.com/7.x/avataaars/svg?seed=Ana'), true);
  assert.equal(isGeneratedAvatarPlaceholder('https://placehold.co/100x100'), true);
  assert.equal(isGeneratedAvatarPlaceholder('https://example.com/foto-ana.jpg'), false);
  assert.equal(isGeneratedAvatarPlaceholder('data:image/jpeg;base64,AAAA'), false);
});
