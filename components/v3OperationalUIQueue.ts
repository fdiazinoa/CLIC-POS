/** Serializes async candidate mutations and rejects work from a retired UI context. */
export class V3OperationalUIQueue {
  private pending: Promise<unknown> = Promise.resolve();

  run<T>(isCurrent: () => boolean, operation: () => Promise<T>): Promise<T> {
    const task = this.pending.then(async () => {
      if (!isCurrent()) throw new Error('SYNC_V3_UI_CONTEXT_CHANGED');
      const result = await operation();
      if (!isCurrent()) throw new Error('SYNC_V3_UI_CONTEXT_CHANGED');
      return result;
    });
    this.pending = task.catch(() => undefined);
    return task;
  }
}
