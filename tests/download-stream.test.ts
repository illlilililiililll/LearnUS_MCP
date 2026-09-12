import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {request} from 'node:https';
import {FileClient} from '../src/client/FileClient.js';
vi.mock('node:https',()=>({request:vi.fn()}));
const roots:string[]=[];
afterEach(async()=>{vi.unstubAllEnvs();vi.clearAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const course={courseId:'7',semester:'2026-2',activities:[],videos:[],weeks:[],audienceContext:[],fetchedAt:0,warnings:[]};
function response(status:number,headers:Record<string,string>,content=''){
  const stream=Object.assign(Readable.from([Buffer.from(content)]),{statusCode:status,headers});
  vi.mocked(request).mockImplementationOnce(((_url:unknown,_options:unknown,callback:(stream:unknown)=>void)=>{
    const req=Object.assign(new EventEmitter(),{setTimeout:vi.fn(),end:()=>{callback(stream);},destroy:vi.fn()});return req;
  }) as never);return stream;
}
function registered(){const files=new FileClient(),ref=files.register('https://ys.learnus.org/pluginfile.php/1/mod_assign/introattachment/0/example.pdf?forcedownload=1','example.pdf','assignment','7');return {files,ref};}
it('rejects an external redirect before requesting its cookies or body',async()=>{
  const {files,ref}=registered(),cookies=vi.fn(async()=>[]),stream=response(303,{location:'https://outside.example/pluginfile.php/1/file'});
  await expect(files.download(ref.fileId,{cookies} as never,course)).rejects.toThrow('ENDPOINT_UNAVAILABLE');
  expect(request).toHaveBeenCalledTimes(1);expect(cookies).toHaveBeenCalledTimes(1);expect(stream.destroyed).toBe(true);
});
it('limits streamed bytes even without Content-Length and removes partial files',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'learnus-stream-'));roots.push(root);vi.stubEnv('LEARNUS_DOWNLOAD_ROOT',root);vi.stubEnv('LEARNUS_MAX_DOWNLOAD_BYTES','3');
  const {files,ref}=registered(),stream=response(200,{'content-type':'application/pdf','content-disposition':'attachment; filename="example.pdf"'},'oversized');
  await expect(files.download(ref.fileId,{cookies:async()=>[]} as never,course)).rejects.toThrow('DOWNLOAD_TOO_LARGE');
  const entries=await readdir(root,{recursive:true,withFileTypes:true});expect(entries.some(entry=>entry.isFile())).toBe(false);expect(stream.destroyed).toBe(true);
});
it('disposes a binary response when local directory creation fails',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'learnus-setup-'));roots.push(root);const blocked=path.join(root,'file');await writeFile(blocked,'synthetic');vi.stubEnv('LEARNUS_DOWNLOAD_ROOT',blocked);
  const {files,ref}=registered(),stream=response(200,{'content-type':'application/pdf','content-disposition':'attachment; filename="example.pdf"'},'ok');
  await expect(files.download(ref.fileId,{cookies:async()=>[]} as never,course)).rejects.toThrow();expect(stream.destroyed).toBe(true);
});
