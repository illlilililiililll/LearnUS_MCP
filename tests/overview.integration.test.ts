import { it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { EnvironmentCredentialProvider } from '../src/auth/CredentialProvider.js';
import { PlaywrightAuthManager } from '../src/auth/PlaywrightAuthManager.js';
import { LearnUsClient } from '../src/client/LearnUsClient.js';
import { createServer } from '../src/tools/index.js';
import { record } from '../src/client/MoodleAjaxClient.js';
import { checkIntegration as check, integrationFailure, mcpError } from './support/integration.js';
import type { LearnUsOverview } from '../src/models/Overview.js';
const enabled=process.env.LEARNUS_INTEGRATION==='1'&&!!process.env.LEARNUS_ID&&!!process.env.LEARNUS_PASSWORD;

it.skipIf(!enabled)('M6: aggregates normalized read-only sections in one authenticated session',async()=>{
  const auth=new PlaywrightAuthManager(new EnvironmentCredentialProvider()),server=createServer(new LearnUsClient(auth)),mcp=new Client({name:'overview-integration',version:'1'});
  let checkpoint='setup',diagnostics={courseCount:0,upcomingCount:0,assignmentCount:0,announcementCount:0,warningCount:0};
  try{
    const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await mcp.connect(b);
    checkpoint='authenticate';await auth.ensureAuthenticated();const context=await auth.session.getContext(),generation=auth.session.generation;
    const get=context.request.get.bind(context.request),post=context.request.post.bind(context.request);
    const getSpy=vi.spyOn(context.request,'get').mockImplementation(async(...args)=>{
      const url=new URL(args[0]);check(url.origin==='https://ys.learnus.org'&&['/','/course/view.php','/mod/assign/view.php','/mod/ubboard/view.php'].includes(url.pathname),'read_only_get');
      return get(...args);
    });
    const postSpy=vi.spyOn(context.request,'post').mockImplementation(async(...args)=>{
      const url=new URL(args[0]),data=Array.isArray(args[1]?.data)?args[1].data:[],call=record(data[0]);
      check(url.origin==='https://ys.learnus.org'&&url.pathname==='/lib/ajax/service.php'&&call.methodname==='core_calendar_get_action_events_by_timesort','read_only_post');
      return post(...args);
    });
    try{
      checkpoint='learnus_get_overview';const response=await mcp.callTool({name:'learnus_get_overview',arguments:{maxItemsPerSection:2}},undefined,{timeout:300000});
      if(response.isError)throw mcpError((response.content as {text?:string}[])?.[0]?.text);
      const content=response.content as {type:string;text?:string}[];check(content[0]?.type==='text','tool_content');const overview=JSON.parse(content[0].text!) as LearnUsOverview;
      diagnostics={courseCount:overview.courses?.length??0,upcomingCount:overview.upcoming?.length??0,assignmentCount:overview.assignments?.length??0,announcementCount:overview.announcements?.length??0,warningCount:overview.warnings.length};
      check(Array.isArray(overview.upcoming)&&Array.isArray(overview.assignments)&&Array.isArray(overview.announcements),'default_sections');
      check(!overview.courses&&!overview.notifications,'default_optional_sections');
      check([overview.upcoming,overview.assignments,overview.announcements].every(items=>items!.length<=2),'section_limits');
      check(overview.assignments.every(item=>!('description' in item)&&!('extraFields' in item)&&!('attachments' in item)),'summary_only');
      check(auth.session.generation===generation&&await auth.session.getContext()===context,'same_authenticated_session');
    }finally{getSpy.mockRestore();postSpy.mockRestore();}
  }catch(error){throw new Error(`${integrationFailure('M6',checkpoint,error,diagnostics)} ${JSON.stringify(auth.loginDiagnostics)}`);}
  finally{await mcp.close().catch(()=>undefined);await server.close().catch(()=>undefined);await auth.close();}
},420000);
