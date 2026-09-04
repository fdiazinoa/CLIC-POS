import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DeviceFormFactor } from '../types';
import {
  cameraAvailabilityFromDevices,
  detectCameraAvailability,
  shouldUseDesktopSearchClearAction,
} from '../utils/cameraCapability';

const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');

test('detecta cámaras sin solicitar permisos ni abrir el escáner', async () => {
  assert.equal(cameraAvailabilityFromDevices([{ kind: 'videoinput' }]), 'AVAILABLE');
  assert.equal(cameraAvailabilityFromDevices([{ kind: 'audioinput' }]), 'UNAVAILABLE');
  assert.equal(await detectCameraAvailability(async () => []), 'UNAVAILABLE');
  assert.equal(await detectCameraAvailability(async () => [{ kind: 'videoinput' }]), 'AVAILABLE');
  assert.equal(await detectCameraAvailability(async () => { throw new Error('blocked'); }), 'UNKNOWN');
});

test('la escoba se limita a Desktop con ausencia de cámara confirmada', () => {
  assert.equal(shouldUseDesktopSearchClearAction(DeviceFormFactor.DESKTOP_POS, 'UNAVAILABLE'), true);
  assert.equal(shouldUseDesktopSearchClearAction(DeviceFormFactor.DESKTOP_POS, 'UNKNOWN'), false);
  assert.equal(shouldUseDesktopSearchClearAction(DeviceFormFactor.DESKTOP_POS, 'AVAILABLE'), false);
  assert.equal(shouldUseDesktopSearchClearAction(DeviceFormFactor.TABLET, 'UNAVAILABLE'), false);
  assert.equal(shouldUseDesktopSearchClearAction(DeviceFormFactor.HANDHELD, 'UNAVAILABLE'), false);
});

test('la acción Desktop limpia inmediatamente y devuelve el foco al buscador', () => {
  assert.match(posSource, /detectCameraAvailability\(\)/);
  assert.match(posSource, /useDesktopSearchClearAction \? <BrushCleaning/);
  assert.match(posSource, /aria-label=\{useDesktopSearchClearAction \? 'Limpiar búsqueda' : 'Escanear con cámara'\}/);
  assert.match(posSource, /disabled=\{useDesktopSearchClearAction && searchTerm\.length === 0\}/);

  const start = posSource.indexOf('const clearCatalogSearch = useCallback');
  const end = posSource.indexOf('const [fiscalStatus', start);
  const clearFlow = posSource.slice(start, end);
  assert.match(clearFlow, /setSearchTerm\(''\)/);
  assert.match(clearFlow, /setCatalogSearchQuery\(''\)/);
  assert.match(clearFlow, /searchInputRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(clearFlow, /setIsScannerOpen\(true\)/);
});
