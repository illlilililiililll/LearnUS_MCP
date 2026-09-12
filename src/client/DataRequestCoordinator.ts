export type RequestCategory = 'page'|'calendar'|'announcement'|'notification'|'completion'|'file';

export interface LearnUsPerformanceMetrics {
  networkRequestsStarted:number;
  networkRequestsCompleted:number;
  networkRequestsFailed:number;
  cacheHits:number;
  cacheMisses:number;
  coalescedRequests:number;
  activeRequests:number;
  peakConcurrentRequests:number;
}

const blank=():LearnUsPerformanceMetrics=>({networkRequestsStarted:0,networkRequestsCompleted:0,networkRequestsFailed:0,cacheHits:0,cacheMisses:0,coalescedRequests:0,activeRequests:0,peakConcurrentRequests:0});

export function maxConcurrentRequests(value=process.env.LEARNUS_MAX_CONCURRENT_REQUESTS):number {
  const parsed=Number(value);return Number.isSafeInteger(parsed)&&parsed>=1&&parsed<=32?parsed:4;
}

function stable(value:unknown):string {
  if(value instanceof URLSearchParams)return stable(Object.fromEntries([...value.entries()].filter(([key])=>!['sesskey','token'].includes(key)).sort(([a],[b])=>a.localeCompare(b))));
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).filter(([key])=>!['sesskey','token'].includes(key)).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value)??String(value);
}

export function requestIdentity(method:string,url:string,body:unknown,generation:number):string {
  const parsed=new URL(url);
  for(const key of [...parsed.searchParams.keys()])if(['sesskey','token'].includes(key))parsed.searchParams.delete(key);
  const query=[...parsed.searchParams.entries()].sort(([ak,av],[bk,bv])=>ak.localeCompare(bk)||av.localeCompare(bv));parsed.search='';for(const [key,value] of query)parsed.searchParams.append(key,value);parsed.hash='';
  return `${generation}:${method.toUpperCase()}:${parsed.pathname}${parsed.search}:${stable(body)}`;
}

export class DataRequestCoordinator {
  private readonly metrics=blank();
  private readonly flights=new Map<string,Promise<unknown>>();
  private active=0;
  private readonly waiters:Array<()=>void>=[];
  private readonly max:number;
  constructor(max?:number){this.max=maxConcurrentRequests(max===undefined?undefined:String(max));}
  snapshot():LearnUsPerformanceMetrics{return {...this.metrics};}
  reset():void{Object.assign(this.metrics,blank(),{activeRequests:this.active,peakConcurrentRequests:this.active});}
  cacheHit():void{this.metrics.cacheHits++;}
  cacheMiss():void{this.metrics.cacheMisses++;}
  coalesced():void{this.metrics.coalescedRequests++;}
  private async permit():Promise<void>{if(this.active<this.max){this.active++;return;}await new Promise<void>(resolve=>this.waiters.push(resolve));this.active++;}
  private release():void{this.active--;this.waiters.shift()?.();}
  async run<T>(input:{method:string;url:string;body?:unknown;generation:number;category:RequestCategory;coalesce?:boolean},work:()=>Promise<T>):Promise<T>{
    const key=requestIdentity(input.method,input.url,input.body,input.generation);
    if(input.coalesce!==false){const active=this.flights.get(key);if(active){this.metrics.coalescedRequests++;return structuredClone(await active) as T;}}
    const flight=(async()=>{await this.permit();this.metrics.networkRequestsStarted++;this.metrics.activeRequests++;this.metrics.peakConcurrentRequests=Math.max(this.metrics.peakConcurrentRequests,this.metrics.activeRequests);
      try{const value=await work();this.metrics.networkRequestsCompleted++;return value;}catch(error){this.metrics.networkRequestsFailed++;throw error;}finally{this.metrics.activeRequests--;this.release();}
    })();
    if(input.coalesce!==false)this.flights.set(key,flight);
    try{return structuredClone(await flight);}finally{if(this.flights.get(key)===flight)this.flights.delete(key);}
  }
}
