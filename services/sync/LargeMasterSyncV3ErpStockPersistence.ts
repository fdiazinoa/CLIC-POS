import { sha256Utf8 } from './LargeMasterSyncV3Client';

const STOCK_DISPLAY_DB = 'clic_pos_erp_stock_display';
const SNAPSHOTS = 'snapshots';

export type ErpStockDisplaySnapshot = {
  rows: Map<string, { stock: number; balance: number }>;
  marker?: string;
};

async function openStockDisplay(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STOCK_DISPLAY_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(SNAPSHOTS);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readErpStockDisplaySnapshot(key: string): Promise<ErpStockDisplaySnapshot | undefined> {
  const db = await openStockDisplay();
  if (!db) return undefined;
  try {
    const recordKey = await sha256Utf8(key);
    return await new Promise((resolve, reject) => {
      const request = db.transaction(SNAPSHOTS, 'readonly').objectStore(SNAPSHOTS).get(recordKey);
      request.onsuccess = () => {
        const snapshot = request.result as ErpStockDisplaySnapshot | undefined;
        resolve(snapshot?.rows instanceof Map ? snapshot : undefined);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function writeErpStockDisplaySnapshot(key: string, snapshot: ErpStockDisplaySnapshot, signal: AbortSignal): Promise<void> {
  const db = await openStockDisplay();
  if (!db) return;
  try {
    // Keep the bound scope stable without storing the raw binding tuple.
    const recordKey = await sha256Utf8(key);
    if (signal.aborted) throw signal.reason;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SNAPSHOTS, 'readwrite');
      const abort = () => {
        try { transaction.abort(); }
        catch (error) {
          if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') throw error;
        }
      };
      signal.addEventListener('abort', abort, { once: true });
      transaction.oncomplete = () => { signal.removeEventListener('abort', abort); resolve(); };
      transaction.onabort = () => { signal.removeEventListener('abort', abort); reject(transaction.error || signal.reason); };
      try { transaction.objectStore(SNAPSHOTS).put(snapshot, recordKey); }
      catch (error) {
        signal.removeEventListener('abort', abort);
        reject(error);
        abort();
      }
    });
  } finally {
    db.close();
  }
}
