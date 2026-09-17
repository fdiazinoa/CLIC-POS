import type { Plugin } from 'vite';

// Exact, bounded source patches only in the opt-in build. Fail closed on source drift.
function replaceOnce(code: string, from: string, to: string) {
  if (code.split(from).length !== 2) throw new Error(`Scanner focus diagnostic anchor drift: ${from.slice(0, 70)}`);
  return code.replace(from, to);
}
export function transformScannerFocus(code: string, id: string, enabled: boolean): string | undefined {
  if (!enabled) return;
  const name = id.replaceAll('\\', '/').split('?')[0];
  if (name.endsWith('/index.tsx')) {
    return `import { installScannerFocusDiagnostics } from './diagnostics/scannerFocus';\ninstallScannerFocusDiagnostics(window);\n${code}`;
  }
  if (name.endsWith('/utils/globalBarcodeCapture.ts')) {
    code = replaceOnce(code, 'export function focusSalesScannerInput(doc: Document, input: HTMLInputElement | null) {',
      `export function focusSalesScannerInput(doc: Document, input: HTMLInputElement | null) {\n    const __focusScope = scannerFocusBegin('focus-total', () => ({ doc, input }));\n    try {`);
    code = replaceOnce(code, '    if (!input || input.ownerDocument', `    if (scannerFocusMeasure(__focusScope, 'guards-simple', () => !input || input.ownerDocument`);
    code = replaceOnce(code, 'isEditable(doc.activeElement as HTMLElement) || blocked(doc)) return;',
      `isEditable(doc.activeElement as HTMLElement)) || scannerFocusMeasure(__focusScope, 'blocked-query', () => blocked(doc))) return;`);
    code = replaceOnce(code, "const root = input.closest('[data-pos-scanner-enabled]');",
      "const root = scannerFocusMeasure(__focusScope, 'closest', () => input.closest('[data-pos-scanner-enabled]'));");
    code = replaceOnce(code, "input.closest('[hidden], [inert], [aria-hidden=\"true\"]')) return;",
      "scannerFocusMeasure(__focusScope, 'closest', () => input.closest('[hidden], [inert], [aria-hidden=\"true\"]'))) return;");
    code = replaceOnce(code, '    input.focus({ preventScroll: true });\n}',
      "    scannerFocusMeasure(__focusScope, 'DOM-focus', () => input.focus({ preventScroll: true }));\n    } finally { scannerFocusEnd(__focusScope); }\n}");
    code = replaceOnce(code, 'const cancel = () => { clearTimeout(timer); timer = undefined; };',
      "const cancel = (reason: Event | string = 'cleanup') => { clearTimeout(timer); timer = undefined; scannerFocusPoint('cancel', () => ({ doc: win.document, reason: reason as any })); };");
    code = replaceOnce(code, 'const restore = () => {\n        const input = getReceiver();',
      "const restore = (reason: Event | string = 'mount') => {\n        const input = getReceiver();\n        scannerFocusPoint('restore', () => ({ doc: win.document, input, reason: reason as any }));");
    code = replaceOnce(code, '        timer = setTimeout(() => {\n            timer = undefined;\n            if (!disposed)',
      "        const __scheduledReason = scannerFocusPoint('schedule', () => ({ doc: win.document, input, reason: reason as any }));\n        timer = setTimeout(() => {\n            timer = undefined;\n            scannerFocusPoint('run', () => ({ doc: win.document, reason: __scheduledReason }));\n            if (!disposed)");
    code = replaceOnce(code, 'if (isEditable(win.document.activeElement as HTMLElement)) cancel();\n        else restore();',
      "if (isEditable(win.document.activeElement as HTMLElement)) cancel('focusin');\n        else restore('focusin');");
    code = replaceOnce(code, "if (win.document.visibilityState === 'hidden') cancel(); else restore();",
      "if (win.document.visibilityState === 'hidden') cancel('hidden'); else restore('visible');");
    code = replaceOnce(code, 'if (visible) restore();\n        else cancel();', "if (visible) restore('host-visible');\n        else cancel('host-hidden');");
    return `import { scannerFocusBegin, scannerFocusEnd, scannerFocusMeasure, scannerFocusPoint } from '../diagnostics/scannerFocus';\n${code}`;
  }
  if (name.endsWith('/components/GlobalVirtualKeyboard.tsx')) {
    code = replaceOnce(code, '        const field = event.target;',
      "        const field = event.target;\n        scannerFocusPoint('manual-pointer', () => ({ doc: document, input: field }));");
    code = replaceOnce(code, '        window.setTimeout(() => {\n          if (!field.isConnected)',
      "        window.setTimeout(() => {\n          scannerFocusPoint('manual-callback', () => ({ doc: document, input: field }));\n          if (!field.isConnected)");
    code = replaceOnce(code, '          bridge?.showSoftKeyboard?.();',
      "          scannerFocusPoint('manual-bridge-call-site', () => ({ doc: document, input: field, bridgePresent: !!bridge }));\n          bridge?.showSoftKeyboard?.();");
    return `import { scannerFocusPoint } from '../diagnostics/scannerFocus';\n${code}`;
  }
}
export function scannerFocusDiagnosticsPlugin(enabled: boolean): Plugin {
  return { name: 'pos-scanner-focus-attribution', enforce: 'pre', transform(code, id) {
    const result = transformScannerFocus(code, id, enabled);
    return result === undefined ? undefined : { code: result, map: null };
  } };
}
