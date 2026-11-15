const EVENTS = new Set([
  'OUTBOX_PULL_STARTED', 'OUTBOX_PULL_COMPLETED', 'OUTBOX_EVENT_RECEIVED',
  'CONFIG_PUSH_V2_APPLY_STARTED', 'CONFIG_PUSH_V2_APPLY_COMPLETED', 'CONFIG_PUSH_V2_APPLY_FAILED',
  'config_snapshot_download_started', 'config_snapshot_downloaded', 'config_snapshot_domain_applied',
  'config_snapshot_apply_failed', 'config_snapshot_version_persisted',
  'config_push_v2_acknowledged', 'OUTBOX_ACK_STARTED', 'OUTBOX_ACK_COMPLETED', 'OUTBOX_ACK_FAILED',
  'HTTP_REQUEST_STARTED', 'HTTP_REQUEST_COMPLETED',
]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const REASONS = new Set(['IDENTITY', 'ORIGIN', 'CREDENTIAL', 'CONFIG_SCOPE', 'OWNER', 'TRANSITION', 'RUNTIME']);
const OPERATIONS = new Set(['OUTBOX_PULL', 'OUTBOX_ACK', 'CONFIG_SNAPSHOT']);

/** Allowlist only. Never forward headers, URLs, payloads, arbitrary messages or credential hashes. */
export function recordConfigPushNativeDiagnostic(event: string, details: Record<string, unknown>): void {
  if (!EVENTS.has(event)) return;
  const data: Record<string, unknown> = {};
  for (const key of ['event_id', 'outbox_id', 'snapshot_id']) {
    if (typeof details[key] === 'string' && UUID.test(details[key])) data[key] = details[key];
  }
  if (['PROCESSING', 'STARTED', 'COMPLETED', 'APPLIED', 'FAILED'].includes(String(details.status))) data.status = details.status;
  for (const key of ['http_status', 'duration_ms', 'attempt', 'count', 'bytes_received', 'request_sequence']) {
    const value = details[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) data[key] = value;
  }
  if (typeof details.code === 'string' && /^(SYNC_V3_|CONFIG_PUSH_V2_|ERP_SYNC_)[A-Z0-9_]{1,90}$/.test(details.code)) data.code = details.code;
  if (REASONS.has(String(details.reason))) data.reason = details.reason;
  if (OPERATIONS.has(String(details.operation))) data.operation = details.operation;
  try {
    const bridge = (window as unknown as { AndroidPrinter?: { debugLog?: (value: string) => void } }).AndroidPrinter;
    bridge?.debugLog?.(JSON.stringify({ tag: 'ClicPOSSync', message: `[CLIC_SYNC_AUTHORITY] ${event}`, data }));
  } catch { /* Diagnostic failure cannot change sync, checkpoint or ACK behavior. */ }
}
