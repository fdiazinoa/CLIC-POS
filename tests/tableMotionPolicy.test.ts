import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldReduceTableMotion } from '../utils/tableMotionPolicy';

test('Android nativo usa estados visuales estáticos aunque el usuario permita animaciones', () => {
    assert.equal(shouldReduceTableMotion({
        prefersReducedMotion: false,
        isNativePlatform: true,
        platform: 'android'
    }), true);
});

test('la versión web conserva las animaciones cuando el usuario no pidió reducirlas', () => {
    assert.equal(shouldReduceTableMotion({
        prefersReducedMotion: false,
        isNativePlatform: false,
        platform: 'web'
    }), false);
});

test('la preferencia de accesibilidad desactiva animaciones en cualquier plataforma', () => {
    assert.equal(shouldReduceTableMotion({
        prefersReducedMotion: true,
        isNativePlatform: false,
        platform: 'web'
    }), true);
});
