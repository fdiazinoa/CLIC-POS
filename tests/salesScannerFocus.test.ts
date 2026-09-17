import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { attachSalesScannerFocus, focusSalesScannerInput } from '../utils/globalBarcodeCapture';

function fixture(t?: TestContext) {
    t?.mock.timers.enable({ apis: ['setTimeout'] });
    const listeners = new Map<string, Set<() => void>>();
    const add = (key: string, fn: () => void) => {
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key)!.add(fn);
    };
    const body = { tagName: 'BODY' };
    let blocked = false, hiddenHost = false, enabled = true, calls = 0;
    const doc = { visibilityState: 'visible', activeElement: body as any,
        querySelector: () => blocked ? {} : null,
        addEventListener: (name: string, fn: () => void) => add(`doc:${name}`, fn),
        removeEventListener: (name: string, fn: () => void) => listeners.get(`doc:${name}`)?.delete(fn),
        getClientRects: () => assert.fail('geometry read'),
    };
    const makeInput = () => ({ tagName: 'INPUT', ownerDocument: doc, isConnected: true, disabled: false, readOnly: false,
        inputMode: 'none', dataset: { posScannerReceiver: 'true' },
        closest: (selector: string) => selector === '[data-pos-scanner-enabled]'
            ? { getAttribute: () => enabled ? 'true' : 'false' } : hiddenHost ? {} : null,
        getClientRects: () => assert.fail('geometry read'), getBoundingClientRect: () => assert.fail('geometry read'),
        focus(options: FocusOptions) { assert.deepEqual(options, { preventScroll: true }); calls++; doc.activeElement = this; },
    });
    let receiver = makeInput();
    const original = receiver;
    const win = { document: doc,
        addEventListener: add,
        removeEventListener: (name: string, fn: () => void) => listeners.get(name)?.delete(fn),
        getComputedStyle: () => assert.fail('computed style read'),
    };
    const focus = () => focusSalesScannerInput(doc as unknown as Document, receiver as unknown as HTMLInputElement);
    const mount = () => attachSalesScannerFocus(win as unknown as Window, () => receiver as unknown as HTMLInputElement);
    const event = (name: string) => [...(listeners.get(name) || [])].forEach(fn => fn());
    return { doc, original, body, focus, mount, event, listeners, calls: () => calls,
        receiver: () => receiver, replace: () => { receiver = makeInput(); },
        blocked: (value: boolean) => { blocked = value; }, hidden: (value: boolean) => { hiddenHost = value; },
        enabled: (value: boolean) => { enabled = value; },
    };
}

test('explicit quiet receiver gets focus without geometry and never refocuses itself', () => {
    const f = fixture(); f.focus(); f.focus(); assert.equal(f.calls(), 1);
});
for (const manual of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
    test(`manual ${manual.tagName} keeps focus`, () => {
        const f = fixture(); f.doc.activeElement = manual; f.focus(); assert.equal(f.calls(), 0);
    });
}
for (const guard of ['modal', 'hidden-host', 'disabled-host', 'hidden-document', 'disconnected', 'disabled', 'readonly', 'search-mode', 'unmarked', 'foreign-document']) {
    test(`quiet focus respects ${guard}`, () => {
        const f = fixture();
        if (guard === 'modal') f.blocked(true);
        if (guard === 'hidden-host') f.hidden(true);
        if (guard === 'disabled-host') f.enabled(false);
        if (guard === 'hidden-document') f.doc.visibilityState = 'hidden';
        if (guard === 'disconnected') f.receiver().isConnected = false;
        if (guard === 'disabled') f.receiver().disabled = true;
        if (guard === 'readonly') f.receiver().readOnly = true;
        if (guard === 'search-mode') f.receiver().inputMode = 'search';
        if (guard === 'unmarked') f.receiver().dataset.posScannerReceiver = '';
        if (guard === 'foreign-document') f.receiver().ownerDocument = {} as typeof f.doc;
        f.focus(); assert.equal(f.calls(), 0);
    });
}
test('queued recovery rechecks dialog, document and retained-host guards after the click handler', t => {
    for (const block of ['modal', 'host', 'document']) {
        const f = fixture(t); const cleanup = f.mount();
        if (block === 'modal') f.blocked(true);
        if (block === 'host') f.hidden(true);
        if (block === 'document') f.doc.visibilityState = 'hidden';
        t.mock.timers.tick(1); assert.equal(f.calls(), 0); cleanup(); t.mock.timers.reset();
    }
});
test('navigation click can reveal retained host before recovery; current ref is resolved at execution', t => {
    const f = fixture(t); f.hidden(true); const cleanup = f.mount(); t.mock.timers.tick(1);
    f.event('click'); f.replace(); f.hidden(false); t.mock.timers.tick(1);
    assert.equal(f.calls(), 1); assert.equal(f.doc.activeElement, f.receiver()); assert.notEqual(f.doc.activeElement, f.original);
    cleanup();
});
test('manual focus cancels queued recovery and quiet clicks never schedule repeated work', t => {
    const f = fixture(t); const cleanup = f.mount();
    f.doc.activeElement = { tagName: 'INPUT' }; f.event('focusin'); t.mock.timers.tick(1); assert.equal(f.calls(), 0);
    f.doc.activeElement = f.body; f.event('focusout'); t.mock.timers.tick(1); assert.equal(f.calls(), 1);
    f.event('click'); f.event('focus'); t.mock.timers.tick(1000); assert.equal(f.calls(), 1);
    cleanup();
});
test('blur, hidden document and cleanup cancel all queued work; StrictMode remount leaves one listener set', t => {
    const f = fixture(t); let cleanup = f.mount(); f.event('blur'); t.mock.timers.tick(1); assert.equal(f.calls(), 0);
    f.event('click'); f.doc.visibilityState = 'hidden'; f.event('doc:visibilitychange'); t.mock.timers.tick(1); assert.equal(f.calls(), 0);
    f.doc.visibilityState = 'visible'; f.event('doc:visibilitychange'); cleanup(); t.mock.timers.tick(1); assert.equal(f.calls(), 0);
    assert.ok([...f.listeners.values()].every(set => set.size === 0));
    cleanup = f.mount(); assert.ok([...f.listeners.values()].every(set => set.size === 1));
    t.mock.timers.tick(1); assert.equal(f.calls(), 1); cleanup();
});
