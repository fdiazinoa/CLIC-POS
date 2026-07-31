import { NetworkScanner } from '../services/sync/NetworkScanner';
import { normalizeMasterHost } from './cloudMasterRegistry';

export type LanMasterCandidate = {
  host: string;
  url?: string;
  tenantId?: string;
  terminalId?: string;
  companyName?: string;
};

const resolveExpectedTenantId = (): string => (
  localStorage.getItem('clic_erp_sync_tenant_id')
  || localStorage.getItem('active_tenant_id')
  || localStorage.getItem('clic_tenant_id')
  || ''
).trim();

export const discoverLanMasterCandidates = async (
  options: { expectedTenantId?: string; timeoutMs?: number } = {}
): Promise<LanMasterCandidate[]> => {
  const expectedTenantId = (options.expectedTenantId || resolveExpectedTenantId()).trim();
  const nativeBridge = window.ClicPOSNativePrinter;
  const candidates: LanMasterCandidate[] = [];
  let localIpHint = '';

  if (typeof nativeBridge?.discoverMasterServers === 'function') {
    try {
      const discovery = await nativeBridge.discoverMasterServers({ timeoutMs: options.timeoutMs || 2500 });
      const masters = Array.isArray(discovery?.masters) ? discovery.masters : [];
      masters
        .filter(master => {
          const discoveredTenantId = String(master.tenantId || '').trim();
          return !expectedTenantId || !discoveredTenantId || discoveredTenantId === expectedTenantId;
        })
        .sort((left, right) => {
          const leftMatches = String(left.tenantId || '').trim() === expectedTenantId ? 1 : 0;
          const rightMatches = String(right.tenantId || '').trim() === expectedTenantId ? 1 : 0;
          return rightMatches - leftMatches;
        })
        .forEach(master => {
          const host = normalizeMasterHost(master.host || master.url || '');
          if (!host || candidates.some(candidate => candidate.host === host)) return;
          candidates.push({
            host,
            url: master.url,
            tenantId: master.tenantId,
            terminalId: master.terminalId,
            companyName: master.companyName,
          });
        });
    } catch (error) {
      console.warn('[MASTER_DISCOVERY] Native DNS-SD discovery failed:', error);
    }
  }

  if (candidates.length > 0) return candidates;

  if (typeof nativeBridge?.getDeviceInfo === 'function') {
    try {
      const deviceInfo = await nativeBridge.getDeviceInfo();
      localIpHint = String(deviceInfo?.localIp || deviceInfo?.localIps?.[0] || '');
    } catch {
      localIpHint = '';
    }
  }

  const scannedUrl = await NetworkScanner.findMaster(localIpHint || undefined, expectedTenantId || undefined);
  const scannedHost = normalizeMasterHost(scannedUrl || '');
  return scannedHost ? [{ host: scannedHost, url: scannedUrl || undefined }] : [];
};
