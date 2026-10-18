import type {PresentationAuthority} from './client';
import {canonicalPresentationJson} from './contract';
// Only the in-flight negotiation is process-local; known denials are retained by the SQL sidecar.
const pending=new Map<string,object>();
const key=(authority:PresentationAuthority)=>canonicalPresentationJson(authority);
export function beginPresentationAdmission(authority:PresentationAuthority){const lease={key:key(authority)};pending.set(lease.key,lease);return lease;}
export function finishPresentationAdmission(lease:{key:string}){if(pending.get(lease.key)===lease)pending.delete(lease.key);}
export function assertPresentationAdmission(authority:PresentationAuthority){if(pending.has(key(authority)))throw Error('INVENTORY_PRESENTATION_PREPARATION_PENDING');}
