import { ARTICLE_FORMATS_READINESS, formatsNegotiated } from './activation';
import { ArticleFormatNetworkMaster } from './networkMaster';
import { ArticleFormatPosting, drainFormatWireEvents } from './posting';
import type { FormatSQL } from './store';
import { requireFormat, validateContext, type FormatTransport } from './wire';

/** Operational entry point. No flag/capability can bypass the closed integral readiness. */
export async function openArticleFormatsRuntime(sql:FormatSQL,transport:FormatTransport,config:{featureFlags?:{ARTICLE_FORMATS?:boolean}},terminal:{id:string;capabilities?:{article_formats?:number}}){
 requireFormat(formatsNegotiated(config,terminal,ARTICLE_FORMATS_READINESS),'POS_ARTICLE_FORMATS_NOT_NEGOTIATED');
 return prepareArticleFormatsAdapters(sql,transport,terminal.id);
}
/** Adapter construction for isolated contract validation; does not set or advertise operational readiness. */
export async function prepareArticleFormatsAdapters(sql:FormatSQL,transport:FormatTransport,terminalId:string){
 const context=validateContext(await transport.request('/api/sync/article-formats/v1/negotiate',{}));
 requireFormat(context.scope.terminalId===terminalId,'POS_FORMAT_SCOPE_FORBIDDEN');
 const masters=new ArticleFormatNetworkMaster(sql,context,transport),posting=new ArticleFormatPosting(sql,context,masters);
 await masters.migrate();await posting.migrate();
 return {context,masters,posting,drain:()=>drainFormatWireEvents(posting,transport)};
}

/** V2 construction uses its own server authority and never changes readiness V1. */
export async function prepareArticleFormatsAdaptersV2(sql:FormatSQL,transport:FormatTransport,terminalId:string,hooks:import('./financialV2').FormatPostingV2Hooks){
 const {validateContextV2}=await import('./v2');
 const context=validateContextV2(await transport.request('/api/sync/article-formats/v2/negotiate',{}));
 requireFormat(context.scope.terminalId===terminalId,'POS_FORMAT_SCOPE_FORBIDDEN');
 const masters=new ArticleFormatNetworkMaster(sql,context,transport),posting=new ArticleFormatPosting(sql,context,masters,hooks);
 await masters.migrate();await posting.migrate();
 return {context,masters,posting,drain:()=>drainFormatWireEvents(posting,transport),readiness:()=>import('./financialV2').then(m=>m.getArticleFormatReadinessV2(sql,context))};
}
