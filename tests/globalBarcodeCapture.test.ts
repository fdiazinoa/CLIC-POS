import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { attachGlobalBarcodeCapture, focusSalesScannerInput } from '../utils/globalBarcodeCapture';
import { detectTicketPattern } from '../hooks/useBarcodeScanner';

function harness(t: TestContext) {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const listeners = new Map<string, Set<(event: any) => void>>();
    let blocked = false;
    const win = {
        document: { querySelector: () => blocked ? {} : null },
        addEventListener(name: string, fn: any) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name)!.add(fn);
        },
        removeEventListener(name: string, fn: any) { listeners.get(name)?.delete(fn); },
    };
    const scans: string[] = [];
    const body = { tagName: 'BODY', dataset: {}, value: '' };
    const search = { tagName: 'INPUT', dataset: { barcodeScannerTarget: 'true' }, value: '',
        ownerDocument: { createEvent: () => ({ initEvent() {} }) },
        dispatchEvent: () => true,
    };
    const cleanup = attachGlobalBarcodeCapture(win as unknown as Window, { onScan: code => {
        scans.push(code);
    } });
    t.after(cleanup);
    const send = (name: string, props: any = {}) => {
        const event = { target: body, prevented: false, stopped: false,
            preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...props };
        listeners.get(name)?.forEach(fn => fn(event));
        return event;
    };
    const key = (key: string, target = body, extra = {}) => send('keydown', { key, target, ...extra });
    const input = (data: string | null, target = search, extra = {}) => send('input', { target, data, inputType: 'insertText', ...extra });
    const burst = (code: string, target = body, gap = 20) => {
        for (const ch of code) {
            key(ch, target);
            if (target.tagName === 'INPUT') { target.value += ch; input(ch, target as typeof search); }
            t.mock.timers.tick(gap);
        }
    };
    return { scans, body, search, key, input, burst, send, cleanup, block: () => { blocked = true; } };
}

for (const suffix of ['Enter', 'Tab', 'idle']) {
    for (const focused of [false, true]) {
        test(`HID ${suffix}, search focused=${focused}: emits once`, t => {
            const h = harness(t);
            const target = focused ? h.search : h.body;
            h.burst('987654321', target);
            if (suffix !== 'idle') {
                const e = h.key(suffix, target);
                assert.equal(e.prevented, true);
                assert.equal(e.stopped, true);
            }
            t.mock.timers.tick(300);
            assert.deepEqual(h.scans, ['987654321']);
        });
    }
}

test('70ms reader works and manual 150ms input stays manual', t => {
    const h = harness(t);
    h.burst('987654321', h.body, 70);
    h.key('Enter');
    h.burst('chocolate', h.search, 150);
    assert.equal(h.key('Enter', h.search).prevented, false);
    t.mock.timers.tick(300);
    assert.deepEqual(h.scans, ['987654321']);
});

test('Android HID keydown-only reader works while POS search has focus', t => {
    const h = harness(t);
    for (const char of '74000171') {
        h.key(char, h.search);
        t.mock.timers.tick(20);
    }
    const suffix = h.key('Enter', h.search);
    assert.equal(suffix.prevented, true);
    assert.equal(suffix.stopped, true);
    assert.deepEqual(h.scans, ['74000171']);
});

for (const data of ['987654321', null]) {
    test(`Android IME complete code (${data ? 'data' : 'null data'}), no keys needed`, t => {
        const h = harness(t);
        h.search.value = '987654321';
        h.input(data);
        t.mock.timers.tick(300);
        assert.deepEqual(h.scans, ['987654321']);
        assert.equal(h.key('Enter', h.search).prevented, true);
        assert.deepEqual(h.scans, ['987654321']);
    });
}

test('IME plus immediate Enter emits once; subsequent same code is another unit', t => {
    const h = harness(t);
    for (let scan = 0; scan < 2; scan++) {
        h.search.value = '987654321';
        h.input('987654321');
        h.key('Enter', h.search);
    }
    t.mock.timers.tick(300);
    assert.deepEqual(h.scans, ['987654321', '987654321']);
});

test('repeated HID scans of same SKU are not deduplicated', t => {
    const h = harness(t);
    h.burst('987654321'); h.key('Enter');
    h.burst('987654321'); h.key('Enter');
    t.mock.timers.tick(300);
    assert.equal(h.scans.length, 2);
});

test('unknown IME code is consumed before another scan without catalog cleanup', t => {
    const h = harness(t);
    let controlledUpdates = 0;
    h.search.dispatchEvent = () => {
        controlledUpdates++;
        h.input(null); // Clearing dispatch must not become another scan.
        return true;
    };
    for (const code of ['999999999991', '999999999992', '999999999992']) {
        h.search.value += code;
        h.input(code);
        t.mock.timers.tick(300);
        assert.equal(h.search.value, '');
        assert.equal(h.key('Enter', h.search).prevented, true);
    }
    assert.deepEqual(h.scans, ['999999999991', '999999999992', '999999999992']);
    assert.equal(controlledUpdates, 3);
});

