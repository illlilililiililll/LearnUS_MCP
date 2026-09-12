import {expect,it,vi} from 'vitest';
import {LearnUsClient} from '../src/client/LearnUsClient.js';
import {PlaywrightAuthManager} from '../src/auth/PlaywrightAuthManager.js';
import type {LearnUsOverview} from '../src/models/Overview.js';

it('delegates once and preserves actionability, partial warnings, and all summary sections',async()=>{
  const client=new LearnUsClient(new PlaywrightAuthManager({getCredentials:vi.fn()}));
  const result:LearnUsOverview={range:{from:'2026-09-07',to:'2026-09-13'},assignments:[{cmid:1,courseId:7,url:'https://ys.learnus.org/mod/assign/view.php?id=1',classification:'completed'},{cmid:2,courseId:7,url:'https://ys.learnus.org/mod/assign/view.php?id=2',classification:'actionable'}],resources:[{cmid:3,courseId:7,completionState:'complete',classification:'completed'},{cmid:4,courseId:7,completionState:'unknown',classification:'unknown'}],learning:{actionable:[],completed:[],unknown:[]},notifications:[{text:'New file uploaded'}],sectionSemantics:{announcements:'informational',notifications:'informational',upcoming:'schedule_not_completion'},warnings:['LEARNING_UNAVAILABLE']};
  const overview=vi.spyOn(client,'getOverview').mockResolvedValue(result);
  expect(await client.getWeeklyTasks({courseId:'7',from:'2026-09-07',to:'2026-09-13'})).toBe(result);
  expect(overview).toHaveBeenCalledExactlyOnceWith({courseId:7,from:'2026-09-07',to:'2026-09-13',includeLearning:true});
});

it('inherits the existing Korea Monday-Sunday range at the UTC Sunday boundary',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-06T16:00:00Z'));
  try{const client=new LearnUsClient(new PlaywrightAuthManager({getCredentials:vi.fn()}));
    vi.spyOn(client,'listCourses').mockResolvedValue({courses:[],warnings:[]});
    vi.spyOn(client,'listAnnouncements').mockResolvedValue({items:[],warnings:[],diagnostics:{courseCount:0,announcementWidgetCount:0,emptyCourseCount:0,boardCount:0,boardRequestCount:0,announcementCount:0,parserMismatchCount:0}});
    vi.spyOn(client,'upcoming').mockResolvedValue({events:[],warnings:[],truncated:false});
    expect((await client.getWeeklyTasks()).range).toEqual({from:'2026-09-07',to:'2026-09-13'});
    await expect(client.getWeeklyTasks({from:'2026-09-14',to:'2026-09-07'})).rejects.toThrow('PARSE_ERROR');
  }finally{vi.useRealTimers();}
});

it('rejects invalid inputs before orchestration',async()=>{
  const client=new LearnUsClient(new PlaywrightAuthManager({getCredentials:vi.fn()})),overview=vi.spyOn(client,'getOverview');
  for(const input of [{courseId:'0'},{courseId:'9007199254740992'},{courseId:'7&action=delete'},{from:'invalid'}])await expect(client.getWeeklyTasks(input)).rejects.toThrow('PARSE_ERROR');
  expect(overview).not.toHaveBeenCalled();
});
