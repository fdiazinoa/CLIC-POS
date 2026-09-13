#!/usr/bin/env python3
"""Observed spans and sampled stacks only; never infer a culprit from overlap alone."""
import json,re,sys,collections
from pathlib import Path
p=Path(sys.argv[1]);events=[]
for line in (p/'diagnostic-logcat.txt').read_text(errors='replace').splitlines():
 m=re.search(r'POS_DIAG_JS\s*:\s*(\{.*)',line)
 if m:
  try:events.append(json.loads(m[1]))
  except ValueError:pass
profile=json.loads((p/'javascript.cpuprofile').read_text());anchor=json.loads((p/'v8-clock.json').read_text())
nodes={n['id']:n for n in profile['nodes']};parents={c:n['id'] for n in profile['nodes'] for c in n.get('children',[])}
metric=next(m['value'] for m in anchor['metrics'] if m['name']=='Timestamp')*1000
mid=(anchor['jsBefore']['js']+anchor['jsAfter'])/2;session=anchor['jsBefore']['diagnostic']['session']
events=[e for e in events if e.get('session')==session]
samples=[];ts=profile['startTime']/1000
for node,delta in zip(profile.get('samples',[]),profile.get('timeDeltas',[])):
 ts+=delta/1000;samples.append((ts-metric+mid,node))
def stack(node):
 result=[]
 while node in nodes:
  f=nodes[node]['callFrame'];result.append({'function':f['functionName'],'url':f['url'],'line':f['lineNumber']+1,'column':f['columnNumber']+1});node=parents.get(node)
 return result
out=[]
for a in events:
 if a['name']!='ACTION_START' or a.get('kind')!='action':continue
 tid=a['traceId'];fr=next((e for e in events if e['name']=='FIRST_RENDER' and e.get('traceId')==tid),None)
 end=fr['ts'] if fr else a['ts']+5000
 # Include concurrent spans with their OWN trace IDs; do not relabel background work as child work.
 window=[e for e in events if a['ts']<=e.get('ts',-1)<=end]
 counts=collections.Counter(n for t,n in samples if a['ts']<=t<=end)
 out.append({'traceId':tid,'operation':a.get('operation'),'actionJsMs':a['ts'],'firstRenderMs':end-a['ts'] if fr else None,'anchorUncertaintyMs':anchor['uncertaintyMs'],'timeline':window,'sampledStacks':[{'count':count,'stack':stack(n)} for n,count in counts.most_common(15)],'causalConclusion':None})
(p/'selective-operations.json').write_text(json.dumps(out,indent=2))
print(json.dumps({'session':session,'actions':len(out),'samples':len(samples),'events':len(events),'maxDrops':max((e.get('drops',0) for e in events),default=0),'clockUncertaintyMs':anchor['uncertaintyMs'],'note':'sample count is not exact function wall duration; inspect spans and Perfetto before attribution'},indent=2))
