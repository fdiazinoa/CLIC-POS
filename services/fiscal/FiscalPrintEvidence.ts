import type {Transaction} from '../../types';
import {verifyFiscalStatusProof,type FiscalStatusProof,sameFiscalNcf} from './FiscalStatusProof';
export interface FiscalPrintEvidence {schemaVersion:1;qrUrl:string;securityCode:string;signedAt:string}
export interface FiscalPrintDisplay extends FiscalPrintEvidence {certifiedNcf:string;dgiiAccepted:boolean}
const verified=new WeakSet<object>();
export const isVerifiedFiscalPrintDisplay=(value:FiscalPrintDisplay|undefined):value is FiscalPrintDisplay=>Boolean(value&&verified.has(value));
/** DGII URL is kept byte-for-byte. Never synthesize a stamp or a security value. */
export const fiscalCivilDate=(value:string):string=>{
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value.split('-').reverse().join('-');
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';
 return new Intl.DateTimeFormat('en-GB',{timeZone:'America/Santo_Domingo',day:'2-digit',month:'2-digit',year:'numeric'}).format(date).replace(/\//g,'-');
};
export const validateDgiiPrintEvidence=(proof:FiscalStatusProof,tx:Transaction):FiscalPrintDisplay|undefined=>{
 const evidence=proof.providerReceipt?.printEvidence;
 if(!evidence||evidence.schemaVersion!==1||typeof evidence.qrUrl!=='string'||evidence.qrUrl.length>4096
   ||typeof evidence.securityCode!=='string'||!/^[A-Za-z0-9+/=]{6}$/.test(evidence.securityCode)
   ||typeof evidence.signedAt!=='string'||!/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(evidence.signedAt))return;
 const ncf=proof.providerReceipt.returnedNcf;
 if(!/^E(?:31|32|34|44|45)\d{10}$/.test(ncf)||!sameFiscalNcf(ncf,tx.electronicNcf||tx.ncf))return;
 let url:URL;try{url=new URL(evidence.qrUrl);}catch{return;}
 const environmentPath=({0:'testecf',1:'certecf',2:'ecf'} as Record<number,string>)[proof.issuer.environment];
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!environmentPath)return;
 const consumer=tx.ncfType==='E32'&&Math.abs(tx.total)<250000;
 if(url.hostname!==(consumer?'fc.dgii.gov.do':'ecf.dgii.gov.do')
   ||url.pathname.toLowerCase()!==`/${environmentPath}/${consumer?'consultatimbrefc':'consultatimbre'}`)return;
 const params=new Map<string,string>();
 for(const [key,value] of url.searchParams){const normalized=key.toLowerCase();if(params.has(normalized))return;params.set(normalized,value);}
 const allowed=consumer?['rncemisor','encf','montototal','codigoseguridad']:['rncemisor','rnccomprador','encf','fechaemision','montototal','fechafirma','codigoseguridad'];
 if([...params.keys()].some(key=>!allowed.includes(key))||allowed.some(key=>!params.has(key)))return;
 const amount=params.get('montototal')!;
 if(params.get('rncemisor')!==proof.issuer.rnc||params.get('encf')!==ncf||params.get('codigoseguridad')!==evidence.securityCode
   ||!/^\d+(?:\.\d{1,2})?$/.test(amount)||Math.abs(Number(amount)-Math.abs(tx.total))>=0.005)return;
 if(!consumer){
   const buyer=String(tx.customerSnapshot?.taxId||'').replace(/\D/g,'');
   const date=fiscalCivilDate(tx.date);
   if(!buyer||params.get('rnccomprador')!==buyer||params.get('fechaemision')!==date||params.get('fechafirma')!==evidence.signedAt)return;
 }
 return {...evidence,certifiedNcf:ncf,dgiiAccepted:false};
};
/** This proof authorizes printing signed evidence, independently of DGII acceptance. */
export const resolveFiscalPrintDisplay=async(tx:Transaction):Promise<FiscalPrintDisplay|undefined>=>{
 const proof=tx.fiscalPrintProof || tx.fiscalStatusProof;
 const scope=tx.fiscalPrintScope||tx.fiscalSubmissionScope||tx.fiscalLookupApproval;
 if(!proof||!scope||!['ACCEPTED','PENDING'].includes(proof.decision)||!await verifyFiscalStatusProof(proof,scope,tx,false))return;
 const display=validateDgiiPrintEvidence(proof,tx);
 if(display){display.dgiiAccepted=await verifyFiscalStatusProof(proof,scope,tx) || Boolean(tx.fiscalStatusProof&&await verifyFiscalStatusProof(tx.fiscalStatusProof,scope,tx));verified.add(display);}
 return display;
};
