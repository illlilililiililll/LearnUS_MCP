import { expect, it, vi } from 'vitest';
import { LearnUsClient } from '../src/client/LearnUsClient.js';
import { PlaywrightAuthManager } from '../src/auth/PlaywrightAuthManager.js';

const announcementDiagnostics={courseCount:1,announcementWidgetCount:1,emptyCourseCount:0,boardCount:1,boardRequestCount:0,announcementCount:1,parserMismatchCount:0};
function harness(){return new LearnUsClient(new PlaywrightAuthManager({getCredentials:vi.fn()}));}
function sources(client:LearnUsClient){
  const courses=vi.spyOn(client,'listCourses').mockResolvedValue({courses:[{id:7,name:'Synthetic course',url:'https://ys.learnus.org/course/view.php?id=7'}],warnings:[]});
  const activities=vi.spyOn(client,'listActivities').mockResolvedValue({activities:[{id:11,type:'assign',name:'Synthetic assignment'},{id:11,type:'assign',name:'Duplicate'}]});
  const assignment=vi.spyOn(client,'getAssignment').mockResolvedValue({cmid:11,url:'https://ys.learnus.org/mod/assign/view.php?id=11',title:'Synthetic assignment',description:'private full description',dueDate:'2026-09-03',submissionStatus:'Pending',extraFields:[{label:'Private',value:'Value'}],warnings:[],attachments:[]});
  const upcoming=vi.spyOn(client,'upcoming').mockResolvedValue({events:[{id:2,timesort:1788372000,date:'2026-09-03T00:00:00.000Z',name:'Synthetic event'},{id:2,timesort:1788372000,date:'2026-09-03T00:00:00.000Z'}],warnings:[],truncated:false});
  const announcements=vi.spyOn(client,'listAnnouncements').mockResolvedValue({items:[{id:'21',moduleId:'10',title:'Synthetic notice',createdAt:'2026-09-04',url:'https://ys.learnus.org/mod/ubboard/article.php?id=10&bwid=21'},{id:'21',moduleId:'10',title:'Duplicate',createdAt:'2026-09-04',url:'https://ys.learnus.org/mod/ubboard/article.php?id=10&bwid=21'}],warnings:[],diagnostics:announcementDiagnostics});
  const notifications=vi.spyOn(client,'listNotifications').mockResolvedValue({items:[{id:'31',title:'Synthetic notification',text:'x'.repeat(250),createdAt:'2026-09-05'},{id:'31',title:'Duplicate',createdAt:'2026-09-05'}],warnings:[]});
  return {courses,activities,assignment,upcoming,announcements,notifications};
}

