import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {CapacitorSQLiteAdapter} from '../services/db/adapters/CapacitorSQLiteAdapter';

// Mirror the installed Android UtilsSQLite.getStatementsArray, including its limited
// concatRemoveEnd repair. Native execute does not accept arbitrary SQL script text.
function androidStatements(script:string):string[]{
 const commands=script.replaceAll('end;','END;').split(';\n').map(part=>part.trim());
 while(commands.includes('END')){const end=commands.indexOf('END');commands[end-1]+='; END';commands.splice(end,1);}
 const parsed=commands.map(command=>command.split('\n').map(line=>line.trim().split('--')[0]).filter(Boolean).join(' '));
 if(!parsed.at(-1)?.trim())parsed.pop();return parsed;
}
test('actual adapter fresh schema and repeat initialization survive installed Android execute splitting',async()=>{
 const java=readFileSync(new URL('../node_modules/@capacitor-community/sqlite/android/src/main/java/com/getcapacitor/community/database/sqlite/SQLite/UtilsSQLite.java',import.meta.url),'utf8');
 // Fail explicitly if the dependency changes the parser; review this compatibility model then.
 assert.ok(java.includes('String[] sqlCmdArray = stmts.split(";\\n");'));
 assert.ok(java.includes('lArray.set(idx - 1, lArray.get(idx - 1) + "; END");'));
 const sql=new DatabaseSync(':memory:');let initialized=0;
 const bridge={query:async(statement:string,values:any[]=[])=>({values:sql.prepare(statement).all(...values)}),run:async(statement:string,values:any[]=[])=>({changes:sql.prepare(statement).run(...values)}),execute:async(script:string)=>{for(const statement of androidStatements(script)){sql.exec(statement);initialized++;}},beginTransaction:async()=>sql.exec('BEGIN IMMEDIATE'),commitTransaction:async()=>sql.exec('COMMIT'),rollbackTransaction:async()=>sql.exec('ROLLBACK'),isTransactionActive:async()=>({result:sql.isTransaction})};
 try{const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge,isReady:true});await (adapter as any).initSchema();await (adapter as any).initSchema();assert.ok(initialized>100);
 const trigger=sql.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='pos_pending_authority_delete_v2'").get()!.sql;assert.match(String(trigger),/INSERT INTO pos_fiscal_authority_withdrawals_v2/);assert.match(String(trigger),/UPDATE pos_offline_fiscal_allocations_v2 SET revoked=1/);
 assert.equal(sql.prepare('SELECT count(*) n FROM pos_fiscal_authority_withdrawals_v2').get()!.n,0);assert.equal(sql.prepare('SELECT count(*) n FROM pos_fiscal_pending_numbers_v2').get()!.n,0);
 }finally{sql.close();}
});
test('compatibility model detects the original split-body trigger failure',()=>{const sql=new DatabaseSync(':memory:');try{
 const original="CREATE TABLE source(id INTEGER);\nCREATE TABLE archive(id INTEGER);\nCREATE TRIGGER broken BEFORE DELETE ON source BEGIN\n INSERT INTO archive VALUES(OLD.id);\n UPDATE archive SET id=OLD.id;\nEND;\n";
 assert.throws(()=>androidStatements(original).forEach(statement=>sql.exec(statement)),/incomplete input/);
 }finally{sql.close();}});
