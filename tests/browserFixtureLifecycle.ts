/** Real timers owned by an isolated browser fixture; callbacks run normally until explicit teardown. */
export function ownBrowserFixtureTimers(){
 const original={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 const timeouts=new Set<ReturnType<typeof setTimeout>>();
 globalThis.setTimeout=((callback:(...args:any[])=>void,delay?:number,...args:any[])=>{
  const handle=original.setTimeout((...values:any[])=>{timeouts.delete(handle);callback(...values);},delay,...args);
  timeouts.add(handle);return handle;
 }) as typeof globalThis.setTimeout;
 globalThis.clearTimeout=((handle:ReturnType<typeof setTimeout>)=>{timeouts.delete(handle);original.clearTimeout(handle);}) as typeof globalThis.clearTimeout;
 return {dispose(){for(const handle of timeouts)original.clearTimeout(handle);timeouts.clear();globalThis.setTimeout=original.setTimeout;globalThis.clearTimeout=original.clearTimeout;}};
}
