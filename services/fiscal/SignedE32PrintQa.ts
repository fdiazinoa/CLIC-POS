import type { BusinessConfig, Transaction } from '../../types';
import { buildSignedE32QaTicketPayload } from '../printer/EscPosFormatter';
import { PrintRouterService } from '../printer/PrintRouterService';
import { validateDgiiPrintContext } from './FiscalPrintEvidence';

export interface SignedE32QaInput {
  ecf: string;
  rfce: string;
  dispatch?: boolean;
}

const ISSUER = '999999999';
const NCF = 'E320000000001';
const XMLDSIG = 'http://www.w3.org/2000/09/xmldsig#';

function readFixture(base64: string, root: string): Document {
  const decoded = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(decoded), 'application/xml');
  if (xml.documentElement.localName !== root
    || xml.getElementsByTagNameNS(XMLDSIG, 'Signature').length !== 1
    || xml.querySelector('IdDoc > eNCF')?.textContent !== NCF
    || xml.querySelector('Emisor > RNCEmisor')?.textContent !== ISSUER
    || xml.querySelector('Totales > MontoTotal')?.textContent !== '192.00') {
    throw new Error('QA_SIGNED_FIXTURE_MISMATCH');
  }
  return xml;
}

/** Hardware smoke test. Inputs come from verified synthetic Android instrumentation fixtures. */
export async function printSignedE32Qa(input: SignedE32QaInput, config: BusinessConfig, terminalId: string) {
  const start = performance.now();
  const ecf = readFixture(input.ecf, 'ECF');
  const rfce = readFixture(input.rfce, 'RFCE');
  const signature = ecf.getElementsByTagNameNS(XMLDSIG, 'SignatureValue').item(0);
  const securityCode = signature?.textContent?.trim().slice(0, 6);
  const signedAt = ecf.querySelector('FechaHoraFirma')?.textContent;
  if (!securityCode || !signedAt || rfce.querySelector('CodigoSeguridadeCF')?.textContent !== securityCode) {
    throw new Error('QA_SIGNED_FIXTURE_CODE_MISMATCH');
  }

  const transaction: Transaction = {
    id: 'SIGNED-E32-QA',
    date: '2026-11-25T10:00:00-04:00',
    total: 192,
    status: 'COMPLETED',
    ncfType: 'E32',
    ncf: NCF,
    terminalId,
    userId: 'QA',
    userName: 'QA',
    items: [{
      id: 'QA',
      cartId: 'QA',
      name: 'Articulo sintetico QA',
      category: 'QA',
      price: 192,
      quantity: 1,
      taxable: false,
      images: [],
      attributes: [],
      variants: [],
      tariffs: [],
      appliedTaxIds: [],
    }],
    payments: [{ method: 'Efectivo', amount: 192 }],
  };
  const printConfig: BusinessConfig = {
    ...config,
    companyInfo: { name: 'PRUEBA QA', rnc: ISSUER, address: 'SIN VALIDEZ FISCAL', phone: '' },
    receiptConfig: { ...config.receiptConfig, showQr: false, footerMessage: 'SIN VALIDEZ FISCAL' },
  };
  const qr = new URL('https://fc.dgii.gov.do/TesteCF/ConsultaTimbreFC');
  qr.search = new URLSearchParams({
    RncEmisor: ISSUER, eNCF: NCF, MontoTotal: '192.00', CodigoSeguridad: securityCode,
  }).toString();
  const evidence = validateDgiiPrintContext({
    issuerRnc: ISSUER, ncf: NCF, environment: 0,
    evidence: { schemaVersion: 1, qrUrl: qr.href, securityCode, signedAt },
  }, transaction);
  const escPosBase64 = evidence && buildSignedE32QaTicketPayload(transaction, printConfig, evidence);
  if (!escPosBase64) throw new Error('QA_SIGNED_TICKET_RENDER_FAILED');
  const payload = atob(escPosBase64);
  const qrStore = '\x1d(k' + String.fromCharCode((qr.href.length + 3) % 256, Math.floor((qr.href.length + 3) / 256)) + '1P0';
  if (!payload.includes(qrStore + qr.href + '\x1d(k\x03\x001Q0')
    || !payload.includes(NCF) || !payload.includes('Codigo de seguridad: ' + securityCode)
    || !payload.includes('SIN VALIDEZ FISCAL')) {
    throw new Error('QA_SIGNED_TICKET_PAYLOAD_MISMATCH');
  }
  const renderMs = Math.round(performance.now() - start);
  const beforePrint = performance.now();
  const dispatched = input.dispatch ? await PrintRouterService.routeAndPrintEscPos({
    config: printConfig, escPosBase64, role: 'TICKET', jobType: 'TICKET',
    terminalId, referenceId: transaction.id, copies: 1,
  }) : false;
  return { ncf: NCF, securityCode, signedAt, qr: qr.href, renderMs, dispatched,
    dispatchMs: input.dispatch ? Math.round(performance.now() - beforePrint) : null,
    acknowledgedAt: dispatched ? Date.now() : null,
  };
}
