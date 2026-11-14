import type {Transaction} from '../../types';

/** Retains the ordinary B01/B02 checkout draft across a lost create/commit response.
 * A changed cart/payment cannot silently take over an unresolved fiscal attempt. */
export class LegacyFiscalCheckoutAttempt {
 private attempt?:{identity:string;promise:Promise<Transaction>};
 resume(identity:string):Promise<Transaction>|undefined {
  if(this.attempt&&this.attempt.identity!==identity)throw Error('LEGACY_FISCAL_RETRY_CHANGED: Hay un cobro pendiente. Reintenta con los mismos artículos, cliente y pagos.');
  return this.attempt?.promise;
 }
 create(identity:string,factory:()=>Promise<Transaction>):Promise<Transaction>{
  const pending=this.resume(identity);if(pending)return pending;
  const promise=Promise.resolve().then(factory);
  this.attempt={identity,promise};
  // Draft creation performs no financial persistence in this path. A definite
  // creation failure may be corrected; a watchdog never rejects this promise.
  void promise.catch(()=>{if(this.attempt?.promise===promise)this.attempt=undefined;});
  return promise;
 }
 retain(identity:string,transaction:Transaction):void {
  this.resume(identity);this.attempt={identity,promise:Promise.resolve(transaction)};
 }
 complete(identity:string):void {
  if(this.attempt?.identity===identity)this.attempt=undefined;
 }
}
