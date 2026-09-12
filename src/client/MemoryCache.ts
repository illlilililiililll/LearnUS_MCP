import type { DataRequestCoordinator } from './DataRequestCoordinator.js';

// Normalized values only. Concurrent refreshes share the pending load.
export class MemoryCache {
  private values = new Map<string,{expires:number;value:unknown}>();
  private flights = new Map<string,Promise<unknown>>();
  constructor(private readonly options:{metrics?:DataRequestCoordinator;generation?:()=>number;enabled?:boolean;now?:()=>number}={}){}
  clear():void{this.values.clear();}
  async get<T>(key:string, ttl:number, refresh:boolean, load:()=>Promise<T>,cacheIf:(value:T)=>boolean=()=>true):Promise<T> {
    if(this.options.enabled===false)return load();
    const generation=this.options.generation?.()??0,scoped=`${generation}:${key}`,now=this.options.now??Date.now;
    const flight = this.flights.get(scoped); if (flight){this.options.metrics?.coalesced();return structuredClone(await flight) as T;}
    const cached = this.values.get(scoped);
    if (!refresh && cached && cached.expires > now()){this.options.metrics?.cacheHit();return structuredClone(cached.value) as T;}
    this.options.metrics?.cacheMiss();
    const promise = load().then(value=>{if(cacheIf(value)&&(this.options.generation?.()??0)===generation)this.values.set(scoped,{expires:now()+ttl,value:structuredClone(value)});return value;});
    this.flights.set(scoped,promise);
    try { return structuredClone(await promise); } finally {this.flights.delete(scoped);}
  }
}
