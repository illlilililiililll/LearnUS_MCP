import { readFileSync } from 'node:fs';
import { it, expect, vi } from 'vitest';
import { parseAnnouncements, parseAnnouncement, announcementModules, parseInlineAnnouncements } from '../src/parser/announcement.js';
import { parseNotifications } from '../src/parser/notification.js';
import { LearnUsClient } from '../src/client/LearnUsClient.js';
import { PlaywrightAuthManager } from '../src/auth/PlaywrightAuthManager.js';
const fixture = (name:string)=>readFileSync(new URL(`./fixtures/${name}.html`,import.meta.url),'utf8');
it('normalizes board rows by identity and labels under unfamiliar wrappers',()=>{
  const result = parseAnnouncements(fixture('announcements'),'11','7');
  expect(result.items.map(item=>item.id)).toEqual(['21','22','23']);
  expect(result.items[0]).toMatchObject({title:'Earlier notice',author:'Example author',createdAt:'2026-09-01T09:00:00+09:00',courseId:'7'});
  expect(result.items[1].author).toBeUndefined();
  expect(result.items[2].createdAt).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('synthetic-private');
});
it('distinguishes empty boards and parser mismatch',()=>{
  expect(parseAnnouncements('<div>등록된 게시물이 없습니다.</div>','11').warnings).toEqual(['NO_ANNOUNCEMENTS_FOUND']);
  expect(parseAnnouncements('<section>Unexpected wrapper</section>','11').warnings).toEqual(['ANNOUNCEMENT_STRUCTURE_UNRECOGNIZED']);
  expect(parseAnnouncements('<div><a href="/mod/ubboard/article.php?id=11&bwid=9">Title</a><time datetime="2026-09-01">Date</time></div>','11').items[0].createdAt).toBe('2026-09-01T00:00:00+09:00');
});
it('discovers only semantically identified announcement widgets',()=>{
  const menu = '<nav><a href="/mod/ubboard/view.php?id=99">Menu</a></nav><footer><a href="/mod/ubboard/view.php?id=98">Footer</a></footer>';
  expect(announcementModules(menu+'<div class="course-content"></div>').moduleIds).toEqual([]);
  expect(announcementModules(menu+'<section class="course-article"><header class="course-article-header"><h5>과목공지</h5></header><div class="actions"><a href="/mod/ubboard/view.php?id=11">More</a></div></section>').moduleIds).toEqual(['11']);
});
it('parses inline widgets, empty courses, malformed links and duplicate identities',()=>{
  const article='<div class="article-list-item"><a href="/mod/ubboard/article.php?id=11&amp;bwid=21"><span class="article-subject">Synthetic notice</span></a><span class="article-date">2026-09-02</span></div>';
  const widget=(label:string,body:string)=>`<section class="course-article"><header class="course-article-header"><h5>${label}</h5></header><div class="actions"><a href="/mod/ubboard/view.php?id=11">More</a></div><div class="course-article-body"><div class="article-list">${body}</div></div></section>`;
  const parsed=parseInlineAnnouncements(widget('Course announcements',article+article),'7');
  expect(parsed.items).toHaveLength(1);expect(parsed.items[0]).toMatchObject({id:'21',moduleId:'11',courseId:'7',title:'Synthetic notice',createdAt:'2026-09-02T00:00:00+09:00'});
  expect(parsed.moduleIds).toEqual(['11']);expect(parsed.parserMismatchCount).toBe(0);
  expect(parseInlineAnnouncements(widget('과목공지',''),'7')).toMatchObject({items:[],widgetCount:1,emptyWidgetCount:1,parserMismatchCount:0});
  expect(parseInlineAnnouncements('<main class="course-content"></main>','7')).toMatchObject({items:[],widgetCount:0,parserMismatchCount:0});
  expect(parseInlineAnnouncements(widget('Announcements','<div class="article-list-item"><a href="/mod/ubboard/article.php?id=11&amp;bwid=bad"><span class="article-subject">Synthetic</span></a></div>'),'7').parserMismatchCount).toBe(1);
});
it('preserves article lists wrapped in forms',()=>{
  const result=parseAnnouncements('<form><div class="article-list"><div class="article-list-item"><a href="/mod/ubboard/article.php?id=11&amp;bwid=21"><span class="article-subject">Synthetic</span></a></div></div></form>','11');
  expect(result.items).toHaveLength(1);expect(result.warnings).toEqual([]);
});
it('returns readable detail and attachment metadata without scripts or navigation',()=>{
  const result = parseAnnouncement(fixture('announcement-detail'),'11','22');
  expect(result.item).toMatchObject({title:'Example announcement',author:'Example author',createdAt:'2026-09-02T09:00:00+09:00',content:'First paragraph.\nSecond line.\nAnother paragraph.',attachments:[{name:'example.pdf',url:'https://ys.learnus.org/pluginfile.php/123/mod_ubboard/article/22/example.pdf?forcedownload=1'}]});
  expect(JSON.stringify(result)).not.toMatch(/synthetic-private|<script|Tracking navigation|Delete/);
  expect(parseAnnouncement('<article><h1>Title</h1></article>','11','22').warnings).toEqual(['ANNOUNCEMENT_CONTENT_MISSING']);
});
it('normalizes notifications and does not invent read status',()=>{
  const result = parseNotifications(fixture('notifications'));
  expect(result.items).toHaveLength(2);
  expect(result.items[0]).toMatchObject({id:'31',title:'Example notification',text:'Example text',read:false,url:'https://ys.learnus.org/mod/assign/view.php?id=12'});
  expect(result.items[0].createdAt).toBe('2026-09-02T10:00:00+09:00');
  expect(result.items[1].read).toBeUndefined();
  expect(result.items[1].url).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('synthetic-private');
});
it('distinguishes empty and malformed notification fragments',()=>{
  expect(parseNotifications('<div class="media-lists"></div>').warnings).toEqual(['NO_NOTIFICATIONS_FOUND']);
  expect(parseNotifications('<p>No notifications</p>').warnings).toEqual(['NO_NOTIFICATIONS_FOUND']);
  expect(parseNotifications('<div class="media-lists"><a class="media">Broken</a></div>').warnings).toEqual(['NOTIFICATION_STRUCTURE_UNRECOGNIZED']);
  expect(parseNotifications(undefined).warnings).toEqual(['NOTIFICATION_STRUCTURE_UNRECOGNIZED']);
});
function harness(getBody:(url:string)=>string,status=200) {
  const auth = new PlaywrightAuthManager({getCredentials:vi.fn()});
  auth.session.sesskey = 'synthetic-key';
  const ensure = vi.spyOn(auth,'ensureAuthenticated').mockResolvedValue();
  const response = (url:string,body:string) => ({url:()=>url,status:()=>status,ok:()=>status<400,text:async()=>body,dispose:vi.fn()});
  const get = vi.fn(async(url:string)=>response(url,getBody(url)));
  const post = vi.fn(async(url:string)=>response(url,JSON.stringify({code:'100',html:fixture('notifications')})));
  vi.spyOn(auth.session,'getContext').mockResolvedValue({request:{get,post}} as never);
  return {client:new LearnUsClient(auth),auth,ensure,get,post};
}
const course = '<script>M.cfg={sesskey:"synthetic"}</script><a href="/login/logout.php">Logout</a><div class="course-content"><section class="course-article"><header class="course-article-header"><h5>과목공지</h5></header><div class="actions"><a href="/mod/ubboard/view.php?id=11">More</a></div><div class="course-article-body"><div class="article-list"></div></div></section><li class="activity modtype_ubboard" id="module-99"><a href="/mod/ubboard/view.php?id=99">Q and A</a></li></div>';
it('reads board pages before globally sorting and limiting the unique articles',async()=>{
  const h = harness(url=>url.includes('/course/') ? course : url.includes('page=1') ? '<li><a href="/mod/ubboard/article.php?id=11&bwid=24">Newest</a><time datetime="2026-09-03">Date</time></li>' : fixture('announcements')+'<a rel="next" href="/mod/ubboard/view.php?id=11&page=1">Next</a>');
  const result = await h.client.listAnnouncements({courseId:'7',limit:2});
  expect(result.items.map(item=>item.id)).toEqual(['24','22']);
  expect(result.warnings).toEqual(['ANNOUNCEMENT_DATES_MISSING']);
  expect(h.get).toHaveBeenCalledTimes(3);
  expect(h.get.mock.calls.filter(([url])=>new URL(url).pathname==='/mod/ubboard/view.php').every(([url])=>new URL(url).searchParams.get('id')==='11')).toBe(true);
  expect(h.post).not.toHaveBeenCalled();
});
it('separates no board, no articles, endpoint failure and parser mismatch',async()=>{
  const none = harness(()=>'<a href="/login/logout.php">Logout</a><div class="course-content"></div>');
  expect((await none.client.listAnnouncements({courseId:'7'})).warnings).toEqual(['NO_ANNOUNCEMENT_BOARDS']);
  const empty = harness(url=>url.includes('/course/')?course:'No posts found');
  expect((await empty.client.listAnnouncements({courseId:'7'})).warnings).toEqual(['NO_ANNOUNCEMENTS_FOUND']);
  const malformed = harness(url=>url.includes('/course/')?course:'Unexpected');
  expect((await malformed.client.listAnnouncements({courseId:'7'})).warnings).toEqual(['ANNOUNCEMENT_STRUCTURE_UNRECOGNIZED']);
  const unavailable = harness(()=>'',404);
  await expect(unavailable.client.getAnnouncement('11','22')).rejects.toThrow('ENDPOINT_UNAVAILABLE');
});
it('continues after one board endpoint is unavailable',async()=>{
  const h=harness(()=>''),twoBoards=course.replace('</div></div></section>','</div></div></section><section class="course-article"><header class="course-article-header"><h5>Announcements</h5></header><div class="actions"><a href="/mod/ubboard/view.php?id=12">More</a></div></section>');
  h.get.mockImplementation(async url=>{
    const parsed=new URL(url),status=parsed.pathname==='/mod/ubboard/view.php'&&parsed.searchParams.get('id')==='11'?404:200;
    const body=parsed.pathname==='/course/view.php'?twoBoards:`<article><a href="/mod/ubboard/article.php?id=12&bwid=21">Synthetic</a></article>`;
    return {url:()=>url,status:()=>status,ok:()=>status<400,text:async()=>body,dispose:vi.fn()};
  });
  const result=await h.client.listAnnouncements({courseId:'7'});
  expect(result.items).toHaveLength(1);expect(result.warnings).toContain('ENDPOINT_UNAVAILABLE');expect(result.diagnostics).toMatchObject({courseCount:1,boardCount:2,boardRequestCount:2,announcementCount:1});
});
it('continues after one course endpoint is unavailable',async()=>{
  const h=harness(()=>''),response=(url:string,status:number,body:string)=>({url:()=>url,status:()=>status,ok:()=>status<400,text:async()=>body,dispose:vi.fn()});
  vi.spyOn(h.client,'listCourses').mockResolvedValue({courses:[{id:7,url:'https://ys.learnus.org/course/view.php?id=7'},{id:8,url:'https://ys.learnus.org/course/view.php?id=8'}],warnings:[]});
  h.get.mockImplementation(async url=>{
    const parsed=new URL(url);
    if(parsed.pathname==='/course/view.php')return parsed.searchParams.get('id')==='7'?response(url,404,''):response(url,200,course);
    return response(url,200,'<article><a href="/mod/ubboard/article.php?id=11&bwid=21">Synthetic</a></article>');
  });
  const result=await h.client.listAnnouncements();
  expect(result.items).toHaveLength(1);expect(result.warnings).toContain('ENDPOINT_UNAVAILABLE');expect(result.diagnostics).toMatchObject({courseCount:1,boardCount:1,boardRequestCount:1,announcementCount:1});
});
it('only posts the notification read action and never downloads attachments or follows links',async()=>{
  const h = harness(()=>fixture('announcement-detail'));
  await h.client.getAnnouncement('11','22');
  expect(h.get.mock.calls.map(([url])=>new URL(url).pathname)).toEqual(['/mod/ubboard/article.php']);
  expect((await h.client.listNotifications({limit:1})).items).toHaveLength(1);
  expect(h.post).toHaveBeenCalledExactlyOnceWith('https://ys.learnus.org/theme/coursemosv2/action.php',expect.objectContaining({form:{type:'userInfoNotifications',sesskey:'synthetic-key'}}));
  await expect(h.client.getAnnouncement('11&action=delete','22')).rejects.toThrow('PARSE_ERROR');
  expect(h.get).toHaveBeenCalledTimes(1);
});
it('reuses the shared retry once after a notification sesskey expires',async()=>{
  const h = harness(()=>''), response = {url:()=> 'https://ys.learnus.org/theme/coursemosv2/action.php',status:()=>200,ok:()=>true,dispose:vi.fn(),text:async()=>JSON.stringify({errorcode:'invalidsesskey',message:'synthetic-private'})};
  h.post.mockResolvedValueOnce(response);
  h.ensure.mockImplementation(async generation=>{if(generation!==undefined)h.auth.session.sesskey='synthetic-new';});
  expect((await h.client.listNotifications()).items).toHaveLength(2);
  expect(h.post).toHaveBeenCalledTimes(2);
  expect(h.post).toHaveBeenLastCalledWith(expect.any(String),expect.objectContaining({form:{type:'userInfoNotifications',sesskey:'synthetic-new'}}));
  expect(response.dispose).toHaveBeenCalledOnce();
});
it('merges current-course boards before applying the global limit',async()=>{
  const h = harness(url=>{
    const parsed = new URL(url);
    if (parsed.pathname==='/course/view.php') return course.replaceAll('11',parsed.searchParams.get('id')==='7'?'11':'12');
    const moduleId = parsed.searchParams.get('id')!;
    return `<article><a href="/mod/ubboard/article.php?id=${moduleId}&bwid=21">Synthetic</a><time datetime="2026-09-${moduleId==='11'?'01':'03'}">Date</time></article>`;
  });
  vi.spyOn(h.client,'listCourses').mockResolvedValue({courses:[{id:7,url:'https://ys.learnus.org/course/view.php?id=7'},{id:8,url:'https://ys.learnus.org/course/view.php?id=8'}],warnings:[]});
  const result = await h.client.listAnnouncements({limit:1});
  expect(result.items[0]).toMatchObject({courseId:'8',moduleId:'12'});
  expect(result.warnings).toEqual([]);
});
it('does not request boards when inline previews satisfy the limit',async()=>{
  const inline=course.replace('<div class="article-list"></div>','<div class="article-list"><div class="article-list-item"><a href="/mod/ubboard/article.php?id=11&amp;bwid=21"><span class="article-subject">Synthetic</span></a><span class="article-date">2026-09-02</span></div></div>');
  const h=harness(url=>new URL(url).searchParams.get('id')==='7'?inline:'<a href="/login/logout.php">Logout</a><main class="course-content"></main>');
  vi.spyOn(h.client,'listCourses').mockResolvedValue({courses:[{id:7,url:'https://ys.learnus.org/course/view.php?id=7'},{id:8,url:'https://ys.learnus.org/course/view.php?id=8'}],warnings:[]});
  const result=await h.client.listAnnouncements({limit:1});
  expect(result.items).toHaveLength(1);expect(result.warnings).toEqual([]);expect(result.diagnostics).toMatchObject({emptyCourseCount:1,boardRequestCount:0});expect(h.get).toHaveBeenCalledTimes(2);
});
it('reports repeated authentication expiry separately from empty notifications',async()=>{
  const h = harness(()=>''), response = {url:()=> 'https://ys.learnus.org/theme/coursemosv2/action.php',status:()=>200,ok:()=>true,dispose:vi.fn(),text:async()=>JSON.stringify({errorcode:'invalidsesskey'})};
  h.post.mockResolvedValue(response);
  await expect(h.client.listNotifications()).rejects.toThrow('SESSION_EXPIRED');
  expect(h.post).toHaveBeenCalledTimes(2);
});