it('combines normalized sources without copying full assignment content',async()=>{
  const client=harness(),spy=sources(client);
  const result=await client.getOverview({from:'2026-09-01',to:'2026-09-07',includeCourses:true,includeNotifications:true});
  expect(result).toMatchObject({range:{from:'2026-09-01',to:'2026-09-07'},courses:[{id:7}],upcoming:[{id:2}],assignments:[{cmid:11,courseId:7}],announcements:[{id:'21'}],notifications:[{id:'31'}],warnings:[]});
  expect(result.notifications?.[0].text).toHaveLength(200);
  expect(JSON.stringify(result)).not.toMatch(/private full description|extraFields|attachments/);
  expect(spy.courses).toHaveBeenCalledOnce();expect(spy.activities).toHaveBeenCalledOnce();expect(spy.assignment).toHaveBeenCalledOnce();
  expect(spy.upcoming).toHaveBeenCalledExactlyOnceWith({from:'2026-09-01',to:'2026-09-07',limit:10});
});
it('keeps successful sections when one source fails',async()=>{
  const client=harness();sources(client).announcements.mockRejectedValue(new Error('private'));
  const result=await client.getOverview({from:'2026-09-01',to:'2026-09-07'});
  expect(result.upcoming).toHaveLength(1);expect(result.assignments).toHaveLength(1);expect(result.announcements).toBeUndefined();expect(result.warnings).toContain('ANNOUNCEMENTS_UNAVAILABLE');
});
it('keeps an overview when several sources fail',async()=>{
  const client=harness(),spy=sources(client);spy.upcoming.mockRejectedValue(new Error('private'));spy.courses.mockRejectedValue(new Error('private'));spy.notifications.mockRejectedValue(new Error('private'));
  const result=await client.getOverview({from:'2026-09-01',to:'2026-09-07',includeCourses:true,includeNotifications:true});
  expect(result.announcements).toHaveLength(1);expect(result.courses).toBeUndefined();expect(result.assignments).toBeUndefined();
  expect(result.warnings).toEqual(expect.arrayContaining(['COURSES_UNAVAILABLE','ASSIGNMENTS_UNAVAILABLE','UPCOMING_UNAVAILABLE','NOTIFICATIONS_UNAVAILABLE']));
});
it('deduplicates, filters dated summaries and applies each section limit',async()=>{
  const client=harness(),spy=sources(client);
  spy.announcements.mockResolvedValue({items:[{id:'1',moduleId:'10',title:'Inside',createdAt:'2026-09-03',url:'https://ys.learnus.org/mod/ubboard/article.php?id=10&bwid=1'},{id:'2',moduleId:'10',title:'Outside',createdAt:'2026-08-01',url:'https://ys.learnus.org/mod/ubboard/article.php?id=10&bwid=2'}],warnings:[],diagnostics:announcementDiagnostics});
  const result=await client.getOverview({from:'2026-09-01',to:'2026-09-07',includeCourses:true,maxItemsPerSection:1});
  expect(result.courses).toHaveLength(1);expect(result.upcoming).toHaveLength(1);expect(result.assignments).toHaveLength(1);expect(result.announcements?.map(item=>item.id)).toEqual(['1']);
  expect(spy.announcements).toHaveBeenCalledExactlyOnceWith({limit:1});
});
it('returns requested empty sections without treating them as failures',async()=>{
  const client=harness(),spy=sources(client);spy.courses.mockResolvedValue({courses:[],warnings:[]});spy.upcoming.mockResolvedValue({events:[],warnings:[],truncated:false});spy.announcements.mockResolvedValue({items:[],warnings:[],diagnostics:{...announcementDiagnostics,announcementCount:0}});spy.notifications.mockResolvedValue({items:[],warnings:[]});
  const result=await client.getOverview({from:'2026-09-01',to:'2026-09-07',includeCourses:true,includeNotifications:true});
  expect(result).toMatchObject({courses:[],upcoming:[],assignments:[],announcements:[],notifications:[],warnings:[]});
});
it('does not call disabled sources and supplies the current Korea week by default',async()=>{
  const client=harness(),spy=sources(client);
  const result=await client.getOverview({includeUpcoming:false,includeAssignments:false,includeAnnouncements:false});
  expect(result.range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);expect(result.range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect((Date.parse(result.range.to)-Date.parse(result.range.from))/86400000).toBe(6);
  expect(spy.courses).not.toHaveBeenCalled();expect(spy.upcoming).not.toHaveBeenCalled();expect(spy.announcements).not.toHaveBeenCalled();expect(spy.notifications).not.toHaveBeenCalled();
});
it('bounds course activity concurrency to three',async()=>{
  const client=harness(),spy=sources(client),courses=Array.from({length:7},(_,index)=>({id:index+1,url:`https://ys.learnus.org/course/view.php?id=${index+1}`}));
  spy.courses.mockResolvedValue({courses,warnings:[]});let active=0,peak=0;
  spy.activities.mockImplementation(async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return {activities:[]};});
  await client.getOverview({from:'2026-09-01',to:'2026-09-07',includeUpcoming:false,includeAnnouncements:false});
  expect(peak).toBe(3);expect(spy.activities).toHaveBeenCalledTimes(7);
});
it('shares dashboard and course GETs across aggregate sources',async()=>{
  const auth=new PlaywrightAuthManager({getCredentials:vi.fn()}),client=new LearnUsClient(auth),marker='<script>M.cfg={sesskey:"synthetic"}</script><a href="/login/logout.php">Logout</a>';
  vi.spyOn(auth,'ensureAuthenticated').mockResolvedValue();
  vi.spyOn(client,'upcoming').mockResolvedValue({events:[],warnings:[],truncated:false});
  const get=vi.fn(async(url:string)=>{
    const parsed=new URL(url);let body=marker;
    if(parsed.pathname==='/')body+=`<a href="/course/view.php?id=7">Synthetic course</a>`;
    if(parsed.pathname==='/course/view.php')body+=`<li class="activity modtype_assign" id="module-11"><a href="/mod/assign/view.php?id=11">Synthetic assignment</a></li><section class="course-article"><header class="course-article-header"><h5>Announcements</h5></header><div class="article-list-item"><a href="/mod/ubboard/article.php?id=10&amp;bwid=21"><span class="article-subLine article-subject">Synthetic notice</span></a><span class="article-date">2026-09-04</span></div></section>`;
    return {url:()=>url,status:()=>200,ok:()=>true,text:async()=>body,dispose:vi.fn()};
  });
  vi.spyOn(auth.session,'getContext').mockResolvedValue({request:{get}} as never);
  await client.getOverview({from:'2026-09-01',to:'2026-09-07',maxItemsPerSection:1});
  const paths=get.mock.calls.map(([url])=>new URL(url).pathname);
  expect(paths.filter(path=>path==='/')).toHaveLength(1);expect(paths.filter(path=>path==='/course/view.php')).toHaveLength(1);expect(paths.filter(path=>path==='/mod/assign/view.php')).toHaveLength(1);
});
