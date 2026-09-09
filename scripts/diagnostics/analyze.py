import json,re,sys,collections,math
from pathlib import Path
out=Path(sys.argv[1]);events=[];malformed=0
for line in (out/'diagnostic-logcat.txt').read_text(errors='replace').splitlines():
 m=re.search(r'POS_DIAG_(JS|NATIVE|FRAME)\s*:\s*(\{.*)',line)
 if not m:continue
 try:e=json.loads(m[2]);e['source']=m[1];events.append(e)
 except:malformed+=1
saved=json.loads((out/'clock-sync.json').read_text()) if (out/'clock-sync.json').exists() else []
clocks={e['session']:e for e in saved+events if e.get('name')=='CLOCK_SYNC'}
for e in events:
 if e['source']=='JS':
  c=clocks.get(e.get('session'));e['bootMs']=float(c['bootNs'])/1e6+e['ts']-(c['jsBefore']+c['jsAfter'])/2 if c else None
 else:e['bootMs']=float(e.get('bootNs',0))/1e6
by_id=collections.defaultdict(list)
for e in events:
 if e.get('traceId') and e['traceId']!='UNATTRIBUTED':by_id[e['traceId']].append(e)
operations=[]
for tid,ev in by_id.items():
 start=next((e for e in ev if e['name']=='ACTION_START'),None)
 if not start:continue
 if start.get('kind')!='action' or 'inputTimestamp' not in start:continue
 end=next((e for e in ev if e['name']=='ACTION_END'),None);fr=next((e for e in ev if e['name']=='FIRST_RENDER'),None);unlock=next((e for e in ev if e['name']=='LOCAL_UNLOCK'),None)
 sql=[e for e in ev if e['name']=='SQLITE_QUERY_END'];renders=[e for e in ev if e['name']=='REACT_RENDER']
 spans=collections.defaultdict(dict)
 for e in ev:
  if e.get('spanId') is not None:spans[(e['source'],str(e['spanId']))][e['name']]=e
 bridge=[];http=[]
 for names in spans.values():
  if 'CAPACITOR_CALL_START' in names and 'CAPACITOR_CALL_END' in names:
   a,b=names['CAPACITOR_CALL_START'],names['CAPACITOR_CALL_END'];bridge.append({'plugin':a.get('plugin'),'operation':a.get('operation'),'durationMs':b['ts']-a['ts'],'startMs':a['ts']-start['ts']})
  if 'HTTP_START' in names:
   a=names['HTTP_START'];b=names.get('HTTP_HEADERS') or names.get('HTTP_ERROR');http.append({'endpoint':a.get('endpoint'),'durationMs':b['ts']-a['ts'] if b else None,'startMs':a['ts']-start['ts']})
 semantic=[e.get('operation') for e in ev if e['name']=='JS_OPERATION_START' and re.search(r'handle|addToCart|onSelect|processBarcode',e.get('operation',''))]
 operations.append({'traceId':tid,'action':semantic or [start['operation']],'startBootMs':start['bootMs'],'startJsMs':start['ts'],'handlerMs':end['ts']-start['ts'] if end else None,'firstRenderMs':fr['ts']-start['ts'] if fr else None,'firstRenderAmbiguous':fr.get('ambiguous') if fr else None,'localUnlockMs':unlock['ts']-start['ts'] if unlock else None,'queries':len(sql),'sqliteMs':sum(e.get('durationMs',0) for e in sql),'slowestQuery':max(sql,key=lambda e:e.get('durationMs',0),default=None),'rowsReturned':sum(e.get('rows',0) for e in sql),'queriesUnknownRows':sum('rows' not in e for e in sql),'queryOver25':sum(e.get('durationMs',0)>25 for e in sql),'queryOver50':sum(e.get('durationMs',0)>50 for e in sql),'queryOver100':sum(e.get('durationMs',0)>100 for e in sql),'renders':len(renders),'slowestRender':max(renders,key=lambda e:e.get('actualDuration') or 0,default=None),'http':http,'bridge':bridge,'timeline':[e for e in ev if e['name'] in ['ACTION_START','ACTION_END','JS_OPERATION_START','JS_OPERATION_END','FIRST_RENDER','LOCAL_UNLOCK','REACT_COMMIT','SQLITE_QUERY_START','SQLITE_QUERY_END','CAPACITOR_CALL_START','CAPACITOR_CALL_END','HTTP_START','HTTP_HEADERS']]})
summary={'events':len(events),'malformed':malformed,'sessions':list(clocks),'userActions':len(operations),'counts':dict(collections.Counter(e['name'] for e in events)),'maxReportedDrops':max((e.get('dropped',0) for e in events),default=0),'capabilities':[e for e in events if e['name']=='CAPABILITY']}
(out/'events.json').write_text(json.dumps(events));(out/'operations.json').write_text(json.dumps(operations,indent=2));(out/'quality.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
print('SLOW ACTION CANDIDATES (not causal conclusions)')
for o in sorted(operations,key=lambda o:o['firstRenderMs'] or 0,reverse=True)[:12]:print(json.dumps({k:o[k] for k in ['traceId','action','firstRenderMs','localUnlockMs','queries','sqliteMs','renders']}))
