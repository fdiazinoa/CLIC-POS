/** Exact laboratory-only HTTP boundary; no proxy, fallback, redirects or production origin. */
export const LAB_ERP_ORIGIN='http://127.0.0.1:18765';
export function assertLabRequest(value:string,method='GET'):URL {
 const url=new URL(value);
 const methods:Record<string,string>={'/__lab/health':'GET','/__lab/metrics':'GET','/__lab/inbox':'POST','/api/fiscal/v2/documents/applied-receipt':'GET','/api/fiscal/documents/issue':'POST'};
 if(url.origin!==LAB_ERP_ORIGIN||url.username||url.password||url.hash||methods[url.pathname]!==method)throw Error('LAB_NETWORK_DENIED');
 return url;
}
