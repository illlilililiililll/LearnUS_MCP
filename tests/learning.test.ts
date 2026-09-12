import { describe,it,expect } from 'vitest';
import { courseSemester, currentWeek, parseCompletionReport, parseCourseContext, resolveDeadline, resolveVideo } from '../src/parser/learning.js';

const course=(description='')=>`<h1 class="coursename">Synthetic (TST1000.01-00) 2026-2학기</h1><div class="course-content">
<li class="section"><h3 class="sectionname">1주차 [9월 1일 - 9월 11일]</h3></li>
<li class="section"><h3 class="sectionname">2주차 [9월 7일 - 9월 18일]</h3><div class="summary">${description}</div><ul>
<li class="activity modtype_vod" id="module-11"><a href="/mod/vod/view.php?id=11"><span class="instancename">[UIC] Synthetic video<span class="accesshide">VOD</span></span></a><span class="autocompletion"><img src="/completion-auto-n" title="완료하지 못함: Synthetic"></span><div class="contentafterlink">시스템 이용 기간 2026-09-01 - 2026-12-27<br>실험 1 수업 이전까지</div></li>
</ul></li></div>`;
const progress=`<table class="user_progress"><tr><th>주</th><th>강의 자료</th><th>콘텐츠 길이</th><th>최대 학습위치</th><th>진도율</th></tr>
<tr><td><div class="sectiontitle">2</div></td><td><a href="/mod/vod/view.php?id=11">[UIC] Synthetic video</a></td><td>10:00</td><td>05:00<br><button data-modname="vod" data-modid="901"></button></td><td>50%</td></tr></table>`;
const attendance=`<table class="user_progress_table"><tr><th></th><th>강의 자료</th><th>출석인정 요구시간</th><th>총 학습시간</th><th>출석</th><th>주차 출석</th></tr>
<tr><td rowspan="2">2</td><td><a href="/mod/vod/view.php?id=11"><img alt="Synthetic A"></a></td><td>09:00</td><td>10:00<button data-modname="vod" data-modid="901" data-sterm="2026-09-01 00:00" data-eterm="2026-09-08 09:00"></button></td><td>O</td><td rowspan="2">O</td></tr>
<tr><td><a href="/mod/vod/view.php?id=12">Synthetic B</a></td><td>09:00</td><td>00:30<button data-modname="vod" data-modid="902"></button></td><td></td></tr></table>`;

