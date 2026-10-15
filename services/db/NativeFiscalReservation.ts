import type {BusinessConfig,LocalFiscalBuffer} from '../../types';
import type {FormatStatement} from '../articleFormats/store';

export const NATIVE_FISCAL_HISTORY_FIELDS=['ncf','legacyNcf','electronicNcf','fiscalCertifiedNcf','articleFormatWire.fiscal.ncf'] as const;
export const NATIVE_FISCAL_RECEIPTS_SCHEMA=`
CREATE TABLE IF NOT EXISTS article_format_wire_write_scope (id INTEGER PRIMARY KEY CHECK(id=1));
${NATIVE_FISCAL_HISTORY_FIELDS.map((field,index)=>`CREATE INDEX IF NOT EXISTS idx_documents_fiscal_history_${index} ON documents(UPPER(TRIM(json_extract(data,'$.${field}'))))
 WHERE collection_name IN ('transactions','transactionHistory') AND json_extract(data,'$.${field}') IS NOT NULL;`).join('\n')}
CREATE INDEX IF NOT EXISTS idx_documents_native_fiscal_receipt_ncf ON documents(json_extract(data,'$.ncf'))
 WHERE collection_name='nativeFiscalReservations';
CREATE TRIGGER IF NOT EXISTS native_fiscal_receipt_insert BEFORE INSERT ON documents
WHEN NEW.collection_name='nativeFiscalReservations' AND NOT EXISTS (SELECT 1 FROM article_format_wire_write_scope)
BEGIN SELECT RAISE(ABORT,'NATIVE_FISCAL_RECEIPT_TYPED_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS native_fiscal_receipt_update BEFORE UPDATE ON documents
WHEN OLD.collection_name='nativeFiscalReservations' OR NEW.collection_name='nativeFiscalReservations'
BEGIN SELECT RAISE(ABORT,'NATIVE_FISCAL_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS native_fiscal_receipt_delete BEFORE DELETE ON documents
WHEN OLD.collection_name='nativeFiscalReservations'
BEGIN SELECT RAISE(ABORT,'NATIVE_FISCAL_RECEIPT_IMMUTABLE'); END;
`;

type Query=<T>(sql:string,values:(string|number|null)[])=>Promise<T[]>;
export const fiscalIssuerRnc=(business:BusinessConfig):string|undefined=>{
 const raw=String(business.companyInfo?.rnc || '').trim();
 if(!/^[\d\s.-]+$/.test(raw))return undefined;
 const value=raw.replace(/[\s.-]/g,'');
 return /^(?:\d{9}|\d{11})$/.test(value) ? value : undefined;
};

/** Exact expressions/predicates shared by schema, planner and query-plan tests. */
export function fiscalHistoricalCollisionQuery(field:typeof NATIVE_FISCAL_HISTORY_FIELDS[number],knownIssuer:boolean):string {
 return `SELECT d.doc_id FROM documents d WHERE d.collection_name IN ('transactions','transactionHistory')
  AND json_extract(d.data,'$.${field}') IS NOT NULL AND UPPER(TRIM(json_extract(d.data,'$.${field}')))=? ${knownIssuer?`AND (
    json_extract(d.data,'$.fiscalIssuerRnc')=? OR NOT EXISTS (SELECT 1 FROM documents receipt
     WHERE receipt.collection_name='nativeFiscalReservations'
     AND receipt.doc_id=json_array('DOMINICAN_LEGACY_B',json_extract(d.data,'$.fiscalIssuerRnc'),?)
     AND json_extract(receipt.data,'$.transactionId')=d.doc_id))`:''} LIMIT 1`;
}

/** Additive local issuance receipt, through the existing financial SQL unit of work. No transport or second queue. */
export async function planNativeFiscalReceipt(query:Query,business:BusinessConfig,buffer:LocalFiscalBuffer,ncf:string,
 options:{eventId?:string;transactionId?:string;requireIssuer:boolean;occurredAt?:string}):Promise<{statement:FormatStatement;issuerRnc:string|undefined;id:string}> {
 const issuerRnc=fiscalIssuerRnc(business);
 if(!issuerRnc&&options.requireIssuer)throw new Error('NATIVE_FISCAL_ISSUER_UNPROVEN');
 ncf=ncf.trim().toUpperCase();
 if(!/^B(?:01|02|04|14|15)\d{8}$/.test(ncf))throw new Error('NATIVE_FISCAL_NUMBER_INVALID');
 const id=JSON.stringify(issuerRnc?['DOMINICAN_LEGACY_B',issuerRnc,ncf]:['UNATTRIBUTED_NCF_CLAIM_V1',ncf]);
 const existing=await query(`SELECT doc_id FROM documents WHERE collection_name='nativeFiscalReservations'
  AND json_extract(data,'$.ncf')=? ${issuerRnc?"AND (json_extract(data,'$.issuerRnc') IS NULL OR json_extract(data,'$.issuerRnc')=?)":''} LIMIT 1`,issuerRnc?[ncf,issuerRnc]:[ncf]);
 if(existing.length)throw new Error('NATIVE_FISCAL_NUMBER_ALREADY_ISSUED');
 // No backfill: a historical NCF with unknown/unproven frozen issuer is not permission to reuse a number.
 for(const field of NATIVE_FISCAL_HISTORY_FIELDS){
  const rows=await query(fiscalHistoricalCollisionQuery(field,Boolean(issuerRnc)),issuerRnc?[ncf,issuerRnc,ncf]:[ncf]);
  if(rows.length)throw new Error('NATIVE_FISCAL_HISTORICAL_COLLISION');
 }
 const terminal=business.terminals?.find(t=>t.id===buffer.terminalId || t.config?.erpTerminalId===buffer.terminalId);
 const receipt={id,issuerRnc:issuerRnc || null,identityStatus:issuerRnc?'PROVEN_ISSUER_RNC':'UNATTRIBUTED_LEGACY',ncf,
  prefix:buffer.prefix,number:Number(ncf.slice(buffer.prefix.length)),
  tenantId:terminal?.config?.erpBinding?.tenantId || null,companyId:terminal?.config?.erpBinding?.companyId || null,
  terminalId:buffer.terminalId,allocationId:buffer.allocationId,fiscalRangeId:buffer.fiscalRangeId,
  eventId:options.eventId || null,transactionId:options.transactionId || null,issuedAt:options.occurredAt || new Date().toISOString()};
 return {id,issuerRnc,statement:{statement:'INSERT INTO documents(collection_name,doc_id,data,sort_order,updatedAt) VALUES(?,?,?,?,?)',
  values:['nativeFiscalReservations',id,JSON.stringify(receipt),0,receipt.issuedAt]}};
}
