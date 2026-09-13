// Bounded aggregates, never per-fiber traversal or document/prop values in output.
export type TargetMeta = {key?: unknown; refs?: Record<string, unknown>; sizes?: Record<string, number>};
export class TargetCounters {
 private previous = new Map<unknown, Record<string, unknown>>();
 private totals = new Map<string, any>();
 observe(name: string, duration: number, meta?: TargetMeta) {
  let row = this.totals.get(name);
  if (!row) { if (this.totals.size >= 64) return; row = {operation:name,count:0,totalMs:0,maxMs:0,over16:0,over50:0,over100:0,changed:{},baseline:0,sizes:{}}; this.totals.set(name,row); }
  row.count++; row.totalMs+=duration; row.maxMs=Math.max(row.maxMs,duration);
  for(const n of [16,50,100]) if(duration>n) row['over'+n]++;
  if(meta?.refs) {
   // Key stays in memory only. Callers use a stable card key or memo callsite.
   const key=meta.key??name, prior=this.previous.get(key);
   if(!prior) row.baseline++;
   else for(const field of Object.keys(meta.refs)) if(!Object.is(prior[field],meta.refs[field])) row.changed[field]=(row.changed[field]||0)+1;
   if(!this.previous.has(key)&&this.previous.size>=512) this.previous.delete(this.previous.keys().next().value);
   this.previous.set(key,{...meta.refs});
  }
  for(const [field,value] of Object.entries(meta?.sizes||{})) row.sizes[field]=Math.max(row.sizes[field]||0,value);
 }
 drain(){const rows=[...this.totals.values()];this.totals.clear();return rows;}
 reset(){this.previous.clear();this.totals.clear();}
}
