import { existsSync } from 'node:fs';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { EnvironmentCredentialProvider } from '../src/auth/CredentialProvider.js';
import { PlaywrightAuthManager } from '../src/auth/PlaywrightAuthManager.js';
import { LearnUsClient } from '../src/client/LearnUsClient.js';
import { createServer } from '../src/tools/index.js';
import { safeCode } from '../src/errors.js';

const enabled=process.env.LEARNUS_INTEGRATION==='1'&&!!process.env.LEARNUS_ID&&!!process.env.LEARNUS_PASSWORD;
it.skipIf(!enabled)('reads normalized learning state in one authenticated session',async()=>{
  const auth=new PlaywrightAuthManager(new EnvironmentCredentialProvider()),learnus=new LearnUsClient(auth),server=createServer(learnus),mcp=new Client({name:'learning-integration',version:'1'});
  let checkpoint='setup';const check=(value:boolean,label:string)=>{checkpoint=label;if(!value)throw Error('CHECK_FAILED');};
  const call=async(name:string,args:Record<string,unknown>)=>{const r=await mcp.callTool({name,arguments:args},undefined,{timeout:240000});check(!r.isError,'tool_success');const c=r.content as {type:string;text?:string}[];check(c[0]?.type==='text','tool_content');return JSON.parse(c[0].text!);};
  try{
    const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await mcp.connect(b);await auth.ensureAuthenticated();
    const context=await auth.session.getContext(),generation=auth.session.generation;
    const courses=await learnus.listCourses();check(courses.courses.length>0,'courses_available');
    let selected:string|undefined;
    for(const course of courses.courses){const videos=await call('learnus_list_videos',{courseId:String(course.id)});if(videos.items.length){selected=String(course.id);check(videos.items.every((v:Record<string,unknown>)=>typeof v.videoId==='string'&&['required','optional','not_applicable','unknown'].includes(String(v.applicability))),'videos_normalized');break;}}
    check(!!selected,'video_course_available');
    const attendance=await call('learnus_get_video_attendance',{courseId:selected!});check(['attendance','progress'].includes(attendance.mode),'mode_detected');check(attendance.items.length>0,'report_items');check(attendance.items.every((v:Record<string,unknown>)=>v.progressPercent===undefined||(typeof v.progressPercent==='number'&&v.progressPercent>=0&&v.progressPercent<=100)),'progress_range');
    const overview=await call('learnus_get_learning_overview',{courseId:selected!,week:'current'});check(Array.isArray(overview.requiredIncomplete)&&overview.requiredIncomplete.every((v:Record<string,unknown>)=>v.applicability==='required'),'required_filter');
    const files=await call('learnus_list_files',{courseId:selected!,scope:'course'});check(Array.isArray(files.items)&&files.items.every((f:Record<string,unknown>)=>typeof f.fileId==='string'&&f.courseId===selected),'file_refs');
    check(auth.session.generation===generation&&await auth.session.getContext()===context,'same_session');
  }catch(error){throw Error(`LEARNING_INTEGRATION_FAILED ${checkpoint} ${safeCode(error)} ${JSON.stringify(auth.loginDiagnostics)}`);}
  finally{await mcp.close().catch(()=>{});await server.close().catch(()=>{});await auth.close();}
},600000);

const downloadEnabled=enabled&&process.env.LEARNUS_DOWNLOAD_INTEGRATION==='1';
it.skipIf(!downloadEnabled)('downloads one discovered file only to a temporary root',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'learnus-download-')),old=process.env.LEARNUS_DOWNLOAD_ROOT;process.env.LEARNUS_DOWNLOAD_ROOT=root;
  const auth=new PlaywrightAuthManager(new EnvironmentCredentialProvider()),learnus=new LearnUsClient(auth);let checkpoint='setup';
  const check=(value:boolean,label:string)=>{checkpoint=label;if(!value)throw Error('CHECK_FAILED');};
  try{
    const courses=await learnus.listCourses();let fileId:string|undefined;
    for(const course of courses.courses){const files=await learnus.listFiles({courseId:String(course.id),scope:'course'});if(files.items.length){fileId=files.items[0].fileId;break;}}
    check(!!fileId,'downloadable_file_available');const result=await learnus.downloadFile(fileId!);check(result.path.startsWith(root)&&existsSync(result.path)&&result.sizeBytes>0,'download_saved');
  }catch(error){throw Error(`DOWNLOAD_INTEGRATION_FAILED ${checkpoint} ${safeCode(error)} ${JSON.stringify(auth.loginDiagnostics)}`);}
  finally{if(old===undefined)delete process.env.LEARNUS_DOWNLOAD_ROOT;else process.env.LEARNUS_DOWNLOAD_ROOT=old;await auth.close();await rm(root,{recursive:true,force:true});}
},600000);
