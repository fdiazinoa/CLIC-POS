import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';

test('actual Zebra save preserves enabled on unit edit, activates only explicit new preset and rolls back preference on activation failure', async () => {
  const source = readFileSync(new URL('../components/HardwareSettings.tsx', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('const handleSaveScale ='), source.indexOf('const handleStartDiscovery ='));
  const js = (await transform(body, { loader: 'ts', target: 'es2022' })).code;
  for (const scenario of ['edit', 'new', 'activation-failure', 'storage-failure']) {
    const activations: boolean[] = []; const writes: any[] = []; const errors: string[] = []; let closed = 0;
    const previous = { zebraUnit: 'kg', defaultScaleId: 'prior' };
    const dependencies = {
      editingScale: { id: 'local-zebra-mp7000', displayUnit: 'lb' }, zebraBusy: false, editingZebra: true,
      editingLocalZebra: scenario === 'edit', defaultScaleId: 'prior', setDefaultScaleId: () => {}, zebraLocalAllowed: true, selectedTerminalId: 'T', editingScaleDefault: true,
      readLocalScalePreference: () => previous,
      saveLocalScalePreference: (_terminal: string, preference: any) => { if (scenario === 'storage-failure') throw Error('disk failed'); writes.push(preference); },
      applyZebra: async (enabled: boolean) => { activations.push(enabled); return scenario !== 'activation-failure'; },
      setEditingScale: () => { ++closed; }, setZebraMessage: (message: string) => errors.push(message),
    };
    const save = new Function(...Object.keys(dependencies), `${js};return handleSaveScale;`)(...Object.values(dependencies));
    await save();
    if (scenario === 'edit') { assert.deepEqual(activations, []); assert.equal(closed, 1); }
    if (scenario === 'new') { assert.deepEqual(activations, [true]); assert.equal(closed, 1); }
    if (scenario === 'activation-failure') { assert.equal(closed, 0); assert.deepEqual(writes.at(-1), previous); }
    if (scenario === 'storage-failure') { assert.equal(closed, 0); assert.deepEqual(activations, []); assert.match(errors[0], /disk failed/); }
  }
});
