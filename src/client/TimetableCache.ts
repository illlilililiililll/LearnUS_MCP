import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { LearnUsError } from '../errors.js';
import { courseIdentity, normalizeDate } from '../normalize.js';

export interface TimetableClass {courseId:string;startsAt:string;endsAt?:string;kind?:'lecture'|'lab'|'unknown'}
interface StoredTimetable {version:1;semester:string;weeks:Record<string,TimetableClass[]>}
const semesterPattern=/^20\d{2}-[12]$/;
const normalizedClass=(value:unknown):TimetableClass|undefined=>{
  if(!value||typeof value!=='object')return;const v=value as Record<string,unknown>;
  if(!Object.keys(v).every(k=>['courseId','startsAt','endsAt','kind'].includes(k))||typeof v.courseId!=='string'||!courseIdentity(v.courseId)||typeof v.startsAt!=='string'||v.endsAt!==undefined&&typeof v.endsAt!=='string'||v.kind!==undefined&&!['lecture','lab','unknown'].includes(String(v.kind)))return;
  const startsAt=normalizeDate(v.startsAt),endsAt=normalizeDate(v.endsAt as string|undefined);if(!startsAt||v.endsAt!==undefined&&!endsAt)return;
  return {courseId:v.courseId,startsAt,...endsAt&&{endsAt},...v.kind!==undefined&&{kind:v.kind as TimetableClass['kind']}};
};
const normalizedStored=(value:unknown,semester:string):StoredTimetable|undefined=>{
  if(!value||typeof value!=='object')return;const v=value as Record<string,unknown>;
  if(!Object.keys(v).every(k=>['version','semester','weeks'].includes(k))||v.version!==1||v.semester!==semester||!v.weeks||typeof v.weeks!=='object'||Array.isArray(v.weeks))return;
  const weeks:Record<string,TimetableClass[]>={};for(const [week,items] of Object.entries(v.weeks)){if(!/^(?:all|[1-9]\d*)$/.test(week)||!Array.isArray(items))return;const normalized=items.map(normalizedClass);if(normalized.some(item=>!item))return;weeks[week]=normalized as TimetableClass[];}
  return {version:1,semester,weeks};
};
export class TimetableCache {
  private memory=new Map<string,StoredTimetable>();
  private flights=new Map<string,Promise<TimetableClass[]>>();
  private locks=new Map<string,Promise<void>>();
  constructor(private readonly root=path.resolve(process.env.LEARNUS_DOWNLOAD_ROOT||path.join(os.homedir(),'Documents','LearnUS'))){}
  private file(semester:string){if(!semesterPattern.test(semester))throw new LearnUsError('PARSE_ERROR');return path.join(this.root,'.cache','timetable',`${semester}.json`);}
  private async stored(semester:string):Promise<StoredTimetable>{
    const memory=this.memory.get(semester);if(memory)return structuredClone(memory);
    try{const value=normalizedStored(JSON.parse(await readFile(this.file(semester),'utf8')),semester);if(value){this.memory.set(semester,value);return structuredClone(value);}}catch{/* Missing and invalid caches are replaced only after a successful fetch. */}
    return {version:1,semester,weeks:{}};
  }
  private async update<T>(semester:string,action:()=>Promise<T>):Promise<T>{
    const previous=this.locks.get(semester)||Promise.resolve();let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),tail=previous.then(()=>gate);this.locks.set(semester,tail);await previous;
    try{return await action();}finally{release();if(this.locks.get(semester)===tail)this.locks.delete(semester);}
  }
  async get(semester:string,week:number|'all',refresh:boolean,fetchNormalized:()=>Promise<TimetableClass[]>):Promise<TimetableClass[]> {
    const key=week==='all'?'all':String(week);if(key!=='all'&&!/^[1-9]\d*$/.test(key))throw new LearnUsError('PARSE_ERROR');
    const cached=await this.stored(semester);if(!refresh&&cached.weeks[key])return structuredClone(cached.weeks[key]);
    const flightKey=`${semester}:${key}`;const running=this.flights.get(flightKey);if(running)return structuredClone(await running);
    const task=this.update(semester,async()=>{
      const stored=await this.stored(semester);if(!refresh&&stored.weeks[key])return stored.weeks[key];
      const values=await fetchNormalized(),normalized=Array.isArray(values)?values.map(normalizedClass):[];if(!Array.isArray(values)||normalized.some(item=>!item))throw new LearnUsError('PARSE_ERROR');
      stored.weeks[key]=structuredClone(normalized as TimetableClass[]);const file=this.file(semester),directory=path.dirname(file),temporary=path.join(directory,`.${semester}.${randomUUID()}.tmp`);
      await mkdir(directory,{recursive:true});try{await writeFile(temporary,JSON.stringify(stored),'utf8');await rename(temporary,file);}catch(error){await unlink(temporary).catch(()=>{});throw error;}
      this.memory.set(semester,structuredClone(stored));return stored.weeks[key];
    });this.flights.set(flightKey,task);
    try{return structuredClone(await task);}finally{this.flights.delete(flightKey);}
  }
}
