import type { CouponIssuanceEnvelope, IssuedCouponSlip } from '../services/coupons/CouponIssuanceClient';

export function couponSlipLines(coupon: IssuedCouponSlip, receiptReference: string, now = Date.now()): string[] {
  return [coupon.campaignName, `${coupon.benefitValue}% de descuento en su proxima compra`,
    `Codigo: ${coupon.code}`, `Valido desde: ${new Date(coupon.validFrom).toISOString().replace('T', ' ')}`,
    `Vence: ${new Date(coupon.expiresAt).toISOString().replace('T', ' ')}`,
    ...(Date.parse(coupon.expiresAt) <= now ? ['CUPON VENCIDO - NO CANJEABLE'] : []),
    `Compra origen: ${receiptReference}`, 'Conserve este cupon y escanee su QR al canjearlo.'];
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
export async function couponSlipsHtml(result: CouponIssuanceEnvelope, companyName: string, qrSvg: (code: string) => Promise<string>, now = Date.now()): Promise<string> {
  const slips = await Promise.all(result.coupons.map(async coupon => `<section><h2>CUPON PROXIMA COMPRA</h2><b>${escapeHtml(companyName)}</b>${couponSlipLines(coupon, result.receiptReference, now).map(line => `<p>${escapeHtml(line)}</p>`).join('')}<div>${await qrSvg(coupon.code)}</div><p>COLETILLA SEPARADA</p></section>`));
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cupones</title><style>@page{margin:4mm}body{font:12px monospace;text-align:center}section{break-after:page;page-break-after:always}section:last-child{break-after:auto;page-break-after:auto}svg{width:120px;height:120px}p{overflow-wrap:anywhere}</style></head><body>${slips.join('')}</body></html>`;
}
