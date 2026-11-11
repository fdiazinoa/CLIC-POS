import { readLargeMasterSyncV3BoundIdentity, validatedLargeMasterSyncV3ErpSyncBase } from '../sync/LargeMasterSyncV3BoundTransport';
import { CouponIssuancePending, createCouponIssuanceClient } from './CouponIssuanceClient';
export const readCouponPrintIdentity = readLargeMasterSyncV3BoundIdentity;

export const acquireReceiptCoupons = createCouponIssuanceClient({
  readIdentity: readLargeMasterSyncV3BoundIdentity,
  request: async (identity, transactionId) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`${validatedLargeMasterSyncV3ErpSyncBase(identity.erpSyncBaseUrl)}/coupon-issuances`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json',
          'X-Sync-Token': identity.syncToken, 'X-Tenant-Id': identity.tenantId,
          'X-Terminal-Id': identity.terminalId, 'X-Device-Id': identity.deviceId,
          'X-POS-Device-Id': identity.deviceId },
        body: JSON.stringify({ transactionId }),
      });
      const text = await response.text();
      if (text.length > 32768) throw new CouponIssuancePending();
      const data = JSON.parse(text);
      if (!response.ok) throw new CouponIssuancePending(typeof data?.code === 'string' ? data.code : undefined);
      return data;
    } catch (error) { throw error instanceof CouponIssuancePending ? error : new CouponIssuancePending(); }
    finally { clearTimeout(timer); }
  },
});
