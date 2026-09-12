import { randomUUID } from 'node:crypto';
import { request } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { mkdir, open, unlink, realpath, lstat, link } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TextDecoder } from 'node:util';
import type { BrowserContext } from 'playwright';
import { load } from 'cheerio';
import { ORIGIN, cleanText } from '../parser/dashboard.js';
import { contentUrl } from '../parser/content.js';
import { LearnUsError } from '../errors.js';
import type { AttachmentRef } from '../models/Attachment.js';
import type { CourseContextIndex } from '../models/Learning.js';
import { learnUsUrl } from '../normalize.js';

export function safeName(value:string):string {
  const clean=value.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/^[. ]+|[. ]+$/g,'').slice(0,150).replace(/[. ]+$/g,'');
  return !clean?'unnamed':/^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(clean)?`_${clean}`:clean;
}
export function dispositionFileName(disposition:string):string|undefined {
  const encoded=disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1],plain=disposition.match(/filename="([^"]+)"|filename=([^;]+)/i);
  try {
    if(encoded)return safeName(decodeURIComponent(encoded));
    let name=(plain?.[1]||plain?.[2])?.trim();if(!name)return;
    if([...name].every(character=>character.charCodeAt(0)<=255))name=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(name,'latin1'));
    return safeName(name);
  } catch { return plain?safeName((plain[1]||plain[2]).trim()):undefined; }
}
export function below(root:string,target:string):boolean {
  const rel=path.relative(root,target);return !!rel&&!rel.startsWith(`..${path.sep}`)&&rel!=='..'&&!path.isAbsolute(rel);
}
export function downloadDirectory(root:string,course:Pick<CourseContextIndex,'courseId'|'courseName'|'courseCode'|'semester'>):string {
  const semester=course.semester&&/^20\d{2}-[12]$/.test(course.semester)?course.semester:'unknown-semester';
  const target=path.resolve(root,semester,`${safeName(course.courseName||'course')} (${safeName(course.courseCode||`course-${course.courseId}`)})`);
  if(!below(path.resolve(root),target))throw new LearnUsError('PARSE_ERROR');return target;
}
export async function publishDownloaded(temporary:string,directory:string,name:string):Promise<string> {
  const ext=path.extname(name),stem=name.slice(0,name.length-ext.length);
  for(let n=1;n<=10000;n++){
    const candidate=path.join(directory,n===1?name:`${stem} (${n})${ext}`);
    try{await link(temporary,candidate);return candidate;}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')continue;throw e;}
  }
  throw new LearnUsError('ENDPOINT_UNAVAILABLE');
}
export function fileUrl(value:string):URL|undefined {
  try { const u=learnUsUrl(value);if(!u)return;
    if(/^\/pluginfile\.php\//.test(u.pathname)&&[...u.searchParams.keys()].every(k=>k==='forcedownload'))return u;
    if(u.pathname==='/mod/ubfile/view.php'&&/^\d+$/.test(u.searchParams.get('id')||'')&&[...u.searchParams.keys()].every(k=>k==='id'))return u;
  } catch { /* Invalid URLs are not registered. */ }
}
export function sourceFileUrl(value:string,source:AttachmentRef['sourceType']):URL|undefined {
  const url=fileUrl(value);if(!url)return;
  if(source==='assignment'&&(!/^\/pluginfile\.php\/\d+\/mod_assign\/introattachment\/0\/.+/.test(url.pathname)||url.searchParams.get('forcedownload')!=='1'))return;
  return url;
}
export function downloadHeaders(source:AttachmentRef['sourceType'],headers:IncomingHttpHeaders,max:number){
  const mime=String(headers['content-type']||'').split(';')[0],disposition=String(headers['content-disposition']||''),length=Number(headers['content-length']);
  if(!mime||/html|json|javascript/i.test(mime)||source==='assignment'&&!/^attachment(?:;|$)/i.test(disposition))throw new LearnUsError('ENDPOINT_UNAVAILABLE');
  if(Number.isFinite(length)&&length>max)throw new LearnUsError('DOWNLOAD_TOO_LARGE');
  return {mime,disposition,contentDisposition:/^attachment(?:;|$)/i.test(disposition),contentLengthHeader:headers['content-length']!==undefined};
}
export function attachmentLinks(html:string,source:AttachmentRef['sourceType']):{url:string;name:string}[] {
  const $=load(html);$('script,style,nav,footer,form,.modal').remove();
  const scope=source==='assignment'?$('#intro,.activity-description'):source==='announcement'?$('.ubboard_view .files,.ubboard_view .content'):$('.course-content');
  const found=new Map<string,{url:string;name:string}>();
  scope.find('a[href]').each((_,e)=>{const url=contentUrl($(e).attr('href')||'',true);if(url&&sourceFileUrl(url,source)){
    let fallback='attachment';try{fallback=decodeURIComponent(new URL(url).pathname.split('/').at(-1)||fallback);}catch{/* Keep safe fallback. */}
    found.set(url,{url,name:cleanText($(e).text())||fallback});
  }});return [...found.values()];
}
export class FileClient {
  private registry=new Map<string,{ref:AttachmentRef;url:string}>();
  register(url:string,name:string,sourceType:AttachmentRef['sourceType'],courseId:string,parentId?:string):AttachmentRef {
    const valid=sourceFileUrl(url,sourceType);if(!valid||!/^\d+$/.test(courseId))throw new LearnUsError('PARSE_ERROR');
    const existing=[...this.registry.values()].find(e=>e.url===valid.href&&e.ref.courseId===courseId);if(existing)return {...existing.ref};
    const ref:AttachmentRef={fileId:randomUUID(),fileName:safeName(name),sourceType,courseId,parentId,downloadable:true};
    this.registry.set(ref.fileId,{ref,url:valid.href});return {...ref};
  }
  courseId(fileId:string):string {const entry=this.registry.get(fileId);if(!entry)throw new LearnUsError('PARSE_ERROR');return entry.ref.courseId;}
  requestUrl(fileId:string):string {const entry=this.registry.get(fileId);if(!entry)throw new LearnUsError('PARSE_ERROR');return entry.url;}
  async download(fileId:string,context:BrowserContext,course:CourseContextIndex) {
    const entry=this.registry.get(fileId);if(!entry)throw new LearnUsError('PARSE_ERROR');
    const max=Number(process.env.LEARNUS_MAX_DOWNLOAD_BYTES||50*1024*1024);
    if(!Number.isSafeInteger(max)||max<=0)throw new LearnUsError('PARSE_ERROR');
    let url=entry.url;
    for(let redirects=0;redirects<=5;redirects++){
      const allowed=sourceFileUrl(url,entry.ref.sourceType);if(!allowed)throw new LearnUsError('ENDPOINT_UNAVAILABLE');
      // Validate every hop BEFORE fetching cookies. No authenticated external-host request exists.
      const cookies=await context.cookies(url);
      const response=await new Promise<import('node:http').IncomingMessage>((resolve,reject)=>{
        const req=request(allowed,{method:'GET',headers:{Cookie:cookies.map(c=>`${c.name}=${c.value}`).join('; '),Referer:ORIGIN+'/', 'Accept-Encoding':'identity'}},resolve);
        req.on('error',()=>reject(new LearnUsError('NETWORK_ERROR')));req.setTimeout(30000,()=>req.destroy(new LearnUsError('NETWORK_ERROR')));req.end();
      });
      const status=response.statusCode||0;
      if([301,302,303,307,308].includes(status)){
        const location=response.headers.location;response.destroy();if(!location)throw new LearnUsError('ENDPOINT_UNAVAILABLE');
        const next=new URL(location,url);if(/\/(?:login|passni)\//.test(next.pathname))throw new LearnUsError('SESSION_EXPIRED');
        url=next.href;continue;
      }
      if(status===401){response.destroy();throw new LearnUsError('SESSION_EXPIRED');}
      if(status!==200){response.destroy();throw new LearnUsError('ENDPOINT_UNAVAILABLE');}
      let metadata:ReturnType<typeof downloadHeaders>;
      try{metadata=downloadHeaders(entry.ref.sourceType,response.headers,max);}catch(error){response.destroy();throw error;}
      const {mime,disposition}=metadata;
      try {
      const root=path.resolve(process.env.LEARNUS_DOWNLOAD_ROOT||path.join(os.homedir(),'Documents','LearnUS'));
      const directory=downloadDirectory(root,course);
      await mkdir(root,{recursive:true});const rootReal=await realpath(root);
      // Reject symlink/junction descendants rather than following them outside the selected root.
      let component=root;
      for(const part of path.relative(root,directory).split(path.sep)){
        component=path.join(component,part);await mkdir(component).catch(e=>{if(e.code!=='EEXIST')throw e;});
        if((await lstat(component)).isSymbolicLink()||!below(rootReal,await realpath(component))){response.destroy();throw new LearnUsError('PARSE_ERROR');}
      }
      const name=dispositionFileName(disposition)||entry.ref.fileName;
      const temporary=path.join(directory,`.${randomUUID()}.partial`);let final:string|undefined;
      try {
        const file=await open(temporary,'wx');let size=0;
        try {for await(const chunk of response){size+=chunk.length;if(size>max)throw new LearnUsError('DOWNLOAD_TOO_LARGE');await file.writeFile(chunk);}await file.sync();}finally{await file.close();response.destroy();}
        final=await publishDownloaded(temporary,directory,name);
        if(!below(root,final))throw new LearnUsError('PARSE_ERROR');
        return {fileId,path:final,sizeBytes:size,mimeType:mime,contentDisposition:metadata.contentDisposition,contentLengthHeader:metadata.contentLengthHeader};
      } catch(error){if(final)await unlink(final).catch(()=>{});throw error;}finally{response.destroy();await unlink(temporary).catch(()=>{});}
      } finally { response.destroy(); }
    }
    throw new LearnUsError('ENDPOINT_UNAVAILABLE');
  }
}
export class AssignmentAttachmentAdapter {
  constructor(private readonly files:FileClient){}
  resolve(html:string,courseId:string,parentId:string):AttachmentRef[]{
    return attachmentLinks(html,'assignment').map(file=>this.files.register(file.url,file.name,'assignment',courseId,parentId));
  }
}
