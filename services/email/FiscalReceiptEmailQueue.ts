import type { Transaction } from '../../types';
import type { ReceiptEmailPayload, ReceiptEmailResult } from './receiptEmailService';

export const FISCAL_EMAIL_PENDING = 'Correo pendiente de firma fiscal; se enviará automáticamente cuando esté disponible.';
export interface FiscalEmailJob {
  id: string;
  scope: string;
  transaction: Transaction;
  payload: ReceiptEmailPayload;
  state: 'WAITING_SIGNATURE' | 'READY' | 'SENT' | 'REVIEW';
  signedPayload?: ReceiptEmailPayload;
  firstAttemptAt?: number;
  retryAt?: number;
  lastError?: string;
}
export interface FiscalEmailPorts {
  scope(): string;
  list(): Promise<FiscalEmailJob[]>;
  save(job: FiscalEmailJob): Promise<void>;
  prepare(job: FiscalEmailJob): Promise<ReceiptEmailPayload | undefined>;
  send(payload: ReceiptEmailPayload): Promise<ReceiptEmailResult>;
  id(): string;
  now(): number;
}
/** Separate durable delivery intent: never writes a sale, payment, fiscal number or ISSUE. */
export class FiscalReceiptEmailQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private running?: Promise<void>;
  constructor(private readonly ports: FiscalEmailPorts) {}
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const task = this.tail.then(action);
    this.tail = task.catch(() => undefined);
    return task;
  }
  enqueue(transaction: Transaction, payload: ReceiptEmailPayload): Promise<ReceiptEmailResult> {
    return this.serialize(async () => {
      const scope = this.ports.scope();
      if (!scope || !transaction.id) throw Error('No se pudo identificar la terminal para guardar el correo pendiente.');
      const email = payload.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('Introduce un correo electrónico válido.');
      const existing = (await this.ports.list()).find(job => job.scope === scope && job.transaction.id === transaction.id
        && job.payload.email === email && job.state !== 'SENT');
      if (existing?.state === 'REVIEW') return { success: false, status: 'review', message: existing.lastError };
      if (!existing) {
        const id = this.ports.id();
        await this.ports.save(JSON.parse(JSON.stringify({ id, scope, transaction,
          payload: { ...payload, email, deliveryRequestId: id }, state: 'WAITING_SIGNATURE' })));
      }
      return { success: true, status: 'pending_signature', message: FISCAL_EMAIL_PENDING };
    });
  }
  runAutomatic(): Promise<void> {
    if (this.running) return this.running;
    const task = (async () => {
      const scope = this.ports.scope();
      if (!scope) return;
      const jobs = (await this.ports.list()).filter(job => job.scope === scope && !['SENT', 'REVIEW'].includes(job.state)
        && (job.retryAt || 0) <= this.ports.now())
        .sort((a, b) => (a.retryAt || 0) - (b.retryAt || 0)).slice(0, 5);
      for (const job of jobs) {
        if (this.ports.scope() !== scope) return;
        try {
          // Resend's idempotency window is 24h. An uncertain old delivery needs review,
          // never a blind resend after the provider can forget its delivery key.
          if (job.firstAttemptAt !== undefined && this.ports.now() - job.firstAttemptAt >= 24 * 60 * 60 * 1000) {
            job.state = 'REVIEW';
            job.lastError = 'Envío sin confirmación durante 24 horas. Revisar la entrega antes de reenviar.';
            await this.serialize(() => this.ports.save(job));
            continue;
          }
          if (!job.signedPayload) {
            const payload = await this.ports.prepare(job);
            if (!payload) { job.retryAt = this.ports.now() + 60_000; await this.serialize(() => this.ports.save(job)); continue; }
            job.signedPayload = { ...payload, deliveryRequestId: job.id };
            job.state = 'READY';
          }
          if (this.ports.scope() !== scope) return;
          // Freeze both body and delivery identity durably BEFORE any network side effect.
          job.firstAttemptAt ??= this.ports.now();
          job.retryAt = this.ports.now() + 60_000;
          await this.serialize(() => this.ports.save(job));
          if (this.ports.scope() !== scope) return;
          const result = await this.ports.send(job.signedPayload);
          job.lastError = result.success ? undefined : result.message;
          if (result.success) job.state = 'SENT';
          await this.serialize(() => this.ports.save(job));
        } catch (error) {
          job.lastError = error instanceof Error ? error.message : 'No se pudo enviar el correo fiscal.';
          job.retryAt = this.ports.now() + 60_000;
          await this.serialize(() => this.ports.save(job));
        }
      }
    })();
    this.running = task;
    void task.finally(() => { if (this.running === task) this.running = undefined; }).catch(() => undefined);
    return task;
  }
}
