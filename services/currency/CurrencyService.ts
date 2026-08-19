import { BusinessConfig, CurrencyAuditLog, CurrencyConfig, CurrencyRateSchedule, User } from '../../types';
import { db } from '../../utils/db';

const AUDITED_FIELDS: Array<keyof CurrencyConfig> = ['rate', 'buyRate', 'sellRate'];

const appendAuditLogs = async (logs: CurrencyAuditLog[]) => {
  for (const log of logs) {
    await db.saveDocument('currencyAuditLogs' as any, log as any);
  }
};

export const recordCurrencyChanges = async (
  previous: CurrencyConfig[],
  next: CurrencyConfig[],
  user: Pick<User, 'id' | 'name'>,
  terminalId?: string,
  source: CurrencyAuditLog['source'] = 'MANUAL',
): Promise<CurrencyAuditLog[]> => {
  const previousByCode = new Map(previous.map(currency => [currency.code, currency]));
  const now = new Date().toISOString();
  const logs: CurrencyAuditLog[] = [];

  next.forEach(currency => {
    const oldCurrency = previousByCode.get(currency.code);
    AUDITED_FIELDS.forEach(field => {
      const oldValue = oldCurrency ? oldCurrency[field] : null;
      const newValue = currency[field];
      if (oldValue === newValue || (oldValue == null && newValue == null)) return;
      logs.push({
        id: `currency-audit-${currency.code}-${String(field)}-${Date.now()}-${logs.length}`,
        currencyCode: currency.code,
        field: String(field),
        oldValue,
        newValue,
        changedAt: now,
        changedBy: user.id,
        changedByName: user.name,
        terminalId,
        source,
      });
    });
  });

  await appendAuditLogs(logs);
  return logs;
};

export const getLocalCurrencyAudit = async (currencyCode: string): Promise<CurrencyAuditLog[]> => {
  const logs = await db.get('currencyAuditLogs' as any) as CurrencyAuditLog[] | null;
  return (Array.isArray(logs) ? logs : [])
    .filter(log => log.currencyCode === currencyCode)
    .sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt));
};

export const scheduleLocalCurrencyRate = async (
  schedule: Omit<CurrencyRateSchedule, 'id' | 'status' | 'createdAt'>,
): Promise<CurrencyRateSchedule> => {
  const record: CurrencyRateSchedule = {
    ...schedule,
    id: `currency-schedule-${schedule.currencyCode}-${Date.now()}`,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };
  await db.saveDocument('currencyRateSchedules' as any, record as any);
  return record;
};

export const getLocalCurrencySchedules = async (): Promise<CurrencyRateSchedule[]> => {
  const schedules = await db.get('currencyRateSchedules' as any) as CurrencyRateSchedule[] | null;
  return (Array.isArray(schedules) ? schedules : []).sort(
    (a, b) => Date.parse(a.executeAt) - Date.parse(b.executeAt),
  );
};

class CurrencyScheduleExecutor {
  private interval: number | null = null;
  private running = false;

  initialize() {
    if (typeof window === 'undefined' || this.interval !== null) return;
    void this.applyDue();
    this.interval = window.setInterval(() => void this.applyDue(), 30000);
  }

  async applyDue() {
    if (this.running) return;
    this.running = true;
    try {
      const schedules = await getLocalCurrencySchedules();
      const due = schedules.filter(schedule => schedule.status === 'PENDING' && Date.parse(schedule.executeAt) <= Date.now());
      if (due.length === 0) return;

      let config = await db.get('config' as any) as unknown as BusinessConfig;
      if (!config || Array.isArray(config) || !Array.isArray(config.currencies)) return;

      for (const schedule of due) {
        const before = config.currencies;
        const exists = before.some(currency => currency.code === schedule.currencyCode);
        if (!exists) {
          await db.saveDocument('currencyRateSchedules' as any, {
            ...schedule,
            status: 'FAILED',
            error: `Moneda ${schedule.currencyCode} no encontrada`,
          } as any);
          continue;
        }
        const nextCurrencies = before.map(currency => currency.code === schedule.currencyCode ? {
          ...currency,
          rate: schedule.rate,
          buyRate: schedule.buyRate ?? currency.buyRate,
          sellRate: schedule.sellRate ?? currency.sellRate,
          lastModified: new Date().toISOString(),
          lastModifiedBy: schedule.createdByName,
        } : currency);
        config = { ...config, currencies: nextCurrencies };
        await db.save('config', config);
        await recordCurrencyChanges(
          before,
          nextCurrencies,
          { id: schedule.createdBy, name: schedule.createdByName },
          schedule.terminalId,
          'SCHEDULED',
        );
        await db.saveDocument('currencyRateSchedules' as any, {
          ...schedule,
          status: 'APPLIED',
          appliedAt: new Date().toISOString(),
          error: undefined,
        } as any);
      }
      window.dispatchEvent(new CustomEvent('configUpdated', { detail: config }));
    } catch (error) {
      console.error('[CurrencyScheduleExecutor] No se pudieron aplicar tasas programadas:', error);
    } finally {
      this.running = false;
    }
  }
}

export const currencyScheduleExecutor = new CurrencyScheduleExecutor();
