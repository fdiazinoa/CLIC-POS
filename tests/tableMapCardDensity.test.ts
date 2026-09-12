import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
const nodeSource = source.slice(
  source.indexOf('const SmartTableNode'),
  source.indexOf("SmartTableNode.displayName = 'SmartTableNode'")
);

test('la tarjeta no renderiza tiempo, monto ni etapa gastronómica', () => {
  assert.doesNotMatch(nodeSource, /elapsedLabel/);
  assert.doesNotMatch(nodeSource, /currencySymbol/);
  assert.doesNotMatch(nodeSource, /serviceStage|needsRevenueGlow|ringCircumference/);
  assert.doesNotMatch(source, /getServiceStage|🍰|🥩|🥗/);
});

test('el detalle conserva la información operativa bajo demanda', () => {
  assert.match(source, />Ultimo pedido:<\/span> \{tooltip\.model\.lastOrderHint\}/);
  assert.match(source, />Total:<\/span> \{currencySymbol\}\{tooltip\.model\.total\.toLocaleString\(\)\}/);
  assert.match(source, />Tiempo:<\/span> \{tooltip\.model\.elapsedLabel\}/);
});

test('las alertas útiles permanecen visibles en la mesa', () => {
  assert.match(nodeSource, /model\.isPartiallySubtotalized/);
  assert.match(nodeSource, /model\.hasPendingKitchenDispatch/);
  assert.match(nodeSource, /Pedido pendiente de recepción en cocina/);
});
