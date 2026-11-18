export type ManualSyncStage = 'ESPERA' | 'CONFIGURACION' | 'SINCRONIZAR_TODO' | 'MONITOR';

/** Only diagnostic identifiers are shown: arbitrary server messages may contain credentials. */
export function formatManualSyncFailure(error: unknown, stage: ManualSyncStage): string {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const message = typeof value.message === 'string' ? value.message : typeof error === 'string' ? error : '';
  const identifier = (input: unknown): string | undefined =>
    typeof input === 'string' && /^[A-Z0-9][A-Z0-9_]{2,99}$/.test(input) ? input : undefined;
  const code = identifier(value.code) || identifier(message.split(':')[0].trim())
    || (['Failed to fetch', 'Network request failed', 'Network Error', 'Load failed'].includes(message) ? 'NETWORK_ERROR' : 'ERROR_SIN_CODIGO');
  const fields = [`Etapa: ${stage}`, `Código: ${code}`];
  const reason = identifier(value.bindingReason);
  if (reason) fields.push(`Motivo: ${reason}`);
  const status = value.status ?? value.statusCode;
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) fields.push(`HTTP: ${status}`);
  if (code === 'ERROR_SIN_CODIGO') {
    const names = ['Error', 'TypeError', 'RangeError', 'DOMException', 'AbortError', 'TimeoutError'];
    if (typeof value.name === 'string' && names.includes(value.name)) fields.push(`Tipo: ${value.name}`);
    // A bundled source location identifies uncoded failures without exposing URLs, tokens or payloads.
    const location = typeof value.stack === 'string' ? value.stack.match(/\/(assets\/[A-Za-z0-9_-]+\.js:\d+:\d+)(?:[)\s]|$)/)?.[1] : undefined;
    if (location) fields.push(`Origen: ${location}`);
  }
  return `No se pudo completar la sincronización. ${fields.join(' · ')}`;
}
