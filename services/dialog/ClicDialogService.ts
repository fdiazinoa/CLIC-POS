export type ClicDialogTone = 'info' | 'success' | 'warning' | 'danger';

export type ClicDialogOptions = {
  title?: string;
  tone?: ClicDialogTone;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type ClicPromptOptions = ClicDialogOptions & {
  initialValue?: string;
  placeholder?: string;
  inputType?: 'text' | 'email' | 'password' | 'url' | 'number';
  required?: boolean;
};

export type ClicDialogRequest = {
  id: number;
  kind: 'alert' | 'confirm' | 'prompt';
  message: string;
  options: ClicDialogOptions | ClicPromptOptions;
};

type DialogResult = boolean | string | null;
type QueueEntry = ClicDialogRequest & { resolve: (result: DialogResult) => void };
type DialogListener = (request: ClicDialogRequest | null) => void;

let nextId = 1;
let listener: DialogListener | null = null;
let active: QueueEntry | null = null;
const queue: QueueEntry[] = [];

const normalizeMessage = (message: unknown): string => {
  if (message instanceof Error) return message.message || 'Error desconocido.';
  if (typeof message === 'string') return message;
  if (message === undefined) return '';
  try {
    return typeof message === 'object' ? JSON.stringify(message, null, 2) : String(message);
  } catch {
    return String(message);
  }
};

const inferTone = (message: string): ClicDialogTone => {
  if (/error|fall[oó]|incorrect|denegad|insuficiente|no se pudo|bloquead|cr[ií]tic/i.test(message)) return 'danger';
  if (/advert|atenci[oó]n|seguro|confirm|continuar|eliminar|anular|reset|reinici/i.test(message)) return 'warning';
  if (/exit|complet|guardad|enviad|actualizad|listo|correctamente|✅/i.test(message)) return 'success';
  return 'info';
};

const pump = () => {
  if (!listener || active || queue.length === 0) return;
  active = queue.shift() || null;
  listener(active ? {
    id: active.id,
    kind: active.kind,
    message: active.message,
    options: active.options,
  } : null);
};

const enqueue = (
  kind: ClicDialogRequest['kind'],
  message: unknown,
  options: ClicDialogOptions | ClicPromptOptions = {},
): Promise<DialogResult> => new Promise((resolve) => {
  const normalizedMessage = normalizeMessage(message);
  queue.push({
    id: nextId++,
    kind,
    message: normalizedMessage,
    options: { ...options, tone: options.tone || inferTone(normalizedMessage) },
    resolve,
  });
  pump();
});

export const clicAlert = async (message: unknown, options: ClicDialogOptions = {}): Promise<void> => {
  await enqueue('alert', message, options);
};

export const clicConfirm = async (message: unknown, options: ClicDialogOptions = {}): Promise<boolean> => (
  Boolean(await enqueue('confirm', message, options))
);

export const clicPrompt = async (
  message: unknown,
  initialValueOrOptions: string | ClicPromptOptions = {},
): Promise<string | null> => {
  const options = typeof initialValueOrOptions === 'string'
    ? { initialValue: initialValueOrOptions }
    : initialValueOrOptions;
  const result = await enqueue('prompt', message, options);
  return typeof result === 'string' ? result : null;
};

export const subscribeToClicDialogs = (nextListener: DialogListener): (() => void) => {
  listener = nextListener;
  pump();
  return () => {
    if (listener === nextListener) listener = null;
  };
};

export const resolveClicDialog = (id: number, result: DialogResult): void => {
  if (!active || active.id !== id) return;
  const completed = active;
  active = null;
  completed.resolve(result);
  listener?.(null);
  queueMicrotask(pump);
};

export const installNativeAlertBridge = (): void => {
  if (typeof window === 'undefined') return;
  const bridgedWindow = window as Window & { __clicAlertBridgeInstalled?: boolean };
  if (bridgedWindow.__clicAlertBridgeInstalled) return;
  bridgedWindow.__clicAlertBridgeInstalled = true;
  window.alert = (message?: unknown) => {
    void clicAlert(message);
  };
};

declare global {
  const clicConfirm: typeof import('./ClicDialogService').clicConfirm;
  const clicPrompt: typeof import('./ClicDialogService').clicPrompt;
}

if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, { clicConfirm, clicPrompt });
}
