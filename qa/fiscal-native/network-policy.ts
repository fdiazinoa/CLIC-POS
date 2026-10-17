/** Exact laboratory-only HTTP boundary; no proxy, fallback, redirects or production origin. */
export const LAB_ERP_ORIGIN='http://127.0.0.1:18765';
export function assertLabRequest(value:string,method='GET'):URL {
 const url=new URL(value);
 const methods:Record<string,string>={'/__lab/health':'GET','/__lab/metrics':'GET','/__lab/inbox':'POST','/api/fiscal/v2/documents/applied-receipt':'GET','/api/fiscal/documents/issue':'POST'};
 if(url.origin!==LAB_ERP_ORIGIN||url.username||url.password||url.hash||methods[url.pathname]!==method)throw Error('LAB_NETWORK_DENIED');
 return url;
}
export function assertLabInput(input:any):void {
 const {scope,headers}=input.connection,master=input.fiscalMaster,article=input.catalog.sale.article,sale=input.catalog.sale;
 const uuid=(value:any)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
 if(!['tenantId','companyId','storeId','terminalId'].every(key=>uuid(scope[key]))||!scope.deviceId||headers['x-tenant-id']!==scope.tenantId||headers['x-terminal-id']!==scope.terminalId||headers['x-device-id']!==scope.deviceId||headers.authorization!=='Bearer '+headers['x-sync-token']||!headers['x-device-token']||master.tenantId!==scope.tenantId||master.companyId!==scope.companyId||master.terminalId!==scope.terminalId||master.ncfType!=='E32'||master.prefix!=='E32'||!/^(?:\d{9}|\d{11})$/.test(master.issuerRnc)||!uuid(master.fiscalRangeId)||!uuid(master.fiscalAllocationId)||!uuid(article.id)||article.type!=='PRODUCT'||article.inventoriable!==true||article.taxable!==false||article.activeWarehouseIds?.length!==1||!uuid(article.activeWarehouseIds[0])||sale.price!==100||sale.tariff.taxIncluded!==false||!Number.isSafeInteger(master.allocationStart)||master.allocationStart<master.rangeStart||master.allocationStart+1>master.allocationEnd||master.allocationEnd>master.rangeEnd)throw Error('LAB_INPUT_CONFLICT');
}
