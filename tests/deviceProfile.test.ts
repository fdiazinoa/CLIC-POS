import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DeviceFormFactor,
  DeviceOrientation,
  DeviceRole,
} from '../types';
import {
  getDefaultDeviceProfile,
  resolveDeviceProfile,
  resolveTerminalDeviceProfile,
  toDeviceProfileContract,
} from '../utils/deviceProfile';

test('keeps physical form factor independent from ORDER_TAKER role', () => {
  const profile = resolveDeviceProfile([
    {
      deviceProfile: {
        formFactor: 'TABLET',
        orientation: 'PORTRAIT',
        touchOptimized: true,
      },
    },
  ], DeviceRole.ORDER_TAKER);

  assert.deepEqual(profile, {
    formFactor: DeviceFormFactor.TABLET,
    orientation: DeviceOrientation.PORTRAIT,
    touchOptimized: true,
  });
});

test('accepts ERP snake_case device profile contract from resolved terminal', () => {
  const profile = resolveTerminalDeviceProfile({
    terminal_config: {
      resolved: {
        terminal: {
          device_profile: {
            form_factor: 'tablet',
            orientation: 'horizontal',
            touch_optimized: true,
          },
        },
      },
    },
  }, DeviceRole.ORDER_TAKER);

  assert.equal(profile.formFactor, DeviceFormFactor.TABLET);
  assert.equal(profile.orientation, DeviceOrientation.LANDSCAPE);
  assert.equal(profile.touchOptimized, true);
});

test('legacy terminals keep safe role-based defaults', () => {
  assert.deepEqual(getDefaultDeviceProfile(DeviceRole.STANDARD_POS), {
    formFactor: DeviceFormFactor.DESKTOP_POS,
    orientation: DeviceOrientation.AUTO,
    touchOptimized: false,
  });
  assert.deepEqual(getDefaultDeviceProfile(DeviceRole.ORDER_TAKER), {
    formFactor: DeviceFormFactor.DESKTOP_POS,
    orientation: DeviceOrientation.AUTO,
    touchOptimized: true,
  });
});

test('serializes canonical and ERP-compatible representations', () => {
  const contract = toDeviceProfileContract({
    formFactor: DeviceFormFactor.TABLET,
    orientation: DeviceOrientation.AUTO,
    touchOptimized: true,
  });

  assert.deepEqual(contract.deviceProfile, {
    formFactor: 'TABLET',
    orientation: 'AUTO',
    touchOptimized: true,
  });
  assert.deepEqual(contract.device_profile, {
    form_factor: 'TABLET',
    orientation: 'AUTO',
    touch_optimized: true,
  });
});
