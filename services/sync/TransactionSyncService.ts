/**
 * Transaction Sync Service
 * 
 * Handles synchronization of transactions from slave terminals to master.
 * Slave terminals enqueue transactions, master processes and consolidates.
 */

import { apiSyncAdapter } from './ApiSyncAdapter';
import { permissionService } from './PermissionService';
import { Transaction } from '../../types';

class TransactionSyncService {
    /**
     * Send transaction from slave to master
     * (Called automatically via SyncQueue)
     */
    async pushTransaction(transaction: Transaction): Promise<void> {
        try {
            // Use apiSyncAdapter to push to Master terminal
            await apiSyncAdapter.pushTransaction(transaction);
            console.log(`📤 TransactionSync: Pushed transaction ${transaction.id} to master`);
        } catch (error) {
            console.error('Error pushing transaction:', error);
            throw error;
        }
    }

    /**
     * Pull pending transactions (Master only)
     * Returns transactions from all slave terminals
     */
    async pullPendingTransactions(): Promise<Transaction[]> {
        if (!permissionService.isMasterTerminal()) {
            console.warn('⚠️  Only master terminal can pull transactions');
            return [];
        }

        try {
            const transactions = await apiSyncAdapter.pullPendingTransactions();

            if (transactions.length > 0) {
                console.log(`📥 TransactionSync: Pulled ${transactions.length} pending transactions`);
            }

            return transactions;
        } catch (error) {
            console.error('Error pulling transactions:', error);
            return [];
        }
    }

    /**
     * Process received transaction on master
     * Save to database and update inventory
     */
    async processReceivedTransaction(
        transaction: Transaction,
        onSave: (txn: Transaction) => Promise<void>
    ): Promise<void> {
        try {
            // Save transaction
            await onSave(transaction);

            console.log(`✅ TransactionSync: Processed transaction ${transaction.id} from ${transaction.terminalId}`);

            // Dispatch event for UI refresh
            window.dispatchEvent(new CustomEvent('transactionSynced', {
                detail: { transaction }
            }));
        } catch (error) {
            console.error(`Error processing transaction ${transaction.id}:`, error);
            throw error;
        }
    }

    /**
     * Check for pending transactions periodically (Master only)
     */
    startTransactionPolling(
        intervalMs: number,
        onNewTransactions: (txns: Transaction[]) => Promise<void>
    ): number {
        if (!permissionService.isMasterTerminal()) {
            return -1;
        }

        const interval = setInterval(async () => {
            const transactions = await this.pullPendingTransactions();

            if (transactions.length > 0) {
                await onNewTransactions(transactions);
            }
        }, intervalMs);

        console.log(`⏰ Transaction polling started (${intervalMs / 1000}s interval)`);
        return interval as unknown as number;
    }

    stopTransactionPolling(intervalId: number) {
        if (intervalId !== -1) {
            clearInterval(intervalId);
            console.log('⏹️  Transaction polling stopped');
        }
    }
}

export const transactionSyncService = new TransactionSyncService();
