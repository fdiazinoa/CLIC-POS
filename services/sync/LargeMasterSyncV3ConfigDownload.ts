import { largeMasterSyncV3DownloadOrigin } from './LargeMasterSyncV3DownloadOrigin';

/** Only this configuration GET uses the download authority; ACK/auth routes remain independent. */
export const fetchLargeMasterSyncV3ConfigSnapshot = (
  path: string, authBase: string, headers: Record<string, string>, v3Authority: boolean,
  downloadOrigin?: string, fetchImpl: typeof fetch = fetch,
): Promise<Response> => fetchImpl(`${v3Authority
  ? `${largeMasterSyncV3DownloadOrigin(downloadOrigin)}/api/sync` : authBase}${path}`, {
  method: 'GET', headers: { 'Content-Type': 'application/json', ...headers,
    ...(v3Authority ? { 'X-POS-Capabilities': 'largeMasterSyncV3' } : {}) },
  ...(v3Authority ? { redirect: 'error' as const } : {}),
});
