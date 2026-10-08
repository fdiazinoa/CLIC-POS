/** Own a native listener across async registration, cleanup and StrictMode remounts.
 * The callback getter stays live without registering another native recipient. */
export function attachNativeBarcodeSubscription(
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  options: {
    subscribe: (callback: (code: string) => void) => Promise<{ remove(): Promise<void> }>;
    start: () => Promise<void>;
    isEnabled: () => boolean;
    settingEvent: string;
    canReceive: () => boolean;
    getCallback: () => (code: string) => void;
    onError?: (error: unknown) => void;
  },
) {
  let disposed = false;
  let handle: { remove(): Promise<void> } | undefined;
  const report = (error: unknown) => { if (!disposed) options.onError?.(error); };
  const remove = (value: typeof handle) => { if (value) void value.remove().catch(report); };
  const start = () => {
    if (!disposed && handle && options.isEnabled()) void options.start().catch(report);
  };
  void options.subscribe(code => {
    if (!disposed && options.isEnabled() && options.canReceive() && code.trim().length >= 3)
      options.getCallback()(code.trim());
  }).then(value => {
    if (disposed) remove(value);
    else { handle = value; start(); }
  }).catch(report);
  win.addEventListener(options.settingEvent, start);
  return () => {
    disposed = true;
    remove(handle);
    win.removeEventListener(options.settingEvent, start);
  };
}
