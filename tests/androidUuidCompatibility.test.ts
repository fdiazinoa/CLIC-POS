import assert from 'node:assert/strict';
import test from 'node:test';
import { createUuid } from '../utils/uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('creates a UUID when Android WebView has getRandomValues but no randomUUID', () => {
  const id = createUuid({
    getRandomValues: (bytes) => {
      bytes.fill(0x2a);
      return bytes;
    },
  });

  assert.match(id, UUID_V4);
});

test('keeps creation available when the WebView exposes no crypto API', () => {
  assert.match(createUuid({}), UUID_V4);
});
