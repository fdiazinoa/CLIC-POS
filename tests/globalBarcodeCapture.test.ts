import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { attachGlobalBarcodeCapture } from '../utils/globalBarcodeCapture';
import { detectTicketPattern } from '../hooks/useBarcodeScanner';

function harness(t: TestContext) {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const listeners = new Map<string, Set<(event: any) => void>>();
    let blocked = false;
    let tableModal = false;
    const win = {
        document: { querySelector: (selector: string) => selector.includes('data-table-map-persistent-host')
            ? (tableModal ? {} : null) : (blocked || tableModal ? {} : null) },
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
        const event = { target: body, prevented: false, stopped: false, immediateStopped: false,
            preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
            stopImmediatePropagation() { this.immediateStopped = true; }, ...props };
        listeners.get(name)?.forEach(fn => fn(event));
        return event;
    };
    const key = (key: string, target = body, extra = {}) => send('keydown', { key, target, ...extra });
    const input = (data: string | null, target: any = search, extra = {}) => send('input', { target, data, inputType: 'insertText', ...extra });
    const burst = (code: string, target = body, gap = 20) => {
        for (const ch of code) {
            key(ch, target);
            if (target.tagName === 'INPUT') { target.value += ch; input(ch, target as typeof search); }
            t.mock.timers.tick(gap);
        }
    };
    const quiet = { ...search, dataset: { barcodeScannerTarget: 'true', posScannerReceiver: 'true' }, inputMode: 'none', value: '' };
    return { scans, body, search, quiet, key, input, burst, send, cleanup,
        block: (value = true) => { blocked = value; }, modal: (value = true) => { tableModal = value; } };
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

test('table modal consumes only a live HID terminator, without routing the barcode', t => {
    const h = harness(t);
    const closeButton = { tagName: 'BUTTON', dataset: {}, value: '' };
    h.modal();
    assert.equal(h.key('Enter', closeButton).prevented, false);
    assert.equal(h.key('Tab', closeButton).prevented, false);
    for (let i = 0; i < 50; i++) {
        h.burst('7501234567890', closeButton, 10);
        const suffix = h.key(i % 2 ? 'NumpadEnter' : 'Enter', closeButton);
        assert.equal(suffix.prevented, true);
        assert.equal(suffix.stopped, true);
        assert.equal(suffix.immediateStopped, true);
    }
    assert.deepEqual(h.scans, []);
    assert.equal(h.key('Enter', closeButton).prevented, false);
    h.modal(false);
    h.burst('7501234567890');
    assert.equal(h.key('Enter').prevented, true);
    assert.deepEqual(h.scans, ['7501234567890']);
});

test('table modal keeps the scanner listener mounted across POS to TABLE_MAP', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const views = app.slice(app.indexOf('const scannerEnabledViews ='), app.indexOf('useBarcodeScanner({'));
    assert.match(views, /currentView === 'TABLE_MAP'/);
});

test('modal HID suffix is consumed when a focused input also emits input events', t => {
    const h = harness(t);
    const nameInput = { tagName: 'INPUT', dataset: {}, value: '' };
    h.modal();
    for (const character of '7501234567890') {
        h.key(character, nameInput);
        nameInput.value += character;
        h.input(character, nameInput);
        t.mock.timers.tick(10);
    }
    const suffix = h.key('Enter', nameInput);
    assert.equal(suffix.prevented, true);
    assert.equal(suffix.immediateStopped, true);
    assert.deepEqual(h.scans, []);
});

test('modal Android Unidentified plus insertText still consumes the HID suffix', t => {
    const h = harness(t);
    const nameInput = { tagName: 'INPUT', dataset: {}, value: '' };
    h.modal();
    for (const character of '7501234567890') {
        h.key('Unidentified', nameInput);
        nameInput.value += character;
        h.input(character, nameInput);
        t.mock.timers.tick(10);
    }
    assert.equal(h.key('Enter', nameInput).prevented, true);
    assert.deepEqual(h.scans, []);
});

test('slow manual typing and focus change do not suppress Enter in Mesas', t => {
    const h = harness(t);
    const closeButton = { tagName: 'BUTTON', dataset: {}, value: '' };
    h.modal();
    h.burst('manual', closeButton, 150);
    assert.equal(h.key('Enter', closeButton).prevented, false);
    h.burst('7501234567890', closeButton, 10);
    h.send('focusin', { target: closeButton });
    assert.equal(h.key('Enter', closeButton).prevented, false);
    assert.equal(h.key('Escape', closeButton).prevented, false);
    assert.deepEqual(h.scans, []);
});

