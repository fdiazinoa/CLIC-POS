/** Share only the same in-flight discovery across effect replay. No authority cache or retry loop. */
export function createFiscalFormatPreparation<T>(){
 const pending=new Map<string,Promise<T>>();
 return (context:string,prepare:()=>Promise<T>):Promise<T>=>{
  const existing=pending.get(context);if(existing)return existing;
  const operation=Promise.resolve().then(prepare).finally(()=>{if(pending.get(context)===operation)pending.delete(context);});
  pending.set(context,operation);return operation;
 };
}
