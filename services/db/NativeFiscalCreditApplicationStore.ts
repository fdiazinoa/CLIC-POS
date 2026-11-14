import {createUuid} from '../../utils/uuid';
import {assertReturnPreparation,returnJSON,returnNeed,sameReturn} from '../fiscal/FiscalReturnV1';
import type {FiscalWorkflowScope} from '../fiscal/FiscalWorkflowV2Types';
export interface CreditCommand {schemaVersion:1;operationId:string;customerId:string;invoiceId:string;amount:number;}
export interface CreditReceipt extends CreditCommand {currency:'DOP';destination:'INVOICE_DEBT';walletBalance:number;receiptEntryId:string;accountingEntryId:string;}
export interface CreditAttempt {id:string;serverOrigin:string;scope:FiscalWorkflowScope;target:string;commandBytes:string;receipt?:CreditReceipt;projectionRefreshedAt?:string;}
type SQL={query:(sql:string,values?:any[])=>Promise<{values?:any[]}>;run:(sql:string,values?:any[],transaction?:boolean)=>Promise<any>};
export const FISCAL_CREDIT_APPLICATION_SCHEMA=`
CREATE TABLE IF NOT EXISTS pos_fiscal_credit_applications_v1(id TEXT PRIMARY KEY,target TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pos_fiscal_credit_current_v1(target TEXT PRIMARY KEY,operation_id TEXT NOT NULL REFERENCES pos_fiscal_credit_applications_v1(id));
CREATE TRIGGER IF NOT EXISTS pos_credit_identity_v1 BEFORE UPDATE ON pos_fiscal_credit_applications_v1 WHEN OLD.id IS NOT NEW.id OR OLD.target IS NOT NEW.target OR json_extract(OLD.data,'$.serverOrigin') IS NOT json_extract(NEW.data,'$.serverOrigin') OR json_extract(OLD.data,'$.scope') IS NOT json_extract(NEW.data,'$.scope') OR json_extract(OLD.data,'$.commandBytes') IS NOT json_extract(NEW.data,'$.commandBytes') OR json_extract(OLD.data,'$.receipt') IS NOT NULL AND json_extract(OLD.data,'$.receipt') IS NOT json_extract(NEW.data,'$.receipt') BEGIN SELECT RAISE(ABORT,'FISCAL_RETURN_CREDIT_IDENTITY_CONFLICT');END;
CREATE TRIGGER IF NOT EXISTS pos_credit_no_delete_v1 BEFORE DELETE ON pos_fiscal_credit_applications_v1 BEGIN SELECT RAISE(ABORT,'FISCAL_RETURN_CREDIT_RECOVERY_REQUIRED');END;
`;
export class NativeFiscalCreditApplicationStore {
 constructor(private sql:()=>SQL,private locked:<T>(work:()=>Promise<T>)=>Promise<T>,private transaction:<T>(work:()=>Promise<T>)=>Promise<T>){}
 private target(scope:FiscalWorkflowScope,customerId:string,invoiceId:string){return returnJSON([scope,customerId,invoiceId]);}
 private async read(target:string):Promise<CreditAttempt|null>{const row=(await this.sql().query('SELECT a.data FROM pos_fiscal_credit_current_v1 c JOIN pos_fiscal_credit_applications_v1 a ON a.id=c.operation_id WHERE c.target=?',[target])).values?.[0];return row?JSON.parse(row.data):null;}
 current(scope:FiscalWorkflowScope,customerId:string,invoiceId:string){return this.locked(()=>this.read(this.target(scope,customerId,invoiceId)));}
 begin(scope:FiscalWorkflowScope,customerId:string,invoiceId:string,amount:number,newConsumption=false,serverOrigin=''){return this.transaction(async()=>{
  const target=this.target(scope,customerId,invoiceId),old=await this.read(target);
  if(old&&!newConsumption)return old;
  if(old)returnNeed(old.receipt&&old.projectionRefreshedAt,'FISCAL_RETURN_CREDIT_RECOVERY_REQUIRED');
  const id=createUuid(),command:CreditCommand={schemaVersion:1,operationId:id,customerId,invoiceId,amount};
  const a:CreditAttempt={id,serverOrigin,scope,target,commandBytes:JSON.stringify(command)};
  await this.sql().run('INSERT INTO pos_fiscal_credit_applications_v1 VALUES(?,?,?)',[id,target,JSON.stringify(a)],false);
  await this.sql().run('INSERT OR REPLACE INTO pos_fiscal_credit_current_v1 VALUES(?,?)',[target,id],false);return a;
 });}
 complete(expected:CreditAttempt,receipt:CreditReceipt){return this.transaction(async()=>{
  const a=await this.read(expected.target);returnNeed(a&&a.id===expected.id&&a.commandBytes===expected.commandBytes,'FISCAL_RETURN_CREDIT_IDENTITY_CONFLICT');
  if(a!.receipt){returnNeed(sameReturn(a!.receipt,receipt),'FISCAL_RETURN_CREDIT_IDENTITY_CONFLICT');return a!;}
  const next={...a!,receipt};await this.sql().run('UPDATE pos_fiscal_credit_applications_v1 SET data=? WHERE id=?',[JSON.stringify(next),next.id],false);return next;
 });}
 private async publish(expectedCustomer:any,expectedWallet:any,nextCustomer:any,wallet:any,assertCurrent:()=>void){
  assertCurrent();const row=(await this.sql().query("SELECT data FROM documents WHERE collection_name='customers' AND doc_id=?",[nextCustomer.id])).values?.[0];
  returnNeed(sameReturn(row?JSON.parse(row.data):null,expectedCustomer),'FISCAL_RETURN_CUSTOMER_PROJECTION_PENDING');
  const aliases=[nextCustomer.id,nextCustomer.source_customer_id,nextCustomer.sourceCustomerId].filter(Boolean);
  const pending=(await this.sql().query("SELECT data FROM documents WHERE collection_name='customerMutations'")).values||[];
  returnNeed(!pending.some(r=>{const m=JSON.parse(r.data);return aliases.includes(m.customerId)&&!['SYNCED_ACTIVE','SYNCED_MASTER','COMPLETED'].includes(m.syncStatus); }),'FISCAL_RETURN_CUSTOMER_PROJECTION_PENDING');
  const walletRows=(await this.sql().query("SELECT data FROM documents WHERE collection_name='wallets'")).values||[];
  const owned=walletRows.map(r=>JSON.parse(r.data)).filter(w=>aliases.includes(w.customerId));
  returnNeed(wallet?owned.length<=1&&owned.every(w=>w.id===wallet.id):owned.length===0,'FISCAL_RETURN_CUSTOMER_PROJECTION_PENDING');
  const walletRow=wallet&&walletRows.find(r=>JSON.parse(r.data).id===wallet.id);
  returnNeed(sameReturn(walletRow?JSON.parse(walletRow.data):null,expectedWallet),'FISCAL_RETURN_CUSTOMER_PROJECTION_PENDING');
  const walletPending=(await this.sql().query("SELECT data FROM documents WHERE collection_name='wallet_transactions'")).values||[];
  returnNeed(!walletPending.some(r=>{const m=JSON.parse(r.data);return((wallet&&[wallet.id,wallet.erpWalletId].includes(m.walletId))||aliases.includes(m.customerId))&&!['SYNCED_ACTIVE','SYNCED_MASTER','COMPLETED','APPLIED_ERP'].includes(m.syncStatus); }),'FISCAL_RETURN_CUSTOMER_PROJECTION_PENDING');
  const now=new Date().toISOString();
  for(const [collection,document]of (wallet?[['customers',nextCustomer],['wallets',wallet]]:[['customers',nextCustomer]]) as Array<[string,any]>)await this.sql().run('INSERT OR REPLACE INTO documents(collection_name,doc_id,data,sort_order,updatedAt)VALUES(?,?,?,0,?)',[collection,document.id,JSON.stringify(document),now],false);
  assertCurrent();return now;
 }
 refreshProjection(a:CreditAttempt,expectedCustomer:any,expectedWallet:any,nextCustomer:any,wallet:any,assertCurrent:()=>void){return this.transaction(async()=>{
  const stored=await this.read(a.target);returnNeed(stored?.id===a.id&&stored.receipt,'FISCAL_RETURN_CREDIT_RECOVERY_REQUIRED');
  const now=await this.publish(expectedCustomer,expectedWallet,nextCustomer,wallet,assertCurrent);
  const next={...stored!,projectionRefreshedAt:now};await this.sql().run('UPDATE pos_fiscal_credit_applications_v1 SET data=? WHERE id=?',[JSON.stringify(next),next.id],false);return next;
 });}
 refreshReturnProjection(request:any,expectedCustomer:any,expectedWallet:any,nextCustomer:any,wallet:any,assertCurrent:()=>void){return this.transaction(async()=>{
  const row=(await this.sql().query("SELECT data FROM pos_fiscal_return_attempts_v1 WHERE transaction_id=? AND phase='COMMITTED'",[request.transactionId])).values?.[0];
  returnNeed(row,'FISCAL_RETURN_COMMIT_RECEIPT_REQUIRED');const a=JSON.parse(row.data);await assertReturnPreparation(a.preparation,a);
  returnNeed(sameReturn(a.scope,request.scope)&&a.preparation.returnSnapshot.settlement?.customerId===nextCustomer.id,'FISCAL_RETURN_CUSTOMER_SCOPE_REQUIRED');
  const source=(await this.sql().query("SELECT data FROM documents WHERE collection_name='transactionHistory' AND doc_id=?",[request.transactionId])).values?.[0];
  returnNeed(source&&JSON.parse(source.data).syncStatus==='APPLIED_ERP','FISCAL_RETURN_COMMIT_RECEIPT_REQUIRED');
  const now=await this.publish(expectedCustomer,expectedWallet,nextCustomer,wallet,assertCurrent);
  await this.sql().run("UPDATE documents SET data=?,updatedAt=? WHERE collection_name='fiscalReturnProjectionRequests' AND doc_id=?",[JSON.stringify({...request,state:'REFRESHED',refreshedAt:now}),now,request.id],false);
 });}
}
