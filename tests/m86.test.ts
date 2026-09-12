import {it,expect,vi} from 'vitest';
import {LearnUsClient} from '../src/client/LearnUsClient.js';
import {PlaywrightAuthManager} from '../src/auth/PlaywrightAuthManager.js';
import {parseActivityCompletion} from '../src/parser/completion.js';
import {parseCourseContext,resolveVideo,requiredVideo} from '../src/parser/learning.js';
const video=(text='',icon='n')=>parseCourseContext(`<h1>Example</h1><div class="course-content"><li class="activity modtype_vod" id="module-11"><a href="/mod/vod/view.php?id=11">Same title</a><span class="autocompletion"><img src="/completion-auto-${icon}"></span><div class="contentafterlink">${text}</div></li></div>`,'7').videos[0];
const empty={mode:'unknown' as const,entries:[],warnings:[]};
it('recognizes completion icons, no tracking and unfamiliar tracking separately',()=>{
  expect(parseActivityCompletion('<img src="/completion-auto-y">')).toBe('complete');
  expect(parseActivityCompletion('<img src="/completion-auto-n">')).toBe('incomplete');
  expect(parseActivityCompletion('<a>File</a>')).toBe('not_tracked');
  expect(parseActivityCompletion('<div class="completion-new"><input type="checkbox"></div>')).toBe('unknown');
});
it('requires direct target evidence and keeps completion separate from attendance',()=>{
  expect(resolveVideo(video('필수 시청'),empty)).toMatchObject({attendanceTarget:'yes',completionState:'incomplete',attendanceStatus:'unknown'});
  expect(requiredVideo(resolveVideo(video('필수 시청'),empty))).toBe(true);
  expect(requiredVideo({...resolveVideo(video('필수 시청'),empty),completionState:'unknown',state:'unknown'})).toBe(false);
  expect(resolveVideo(video('시청 필요 없음'),empty)).toMatchObject({attendanceTarget:'no',state:'not_required'});
  expect(resolveVideo(video(),empty)).toMatchObject({attendanceTarget:'unknown'});
  expect(resolveVideo(video('필수 시청','y'),empty)).toMatchObject({state:'completed',attendanceStatus:'unknown'});
});
it('joins Progress stop by cmid only and never uses availability as a deadline',()=>{
  const v=video('시스템 이용 기간 2026-09-01 - 2026-12-27'),event={id:1,cmid:11,module:'vod',type:'progressstop',date:'2026-09-12T00:00:00Z',timesort:1789171200,name:'Same title'};
  expect(resolveVideo(v,empty).effectiveDueAt).toBeUndefined();
  expect(resolveVideo(v,empty,Date.now(),[{...event,cmid:12}]).effectiveDueAt).toBeUndefined();
  expect(resolveVideo(v,empty,Date.now(),[event])).toMatchObject({effectiveDueAt:event.date,effectiveDueSource:'calendar_progress_stop'});
  const conflict=resolveVideo(v,empty,Date.now(),[event,{...event,id:2,date:'2026-09-13T00:00:00Z'}]);
  expect(conflict.effectiveDueAt).toBeUndefined();expect(conflict.warnings).toContain('VIDEO_DEADLINE_CONFLICT');
});
it('explicit attendance completion excludes a video from required learning',()=>{
  expect(resolveVideo(video('필수 시청'),{mode:'attendance',entries:[{videoId:'11',title:'Unrelated title',officiallyRecognized:true}],warnings:[]})).toMatchObject({state:'completed',attendanceStatus:'attended'});
});
it.each(['complete','unknown'] as const)('new file notification does not make a %s resource required',async state=>{
  const client=new LearnUsClient(new PlaywrightAuthManager({getCredentials:vi.fn()}));
  vi.spyOn(client,'listCourses').mockResolvedValue({courses:[{id:7,url:'https://ys.learnus.org/course/view.php?id=7'}],warnings:[]});
  vi.spyOn(client,'listActivities').mockResolvedValue({activities:[{id:13,type:'unknown',module:'ubfile',completionState:state}]});
  vi.spyOn(client,'listNotifications').mockResolvedValue({items:[{id:'1',text:'New file uploaded'}],warnings:[]});
  const result=await client.getOverview({includeUpcoming:false,includeAnnouncements:false,includeNotifications:true});
  expect(result.resources?.[0].classification).not.toBe('actionable');
  expect(result.sectionSemantics?.notifications).toBe('informational');
});
