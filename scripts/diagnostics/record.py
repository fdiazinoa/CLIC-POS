#!/usr/bin/env python3
"""Keep the capture owner alive, enforce deadline, and reject broken log streams.
Run in a persistent exec session. Create OUT/stop.request to end early.
"""
import argparse,subprocess,time,json,os
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--serial',required=True);p.add_argument('--out',required=True);p.add_argument('--seconds',type=int,default=40);a=p.parse_args()
if not 15<=a.seconds<=45:raise SystemExit('Duration must be 15..45 seconds')
out=Path(a.out);helper=Path(__file__).with_name('capture.py');args=['python3',str(helper)]
subprocess.run(args+['start','--serial',a.serial,'--out',str(out),'--system-atrace'],check=True)
state=json.loads((out/'capture-state.json').read_text());start=time.monotonic();health=[]
try:
 while time.monotonic()-start<a.seconds and not (out/'stop.request').exists():
  status=subprocess.run(['ps','-p',str(state['logPid']),'-o','stat='],capture_output=True,text=True)
  if status.returncode or 'Z' in status.stdout:
   health.append({'elapsedSeconds':time.monotonic()-start,'error':'logcat_stream_ended; session incomplete'});break
  if not health or time.monotonic()-start-health[-1]['elapsedSeconds']>=30:
   item={'elapsedSeconds':round(time.monotonic()-start,1),'logBytes':(out/'diagnostic-logcat.txt').stat().st_size};health.append(item);print(json.dumps(item),flush=True)
  time.sleep(2)
finally:
 (out/'capture-health.json').write_text(json.dumps(health,indent=2))
 subprocess.run(args+['stop','--serial',a.serial,'--out',str(out)],check=True)
