import assert from 'node:assert/strict';
import test from 'node:test';
import { biometricService } from '../services/BiometricAuthService';
import type { User, UserBiometrics } from '../types';

const installNativeBridge = (overrides: Record<string, unknown> = {}) => {
  (globalThis as any).window = {
    ClicPOSNativePrinter: {
      discoverFingerprintReaders: async () => ({
        devices: [{ vendorId: 0x05ba, productId: 0x000a }],
      }),
      enrollFingerprint: async () => ({
        success: true,
        credentialID: 'dp4500:test',
        publicKey: 'sourceafis:3.18.1:template',
      }),
      verifyFingerprint: async () => ({ success: true, credentialID: 'dp4500:test' }),
      ...overrides,
    },
  };
};

test('detecta el U.are.U 4500 mediante el bridge nativo', async () => {
  installNativeBridge();
  assert.equal(await biometricService.isAvailable(), true);
});

test('registra una plantilla SourceAFIS sin conservar la imagen cruda', async () => {
  installNativeBridge();
  const user: User = { id: 'u1', name: 'Ana', pin: '1234', role: 'CASHIER' };
  const credential = await biometricService.register(user);
  assert.deepEqual(credential, {
    credentialID: 'dp4500:test',
    publicKey: 'sourceafis:3.18.1:template',
  });
});

test('envía plantillas SourceAFIS al cotejo nativo y devuelve la credencial reconocida', async () => {
  let received: unknown;
  installNativeBridge({
    verifyFingerprint: async (payload: unknown) => {
      received = payload;
      return { success: true, credentialID: 'dp4500:test' };
    },
  });
  const credentials: UserBiometrics[] = [{
    credentialID: 'dp4500:test',
    publicKey: 'sourceafis:3.18.1:template',
    registeredAt: '2026-08-24T00:00:00.000Z',
  }];
  assert.equal(await biometricService.verify(credentials), 'dp4500:test');
  assert.deepEqual(received, {
    templates: [{ credentialID: 'dp4500:test', publicKey: 'sourceafis:3.18.1:template' }],
  });
});
