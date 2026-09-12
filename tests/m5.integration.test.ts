import { it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { EnvironmentCredentialProvider } from '../src/auth/CredentialProvider.js';
import { PlaywrightAuthManager } from '../src/auth/PlaywrightAuthManager.js';
import { LearnUsClient } from '../src/client/LearnUsClient.js';
import { createServer } from '../src/tools/index.js';
import { record } from '../src/client/MoodleAjaxClient.js';
import type { AnnouncementListResult, AnnouncementDetail, LearnUsNotification, ListResult } from '../src/models/Announcement.js';
import { checkIntegration as check, integrationFailure, mcpError } from './support/integration.js';
const enabled = process.env.LEARNUS_INTEGRATION === '1' && !!process.env.LEARNUS_ID && !!process.env.LEARNUS_PASSWORD;
it.skipIf(!enabled)('M5: reads announcements and notifications in one session without state-changing data requests',async()=>{
  const auth = new PlaywrightAuthManager(new EnvironmentCredentialProvider());
  const learnus = new LearnUsClient(auth);
  const announcementSpy = vi.spyOn(learnus,'listAnnouncements');
  const server = createServer(learnus), mcp = new Client({name:'m5-integration',version:'1'});
  let checkpoint = 'setup';
  let diagnostics:{courseCount:number;announcementWidgetCount:number;emptyCourseCount:number;boardCount:number;boardRequestCount:number;announcementCount:number;parserMismatchCount:number;warnings:string[]}={courseCount:0,announcementWidgetCount:0,emptyCourseCount:0,boardCount:0,boardRequestCount:0,announcementCount:0,parserMismatchCount:0,warnings:[]};
  const call = async(name:string,args={})=>{
    checkpoint=name;
    const response = await mcp.callTool({name,arguments:args},undefined,{timeout:240000});
    if(response.isError)throw mcpError((response.content as {text?:string}[])?.[0]?.text);
    const content = response.content as {type:string;text?:string}[];
    check(content?.[0]?.type==='text','tool_content');
    return JSON.parse(content[0].text!);
  };
  try {
    const [a,b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);await mcp.connect(b);
    checkpoint='authenticate';await auth.ensureAuthenticated();
    const context = await auth.session.getContext(), generation = auth.session.generation;
    const realGet = context.request.get.bind(context.request), realPost = context.request.post.bind(context.request);
    let notificationPosts = 0;
    const getSpy = vi.spyOn(context.request,'get').mockImplementation(async (...args)=>{
      const url = new URL(args[0]);
      check(url.origin==='https://ys.learnus.org' && ['/','/course/view.php','/mod/ubboard/view.php','/mod/ubboard/article.php'].includes(url.pathname),'only_read_endpoints');
      check([...url.searchParams.keys()].every(key=>['id','bwid','page'].includes(key)),'only_read_query_parameters');
      return realGet(...args);
    });
    const postSpy = vi.spyOn(context.request,'post').mockImplementation(async (...args)=>{
      const form = record(args[1]?.form);
      check(args[0]==='https://ys.learnus.org/theme/coursemosv2/action.php' && form.type==='userInfoNotifications','only_notification_read_action');
      check(Object.keys(form).every(key=>['type','sesskey'].includes(key)),'only_notification_read_fields');
      notificationPosts++;
      return realPost(...args);
    });
    try {
      const announcements = await call('learnus_list_announcements',{limit:3}) as Omit<AnnouncementListResult,'diagnostics'>;
      check(!('diagnostics' in announcements),'internal_diagnostics_not_public');
      check(announcementSpy.mock.results.length===1 && announcementSpy.mock.results[0].type==='return','one_announcement_service_call');
      const internal = await announcementSpy.mock.results[0].value as AnnouncementListResult;
      diagnostics={...internal.diagnostics,warnings:announcements.warnings.filter(w=>/^[A-Z0-9_]+$/.test(w))};
      check(!announcements.warnings.includes('ANNOUNCEMENT_STRUCTURE_UNRECOGNIZED'),'announcement_list_recognized');
      check(diagnostics.parserMismatchCount===0,'announcement_parser_match');
      check(diagnostics.courseCount>0,'course_scan_succeeded');
      if(!announcements.items.length) {
        check(announcements.warnings.includes('NO_ANNOUNCEMENT_BOARDS')||announcements.warnings.includes('NO_ANNOUNCEMENTS_FOUND'),'announcement_empty_state_recognized');
      if(diagnostics.boardCount>0)check(diagnostics.boardRequestCount>0,'board_scan_succeeded');
      } else {
        const selected = announcements.items[0];
        const detail = await call('learnus_get_announcement',{moduleId:selected.moduleId,articleId:selected.id}) as {item?:AnnouncementDetail;warnings:string[]};
        check(!!detail.item?.title && typeof detail.item.content==='string','announcement_detail_normalized');
      }
      const notifications = await call('learnus_list_notifications',{limit:3}) as ListResult<LearnUsNotification>;
      check(Array.isArray(notifications.items) && notifications.items.length<=3,'notification_limit');
      check(!notifications.warnings.includes('NOTIFICATION_STRUCTURE_UNRECOGNIZED'),'notification_fragment_recognized');
      check(notificationPosts===1,'one_notification_read');
      check(auth.session.generation===generation && await auth.session.getContext()===context,'same_authenticated_session');
    } finally {getSpy.mockRestore();postSpy.mockRestore();}
  } catch(error) {
    throw new Error(`${integrationFailure('M5',checkpoint,error,diagnostics)} ${JSON.stringify(auth.loginDiagnostics)}`);
  } finally {
    announcementSpy.mockRestore();
    await mcp.close().catch(()=>undefined);await server.close().catch(()=>undefined);await auth.close();
  }
},360000);
