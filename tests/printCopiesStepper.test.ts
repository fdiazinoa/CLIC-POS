import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PrintCopiesStepper from '../components/PrintCopiesStepper';
import { resolveConfiguredPrintCopies } from '../utils/printCopies';

// This stateless component's actual handlers can be exercised without a DOM.
function control(value: number | undefined, onChange: (n: number) => void) {
  const element = PrintCopiesStepper({ label: 'Factura', value, onChange }) as React.ReactElement;
  const [minus, output, plus] = React.Children.toArray(element.props.children) as React.ReactElement[];
  return { minus, output, plus };
}

test('copias: 1 → 2 → 1 without keyboard or form submission', () => {
  let current = 1;
  const update = (value: number) => { current = value; };
  control(current, update).plus.props.onClick();
  assert.equal(current, 2);
  assert.equal(control(current, update).output.props.children, 2);
  control(current, update).minus.props.onClick();
  assert.equal(current, 1);
  const markup = renderToStaticMarkup(React.createElement(PrintCopiesStepper, { label: 'Factura', value: current, onChange: update }));
  assert.doesNotMatch(markup, /<input/);
  assert.equal((markup.match(/type="button"/g) || []).length, 2);
});

test('copias: boundaries 1 and 10 disable controls and clamp handlers', () => {
  let current = 1;
  const update = (value: number) => { current = value; };
  assert.equal(control(current, update).minus.props.disabled, true);
  control(current, update).minus.props.onClick();
  assert.equal(current, 1);
  for (let i = 0; i < 15; i++) control(current, update).plus.props.onClick();
  assert.equal(current, 10);
  assert.equal(control(current, update).plus.props.disabled, true);
  assert.equal(control(current, update).minus.props.disabled, false);
  assert.equal(control(undefined, update).output.props.children, 1);
});

test('copias: all six document values survive serialization independently', () => {
  const keys = ['invoice', 'creditNote', 'kitchenOrder', 'xReport', 'zReport', 'other'] as const;
  const documentCopies = Object.fromEntries(keys.map(key => [key, 1]));
  for (const [index, key] of keys.entries()) {
    for (let i = 0; i <= index; i++) {
      control(documentCopies[key], value => { documentCopies[key] = value; }).plus.props.onClick();
    }
  }
  const restored = JSON.parse(JSON.stringify({ receiptConfig: { documentCopies } }));
  keys.forEach((key, index) => assert.equal(resolveConfiguredPrintCopies(restored, key), index + 2));
});
