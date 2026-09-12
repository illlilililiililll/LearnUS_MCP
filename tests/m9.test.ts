import {readFileSync} from 'node:fs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {expect,it,vi} from 'vitest';
import {PlaywrightAuthManager} from '../src/auth/PlaywrightAuthManager.js';
import {LearnUsClient} from '../src/client/LearnUsClient.js';
import {createServer} from '../src/tools/index.js';

const result=(response:Awaited<ReturnType<Client['callTool']>>)=>JSON.parse(response.content.find(block=>block.type==='text')?.text||'{}');

it('keeps Tool definitions measurable and routing-specific without repeated global boilerplate',async()=>{
  const auth=new PlaywrightAuthManager({getCredentials:vi.fn()}),server=createServer(new LearnUsClient(auth)),client=new Client({name:'m9',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(a);await client.connect(b);
  try{
    const tools=(await client.listTools()).tools,total=tools.reduce((sum,tool)=>sum+Buffer.byteLength(JSON.stringify(tool)),0);
    expect(tools).toHaveLength(16);expect(total).toBeGreaterThan(0);
    expect(tools.every(tool=>!tool.description?.includes('Source: the authenticated Yonsei LearnUs'))).toBe(true);
    expect(tools.find(tool=>tool.name==='learnus_get_overview')?.description).toContain('generic personal to-do/calendar');
    expect(tools.find(tool=>tool.name==='learnus_get_weekly_tasks')?.description).toContain('informational/completed/optional/unknown');
  }finally{await client.close();await server.close();await auth.close();}
});

it('removes internal evidence and diagnostics only at the public MCP boundary',async()=>{
  const auth=new PlaywrightAuthManager({getCredentials:vi.fn()}),learnus=new LearnUsClient(auth);
  vi.spyOn(learnus,'learningOverview').mockResolvedValue({
    asOf:'2026-09-12T00:00:00.000Z',currentWeek:1,courses:[],requiredIncomplete:[],completed:[],excludedOrOptional:[],
    unknown:[{videoId:'11',courseId:'7',title:'Synthetic',completionState:'incomplete',attendanceTarget:'unknown',attendanceStatus:'unknown',applicability:'unknown',applicabilityConfidence:'low',state:'unknown',completionBasis:'unknown',confidence:'low',effectiveDueAt:'2026-09-13T00:00:00.000Z',effectiveDueSource:'calendar_progress_stop',deadlineCandidates:[{date:'2026-09-13T00:00:00.000Z',source:'calendar_progress_stop'}],deadlineBasis:['INTERNAL'],applicabilityBasis:['INTERNAL'],warnings:['VIDEO_DEADLINE_CONFLICT'],courseName:undefined,rawHtml:'<private>'} as never],
    warnings:['VIDEO_DEADLINE_CONFLICT'],diagnostics:{private:true},
  } as never);
  vi.spyOn(learnus,'listAnnouncements').mockResolvedValue({items:[],warnings:[],diagnostics:{courseCount:1,announcementWidgetCount:0,emptyCourseCount:1,boardCount:0,boardRequestCount:0,announcementCount:0,parserMismatchCount:0}});
  const server=createServer(learnus),client=new Client({name:'m9',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  try{
    const learningResponse=await client.callTool({name:'learnus_get_learning_overview',arguments:{courseId:'7'}}),learning=result(learningResponse),serialized=JSON.stringify(learningResponse);
    expect(learningResponse.structuredContent).toBeUndefined();
    expect(learning.unknown[0]).toMatchObject({completionState:'incomplete',attendanceTarget:'unknown',attendanceStatus:'unknown',effectiveDueAt:'2026-09-13T00:00:00.000Z',effectiveDueSource:'calendar_progress_stop',warnings:['VIDEO_DEADLINE_CONFLICT']});
    expect(serialized).not.toMatch(/deadlineCandidates|deadlineBasis|applicabilityBasis|diagnostics|rawHtml|<private>|courseName/);
    expect(JSON.stringify(await client.callTool({name:'learnus_list_announcements',arguments:{courseId:'7'}}))).not.toContain('diagnostics');
  }finally{await client.close();await server.close();await auth.close();}
});

it('keeps generated token reports structural and free of fixture values',()=>{
  const report=readFileSync(new URL('../docs/m9-token-evaluation.md',import.meta.url),'utf8'),baseline=readFileSync(new URL('../docs/m9-token-baseline.json',import.meta.url),'utf8');
  expect(report).toMatch(/Integration token evaluation: (?:NOT RUN|RUN)/);
  expect(report).toContain('Host-internal Tool tokenization: not observable');
  expect(report+baseline).not.toMatch(/Synthetic course|Synthetic assignment|Synthetic announcement|Synthetic notification|pluginfile\.php|forcedownload=1/);
});
