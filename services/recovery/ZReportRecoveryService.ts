
import { db } from '../../utils/db';
import { ZReport, Transaction } from '../../types';

type RecoveryOptions = {
    notifyUser?: boolean;
    runOncePerSession?: boolean;
    enrichHistory?: boolean;
    maxReports?: number;
};

export class ZReportRecoveryService {
    private static recoveryPromise: Promise<number> | null = null;
    private static alreadyRanInSession = false;
    private static notifiedInSession = false;

    static async recoverOrphanedReports(options: RecoveryOptions = {}): Promise<number> {
        const {
            notifyUser = false,
            runOncePerSession = true,
            enrichHistory = false,
            maxReports = 500
        } = options;

        if (runOncePerSession && this.alreadyRanInSession) {
            return 0;
        }

        // Prevent duplicate/concurrent recoveries (e.g. React StrictMode double effects)
        if (this.recoveryPromise) {
            return this.recoveryPromise;
        }

        this.recoveryPromise = this.runRecovery({
            notifyUser,
            enrichHistory,
            maxReports
        });

        try {
            const recoveredCount = await this.recoveryPromise;
            this.alreadyRanInSession = true;
            return recoveredCount;
        } finally {
            this.recoveryPromise = null;
        }
    }

    private static async runRecovery(params: {
        notifyUser: boolean;
        enrichHistory: boolean;
        maxReports: number;
    }): Promise<number> {
        console.log("🔍 ZReportRecovery: Checking for orphaned transactions...");

        try {
            const { notifyUser, enrichHistory, maxReports } = params;
            const reports = await db.get('zReports') as ZReport[];
            const history = await db.get('transactionHistory') as (Transaction & { zReportId?: string })[];

            if (!history || history.length === 0) return 0;

            const existingReportIds = new Set(reports?.map(r => r.id) || []);
            const transactionsByReportId = new Map<string, Transaction[]>();

            // Group by zReportId
            for (const tx of history) {
                if (tx.zReportId && !existingReportIds.has(tx.zReportId)) {
                    const group = transactionsByReportId.get(tx.zReportId) || [];
                    group.push(tx);
                    transactionsByReportId.set(tx.zReportId, group);
                }
            }

            if (transactionsByReportId.size === 0) {
                console.log("✅ ZReportRecovery: No orphaned transactions found.");
                return 0;
            }

            console.warn(`⚠️ ZReportRecovery: Found ${transactionsByReportId.size} missing Z-Reports! Recovering...`);

            const recoveredReports: ZReport[] = [];

            let recoveredCounter = 0;
            for (const [reportId, txs] of transactionsByReportId) {
                if (recoveredCounter >= maxReports) {
                    console.warn(`⚠️ ZReportRecovery: Reached maxReports=${maxReports}. Remaining reports will be recovered in next run.`);
                    break;
                }

                // Calculate Totals
                const totalsByMethod: Record<string, number> = {};
                for (const tx of txs) {
                    if (tx.payments) {
                        for (const p of tx.payments) {
                            totalsByMethod[p.method] = (totalsByMethod[p.method] || 0) + p.amount;
                        }
                    }
                }

                // Determine dates
                const dates = txs.map(t => new Date(t.date).getTime());
                const maxDate = new Date(Math.max(...dates));
                const minDate = new Date(Math.min(...dates));

                // Reconstruct Report
                const recoveredReport: ZReport = {
                    id: reportId,
                    sequenceNumber: `REC-${reportId.split('-')[1] || '000'}`, // Best effort
                    terminalId: txs[0].terminalId,
                    openedAt: minDate.toISOString(),
                    closedAt: maxDate.toISOString(),
                    closedByUserId: 'system-recovery',
                    closedByUserName: 'System Recovery',
                    baseCurrency: 'DOP', // Fallback
                    totalsByMethod,
                    cashExpected: {},
                    cashCounted: {},
                    cashDiscrepancy: {},
                    cashSales: totalsByMethod['CASH'] || 0,
                    cashIn: 0,
                    cashOut: 0,
                    transactionCount: txs.length,
                    notes: 'Auto-recovered from transaction history',
                    stats: {
                        averageTicket: txs.length > 0 ? Object.values(totalsByMethod).reduce((a, b) => a + b, 0) / txs.length : 0,
                        itemsPerSale: 0, // Hard to calc without full item scan, leave 0
                        peakHour: 'N/A',
                        topProduct: null,
                        returnsCount: 0,
                        returnsTotal: 0,
                        grossSales: Object.values(totalsByMethod).reduce((a, b) => a + b, 0),
                        netSales: Object.values(totalsByMethod).reduce((a, b) => a + b, 0),
                        discountsTotal: 0,
                        advancementsTotal: 0,
                        collectionsTotal: 0
                    },
                    syncStatus: 'PENDING'
                };

                recoveredReports.push(recoveredReport);
                recoveredCounter++;
                console.log(`♻️ Recovered Z-Report ${reportId}:`, recoveredReport);

                await db.saveDocument('zReports', recoveredReport);

                // Optional and expensive: keep disabled by default for faster recovery.
                if (enrichHistory) {
                    for (const tx of txs) {
                        if ((tx as any).zReportSequence === recoveredReport.sequenceNumber) continue;
                        await db.saveDocument('transactionHistory', {
                            ...tx,
                            zReportSequence: recoveredReport.sequenceNumber
                        } as any);
                    }
                }
            }

            if (notifyUser && recoveredReports.length > 0 && !this.notifiedInSession) {
                alert(`SISTEMA: Se han recuperado ${recoveredReports.length} Cierres Z perdidos.`);
                this.notifiedInSession = true;
            }

            return recoveredReports.length;

        } catch (error) {
            console.error("❌ ZReportRecovery Failed:", error);
            return 0;
        }
    }
}
