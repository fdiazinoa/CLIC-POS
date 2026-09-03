import { clicAlert } from '../dialog/ClicDialogService';
import { shouldSuppressBrowserPrintFallback } from './PrintRuntime';
import { PrintOutputError, notifyPrintFailure } from './PrintFeedback';

export const notifyBrowserPrint = (): void => {
  void clicAlert('Se solicitó la impresión al navegador. El sistema no puede saber si se imprimió o se canceló: comprueba la salida antes de repetirla.', {
    title: 'Impresión sin confirmar', tone: 'info',
  });
};

export const printCurrentPage = (): void => {
  if (shouldSuppressBrowserPrintFallback()) {
    notifyPrintFailure('Documento', new PrintOutputError('BROWSER_UNAVAILABLE'));
    return;
  }
  try {
    window.print();
    notifyBrowserPrint();
  } catch {
    notifyPrintFailure('Documento');
  }
};
