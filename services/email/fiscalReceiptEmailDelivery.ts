import { v4 as uuidv4 } from 'uuid';
import type { BusinessConfig, Transaction, User } from '../../types';
import { readTerminalCredentialsSync } from '../sync/TerminalCredentialStore';
import { resolveErpBaseUrl } from '../../utils/erpBaseUrl';
import { financialIdentity } from '../db/LargeMasterSyncV3FinancialRetention';
import { isVerifiedFiscalPrintDisplay, resolveFiscalPrintReadiness } from '../fiscal/FiscalPrintEvidence';
import { buildReceiptEmailPayload } from './receiptEmailPayload';
import { sendReceiptEmailViaErp, type ReceiptEmailResult } from './receiptEmailService';
import { FiscalReceiptEmailQueue } from './FiscalReceiptEmailQueue';

const collection = 'fiscalReceiptEmailRequests';
const database = async () => (await import('../db')).dbAdapter;
const scope = (): string => {
  const credentials = readTerminalCredentialsSync();
  const parts = [resolveErpBaseUrl(), credentials.erpTenantId || credentials.tenantId,
    credentials.companyId, credentials.erpTerminalId || credentials.terminalId, credentials.deviceId];
  return parts.every(Boolean) ? JSON.stringify(parts) : '';
};
export async function prepareFiscalEmailPayload(job: import('./FiscalReceiptEmailQueue').FiscalEmailJob,
  current: Transaction | null): Promise<import('./receiptEmailService').ReceiptEmailPayload | undefined> {
  if (!current || financialIdentity(current) !== financialIdentity(job.transaction)) return undefined;
  const display = await resolveFiscalPrintReadiness(current);
  if (!isVerifiedFiscalPrintDisplay(display)) return undefined;
  const payload = buildReceiptEmailPayload(current, job.payload.email, undefined, String(job.payload.currencySymbol || 'RD$'), [], display);
  // Retain the requested document's original presentation. Only verified fiscal evidence
  // and the workflow's effective buyer can amend the queued receipt.
  return { ...job.payload, fiscalPrintEvidence: payload.fiscalPrintEvidence,
    fiscalValidated: display.dgiiAccepted, customerName: payload.customerName, customerTaxId: payload.customerTaxId,
    showQr: true, receiptDesign: { ...(job.payload.receiptDesign as object), showQr: true } };
}
export const fiscalReceiptEmailQueue = new FiscalReceiptEmailQueue({
  scope,
  list: async () => (await database()).getCollection(collection),
  save: async job => (await database()).saveDocument(collection, job),
  prepare: async job => {
    const db = await database();
    const current = await db.getDocument<Transaction>('transactions', job.transaction.id)
      || await db.getDocument<Transaction>('transactionHistory', job.transaction.id);
    return prepareFiscalEmailPayload(job, current);
  },
  send: payload => sendReceiptEmailViaErp(payload),
  id: uuidv4,
  now: Date.now,
});
export async function requestReceiptEmail(transaction: Transaction, email: string, config: BusinessConfig | undefined,
  currencySymbol: string, users: User[] = []): Promise<ReceiptEmailResult> {
  const payload = buildReceiptEmailPayload(transaction, email, config, currencySymbol, users);
  const electronic = [transaction.ncfType, transaction.electronicNcf, transaction.ncf].some(value => /^E\d{2}/.test(String(value || '')));
  if (!electronic) return sendReceiptEmailViaErp(payload);
  const result = await fiscalReceiptEmailQueue.enqueue(transaction, payload);
  // Enqueue is durable before returning. Financial completion never waits for fiscal signature or delivery.
  if (result.success) void fiscalReceiptEmailQueue.runAutomatic().catch(() => undefined);
  return result;
}
