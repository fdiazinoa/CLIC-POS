#!/usr/bin/env python3
"""Deterministic diagnostic-only patch. Fail closed if upstream source changes."""
from pathlib import Path
import hashlib,json,shutil
root=Path(__file__).resolve().parents[2]
cap=root/'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor'
sql=root/'node_modules/@capacitor-community/sqlite/android/src/main/java/com/getcapacitor/community/database/sqlite/SQLite/Database.java'
manifest={}
def patch(path,fn):
 s=path.read_text();before=hashlib.sha256(s.encode()).hexdigest()
 if '// POS_TEMPORAL_DIAGNOSTIC_PATCH' in s:raise RuntimeError('Already patched; run npm ci before patching')
 s=fn(s);path.write_text('// POS_TEMPORAL_DIAGNOSTIC_PATCH\n'+s);manifest[str(path.relative_to(root))]={'before':before,'after':hashlib.sha256(path.read_bytes()).hexdigest()}
def once(s,a,b):
 assert s.count(a)==1,(a,s.count(a));return s.replace(a,b,1)
def bridge(s):
 s=once(s,'        try {\n            final PluginHandle plugin = this.getPlugin(pluginId);','        PosDiagnosticHooks.enqueue(pluginId, methodName, call);\n        try {\n            final PluginHandle plugin = this.getPlugin(pluginId);')
 s=once(s,'            Runnable currentThreadTask = () -> {\n                try {','            Runnable currentThreadTask = () -> {\n                PosDiagnosticHooks.enter(pluginId, methodName, call);\n                try {')
 s=once(s,'                    throw new RuntimeException(ex);\n                }\n            };','                    throw new RuntimeException(ex);\n                } finally { PosDiagnosticHooks.leave(pluginId, methodName, call); }\n            };');return s
patch(cap/'Bridge.java',bridge)
patch(cap/'PluginCall.java',lambda s:s.replace('        this.msgHandler.sendResponseMessage(', '        PosDiagnosticHooks.response(this);\n        this.msgHandler.sendResponseMessage('))
# Brace scanner ignores strings and comments (including braces in embedded SQL).
def closing(s,start):
 i=start;depth=0;state='code'
 while i<len(s):
  c=s[i];n=s[i:i+2]
  if state=='line':
   if c=='\n':state='code'
  elif state=='block':
   if n=='*/':state='code';i+=1
  elif state in ['"',"'"]:
   if c=='\\':i+=1
   elif c==state:state='code'
  elif n=='//':state='line';i+=1
  elif n=='/*':state='block';i+=1
  elif c in ['"',"'"]:state=c
  elif c=='{':depth+=1
  elif c=='}':
   depth-=1
   if depth==0:return i
  i+=1
 raise RuntimeError('Unclosed method')
def wrap(s,signature,kind,operation,rows=False):
 start=s.index('{',s.index(signature));end=closing(s,start);body=s[start+1:end]
 if rows:body=body.replace('return retArray;', '__posRows = retArray.length(); return retArray;')
 body='\n        com.getcapacitor.PosDiagnosticHooks.Span __posSpan = com.getcapacitor.PosDiagnosticHooks.begin("'+kind+'", '+operation+');\n        long __posRows = -1; Throwable __posError = null;\n        try {\n'+body+'\n        } catch (Exception __posEx) { __posError=__posEx; throw __posEx; } finally { com.getcapacitor.PosDiagnosticHooks.end(__posSpan,__posRows,__posError); }\n    '
 return s[:start+1]+body+s[end:]
def database(s):
 s=wrap(s,'public JSArray selectSQL(', 'SQLITE_QUERY','com.getcapacitor.PosDiagnosticHooks.sqlName(statement)',True)
 s=wrap(s,'public JSObject prepareSQL(', 'SQLITE_PREPARE_EXECUTE','com.getcapacitor.PosDiagnosticHooks.sqlName(statement)')
 s=once(s,'                    _db.execSQL(nCmd);','                    com.getcapacitor.PosDiagnosticHooks.Span __posExec = com.getcapacitor.PosDiagnosticHooks.begin("SQLITE_QUERY", com.getcapacitor.PosDiagnosticHooks.sqlName(nCmd));\n                    try { _db.execSQL(nCmd); } finally { com.getcapacitor.PosDiagnosticHooks.end(__posExec,-1,null); }')
 for stmt in ['stmt.executeInsert();','stmt.executeUpdateDelete();']:
  s=once(s,stmt,'com.getcapacitor.PosDiagnosticHooks.Span __posWrite = com.getcapacitor.PosDiagnosticHooks.begin("SQLITE_QUERY", com.getcapacitor.PosDiagnosticHooks.sqlName(sqlStmt));\n                try { '+stmt+' } finally { com.getcapacitor.PosDiagnosticHooks.end(__posWrite,-1,null); }')
 s=once(s,'                _db.beginTransaction();' ,'                _db.beginTransaction();\n                com.getcapacitor.PosDiagnosticHooks.transactionBegin(this);')
 s=s.replace('_db.endTransaction();','_db.endTransaction();\n                com.getcapacitor.PosDiagnosticHooks.transactionEnd(this);')
 s=wrap(s,'public Integer beginTransaction()', 'SQLITE_TX_BEGIN_WAIT','"beginTransaction"')
 return s
patch(sql,database)
def utilities(s):
 for signature,query in [('public int dbChanges(', 'SELECT total_changes()'),('public long dbLastId(', 'SELECT last_insert_rowid()')]:
  start=s.index('{',s.index(signature));end=closing(s,start);body=s[start+1:end]
  body=body.replace('if (cursor.moveToFirst()) {','if (cursor.moveToFirst()) { __posRows=1;')
  body='\n        com.getcapacitor.PosDiagnosticHooks.Span __posSpan = com.getcapacitor.PosDiagnosticHooks.begin("SQLITE_QUERY", "'+query+'"); long __posRows=0;\n        try { '+body+' } finally { com.getcapacitor.PosDiagnosticHooks.end(__posSpan,__posRows,null); }\n'
  s=s[:start+1]+body+s[end:]
 return s
patch(sql.with_name('UtilsSQLite.java'),utilities)
shutil.copy2(root/'android/diagnostics/PosDiagnosticHooks.java',cap/'PosDiagnosticHooks.java')
(root/'diagnostic-native-patches.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Native diagnostic patches verified and applied')
