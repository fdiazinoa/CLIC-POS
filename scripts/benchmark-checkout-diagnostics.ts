import { performance } from 'node:perf_hooks';
import { CheckoutDiagnosticRecorder, recordCheckoutDiagnostic } from '../services/CheckoutDiagnostics';
for (const count of [1, 20, 100, 1000]) {
    const items = Array.from({ length: count }, (_, i) => ({ id: `product-${i}`, cartId: `line-${i}`, name: 'Producto restaurante', quantity: 1, price: 30, image: 'x'.repeat(10000) }));
    const recorder = new CheckoutDiagnosticRecorder(async () => {});
    const times: number[] = [];
    for (let i = 0; i < 1200; i++) {
        const started = performance.now();
        recorder.record('CART_RENDER', { items, total: count * 30, tableId: 'table-1' });
        if (i >= 200) times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    console.log(JSON.stringify({ items: count, medianMs: +times[500].toFixed(4), p95Ms: +times[950].toFixed(4), captureLimit: 100 }));
}
const started = performance.now();
for (let i = 0; i < 1_000_000; i++) recordCheckoutDiagnostic('CART_RENDER', {});
console.log(JSON.stringify({ disabledMillionCallsMs: +(performance.now() - started).toFixed(3) }));
