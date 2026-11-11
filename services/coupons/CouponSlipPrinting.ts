import type { BusinessConfig, Transaction } from '../../types';
import { dbAdapter } from '../db';
import { clicAlert } from '../dialog/ClicDialogService';
import { PrintRouterService } from '../printer/PrintRouterService';
import { runPrintTask, PrintOutputError } from '../printer/PrintFeedback';
import { notifyBrowserPrint } from '../printer/BrowserPrint';
import { shouldSuppressBrowserPrintFallback } from '../printer/PrintRuntime';
import { buildEscPosCouponSlipsPayload } from '../printer/EscPosFormatter';
import { fiscalQrSvg } from '../fiscal/FiscalQrSvg';
import { couponSlipsHtml } from '../../utils/couponSlipPresentation';
import { acquireReceiptCoupons, readCouponPrintIdentity } from './CouponIssuanceRuntime';
import { CouponIssuancePending } from './CouponIssuanceClient';

const pending = new Map<string, Promise<boolean>>();

/** A separate artifact: errors here never turn an accepted invoice into a failed sale. */
export function printReceiptCouponSlips(transaction: Transaction, config: BusinessConfig, notifyEmpty = false): Promise<boolean> {
  if (!config.receiptConfig?.printCouponSlip || transaction.documentType !== 'TICKET'
    || transaction.status !== 'COMPLETED') return Promise.resolve(false);
  let identity: ReturnType<typeof readCouponPrintIdentity>;
  try { identity = readCouponPrintIdentity(); }
  catch {
    return clicAlert(new CouponIssuancePending().message, { title: 'Cupón pendiente', tone: 'warning' }).then(() => false);
  }
  const identityProof = JSON.stringify(identity);
  const assertIdentity = () => { if (JSON.stringify(readCouponPrintIdentity()) !== identityProof) throw new CouponIssuancePending(); };
  const key = JSON.stringify([identity.erpSyncBaseUrl, identity.tenantId, identity.terminalId, identity.deviceId, transaction.id]);
  const existing = pending.get(key);
  if (existing) return existing;
  const task = (async () => {
    try {
      const durable = await dbAdapter.getDocument<Transaction>('transactions', transaction.id)
        || await dbAdapter.getDocument<Transaction>('transactionHistory', transaction.id);
      if (!durable) throw new CouponIssuancePending();
      // Fetch outside the print critical-operation gate: synchronisation must be
      // free to confirm the sale while optional coupon issuance is being resolved.
      const issued = await acquireReceiptCoupons(durable);
      assertIdentity();
      if (!issued.coupons.length) {
        if (notifyEmpty) await clicAlert('Esta compra no generó un cupón elegible.', { title: 'Cupón', tone: 'info' });
        return true;
      }
      const escPosBase64 = buildEscPosCouponSlipsPayload(issued, config)!;
      return await runPrintTask(`coupon-slip:${key}`, 'Cupón', async () => {
        assertIdentity();
        const job = { config, role: 'TICKET' as const, terminalId: durable.terminalId,
          jobType: 'TICKET' as const, referenceId: `coupon-slip:${key}`, copies: 1 };
        if (await PrintRouterService.routeAndPrintEscPos({ ...job, escPosBase64 })) return true;
        if (!shouldSuppressBrowserPrintFallback()) {
          const html = await couponSlipsHtml(issued, config.companyInfo?.name || '', code => fiscalQrSvg(code, 120));
          assertIdentity();
          if (await PrintRouterService.routeAndPrintHtml({ ...job, html })) return true;
          assertIdentity();
          const printWindow = window.open('', '_blank', 'width=400,height=600');
          if (!printWindow) throw new PrintOutputError('POPUP_BLOCKED');
          printWindow.document.write(html);
          printWindow.document.close();
          printWindow.focus();
          printWindow.print();
          notifyBrowserPrint();
          return true;
        }
        return false;
      });
    } catch (error) {
      await clicAlert(error instanceof CouponIssuancePending ? error.message : new CouponIssuancePending().message, { title: 'Cupón pendiente', tone: 'warning' });
      return false;
    }
  })();
  pending.set(key, task);
  void task.finally(() => { if (pending.get(key) === task) pending.delete(key); }).catch(() => undefined);
  return task;
}
