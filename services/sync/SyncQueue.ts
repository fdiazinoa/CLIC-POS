import { dbAdapter } from '../db';

export interface SyncItem {
    id: string;
    type: 'TRANSACTION' | 'INVENTORY_ADJUSTMENT' | 'CUSTOMER_UPDATE' | 'DOCUMENT_SERIES';
    payload: any;
    status: 'PENDING' | 'SYNCED' | 'ERROR';
    retryCount: number;
    createdAt: string;
    error?: string;
}

class SyncQueueService {
    private isProcessing = false;
    private workerInterval: any = null;

    async enqueue(type: SyncItem['type'], payload: any): Promise<void> {
        const item: SyncItem = {
            id: `SYNC-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            type,
            payload,
            status: 'PENDING',
            retryCount: 0,
            createdAt: new Date().toISOString()
        };

        // We need to use executeSQL because our adapter's saveCollection is for key-value stores
        // and we want to use the relational sync_queue table we just created.
        await dbAdapter.executeSQL(
            `INSERT INTO sync_queue (id, type, payload, status, retryCount, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
            [item.id, item.type, JSON.stringify(item.payload), item.status, item.retryCount, item.createdAt]
        );

        console.log(`📥 SyncQueue: Enqueued ${type} ${item.id}`);

        // Trigger immediate process attempt
        this.process();
    }

    async process(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            // Fetch pending items
            // Note: executeSQL returns an array of result objects. 
            // Depending on sql.js version it might be [{columns:[], values:[]}] or just array of objects if using a wrapper.
            // Our adapter's executeSQL returns the raw result from sql.js exec which is [{columns, values}]
            // We need to handle that or add a helper in adapter. 
            // Let's assume for now we need to parse it.

            // Actually, let's look at SQLiteWASMAdapter.ts again. 
            // It returns `this.db.exec(query, params)`. 
            // sql.js exec returns `[{columns:['id',...], values:[['1',...]]}]`.

            const result = await dbAdapter.executeSQL(`SELECT * FROM sync_queue WHERE status = 'PENDING' ORDER BY createdAt ASC LIMIT 5`);

            if (result && result.length > 0 && result[0].values) {
                const columns = result[0].columns;
                const rows = result[0].values;

                for (const row of rows) {
                    const item: any = {};
                    columns.forEach((col: string, i: number) => {
                        item[col] = row[i];
                    });

                    await this.syncItem(item);
                }
            }

        } catch (error) {
            console.error("SyncQueue Process Error:", error);
        } finally {
            this.isProcessing = false;
        }
    }

    private async syncItem(item: any): Promise<void> {
        console.log(`🔄 Syncing item ${item.id} (${item.type})...`);

        try {
            const payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;

            // Handle different sync types
            if (item.type === 'TRANSACTION') {
                // Use TransactionSyncService for real transaction sync
                const { transactionSyncService } = await import('./TransactionSyncService');
                await transactionSyncService.pushTransaction(payload);
            } else if (item.type === 'INVENTORY_ADJUSTMENT') {
                // Use ApiSyncAdapter for inventory movements
                const { apiSyncAdapter } = await import('./ApiSyncAdapter');
                await apiSyncAdapter.pushInventoryMovement(payload);
            } else {
                // For other types, use mock sync for now
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Update status to SYNCED
            await dbAdapter.executeSQL(
                `UPDATE sync_queue SET status = 'SYNCED' WHERE id = ?`,
                [item.id]
            );
            console.log(`✅ Item ${item.id} synced successfully.`);

        } catch (error: any) {
            console.error(`❌ Failed to sync item ${item.id}:`, error);

            // Report error to Master
            try {
                const { apiSyncAdapter } = await import('./ApiSyncAdapter');
                await apiSyncAdapter.reportError(error.message, item.type, item.id);
            } catch (reportError) {
                console.warn('Could not report sync error to Master:', reportError);
            }

            // Update retry count and error
            await dbAdapter.executeSQL(
                `UPDATE sync_queue SET status = 'ERROR', retryCount = retryCount + 1, error = ? WHERE id = ?`,
                [error.message, item.id]
            );
        }
    }

    startBackgroundWorker(intervalMs: number = 30000) {
        if (this.workerInterval) clearInterval(this.workerInterval);
        this.workerInterval = setInterval(() => this.process(), intervalMs);
        console.log("⚙️ SyncQueue Background Worker started.");
    }

    stopBackgroundWorker() {
        if (this.workerInterval) clearInterval(this.workerInterval);
    }
}

export const syncQueue = new SyncQueueService();
