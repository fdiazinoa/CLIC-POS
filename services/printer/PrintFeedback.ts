import { clicAlert } from '../dialog/ClicDialogService';

const failureMessages: Record<string, string> = {
  BROWSER_UNAVAILABLE: 'Este documento utiliza el diálogo de impresión del navegador, que no está disponible en el APK. Ábrelo en la versión web para imprimirlo.',
  POPUP_BLOCKED: 'El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes y vuelve a intentar.',
  PRINTER_NOT_FOUND: 'No se encontró una impresora. Configúrala en Ajustes > Hardware y comprueba que esté conectada.',
  BT_NOT_SUPPORTED: 'Este dispositivo no dispone de Bluetooth para imprimir. Configura una impresora compatible en Ajustes > Hardware.',
  BT_DISABLED: 'Bluetooth está apagado. Actívalo y comprueba la conexión de la impresora.',
  NOT_PAIRED: 'La impresora no está vinculada. Vincúlala en Ajustes > Hardware.',
  PERMISSION_DENIED: 'Falta el permiso de Bluetooth. Autorízalo en los ajustes de Android.',
  CONNECT_FAILED: 'No se pudo conectar con la impresora. Comprueba que esté encendida y conectada.',
  NETWORK_PRINT_ERROR: 'No se pudo completar el envío a la impresora de red. Revisa su IP y conexión.',
  USB_PRINT_ERROR: 'No se pudo completar el envío USB. Revisa el cable y los permisos de la impresora.',
  UNSUPPORTED_CONNECTION: 'La conexión configurada no es compatible. Revisa Ajustes > Hardware.',
};

export class PrintOutputError extends Error {
  constructor(code?: string) {
    super(failureMessages[code || ''] || 'No se pudo completar el envío. Revisa la impresora configurada, su conexión y el papel.');
    this.name = 'PrintOutputError';
  }
}

export const notifyPrintFailure = (title: string, error?: unknown): void => {
  const reason = error instanceof PrintOutputError ? error.message : new PrintOutputError().message;
  void clicAlert(`${title}: ${reason}\n\nEste aviso solo afecta a la impresión. Si la operación ya se registró, puedes reimprimir el documento sin repetir el cobro. Si salió una parte, comprueba el papel antes de reintentar.`, {
    title: 'No se pudo imprimir', tone: 'warning',
  });
};

export const notifyPrintQueued = (): void => {
  void clicAlert('El trabajo está en cola; todavía no se ha confirmado su impresión. Evita reenviarlo para no duplicar copias.', {
    title: 'Impresión pendiente', tone: 'info',
  });
};

// Keep timed-out jobs locked until the original transport settles. A timeout
// cannot cancel a native write and must never enable a duplicate submission.
const pending = new Map<string, Promise<boolean>>();
export const runPrintTask = (
  key: string,
  title: string,
  task: () => Promise<boolean>,
  timeoutMs = 15000,
): Promise<boolean> => {
  const existing = pending.get(key);
  if (existing) return existing;

  let timer: ReturnType<typeof setTimeout>;
  let timedOut = false;
  const operation = Promise.resolve().then(task).catch(error => {
    if (!timedOut) notifyPrintFailure(title, error);
    return null;
  });
  const result = Promise.race([
    operation.then(accepted => {
      if (!timedOut && accepted === false) notifyPrintFailure(title);
      return accepted === true;
    }),
    new Promise<boolean>(resolve => {
      timer = setTimeout(() => {
        timedOut = true;
        void clicAlert(`${title}: la impresora no respondió a tiempo. No podemos confirmar si recibió el documento. Comprueba la salida antes de volver a imprimir; el envío original sigue pendiente.`, {
          title: 'Impresión sin confirmar', tone: 'warning',
        });
        resolve(false);
      }, timeoutMs);
    }),
  ]);
  pending.set(key, result);
  void operation.finally(() => {
    clearTimeout(timer);
    pending.delete(key);
  });
  return result;
};
