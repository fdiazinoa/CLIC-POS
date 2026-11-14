/** A response may settle its durable operation after navigation; it may not update the new screen. */
export function createCreditActionBoundary(){
 let key='',alive=true,epoch=0;
 return {
  bind(next:string){if(next!==key){key=next;alive=true;epoch++;}},
  open(expected:string){if(key===expected){alive=true;epoch++;}},
  close(expected:string){if(key===expected){alive=false;epoch++;}},
  capture(){const expected=key,version=epoch;return()=>alive&&key===expected&&epoch===version;},
 };
}
