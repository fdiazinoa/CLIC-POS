/** Share only the same in-flight discovery across effect replay. No authority cache or retry loop. */
export function createFiscalFormatPreparation<T>(){
 const pending=new Map<string,Promise<T>>();
 return (context:string,prepare:()=>Promise<T>):Promise<T>=>{
  const existing=pending.get(context);if(existing)return existing;
  const operation=Promise.resolve().then(prepare).finally(()=>{if(pending.get(context)===operation)pending.delete(context);});
  pending.set(context,operation);return operation;
 };
}

/** Actionable UI guidance; retain only a bounded diagnostic code, never a raw server message. */
export function fiscalFormatPreparationProblem(error:unknown):{message:string;code:string}{
 const raw=error instanceof Error?error.message:String(error||'');
 const code=/^[A-Z][A-Z0-9_]{2,95}$/.test(raw)?raw:'FORMAT_PREPARATION_UNAVAILABLE';
 const reason=raw.toUpperCase();
 if(/EXPIRED|SESSION|AUTHENTICAT|TERMINAL_AUTH|REAUTH/.test(reason))return {code,message:'Valida la sesión de esta caja y vuelve a intentar cargar las presentaciones.'};
 if(/FLAG.*DISABLED|DISABLED.*FLAG|COMPANY.*DISABLED|ARTICLE_FORMATS_DISABLED/.test(reason))return {code,message:'Las presentaciones están deshabilitadas para esta empresa. Habilítalas en el ERP antes de reintentar.'};
 if(/GRANT|SCOPE|CAPABILITY|ERP_FLAG|HTTP404/.test(reason))return {code,message:'Presentaciones pendientes de habilitación en el ERP para esta caja. Reintenta cuando se complete la habilitación.'};
 if(/NETWORK|OFFLINE|TIMEOUT|TIMED.?OUT|FETCH|CONNECTION|HTTP500/.test(reason))return {code,message:'No se pudieron cargar las presentaciones. Revisa la conexión y vuelve a intentar.'};
 return {code,message:'Los datos de presentaciones están incompletos o no se pudieron verificar. Vuelve a intentar la sincronización.'};
}
