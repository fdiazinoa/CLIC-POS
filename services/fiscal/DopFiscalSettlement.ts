/** Mirrors the existing POS base selector; conflicting base flags are not a fiscal authority. */
export function configuredFiscalBaseCurrency(config:{currencies?:Array<{code:string;isBase?:boolean}>}):string|undefined {
 const currencies=config.currencies||[],base=currencies.filter(row=>row.isBase);
 if(base.length>1)return undefined;return (base[0]||currencies[0])?.code;
}
/** Validate existing tender DTOs without fetching rates or changing their original fields. */
export function assertDopFiscalSettlement(source:Record<string,any>):void {
 const fail=():never=>{throw Error('FISCAL_WORKFLOW_SETTLEMENT_INVALID');};
 const round=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
 const cents=(value:any):number=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||Math.abs(value-round(value))>.000001)fail();return value;};
 const aliases=(row:Record<string,any>,keys:string[])=>{
  const present=keys.map(key=>row[key]).filter(value=>value!==undefined&&value!==null&&value!=='');
  if(present.some(value=>value!==present[0]))fail();return present[0];
 };
 if(source.currency!==undefined&&source.currency!=='DOP'||source.exchangeRate!==undefined&&source.exchangeRate!==1)fail();
 const total=cents(source.total),pending=cents(source.pendingBalance??0);
 if(!Array.isArray(source.payments)||!source.payments.length)fail();
 let remaining=total,received=0,applied=0,change=0,credit=0;
 const foreign:Array<{code:string;rate:number;original:number}>=[];
 for(const payment of source.payments){
  let code=aliases(payment,['currencyCode','currency_code']);
  // Old kiosks used this field as a display symbol; ISO aliases still must agree.
  if(typeof payment.currency==='string'&&/^[A-Z]{3}$/.test(payment.currency)){
   if(code!==undefined&&code!==payment.currency)fail();code=payment.currency;
  }
  code=code??'DOP';if(typeof code!=='string'||!/^[A-Z]{3}$/.test(code))fail();
  let rate=aliases(payment,['exchangeRate','exchange_rate']);
  if(rate===undefined){if(code!=='DOP')fail();rate=1;}
  if(typeof rate!=='number'||!Number.isFinite(rate)||rate<=0||code==='DOP'&&rate!==1)fail();
  const amount=cents(payment.amount),original=payment.amountOriginal===undefined?code==='DOP'?amount:fail():cents(payment.amountOriginal);
  if(Math.abs(round(original*rate)-amount)>.01)fail();
  const deferred=payment.method==='CREDIT';
  const expectedApplied=deferred?0:round(Math.min(amount,remaining));
  const explicitApplied=aliases(payment,['amountApplied','appliedAmount','applied_amount']);
  if(explicitApplied!==undefined&&(!deferred&&cents(explicitApplied)!==expectedApplied||deferred&&cents(explicitApplied)!==0&&explicitApplied!==amount))fail();
  const expectedChange=deferred?0:round(amount-expectedApplied),explicitChange=aliases(payment,['changeAmount','change_amount']);
  if(explicitChange!==undefined&&cents(explicitChange)!==expectedChange)fail();
  const changeCode=aliases(payment,['changeCurrencyCode','change_currency_code']);
  if(changeCode!==undefined&&changeCode!=='DOP')fail();
  remaining=round(Math.max(0,remaining-amount));
  if(deferred)credit=round(credit+amount);else{
   received=round(received+amount);applied=round(applied+expectedApplied);change=round(change+expectedChange);
   if(code!=='DOP')foreign.push({code,rate,original});
  }
 }
 if(credit!==pending||round(applied+pending)!==total||remaining!==0)fail();
 if(foreign.length&&source.currency!=='DOP')fail();
 const codes=[...new Set(foreign.map(row=>row.code))],rates=[...new Set(foreign.map(row=>row.rate))];
 const expectedCode=codes.length===1?codes[0]:foreign.length?undefined:received>0?'DOP':undefined;
 const expectedRate=codes.length===1&&rates.length===1?rates[0]:!foreign.length&&received>0?1:undefined;
 const expectedOriginal=codes.length===1?round(foreign.reduce((sum,row)=>sum+row.original,0)):!foreign.length&&received>0?received:undefined;
 const summary:[string[],any][]=[
  [['settlementCurrencyCode','settlement_currency_code'],expectedCode],
  [['settlementExchangeRate','settlement_exchange_rate'],expectedRate],
  [['settlementReceivedOriginal','settlement_received_original'],expectedOriginal],
  [['settlementReceivedBase','settlement_received_base'],received],
  [['settlementAppliedBase','settlement_applied_base'],applied],
  [['settlementChangeBase','settlement_change_base'],change],
  [['settlementChangeCurrencyCode','settlement_change_currency_code'],change>0?'DOP':undefined],
 ];
 for(const [keys,expected] of summary){const value=aliases(source,keys);if(value!==undefined&&value!==expected)fail();}
}
