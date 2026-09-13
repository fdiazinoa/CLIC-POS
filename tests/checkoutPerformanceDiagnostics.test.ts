import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { captureCheckoutPerformance } from '../services/CheckoutPerformanceDiagnostics';

const mainActivity = readFileSync(
    new URL('../android/app/src/main/java/com/clicpos/app/MainActivity.java', import.meta.url),
    'utf8',
);

test('Android bridge exposes bounded device and performance snapshots without new permissions', () => {
    assert.match(mainActivity, /public String getDiagnosticDeviceContext\(\)/);
    assert.match(mainActivity, /public String getDiagnosticPerformanceSnapshot\(\)/);
    assert.match(mainActivity, /Debug\.getMemoryInfo\(processMemory\)/);
    assert.match(mainActivity, /Process\.getElapsedCpuTime\(\)/);
    assert.match(mainActivity, /getCurrentThermalStatus\(\)/);
    assert.match(mainActivity, /storage\.getAvailableBytes\(\)/);
    assert.doesNotMatch(mainActivity, /READ_PHONE_STATE|PACKAGE_USAGE_STATS|DUMP/);
});

test('milestone snapshots include native resources and correlated checkout duration', async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    let cpuTimeMs = 100;
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            ClicPOSAppBridge: {
                getDiagnosticPerformanceSnapshot: () => JSON.stringify({
                    appPssKb: 12000,
                    javaHeapUsedBytes: 4_000_000,
                    processCpuTimeMs: cpuTimeMs += 10,
                    batteryPercent: 85,
                }),
            },
        },
    });
    try {
        const opened = captureCheckoutPerformance('CHECKOUT_OPEN', {});
        await new Promise(resolve => setTimeout(resolve, 2));
        const confirmed = captureCheckoutPerformance('CHECKOUT_CONFIRM', {});
        assert.equal(opened?.source, 'android_native');
        assert.equal(opened?.memory?.appPssKb, 12000);
        assert.equal(opened?.power?.batteryPercent, 85);
        assert.equal(typeof confirmed?.cpu?.processCpuPercent, 'number');
        assert.equal(typeof confirmed?.durations?.checkoutOpenToConfirmMs, 'number');
    } finally {
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
        else delete (globalThis as { window?: unknown }).window;
    }
});
