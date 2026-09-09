#!/usr/bin/env python3
"""Create a Perfetto-readable native-log overlay with the original atrace scheduling.
These sections are reconstructed from measured START/END records, NOT emitted
android.os.Trace sections. Keep original .pftrace, .ctrace and logcat as evidence.
"""
import json,zlib,argparse
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('directory');a=p.parse_args();root=Path(a.directory)
events=json.loads((root/'events.json').read_text());output=[];active={};threads=set()
for e in events:
 if e.get('source')!='NATIVE' or not e.get('bootMs'):continue
 pid=e.get('pid');tid=e.get('tid');name=e.get('name','');key=(pid,e.get('traceId'),e.get('spanId'),name.removesuffix('_START').removesuffix('_END'))
 if (pid,tid) not in threads:
  threads.add((pid,tid));output.append({'ph':'M','name':'thread_name','pid':pid,'tid':tid,'args':{'name':e.get('thread','native')}})
 if name.endswith('_START'):active[key]=e
 elif name.endswith('_END') and key in active:
  start=active.pop(key);dur=(e['bootMs']-start['bootMs'])*1000
  if dur<0:continue
  output.append({'ph':'X','cat':'POS.native-log.measured','name':e.get('traceId','')+' | '+name[:-4]+' | '+str(e.get('operation','')),'pid':pid,'tid':tid,'ts':start['bootMs']*1000,'dur':dur,'args':{'traceId':e.get('traceId'),'spanId':e.get('spanId'),'rows':e.get('rows'),'durationReportedMs':e.get('durationMs'),'mainThread':e.get('mainThread'),'evidence':'reconstructed START/END from native log; includes event emission overhead'}})
# Android atrace uses the boot clock on the target. Verify offsets against shared
# CLOCK_SYNC / UserTiming markers before making a cross-file causal conclusion.
b=(root/'system.ctrace').read_bytes();marker=b'TRACE:\n';raw=zlib.decompress(b[b.index(marker)+len(marker):]).decode(errors='replace')
(root/'native-overlay.json').write_text(json.dumps({'traceEvents':output,'systemTraceEvents':raw,'displayTimeUnit':'ms','metadata':{'source':'measured native logs + original atrace','notAndroidTraceSections':True,'clockValidationRequired':True}}))
print('Native overlay sections:',sum(e['ph']=='X' for e in output),'Unclosed native spans:',len(active))
