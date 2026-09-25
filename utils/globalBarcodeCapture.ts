import { tableLatencyQaMark } from '../diagnostics/tableLatencyQa';

export interface BarcodeCaptureOptions {
    onScan: (code: string) => void;
    prefixTimeout?: number;
    idleTimeout?: number;
}

const isEditable = (element: HTMLElement | null) => Boolean(element && (
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable
));
const blocked = (doc: Document) => Boolean(
    doc.querySelector('[data-pos-scanner-enabled="false"]') ||
    doc.querySelector('[role="dialog"], dialog[open], [aria-modal="true"]')
);

export const SALES_SCANNER_HOST_VISIBILITY = 'pos:scanner-host-visibility';

/** Emitted by the retained owner after committing its inert/visible boundary. */
export function notifySalesScannerHostVisibility(host: HTMLElement, visible: boolean) {
    host.dispatchEvent(new CustomEvent(SALES_SCANNER_HOST_VISIBILITY, { bubbles: true, detail: { visible } }));
}

/** Only the explicit quiet receiver may acquire automatic IME focus. No layout reads. */
export function focusSalesScannerInput(doc: Document, input: HTMLInputElement | null) {
    if (!input || input.ownerDocument !== doc || !input.isConnected || doc.visibilityState !== 'visible' ||
        input.dataset.posScannerReceiver !== 'true' || input.inputMode !== 'none' || input.disabled || input.readOnly ||
        input === doc.activeElement || isEditable(doc.activeElement as HTMLElement) || blocked(doc)) return;
    const root = input.closest('[data-pos-scanner-enabled]');
    if (!root || root.getAttribute('data-pos-scanner-enabled') !== 'true' ||
        input.closest('[hidden], [inert], [aria-hidden="true"]')) return;
    tableLatencyQaMark('SCANNER_FOCUS_START');
    input.focus({ preventScroll: true });
    tableLatencyQaMark('SCANNER_FOCUS_END');
}

/** Event-bound restoration; the receiver ref and all route/modal guards are read at execution. */
export function attachSalesScannerFocus(win: Window, getReceiver: () => HTMLInputElement | null) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const cancel = () => { clearTimeout(timer); timer = undefined; };
    const restore = () => {
        const input = getReceiver();
        if (disposed || !input || input.disabled || input.readOnly || win.document.visibilityState !== 'visible' ||
            input === win.document.activeElement || isEditable(win.document.activeElement as HTMLElement)) return;
        if (timer !== undefined) return;
        // A click may reveal the retained POS or open a modal. Inert/dialog
        // eligibility must be checked after its handler, not used to skip a reveal.
        timer = setTimeout(() => {
            timer = undefined;
            if (!disposed) focusSalesScannerInput(win.document, getReceiver());
        }, 0);
    };
    const onFocusIn = () => {
        if (isEditable(win.document.activeElement as HTMLElement)) cancel();
        else restore();
    };
    const onVisibility = () => { if (win.document.visibilityState === 'hidden') cancel(); else restore(); };
    const onHostVisibility = (event: Event) => {
        const input = getReceiver();
        const visible = (event as CustomEvent<{ visible?: unknown }>).detail?.visible;
        if (disposed || typeof visible !== 'boolean' || !input || !input.isConnected || input.ownerDocument !== win.document) return;
        const host = input.closest('[data-pos-persistent-host="true"]');
        if (!host || event.target !== host || host.ownerDocument !== win.document) return;
        if (visible) restore();
        else cancel();
    };
    restore();
    win.addEventListener('click', restore);
    win.addEventListener('focusin', onFocusIn);
    win.addEventListener('focusout', restore);
    win.addEventListener('focus', restore);
    win.addEventListener('blur', cancel);
    win.addEventListener(SALES_SCANNER_HOST_VISIBILITY, onHostVisibility);
    win.document.addEventListener('visibilitychange', onVisibility);
    return () => {
        disposed = true;
        cancel();
        win.removeEventListener('click', restore);
        win.removeEventListener('focusin', onFocusIn);
        win.removeEventListener('focusout', restore);
        win.removeEventListener('focus', restore);
        win.removeEventListener('blur', cancel);
        win.removeEventListener(SALES_SCANNER_HOST_VISIBILITY, onHostVisibility);
        win.document.removeEventListener('visibilitychange', onVisibility);
    };
}

