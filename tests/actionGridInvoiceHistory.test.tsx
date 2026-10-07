import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import ActionGrid from '../components/ActionGrid';
import type { BusinessConfig } from '../types';

const props = {
  config: {} as BusinessConfig, parkedTicketsCount: 0, globalDiscountValue: 0,
  isReturnMode: false, hasCartItems: false,
};

const buttonsIn = (node: React.ReactNode): React.ReactElement<any>[] => {
  if (Array.isArray(node)) return node.flatMap(buttonsIn);
  if (!React.isValidElement(node)) return [];
  const element = node as React.ReactElement<any>;
  return [...(element.type === 'button' ? [element] : []), ...buttonsIn(element.props.children)];
};

for (const orientation of ['horizontal', 'vertical'] as const) {
  for (const region of ['all', 'other'] as const) {
    test(`invoice history click dispatches once with empty cart (${orientation}/${region})`, () => {
      const dispatched: string[] = [];
      const tree = ActionGrid({ ...props, orientation, actionRegion: region, onAction: action => dispatched.push(action) });
      const buttons = buttonsIn(tree);
      const history = buttons.filter(button => button.props['data-action-id'] === 'HISTORY');
      assert.equal(history.length, 1);
      assert.equal(history[0].props.disabled, false);
      const html = renderToStaticMarkup(history[0]);
      assert.match(html, /Historial Factura/);
      assert.match(html, /lucide-history/);
      assert.equal(buttons.some(button => button.props['data-action-id'] === 'ATTENDANCE'), false);
      history[0].props.onClick();
      assert.deepEqual(dispatched, ['HISTORY']);
    });
  }
}

test('invoice history stays outside ticket-only actions without duplication', () => {
  const tree = ActionGrid({ ...props, actionRegion: 'ticket', onAction: () => {} });
  assert.equal(buttonsIn(tree).some(button => button.props['data-action-id'] === 'HISTORY'), false);
});

test('POS history action routes to existing callback and retains attendance route', () => {
  const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  assert.match(source, /case 'HISTORY': onOpenHistory\(\); break;/);
  assert.match(source, /case 'ATTENDANCE': onOpenAttendance\(\); break;/);
});
