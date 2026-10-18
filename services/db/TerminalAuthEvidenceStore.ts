import {validateTerminalAuthEnvelope} from '../sync/BindingAuthEvidenceV1';
import type {BindingAuthEvidenceV1,BindingAuthScope} from '../sync/BindingAuthEvidenceV1';
export type TerminalAuthEnvelope={schemaVersion:1;revision:number;scope:BindingAuthScope;beforeCredentials:string;credentials:string;session:{token:string;expiresAt:string};evidence:BindingAuthEvidenceV1|null};
export type TerminalAuthRecord={raw:string;envelope:TerminalAuthEnvelope};
export interface TerminalAuthEvidenceStore{read():Promise<TerminalAuthRecord|null>;history():Promise<TerminalAuthEnvelope[]>;commit(expected:string|null,next:TerminalAuthEnvelope):Promise<void>}
export const TERMINAL_AUTH_EVIDENCE_SCHEMA=`
CREATE TABLE IF NOT EXISTS terminal_auth_evidence_current(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL,envelope_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS terminal_auth_evidence_history(revision INTEGER PRIMARY KEY,envelope_json TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS preserve_terminal_auth_evidence_history_update BEFORE UPDATE ON terminal_auth_evidence_history BEGIN SELECT RAISE(ABORT,'SYNC_BINDING_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS preserve_terminal_auth_evidence_history_delete BEFORE DELETE ON terminal_auth_evidence_history BEGIN SELECT RAISE(ABORT,'SYNC_BINDING_HISTORY_IMMUTABLE'); END;`;
type Port={query:(sql:string,values?:any[])=>Promise<{values?:any[]}>;run:(sql:string,values:any[],transaction?:boolean)=>Promise<any>};
/** Dedicated private tables: never generic documents, sync collections or Outbox. */
export class NativeTerminalAuthEvidenceStore implements TerminalAuthEvidenceStore{
 constructor(private port:()=>Port,private exclusive:<T>(work:()=>Promise<T>)=>Promise<T>,private atomic:<T>(work:()=>Promise<T>)=>Promise<T>){}
 private async readOwned():Promise<TerminalAuthRecord|null>{const row=(await this.port().query('SELECT envelope_json FROM terminal_auth_evidence_current WHERE singleton=1')).values?.[0];if(!row)return null;const raw=row.envelope_json;return {raw,envelope:JSON.parse(raw)};}
 read(){return this.exclusive(()=>this.readOwned());}
 history():Promise<TerminalAuthEnvelope[]>{return this.exclusive(async()=>((await this.port().query('SELECT envelope_json FROM terminal_auth_evidence_history ORDER BY revision')).values||[]).map(r=>JSON.parse(r.envelope_json)));}
 commit(expected:string|null,next:TerminalAuthEnvelope):Promise<void>{return this.exclusive(()=>this.atomic(async()=>{
  const old=await this.readOwned();if((old?.raw??null)!==expected||next.schemaVersion!==1||next.revision!==(old?.envelope.revision??0)+1)throw Error('SYNC_BINDING_EVIDENCE_CAS_CONFLICT');
  await validateTerminalAuthEnvelope(next);if(old&&(JSON.stringify(old.envelope.scope)!==JSON.stringify(next.scope)||old.envelope.credentials!==next.beforeCredentials))throw Error('SYNC_BINDING_EVIDENCE_CAS_CONFLICT');
  if(next.evidence){const latest=(await this.port().query('SELECT envelope_json FROM terminal_auth_evidence_history ORDER BY revision DESC LIMIT 1')).values?.[0];if(latest&&Date.parse(next.evidence.observedAt)<=Date.parse(JSON.parse(latest.envelope_json).evidence.observedAt))throw Error('SYNC_BINDING_EVIDENCE_STALE_RESPONSE');}
  const raw=JSON.stringify(next);if(next.evidence)await this.port().run('INSERT INTO terminal_auth_evidence_history(revision,envelope_json) VALUES(?,?)',[next.revision,raw],false);
  await this.port().run('INSERT INTO terminal_auth_evidence_current(singleton,revision,envelope_json) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,envelope_json=excluded.envelope_json',[next.revision,raw],false);
 }));}
}
