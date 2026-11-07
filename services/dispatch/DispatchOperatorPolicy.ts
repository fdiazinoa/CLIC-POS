export interface DispatchOperatorPolicy {
 userId:string;erpPosUserId:string;roleId:string;roleVersion:number;permissions:string[];
 userOverride:null;limitSource:'ERP_ASSIGNED_ROLE';discountLimit:{kind:'UNLIMITED'}|{kind:'PERCENT';value:number};
}
/** Legacy local policy can only make a dispatched checkout stricter. It never
 * grants permission, replaces the emitted identity, or increases the ERP cap. */
export function effectiveDispatchDiscountLimit(issued:DispatchOperatorPolicy,localRestriction?:number):number|undefined{
 if(!issued||issued.userOverride!==null||issued.limitSource!=='ERP_ASSIGNED_ROLE'||!issued.userId||!issued.erpPosUserId||!Number.isSafeInteger(issued.roleVersion)||issued.roleVersion<1)throw Error('DISPATCH_OPERATOR_POLICY_INVALID');
 const limit=issued.discountLimit;
 if(!limit||!['UNLIMITED','PERCENT'].includes(limit.kind)||limit.kind==='PERCENT'&&(!Number.isFinite(limit.value)||limit.value<0||limit.value>100))throw Error('DISPATCH_OPERATOR_POLICY_INVALID');
 if(localRestriction!==undefined&&(!Number.isFinite(localRestriction)||localRestriction<0||localRestriction>100))throw Error('DISPATCH_LOCAL_DISCOUNT_POLICY_INVALID');
 const maximum=limit.kind==='PERCENT'?limit.value:undefined;
 return localRestriction===undefined?maximum:maximum===undefined?localRestriction:Math.min(maximum,localRestriction);
}
export function dispatchOperatorHasPermission(issued:DispatchOperatorPolicy,permission:string):boolean{
 return Array.isArray(issued.permissions)&&(issued.permissions.includes('ALL')||issued.permissions.includes(permission));
}
