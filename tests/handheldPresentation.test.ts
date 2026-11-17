import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceFormFactor, DeviceRole } from '../types';
import { resolveTerminalDeviceProfile } from '../utils/deviceProfile';
import { usesHandheldSalePresentation } from '../utils/handheldPresentation';

test('compact sales is limited to handheld supermarket and restaurant profiles', () => {
  for (const formFactor of Object.values(DeviceFormFactor)) {
    for (const [retail, restaurant] of [[true, false], [false, true], [false, false]]) {
      assert.equal(usesHandheldSalePresentation(formFactor, retail, restaurant),
        formFactor === DeviceFormFactor.HANDHELD && (retail || restaurant), `${formFactor}: ${retail}/${restaurant}`);
      assert.equal(usesHandheldSalePresentation(formFactor, retail, restaurant, true), false);
    }
  }
});

test('ERP PDA alias opts in; legacy order-taker tablet and desktop profiles retain their UI', () => {
  const pda = resolveTerminalDeviceProfile({ config: { device_profile: { form_factor: 'PDA' } } });
  assert.equal(usesHandheldSalePresentation(pda.formFactor, true, false), true);
  for (const formFactor of ['TABLET', 'DESKTOP_POS']) {
    const profile = resolveTerminalDeviceProfile({ config: { deviceProfile: { formFactor, touchOptimized: true } } }, DeviceRole.ORDER_TAKER);
    assert.equal(usesHandheldSalePresentation(profile.formFactor, false, true), false);
  }
  const legacy = resolveTerminalDeviceProfile({ config: {} }, DeviceRole.ORDER_TAKER);
  assert.equal(usesHandheldSalePresentation(legacy.formFactor, false, true), false);
});
