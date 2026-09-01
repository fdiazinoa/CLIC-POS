export type NativeLaunchContext = 'activity_recreated' | 'fresh_start' | 'unknown';

export interface NativeSessionResumeDecisionInput {
  launchContext: NativeLaunchContext;
  forceLogin: boolean;
  savedAt?: string;
  autoLogoutMinutes: number;
  currentTerminalId?: string;
  sessionTerminalId?: string;
  now?: number;
}

export const shouldRestoreNativeSession = ({
  launchContext,
  forceLogin,
  savedAt,
  autoLogoutMinutes,
  currentTerminalId,
  sessionTerminalId,
  now = Date.now(),
}: NativeSessionResumeDecisionInput): boolean => {
  if (forceLogin || launchContext !== 'activity_recreated') return false;

  const normalizedCurrentTerminalId = String(currentTerminalId || '').trim();
  const normalizedSessionTerminalId = String(sessionTerminalId || '').trim();
  if (
    normalizedCurrentTerminalId
    && normalizedSessionTerminalId
    && normalizedCurrentTerminalId !== normalizedSessionTerminalId
  ) {
    return false;
  }

  if (autoLogoutMinutes <= 0) return true;

  const savedAtMs = savedAt ? Date.parse(savedAt) : Number.NaN;
  if (!Number.isFinite(savedAtMs)) return false;
  return Math.max(0, now - savedAtMs) < autoLogoutMinutes * 60 * 1000;
};

