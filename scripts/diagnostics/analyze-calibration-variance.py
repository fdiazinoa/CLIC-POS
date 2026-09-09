#!/usr/bin/env python3
"""Correlate named calibration windows, union GC slices, and scheduler states.
Never add GC wall time to scheduling time: the intervals can overlap.
"""
import argparse,csv,io,json,subprocess,statistics
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('capture',type=Path);p.add_argument('--processor',required=True);a=p.parse_args()
def query(trace,sql):
 r=subprocess.run(['python3',a.processor,'query',str(a.capture/trace),sql],check=True,capture_output=True,text=True)
 return list(csv.DictReader(io.StringIO(r.stdout)))
marks=query('session.pftrace',"SELECT s.name,s.ts,t.tid FROM slice s JOIN thread_track tt ON tt.id=s.track_id JOIN thread t ON t.utid=tt.utid WHERE s.name GLOB 'CAL|*'")
byname={r['name']:r for r in marks};tid=int(marks[0]['tid'])
gcs=query('session.pftrace',f"SELECT s.name,s.ts,s.dur FROM slice s JOIN thread_track tt ON tt.id=s.track_id JOIN thread t ON t.utid=tt.utid WHERE t.tid={tid} AND s.name IN ('V8.GCScavenger','V8.GCIncrementalMarking','V8.GCFinalizeMC','V8.GCFinalizeMCReduceMemory') AND s.dur>0")
states=query('system.ctrace',f"SELECT s.ts,s.dur,s.state FROM thread_state s JOIN thread t ON t.utid=s.utid WHERE t.tid={tid} AND s.dur>0")
def clipped(rows,start,end):return [(max(start,int(r['ts'])),min(end,int(r['ts'])+int(r['dur'])),r) for r in rows if int(r['ts'])<end and int(r['ts'])+int(r['dur'])>start]
def union(intervals):
 out=[]
 for x,y in sorted(intervals):
  if out and x<=out[-1][1]:out[-1]=(out[-1][0],max(y,out[-1][1]))
  else:out.append((x,y))
 return out
def length(intervals):return sum(y-x for x,y in union(intervals))/1e6
out=[]
for sample in json.loads((a.capture/'calibration.json').read_text())['results']:
 key=f"CAL|{sample['phase']}|{sample['index']}|{'ON' if sample['enabled'] else 'OFF'}"
 if key+'|START' not in byname or key+'|END' not in byname:raise ValueError('Missing calibration marker '+key)
 start=int(byname[key+'|START']['ts']);end=int(byname[key+'|END']['ts']);gc=clipped(gcs,start,end);sched=clipped(states,start,end)
 gc_union=union([(x,y) for x,y,_ in gc]);cpu=[(x,y) for x,y,r in sched if r['state']=='Running']
 overlaps=[(max(x,u),min(y,v)) for x,y in gc_union for u,v in cpu if x<v and y>u]
 kinds={k:length([(x,y) for x,y,r in gc if r['name']==k]) for k in sorted({r['name'] for _,_,r in gc})}
 bystate={s:length([(x,y) for x,y,r in sched if r['state']==s]) for s in sorted({r['state'] for _,_,r in sched})}
 out.append({**sample,'markerStartNs':start,'markerEndNs':end,'markerMs':(end-start)/1e6,'gcWallMs':length(gc_union),'gcOnCpuMs':length(overlaps),'gcTypesWallMs':kinds,'schedulerMs':bystate,'schedulerCoveredMs':length([(x,y) for x,y,_ in sched]),'gcEvents':[{'name':r['name'],'startMs':(x-start)/1e6,'durationMs':(y-x)/1e6} for x,y,r in gc]})
(a.capture/'variance-correlation.json').write_text(json.dumps({'rendererTid':tid,'samples':out,'warning':'GC wall and scheduler states overlap. This is synthetic calibration, not POS action attribution. Account for trace health and clock validation separately.'},indent=2))
for r in sorted([x for x in out if x['phase']=='measured'],key=lambda x:x['ms'],reverse=True)[:5]:print(json.dumps({k:r[k] for k in ['index','enabled','ms','gcWallMs','gcOnCpuMs','schedulerMs','schedulerCoveredMs']}))
