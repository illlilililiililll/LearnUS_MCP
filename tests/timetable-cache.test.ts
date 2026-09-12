import { describe,it,expect,vi } from 'vitest';
import { mkdtemp,readFile,writeFile,mkdir,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TimetableCache } from '../src/client/TimetableCache.js';
const item=(courseId:string)=>({courseId,startsAt:'2026-09-08T09:00:00+09:00',kind:'lab' as const});
describe('semester timetable cache',()=>{
  it('uses memory, then disk, and accumulates week responses in one normalized file',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'learnus-timetable-')),fetchWeek1=vi.fn(async()=>[item('1')]),first=new TimetableCache(root);
    expect(await first.get('2026-2',1,false,fetchWeek1)).toEqual([item('1')]);expect(await first.get('2026-2',1,false,fetchWeek1)).toEqual([item('1')]);expect(fetchWeek1).toHaveBeenCalledOnce();
    const fetchWeek2=vi.fn(async()=>[item('2')]),second=new TimetableCache(root);expect(await second.get('2026-2',1,false,()=>Promise.reject(Error()))).toEqual([item('1')]);await second.get('2026-2',2,false,fetchWeek2);
    await Promise.all([second.get('2026-2',3,false,async()=>[item('3')]),second.get('2026-2',4,false,async()=>[item('4')])]);
    const stored=JSON.parse(await readFile(path.join(root,'.cache','timetable','2026-2.json'),'utf8'));expect(stored).toEqual({version:1,semester:'2026-2',weeks:{'1':[item('1')],'2':[item('2')],'3':[item('3')],'4':[item('4')]}});
  });
  it('replaces invalid files and refreshes one week atomically',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'learnus-timetable-invalid-')),dir=path.join(root,'.cache','timetable');await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'2026-2.json'),JSON.stringify({rawHtml:'private'}));
    const cache=new TimetableCache(root),fetch=vi.fn(async()=>[item('3')]);await cache.get('2026-2',1,false,fetch);expect(fetch).toHaveBeenCalledOnce();
    await cache.get('2026-2',1,true,async()=>[item('4')]);const text=await readFile(path.join(dir,'2026-2.json'),'utf8');expect(text).not.toContain('rawHtml');expect(JSON.parse(text).weeks['1']).toEqual([item('4')]);await expect(readdir(dir)).resolves.toEqual(['2026-2.json']);
  });
});
