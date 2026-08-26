import assert from 'node:assert/strict';
import test from 'node:test';

import { selectPreferredBackCameraId } from '../utils/cameraSelection';

test('prioriza la cámara trasera principal ID 0 en PDA con varias cámaras traseras', () => {
  assert.equal(selectPreferredBackCameraId([
    { id: '2', label: 'Camera 2, facing back' },
    { id: '1', label: 'Camera 1, facing front' },
    { id: '0', label: 'Camera 0, facing back' },
  ]), '0');
});

test('selecciona una cámara trasera etiquetada cuando no existe ID 0', () => {
  assert.equal(selectPreferredBackCameraId([
    { id: 'front', label: 'Front camera' },
    { id: 'rear', label: 'Rear camera' },
  ]), 'rear');
});

test('usa ID 0 como fallback estable cuando Android no entrega etiquetas', () => {
  assert.equal(selectPreferredBackCameraId([
    { id: '2' },
    { id: '0' },
  ]), '0');
  assert.equal(selectPreferredBackCameraId([]), undefined);
});