test('focused HID sequential scans clear consumed text for Enter, Tab and idle', t => {
    const h = harness(t);
    for (const suffix of ['Enter', 'Tab', 'idle']) {
        h.burst('987654321', h.search);
        if (suffix !== 'idle') h.key(suffix, h.search);
        t.mock.timers.tick(300);
        assert.equal(h.search.value, '');
    }
    assert.deepEqual(h.scans, ['987654321', '987654321', '987654321']);
});

test('slow manual search is neither consumed nor cleared', t => {
    const h = harness(t);
    h.burst('chocolate', h.search, 150);
    t.mock.timers.tick(300);
    assert.equal(h.search.value, 'chocolate');
    assert.deepEqual(h.scans, []);
});

test('late suffix after global idle does not dispatch twice', t => {
    const h = harness(t);
    h.burst('987654321');
    t.mock.timers.tick(300);
    assert.equal(h.key('Tab').prevented, true);
    assert.equal(h.scans.length, 1);
});

test('short SKU requires terminator; no suffix never guesses a short word', t => {
    const h = harness(t);
    h.burst('ABC'); h.key('Enter');
    h.burst('XYZ'); t.mock.timers.tick(300);
    assert.deepEqual(h.scans, ['ABC']);
});

test('ordinary inputs, textarea, select and contenteditable remain untouched', t => {
    const h = harness(t);
    for (const el of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
        const target = { ...h.body, ...el };
        h.burst('987654321', target);
        assert.equal(h.key('Enter', target).prevented, false);
    }
    t.mock.timers.tick(300);
    assert.deepEqual(h.scans, []);
});

test('payment/modal guard cancels a pending scan and all document/product scans', t => {
    const h = harness(t);
    h.burst('987654321');
    h.block();
    t.mock.timers.tick(300);
    h.burst('TCK123456'); h.key('Enter');
    assert.deepEqual(h.scans, []);
});

test('focus change, blur, shortcuts and cleanup cancel pending buffers', t => {
    const h = harness(t);
    for (const cancel of [() => h.send('focusin'), () => h.send('blur'), () => h.key('a', h.body, { ctrlKey: true }), h.cleanup]) {
        h.burst('987654321'); cancel(); t.mock.timers.tick(300);
    }
    assert.deepEqual(h.scans, []);
});

test('manual paste, deletion and composing text are not auto-scans', t => {
    const h = harness(t);
    for (const extra of [{ inputType: 'insertFromPaste' }, { inputType: 'deleteContentBackward' }, { isComposing: true }]) {
        h.search.value = '987654321';
        h.input('987654321', h.search, extra);
        t.mock.timers.tick(300);
    }
    assert.deepEqual(h.scans, []);
});

test('focus recovery selects only visible POS search and leaves forms/modals alone', () => {
    let focused = 0;
    let modal = false;
    const doc = { activeElement: { tagName: 'BODY' }, querySelector: (selector: string) => {
        if (selector === '[data-pos-scanner-enabled="true"]') return { querySelectorAll: () => [
            { getClientRects: () => [], focus: () => assert.fail('hidden input') },
            { getClientRects: () => [1], focus: () => { focused++; } },
        ] };
        return modal ? {} : null;
    } };
    focusSalesScannerInput(doc as unknown as Document);
    assert.equal(focused, 1);
    doc.activeElement.tagName = 'INPUT';
    focusSalesScannerInput(doc as unknown as Document);
    doc.activeElement.tagName = 'BODY'; modal = true;
    focusSalesScannerInput(doc as unknown as Document);
    assert.equal(focused, 1);
});

test('POS marks both search inputs, blocks modal capture and preserves return quantity', () => {
    const pos = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
    assert.equal(pos.match(/data-barcode-scanner-target="true"/g)?.length, 2);
    assert.match(pos, /data-pos-scanner-enabled=\{!isAnyModalOpen/);
    assert.match(pos, /focusSalesScannerInput\(document\)/);
    const process = pos.slice(pos.indexOf('const processBarcode ='), pos.indexOf('const isAnyModalOpen'));
    assert.match(process, /setSearchTerm\(''\)/);
    assert.ok(process.indexOf("setSearchTerm('')") < process.indexOf('routeScannedCoupon(trimmed)'));
    assert.match(process, /setErrorToast\('Código no encontrado'\)/);
    assert.match(process, /isReturnMode \? -1 : 1/);
});

test('ticket routing remains compatible and malformed QR URLs cannot crash scanning', () => {
    assert.equal(detectTicketPattern('tck1234'), 'TCK1234');
    assert.equal(detectTicketPattern('B0200000011'), 'B0200000011');
    assert.equal(detectTicketPattern('https://dgii.gov.do/check?ncf=B0200000011'), 'B0200000011');
    assert.equal(detectTicketPattern('bad dgii.gov.do'), null);
    assert.equal(detectTicketPattern('987654321'), null);
});
