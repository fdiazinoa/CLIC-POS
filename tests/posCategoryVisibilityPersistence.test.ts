import assert from 'node:assert/strict';
import test from 'node:test';

import { getInitialConfig } from '../constants';
import {
  mergePosCategoryPresentation,
  resolveClassificationActive,
} from '../utils/posCatalogPresentation';
import { applyTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';

test('el refresh ERP preserva visibilidad, color y orden configurados en el POS', () => {
  const merged = mergePosCategoryPresentation(
    [{ id: 'Moda', code: 'Moda', name: 'Moda', isActive: false, color: '#112233', sortOrder: 4 }],
    [{ id: '727a51b9-1338-4253-9dc0-b11cee4ff7f7', code: 'MODA', name: 'Moda', isActive: true }],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, '727a51b9-1338-4253-9dc0-b11cee4ff7f7');
  assert.equal(merged[0].isActive, false);
  assert.equal(merged[0].color, '#112233');
  assert.equal(merged[0].sortOrder, 4);
  assert.equal(resolveClassificationActive(merged[0]), false);
});

test('una categoría nueva del ERP conserva su estado remoto al no existir preferencia POS', () => {
  const merged = mergePosCategoryPresentation([], [
    { id: 'erp-category', code: 'ERP-CAT', name: 'Categoría ERP', isActive: false },
  ]);

  assert.equal(merged[0].isActive, false);
});

test('terminal_config no reactiva una categoría POS oculta al reconstruir allowed_categories', () => {
  const config = getInitialConfig('Supermercado' as any);
  config.posCategories = [
    { id: 'Moda', code: 'Moda', name: 'Moda', isActive: false, color: '#445566', sortOrder: 2 },
  ];

  const applied = applyTerminalConfigSnapshot(config, {
    terminalId: 'terminal-category-visibility',
    incomingSnapshot: {
      terminal_id: 'terminal-category-visibility',
      resolved: {
        catalog: {
          allowed_categories: [{ id: 'erp-moda-id', code: 'MODA', name: 'Moda' }],
        },
      },
    } as any,
  });

  const moda = applied.config.posCategories?.find((category) => category.name === 'Moda');
  assert.ok(moda);
  assert.equal(moda.isActive, false);
  assert.equal(moda.color, '#445566');
  assert.equal(moda.sortOrder, 2);
});
