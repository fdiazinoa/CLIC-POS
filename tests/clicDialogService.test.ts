import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clicConfirm,
  clicPrompt,
  resolveClicDialog,
  subscribeToClicDialogs,
  type ClicDialogRequest,
} from '../services/dialog/ClicDialogService';

test('serializa confirmaciones y prompts en una sola cola', async () => {
  const requests: ClicDialogRequest[] = [];
  const unsubscribe = subscribeToClicDialogs((request) => {
    if (request) requests.push(request);
  });

  const confirmation = clicConfirm('¿Continuar?');
  const prompt = clicPrompt('PIN', { inputType: 'password' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, 'confirm');

  resolveClicDialog(requests[0].id, true);
  assert.equal(await confirmation, true);
  await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].kind, 'prompt');

  resolveClicDialog(requests[1].id, '1234');
  assert.equal(await prompt, '1234');
  unsubscribe();
});