/** One buffer for HID and marked search-field IME input. A new burst of the
 * same SKU is intentional: never deduplicate separate scans by product code. */
export function attachGlobalBarcodeCapture(win: Window, options: BarcodeCaptureOptions) {
    const prefixTimeout = options.prefixTimeout ?? 100;
    const idleTimeout = options.idleTimeout ?? 250;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let code = '';
    let target: HTMLElement | null = null;
    let lastAt = 0;
    let burst = 0;
    let atomic = false;
    let clearingInput = false;
    let completed: { target: HTMLElement | null; code: string; at: number } | undefined;
    let modalTarget: HTMLElement | null = null;
    let modalLastAt = 0;
    let modalBurst = 0;
    let modalAwaitingInput = false;
    const resetModalBurst = () => { modalTarget = null; modalLastAt = 0; modalBurst = 0; modalAwaitingInput = false; };
    const tableModalOpen = () => Boolean(win.document.querySelector('[data-table-map-persistent-host="true"][aria-modal="true"]'));
    const appendModalCharacters = (el: HTMLElement, length: number) => {
        const now = Date.now();
        if (modalTarget !== el || now - modalLastAt > prefixTimeout) resetModalBurst();
        modalTarget = el;
        modalLastAt = now;
        modalBurst += length;
    };
    // The dedicated receiver is uncontrolled and contains only transient scanner
    // text. Abandoned scans must not survive in its native value. Manual search
    // inputs retain their text when capture is cancelled.
    const clearQuietInput = (el: HTMLElement | null) => {
        if (el?.tagName === 'INPUT' && el.dataset.posScannerReceiver === 'true') {
            (el as HTMLInputElement).value = '';
        }
    };
    const reset = () => {
        clearTimeout(timer);
        clearQuietInput(target);
        code = '';
        burst = 0;
        atomic = false;
        target = null;
    };
    const cancel = () => { reset(); resetModalBurst(); completed = undefined; };
    const eligible = (el: HTMLElement | null) => !blocked(win.document) && (
        !isEditable(el) || (el?.dataset?.barcodeScannerTarget === 'true' &&
            !(el as HTMLInputElement).readOnly && !(el as HTMLInputElement).disabled)
    );
    const emit = () => {
        if (!eligible(target) || code.trim().length < 3) { cancel(); return false; }
        const value = code.trim();
        const scannedTarget = target;
        reset();
        // Consuming a scan must not depend on a catalog match. Clear the native
        // input AND notify controlled React inputs before routing the barcode.
        // Otherwise an unknown SKU remains and the next scan is concatenated.
        if (scannedTarget?.tagName === 'INPUT' && scannedTarget.dataset.barcodeScannerTarget === 'true') {
            const input = scannedTarget as HTMLInputElement;
            if (input.value.trim() === value) {
                const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
                if (setter) setter.call(input, '');
                else input.value = '';
                clearingInput = true;
                try {
                    const event = input.ownerDocument.createEvent('Event');
                    event.initEvent('input', true, false);
                    input.dispatchEvent(event);
                } finally { clearingInput = false; }
            }
        }
        completed = { target: scannedTarget, code: value, at: Date.now() };
        options.onScan(value);
        return true;
    };
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            // Without a suffix require a complete IME chunk or a sustained
            // six-character burst, not slow/manual typing.
            if (atomic || (burst >= 6 && burst === code.length)) emit();
            else reset();
        }, idleTimeout);
    };
    const consume = (event: KeyboardEvent) => { event.preventDefault(); event.stopPropagation(); };
    const onKey = (event: KeyboardEvent) => {
        const el = event.target as HTMLElement | null;
        if (tableModalOpen()) {
            // The sales scan is blocked by the modal, but the HID suffix must
            // not activate its focused button. Track only a live keydown burst;
            // an ordinary Enter with no scanner burst keeps its native action.
            reset();
            completed = undefined;
            if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.repeat) {
                resetModalBurst();
                return;
            }
            if (event.key === 'Enter' || event.key === 'NumpadEnter' || event.key === 'Tab') {
                const scannerTerminator = modalTarget === el && modalBurst >= 6 &&
                    Date.now() - modalLastAt <= prefixTimeout;
                resetModalBurst();
                if (scannerTerminator) {
                    consume(event);
                    event.stopImmediatePropagation();
                }
                return;
            }
            if (event.key === 'Unidentified' && el?.tagName === 'INPUT') {
                modalAwaitingInput = true;
                return;
            }
            if (event.key.length !== 1) { resetModalBurst(); return; }
            modalAwaitingInput = false;
            appendModalCharacters(el, 1);
            return;
        }
        resetModalBurst();
        if (!eligible(el) || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) { cancel(); return; }
        if (event.repeat) return;
        // Android readers can deliver Unidentified before each valid insertText
        // event. It carries no character: let onInput continue the same burst.
        if (event.key === 'Unidentified' && el?.dataset?.barcodeScannerTarget === 'true') return;
        if (event.key === 'Enter' || event.key === 'Tab') {
            if (target === el && (atomic || (burst >= 3 && burst === code.length))) {
                if (emit()) consume(event);
            } else if (completed?.target === el && Date.now() - completed.at < 500 &&
                (!isEditable(el) || !(el as HTMLInputElement).value || (el as HTMLInputElement).value === completed.code)) {
                // Consume the suffix of a scan already delivered by idle/IME.
                consume(event);
                completed = undefined;
            } else reset();
            return;
        }
        if (event.key.length !== 1) { cancel(); return; }
        completed = undefined;
        const now = Date.now();
        if (target !== el || now - lastAt > prefixTimeout) reset();
        target = el;
        lastAt = now;
        code += event.key;
        burst++;
        schedule();
    };
    const onInput = (event: Event) => {
        if (clearingInput) return;
        const el = event.target as HTMLInputElement | null;
        if (tableModalOpen()) {
            const input = event as InputEvent;
            if (modalAwaitingInput && el?.tagName === 'INPUT' && input.inputType === 'insertText' &&
                !input.isComposing && input.data) appendModalCharacters(el, input.data.length);
            modalAwaitingInput = false;
            return;
        }
        if (el?.tagName !== 'INPUT' || el.dataset.barcodeScannerTarget !== 'true') { cancel(); return; }
        const input = event as InputEvent;
        if (!eligible(el) || input.isComposing || input.inputType?.startsWith('delete') ||
            input.inputType === 'insertFromPaste' || input.inputType === 'insertFromDrop') { clearQuietInput(el); cancel(); return; }
        const value = el.value;
        completed = undefined;
        const now = Date.now();
        // A hardware keyboard normally emits keydown before input. Keep the
        // keydown buffer as a fallback for Android WebViews/readers that omit
        // input, and treat the matching input event as a mirror—not a second
        // character.
        const mirrorsKeydown = target === el && now - lastAt <= prefixTimeout && value === code;
        if (mirrorsKeydown) {
            lastAt = now;
            if (!value) { reset(); return; }
            schedule();
            return;
        }
        const continuation = target === el && now - lastAt <= prefixTimeout && value === code + (input.data || '');
        const chunk = input.data ?? (input.inputType === 'insertText' && !code ? value : '');
        burst = continuation ? burst + chunk.length : (value === chunk ? chunk.length : 0);
        atomic = chunk.length >= 3 && chunk === value;
        code = value;
        target = el;
        lastAt = now;
        if (!value || (!chunk && !continuation)) { reset(); return; }
        schedule();
    };
    win.addEventListener('keydown', onKey, true);
    win.addEventListener('input', onInput, true);
    win.addEventListener('focusin', cancel, true);
    win.addEventListener('blur', cancel);
    return () => {
        cancel();
        win.removeEventListener('keydown', onKey, true);
        win.removeEventListener('input', onInput, true);
        win.removeEventListener('focusin', cancel, true);
        win.removeEventListener('blur', cancel);
    };
}
