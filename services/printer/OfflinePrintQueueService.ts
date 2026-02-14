import { BusinessConfig } from '../../types';
import { db } from '../../utils/db';
import { PrinterRole, PrintRouterService } from './PrintRouterService';

export interface OfflinePrintQueueItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: 'PENDING' | 'SYNCING' | 'ERROR';
  attempts: number;
  lastError?: string;
  role: PrinterRole;
  terminalId?: string;
  printerId?: string;
  jobType?: string;
  referenceId?: string;
  copies?: number;
  html?: string;
  escPosBase64?: string;
  source?: string;
}

interface EnqueuePrintJobPayload {
  role: PrinterRole;
  terminalId?: string;
  printerId?: string;
  jobType?: string;
  referenceId?: string;
  copies?: number;
  html?: string;
  escPosBase64?: string;
  source?: string;
}

const queueCollection = 'offline_print_queue';
let processing = false;

const getQueue = async (): Promise<OfflinePrintQueueItem[]> => {
  return ((await db.get(queueCollection as any)) as OfflinePrintQueueItem[]) || [];
};

const sortByCreatedAt = (items: OfflinePrintQueueItem[]): OfflinePrintQueueItem[] => {
  return [...items].sort((a, b) => {
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return timeA - timeB;
  });
};

const notifyWake = () => {
  window.dispatchEvent(new CustomEvent('offlinePrintQueueWake'));
};

const notifyProcessed = (item: OfflinePrintQueueItem) => {
  window.dispatchEvent(new CustomEvent('offlinePrintQueueProcessed', {
    detail: {
      referenceId: item.referenceId,
      source: item.source,
      role: item.role
    }
  }));
};

export const offlinePrintQueueService = {
  async enqueueJob(payload: EnqueuePrintJobPayload): Promise<OfflinePrintQueueItem> {
    if (!payload.html && !payload.escPosBase64) {
      throw new Error('No hay contenido de impresion para encolar.');
    }

    const item: OfflinePrintQueueItem = {
      id: `OPQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'PENDING',
      attempts: 0,
      role: payload.role,
      terminalId: payload.terminalId,
      printerId: payload.printerId,
      jobType: payload.jobType,
      referenceId: payload.referenceId,
      copies: payload.copies,
      html: payload.html,
      escPosBase64: payload.escPosBase64,
      source: payload.source
    };

    await db.saveDocument(queueCollection as any, item as any);
    notifyWake();
    return item;
  },

  async getPendingCount(): Promise<number> {
    const queue = await getQueue();
    return queue.filter(item => item.status === 'PENDING' || item.status === 'ERROR' || item.status === 'SYNCING').length;
  },

  async processPendingQueue(config: BusinessConfig): Promise<{ processed: number; failed: number; pending: number }> {
    if (processing) {
      const pending = await this.getPendingCount();
      return { processed: 0, failed: 0, pending };
    }

    processing = true;

    let processed = 0;
    let failed = 0;

    try {
      const queue = sortByCreatedAt(await getQueue());

      for (const item of queue) {
        if (!(item.status === 'PENDING' || item.status === 'ERROR' || item.status === 'SYNCING')) continue;

        const workingItem: OfflinePrintQueueItem = {
          ...item,
          status: 'SYNCING',
          attempts: Math.max(0, Number(item.attempts || 0)) + 1,
          updatedAt: new Date().toISOString(),
          lastError: undefined
        };

        await db.saveDocument(queueCollection as any, workingItem as any);

        try {
          let printed = false;

          if (workingItem.escPosBase64) {
            printed = await PrintRouterService.routeAndPrintEscPos({
              config,
              role: workingItem.role,
              terminalId: workingItem.terminalId,
              jobType: workingItem.jobType,
              referenceId: workingItem.referenceId,
              copies: workingItem.copies,
              preferredPrinterId: workingItem.printerId,
              escPosBase64: workingItem.escPosBase64
            });
          }

          if (!printed && workingItem.html) {
            printed = await PrintRouterService.routeAndPrintHtml({
              config,
              role: workingItem.role,
              terminalId: workingItem.terminalId,
              jobType: workingItem.jobType,
              referenceId: workingItem.referenceId,
              copies: workingItem.copies,
              preferredPrinterId: workingItem.printerId,
              html: workingItem.html
            });
          }

          if (!printed) {
            throw new Error('Impresora no disponible o fuera de rango.');
          }

          await db.deleteDocument(queueCollection as any, workingItem.id);
          notifyProcessed(workingItem);
          processed += 1;
        } catch (error: any) {
          const failedItem: OfflinePrintQueueItem = {
            ...workingItem,
            status: 'ERROR',
            updatedAt: new Date().toISOString(),
            lastError: String(error?.message || error || 'Error de impresión')
          };

          await db.saveDocument(queueCollection as any, failedItem as any);
          failed += 1;
        }
      }
    } finally {
      processing = false;
    }

    const pending = await this.getPendingCount();
    return { processed, failed, pending };
  }
};
