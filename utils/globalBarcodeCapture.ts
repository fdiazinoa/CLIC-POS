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

/** IME-only readers need an input, but must not steal focus from forms. */
export function focusSalesScannerInput(doc: Document) {
    if (blocked(doc) || isEditable(doc.activeElement as HTMLElement)) return;
    const root = doc.querySelector('[data-pos-scanner-enabled="true"]');
    const inputs = root?.querySelectorAll<HTMLInputElement>('[data-barcode-scanner-target="true"]');
    const input = inputs && Array.from(inputs).find(field => field.getClientRects().length > 0);
    input?.focus({ preventScroll: true });
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
    let completed: { target: HTMLElement | null; code: string; at: number } | undefined;
    const reset = () => {
        clearTimeout(timer);
        code = '';
        burst = 0;
        atomic = false;
        target = null;
    };
    const cancel = () => { reset(); completed = undefined; };
    const eligible = (el: HTMLElement | null) => !blocked(win.document) && (
        !isEditable(el) || (el?.dataset?.barcodeScannerTarget === 'true' &&
            !(el as HTMLInputElement).readOnly && !(el as HTMLInputElement).disabled)
    );
    const emit = () => {
        if (!eligible(target) || code.trim().length < 3) { cancel(); return false; }
        const value = code.trim();
        completed = { target, code: value, at: Date.now() };
        reset();
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
        if (!eligible(el) || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) { cancel(); return; }
        if (event.repeat) return;
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
        // Focused search uses input as source of truth; Android may send both.
        if (isEditable(el)) return;
        const now = Date.now();
        if (target !== el || now - lastAt > prefixTimeout) reset();
        target = el;
        lastAt = now;
        code += event.key;
        burst++;
        schedule();
    };
    const onInput = (event: Event) => {
        const el = event.target as HTMLInputElement | null;
        if (el?.tagName !== 'INPUT' || el.dataset.barcodeScannerTarget !== 'true') { cancel(); return; }
        const input = event as InputEvent;
        if (!eligible(el) || input.isComposing || input.inputType?.startsWith('delete') ||
            input.inputType === 'insertFromPaste' || input.inputType === 'insertFromDrop') { cancel(); return; }
        const value = el.value;
        completed = undefined;
        const now = Date.now();
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
