import {it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {EnvironmentCredentialProvider} from '../src/auth/CredentialProvider.js';
import {PlaywrightAuthManager} from '../src/auth/PlaywrightAuthManager.js';
import {LearnUsClient} from '../src/client/LearnUsClient.js';
import {createServer} from '../src/tools/index.js';
const enabled=process.env.LEARNUS_INTEGRATION==='1'&&!!process.env.LEARNUS_ID&&!!process.env.LEARNUS_PASSWORD;
it.skipIf(!enabled)('checks release read-only shapes in one real session, accepting absent entities',async()=>{
  const auth=new PlaywrightAuthManager(new EnvironmentCredentialProvider()),server=createServer(new LearnUsClient(auth)),client=new Client({name:'release-check',version:'1'});
  const check=(condition:unknown)=>{if(!condition)throw new Error('RELEASE_STRUCTURE_FAILED');};
  const call=async(name:string,args:Record<string,unknown>={})=>{const response=await client.callTool({name,arguments:args},undefined,{timeout:300000});check(!response.isError);const blocks=response.content as {type:string;text?:string}[];const value=JSON.parse(blocks.find(block=>block.type==='text')?.text??'{}');check(!(value.warnings??[]).some((warning:string)=>/STRUCTURE_UNRECOGNIZED|UNAVAILABLE/.test(warning)));return value;};
  try {
    const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
    await auth.ensureAuthenticated();const generation=auth.session.generation,context=await auth.session.getContext();
    const courses=await call('learnus_list_courses');check(Array.isArray(courses.courses));
    const weekly=await call('learnus_get_weekly_tasks');check(weekly.range&&Array.isArray(weekly.warnings));
    const notifications=await call('learnus_list_notifications');check(Array.isArray(notifications.items));
    if(courses.courses.length){
      const courseId=String(courses.courses[0].id),course=await call('learnus_get_course',{courseId});check(Array.isArray(course.activities));
      const assignment=course.activities.find((activity:{type:string})=>activity.type==='assign');
      if(assignment){const detail=await call('learnus_get_assignment',{cmid:assignment.id});check(detail.cmid===assignment.id);}
      const announcements=await call('learnus_list_announcements',{courseId});check(Array.isArray(announcements.items));
      if(announcements.items.length){const item=announcements.items[0];if(item.moduleId)check((await call('learnus_get_announcement',{moduleId:item.moduleId,articleId:item.id})).item);}
      check(Array.isArray((await call('learnus_upcoming',{from:weekly.range.from,to:weekly.range.to,courseId})).events));
      check(Array.isArray((await call('learnus_list_files',{courseId})).items));
      const learning=await call('learnus_get_learning_overview',{courseId});check(Array.isArray(learning.requiredIncomplete));
    }
    check(auth.session.generation===generation&&await auth.session.getContext()===context);
  }catch{throw new Error('RELEASE_INTEGRATION_FAILED');}
  finally{await client.close().catch(()=>{});await server.close().catch(()=>{});await auth.close();}
},600000);
