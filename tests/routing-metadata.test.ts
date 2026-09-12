import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LearnUsClient } from '../src/client/LearnUsClient.js';
import { createServer } from '../src/tools/index.js';

it('publishes an MCP-first routing contract without pretending to run an LLM eval',async()=>{
  const server=createServer({} as LearnUsClient),client=new Client({name:'routing-contract',version:'1'});
  const [serverTransport,clientTransport]=InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);await client.connect(clientTransport);
  try{
    const tools=(await client.listTools()).tools,byName=new Map(tools.map(tool=>[tool.name,tool]));
    const scenarios=[
      ['LearnUs에서 수강 강의 보여줘','learnus_list_courses','courses/classes'],
      ['이 강의 활동 목록 보여줘','learnus_list_activities','activities or learning materials'],
      ['이 과제 상세와 제출 상태 알려줘','learnus_get_assignment','details or status'],
      ['LearnUs 이번 주 해야 할 일 알려줘','learnus_get_weekly_tasks','coursework remains this week'],
      ['이번 주에 해야 할 과제 뭐 있어?','learnus_get_weekly_tasks','assignments'],
      ['이번 주 수업 중 해야 하는 것 정리해줘','learnus_get_weekly_tasks','coursework'],
      ['안 들은 필수 강의 있어?','learnus_get_weekly_tasks','required lecture videos'],
      ['과제 마감 언제야?','learnus_get_weekly_tasks','academic deadlines'],
      ['최근 수업 관련 중요한 것 있어?','learnus_get_overview','what matters'],
      ['내 수업들 전체적으로 한번 확인해줘','learnus_get_overview','multiple categories'],
      ['이번 주 출석해야 할 영상 있어?','learnus_get_learning_overview','completion or attendance'],
      ['최근 강의 공지 보여줘','learnus_list_announcements','course notices or announcements'],
      ['강의자료 PDF와 첨부파일 찾아줘','learnus_list_files','course files, lecture materials, PDFs'],
    ] as const;
    const matched=scenarios.filter(([prompt,name,phrase])=>{
      const description=byName.get(name)?.description||'';
      expect(description,`${prompt} -> ${name}`).toContain(phrase);
      return true;
    }).length;
    expect(matched/scenarios.length).toBe(1);
    expect(client.getInstructions()).toContain('Do not select LearnUs solely for generic personal to-do/calendar questions');
    expect(client.getInstructions()).toContain('no Tool supports the capability');
    expect(client.getInstructions()).toContain('visual UI interaction');
    expect(client.getInstructions()).toContain('not evidence that a capability is unsupported');
    expect(byName.get('learnus_get_weekly_tasks')?.description).toContain('unrelated personal to-do/calendar questions');
    expect(byName.get('learnus_get_overview')?.description).toContain('default broad LearnUs retrieval Tool');
    for(const tool of tools)for(const property of Object.values(tool.inputSchema.properties||{}))
      expect(property).toHaveProperty('description');
  }finally{await client.close();await server.close();}
});