describe('learning normalization',()=>{
  it('normalizes full and term-only dashboard semester labels',()=>{
    expect(courseSemester('Synthetic 2026년2학기')).toBe('2026-2');
    expect(courseSemester('Synthetic (2학기)',Date.parse('2026-09-09T00:00:00+09:00'))).toBe('2026-2');
  });
  it('detects progress and attendance report semantics, including rowspans',()=>{
    const p=parseCompletionReport(progress,'https://ys.learnus.org/report/ubcompletion/user_progress.php');
    expect(p.mode).toBe('progress');expect(p.entries[0]).toMatchObject({progressPercent:50,maxPositionSeconds:300,contentLengthSeconds:600,instanceId:'901'});
    const a=parseCompletionReport(attendance,'https://ys.learnus.org/report/ubcompletion/user_progress_a.php');
    expect(a.mode).toBe('attendance');expect(a.entries).toHaveLength(2);expect(a.entries[0]).toMatchObject({title:'Synthetic A',officiallyRecognized:true,effectiveDueAt:'2026-09-08T09:00:00+09:00',deadlineBasis:['ATTENDANCE_RECOGNITION_PERIOD']});expect(a.entries[1].weeklyAttendanceRecognized).toBe(true);
  });
  it('keeps unknown report structures distinct from empty reports',()=>expect(parseCompletionReport('<main></main>','https://ys.learnus.org/').warnings).toContain('COMPLETION_STRUCTURE_UNRECOGNIZED'));
  it('chooses the latest started overlapping week',()=>expect(currentWeek([{week:1,start:'2026-09-01T00:00:00+09:00',end:'2026-09-11T23:59:59+09:00'},{week:2,start:'2026-09-07T00:00:00+09:00',end:'2026-09-18T23:59:59+09:00'}],Date.parse('2026-09-07T12:00:00+09:00'))).toBe(2));
  it('excludes a confirmed audience even with partial progress',()=>{
    const context=parseCourseContext(course().replace('시스템 이용 기간','UIC 영상은 일반/공학 수강생은 시청할 필요 없습니다.<br>시스템 이용 기간'),'7',{audienceTags:['engineering']},Date.parse('2026-09-07T12:00:00+09:00'));
    const report=parseCompletionReport(progress.replace('50%','0.99%'),'https://ys.learnus.org/report/ubcompletion/user_progress.php');
    expect(resolveVideo(context.videos[0],report)).toMatchObject({state:'not_required',progressPercent:0.99});
    expect(context.videos[0]).toMatchObject({completionHint:false,applicability:'not_applicable',deadlinePrecision:'relative',instructionalDueRule:'실험 1 수업 이전까지',systemAvailableUntil:'2026-12-27T23:59:59+09:00'});
    expect(context.videos[0].effectiveDueAt).toBeUndefined();
  });
  it('uses an attendance O ahead of a negative completion hint',()=>{
    const report=parseCompletionReport(attendance,'https://ys.learnus.org/report/ubcompletion/user_progress_a.php');
    const base=parseCourseContext(course(),'7',{},Date.parse('2026-09-07T12:00:00+09:00')).videos[0];
    const result=resolveVideo({...base,title:'Synthetic A',applicability:'required'},report);
    expect(result).toMatchObject({state:'completed',completionBasis:'attendance',officiallyRecognized:true});expect(result.warnings).toContain('COMPLETION_HINT_DISAGREEMENT');expect(report.entries[1].officiallyRecognized).toBeNull();
  });
  it('treats individual attendance X as required and keeps dash distinct',()=>{
    const report=parseCompletionReport(attendance.replace('10:00<button','00:00<button').replace('<td>O</td><td rowspan="2">O</td>','<td>X</td><td rowspan="2">X</td>'),'https://ys.learnus.org/report/ubcompletion/user_progress_a.php');
    const base=parseCourseContext(course(),'7',{},Date.parse('2026-09-07T12:00:00+09:00')).videos[0];
    expect(resolveVideo({...base,title:'Synthetic A'},report,Date.parse('2026-09-07T00:00:00+09:00'))).toMatchObject({officiallyRecognized:false,weeklyAttendanceRecognized:false,applicability:'required',applicabilityConfidence:'high',applicabilityBasis:['INDIVIDUAL_ATTENDANCE_NOT_RECOGNIZED'],state:'not_started',completionBasis:'attendance'});
    expect(resolveVideo({...base,videoId:'12',title:'Synthetic B'},report)).toMatchObject({officiallyRecognized:null,weeklyAttendanceRecognized:false,applicability:'unknown'});
  });
  it('parses completion-auto-y and completion-auto-n without overriding reports',()=>{
    expect(parseCourseContext(course().replace('completion-auto-n','completion-auto-y'),'7').videos[0].completionHint).toBe(true);
    expect(parseCourseContext(course(),'7').videos[0].completionHint).toBe(false);
  });
  it('does not join completion rows by title alone',()=>{
    const video=parseCourseContext(course(),'7').videos[0],report=parseCompletionReport(progress.replace('<a href="/mod/vod/view.php?id=11">','').replace('</a></td>','</td>'),'https://ys.learnus.org/report/ubcompletion/user_progress.php');
    const result=resolveVideo(video,report);expect(result.progressPercent).toBeUndefined();expect(result).toMatchObject({state:'unknown',warnings:['REPORT_IDENTITY_UNRESOLVED']});
  });
  it('does not turn unknown applicability into overdue',()=>{
    const v=parseCourseContext(course(),'7',{},Date.parse('2026-09-07T12:00:00+09:00')).videos[0];
    expect(resolveVideo({...v,effectiveDueAt:'2026-09-01T00:00:00+09:00'},parseCompletionReport(progress,'https://ys.learnus.org/report/ubcompletion/user_progress.php'),Date.parse('2026-09-07T00:00:00+09:00')).state).toBe('in_progress');
  });
  it('uses confirmed deadlines only for required overdue states',()=>{
    const base=parseCourseContext(course(),'7',{},Date.parse('2026-09-07T12:00:00+09:00')).videos[0];
    const required={...base,applicability:'required' as const,effectiveDueAt:'2026-09-10T00:00:00+09:00'};
    const report=parseCompletionReport(progress,'https://ys.learnus.org/report/ubcompletion/user_progress.php');
    expect(resolveVideo(required,report,Date.parse('2026-09-07T00:00:00+09:00')).state).toBe('in_progress');
    expect(resolveVideo(required,report,Date.parse('2026-09-11T00:00:00+09:00')).state).toBe('overdue_incomplete');
  });
  it('resolves relative rules only with one high-confidence timetable match',()=>{
    const unresolved=resolveDeadline('실험 1 수업 이전까지','7');expect(unresolved.effectiveDueAt).toBeUndefined();expect(unresolved.deadlinePrecision).toBe('relative');
    expect(resolveDeadline('실험 1 수업 이전까지','7',[{rule:'실험 1 수업 이전까지',startsAt:'2026-09-09T09:00:00+09:00',courseId:'7',confidence:'high'}]).effectiveDueAt).toBe('2026-09-09T09:00:00+09:00');
  });
});
