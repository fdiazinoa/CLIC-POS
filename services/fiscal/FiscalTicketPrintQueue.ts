export const FISCAL_TICKET_PENDING = 'Venta registrada. El ticket fiscal se imprimirá cuando esté disponible el timbre firmado.';

export interface FiscalTicketPrintJob {
  id: string;
  scope: string;
  transactionId: string;
  state: 'WAITING_SIGNATURE' | 'SENDING' | 'PRINTED' | 'REVIEW';
}

interface FiscalTicketPrintPorts {
  scope(): string;
  get(id: string): Promise<FiscalTicketPrintJob | null>;
  list(): Promise<FiscalTicketPrintJob[]>;
  save(job: FiscalTicketPrintJob): Promise<void>;
}

const jobId = (scope: string, transactionId: string) => JSON.stringify([scope, transactionId]);

export class FiscalTicketPrintQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private running?: Promise<boolean>;
  private printing = new Set<string>();
  private cursor = 0;

  constructor(private readonly ports: FiscalTicketPrintPorts) {}

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const task = this.tail.then(action);
    this.tail = task.catch(() => undefined);
    return task;
  }

  enqueue(transactionId: string): Promise<void> {
    const scope = this.ports.scope();
    if (!scope || !transactionId) return Promise.reject(Error('No se pudo guardar el ticket fiscal pendiente de esta terminal.'));
    return this.serialize(async () => {
      const id = jobId(scope, transactionId);
      if (!await this.ports.get(id)) {
        if (this.ports.scope() !== scope) throw Error('La vinculación de la terminal cambió.');
        await this.ports.save({ id, scope, transactionId, state: 'WAITING_SIGNATURE' });
      }
    });
  }

  async blocksManualPrint(transactionId: string): Promise<boolean> {
    const scope = this.ports.scope();
    if (!scope) return false;
    return this.serialize(async () => {
      const job = await this.ports.get(jobId(scope, transactionId));
      return job?.state === 'WAITING_SIGNATURE' || Boolean(job && this.printing.has(job.id));
    });
  }

  drain(
    prepare: (job: FiscalTicketPrintJob) => Promise<((isCurrent: () => boolean) => Promise<boolean>) | 'REVIEW' | undefined>,
    isCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    if (this.running) return this.running.then(() => this.drain(prepare, isCurrent));
    const scope = this.ports.scope();
    const isActiveScope = () => isCurrent() && this.ports.scope() === scope;
    const work = async () => {
      if (!scope || !isActiveScope()) return false;
      const jobs = (await this.ports.list()).filter(job => job.scope === scope && job.state === 'WAITING_SIGNATURE');
      let waiting = jobs.length > 5;
      const offset = jobs.length ? this.cursor % jobs.length : 0;
      this.cursor = offset + 5;
      const batch = [...jobs.slice(offset), ...jobs.slice(0, offset)].slice(0, 5);
      for (const job of batch) {
        if (!isActiveScope()) return false;
        const print = await prepare(job).catch(() => undefined);
        if (!print) { waiting = true; continue; }
        if (!isActiveScope()) return false;
        if (print === 'REVIEW') {
          await this.serialize(() => this.ports.save({ ...job, state: 'REVIEW' }));
          continue;
        }
        // A crash or an indeterminate printer response must not trigger a second automatic send.
        this.printing.add(job.id);
        try {
          await this.serialize(() => this.ports.save({ ...job, state: 'SENDING' }));
          if (!isActiveScope()) {
            // The transport has not started. It is safe to restore this queued job.
            await this.serialize(() => this.ports.save(job));
            return false;
          }
          const printed = await Promise.resolve().then(() => print(isActiveScope)).catch(() => false);
          await this.serialize(() => this.ports.save({ ...job, state: printed ? 'PRINTED' : 'REVIEW' }));
        } finally {
          this.printing.delete(job.id);
        }
      }
      return waiting;
    };
    const task = work();
    this.running = task;
    void task.finally(() => { if (this.running === task) this.running = undefined; }).catch(() => undefined);
    return task;
  }
}