test('focus change, blur, shortcuts and cleanup cancel pending buffers', t => {
    const h = harness(t);
    for (const cancel of [() => h.send('focusin'), () => h.send('blur'), () => h.key('a', h.body, { ctrlKey: true }), h.cleanup]) {
        h.burst('987654321'); cancel(); t.mock.timers.tick(300);
    }
    assert.deepEqual(h.scans, []);
});

test('manual paste, drop, deletion and composing text are not auto-scans', t => {
    const h = harness(t);
    for (const extra of [{ inputType: 'insertFromPaste' }, { inputType: 'insertFromDrop' }, { inputType: 'deleteContentBackward' }, { isComposing: true }]) {
        h.search.value = '987654321';
        h.input('987654321', h.search, extra);
        t.mock.timers.tick(300);
    }
    assert.deepEqual(h.scans, []);
});

test('IME-only character continuation on marked quiet receiver emits once with suffix and idle', t => {
    const h = harness(t);
    for (const suffix of ['Enter', 'Tab', 'idle']) {
        for (const character of 'IME123') {
            h.search.value += character;
            h.input(character);
            t.mock.timers.tick(15);
        }
        if (suffix !== 'idle') h.key(suffix, h.search);
        t.mock.timers.tick(300);
        assert.equal(h.search.value, '');
    }
    assert.deepEqual(h.scans, ['IME123', 'IME123', 'IME123']);
});

test('POS marks manual inputs and quiet receiver, blocks modal capture and preserves return quantity', () => {
    const pos = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
    assert.equal(pos.match(/data-barcode-scanner-target="true"/g)?.length, 3);
    assert.match(pos, /data-pos-scanner-enabled=\{!isAnyModalOpen/);
    assert.match(pos, /attachSalesScannerFocus\(window, \(\) => salesScannerReceiverRef\.current\)/);
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


test('incomplete quiet-receiver scan times out without poisoning the next IME scan', t => {
    const h = harness(t);
    h.quiet.value = '12';
    h.input('12', h.quiet);
    t.mock.timers.tick(300);
    assert.equal(h.quiet.value, '');
    assert.deepEqual(h.scans, []);
    h.quiet.value += '987654321';
    h.input('987654321', h.quiet);
    h.key('Enter', h.quiet);
    assert.equal(h.quiet.value, '');
    assert.deepEqual(h.scans, ['987654321']);
});

test('blocked quiet-receiver scan discards only its temporary input before resuming', t => {
    const h = harness(t);
    h.quiet.value = '987654321';
    h.block();
    h.input('987654321', h.quiet);
    t.mock.timers.tick(300);
    assert.equal(h.quiet.value, '');
    assert.deepEqual(h.scans, []);
    h.block(false);
    h.quiet.value += '987654321';
    h.input('987654321', h.quiet);
    h.key('Enter', h.quiet);
    assert.deepEqual(h.scans, ['987654321']);
});

test('blur abandons a partial quiet scan without erasing a manual search', t => {
    const h = harness(t);
    h.search.value = 'manual search';
    h.quiet.value = '12';
    h.input('12', h.quiet);
    h.send('blur');
    t.mock.timers.tick(300);
    assert.equal(h.quiet.value, '');
    assert.equal(h.search.value, 'manual search');
    assert.deepEqual(h.scans, []);
});

for (const suffix of ['Enter', 'Tab', 'idle']) {
    test(`Android Unidentified key followed by IME character, ${suffix}: emits once per physical scan`, t => {
        const h = harness(t);
        for (let scan = 0; scan < 2; scan++) {
            for (const character of '987654321') {
                h.key('Unidentified', h.quiet);
                h.quiet.value += character;
                h.input(character, h.quiet);
                t.mock.timers.tick(20);
            }
            if (suffix !== 'idle') assert.equal(h.key(suffix, h.quiet).prevented, true);
            t.mock.timers.tick(300);
            assert.equal(h.quiet.value, '');
        }
        assert.deepEqual(h.scans, ['987654321', '987654321']);
    });
}
