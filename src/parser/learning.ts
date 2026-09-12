import { load } from 'cheerio';
import { cleanText, localUrl, ORIGIN } from './dashboard.js';
import { contentText } from './content.js';
import type { CompletionReport, CourseContextIndex, CourseOverride, LearningDeadline, TimetableEvidence, VideoLearningStatus } from '../models/Learning.js';
import { activityIdentity, normalizeDate } from '../normalize.js';
import { parseActivityCompletion } from './completion.js';
import type { CalendarEvent } from '../models/CalendarEvent.js';

const datePattern = /(?:20\d{2})[년./-]\s*\d{1,2}[월./-]\s*\d{1,2}일?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/g;
export function learningDate(text:string, end = false):string|undefined {
  return normalizeDate(text,end);
}
export function resolveDeadline(text:string, courseId:string, timetable:TimetableEvidence[]=[]):LearningDeadline {
  const result:LearningDeadline = {deadlinePrecision:'unknown',deadlineBasis:[],deadlineCandidates:[]};
  for (const line of text.split('\n').map(cleanText).filter(Boolean)) {
    const dates = line.match(datePattern) || [];
    if (/(?:이용|열람|시청|학습|재생)\s*기간|available|availability/i.test(line) && dates.length) {
      if (dates.length>1) result.systemAvailableFrom=learningDate(dates[0]!);
      result.systemAvailableUntil=learningDate(dates.at(-1)!,true);
    }
    if (/(?:이전|전)\s*까지|수업\s*(?:이전|전)|before\s+(?:the\s+)?(?:class|lab)/i.test(line)) {
      result.instructionalDueRule=line; result.deadlinePrecision='relative'; result.deadlineBasis=['INSTRUCTOR_RELATIVE_RULE'];
      const evidence=timetable.filter(e=>e.courseId===courseId && e.rule===line && e.confidence==='high' && Number.isFinite(Date.parse(e.startsAt)));
      if (evidence.length===1) { result.instructionalDueAt=evidence[0].startsAt; result.effectiveDueAt=evidence[0].startsAt; result.deadlineCandidates!.push({date:evidence[0].startsAt,source:'instructor'});result.deadlinePrecision='exact';result.deadlineBasis.push('MATCHED_TIMETABLE'); }
    }
    if (/(?:시청|수강|학습|완료)\s*(?:기한|마감)|출석\s*인정\s*기간|due\s*(?:date|by)|must.*by/i.test(line) && dates.length) {
      result.instructionalDueAt=learningDate(dates.at(-1)!,true);result.effectiveDueAt=result.instructionalDueAt;
      if(result.instructionalDueAt)result.deadlineCandidates!.push({date:result.instructionalDueAt,source:'instructor'});
      result.deadlinePrecision=/\d:\d{2}/.test(dates.at(-1)!)?'exact':'day';result.deadlineBasis=['EXPLICIT_INSTRUCTIONAL_DEADLINE'];
    }
  }
  if(result.effectiveDueAt)result.effectiveDueSource='instructor';
  if(new Set(result.deadlineCandidates!.map(c=>Date.parse(c.date))).size>1){result.effectiveDueAt=undefined;result.effectiveDueSource='unknown';}
  return result;
}
export function resolveApplicability(title:string, text:string, audience:string[]):Pick<VideoLearningStatus,'applicability'|'applicabilityConfidence'|'applicabilityBasis'> {
  void title; // Compatibility parameter; titles are never target evidence.
  const excluded=/(?:시청|수강).{0,12}(?:필요\s*없|않아도|안\s*해도)|need\s+not\s+(?:watch|view)|not\s+required/i;
  const engineering=audience.some(t=>/^(engineering|general|공학|일반)$/i.test(t));
  if (engineering && /일반|공학|engineering|general/i.test(text) && excluded.test(text))
    return {applicability:'not_applicable',applicabilityConfidence:'high',applicabilityBasis:['EXPLICIT_AUDIENCE_EXCLUSION','MATCHED_STUDENT_AUDIENCE']};
  if(excluded.test(text)&&!/UIC|일반|공학|engineering|general/i.test(text))return {applicability:'not_applicable',applicabilityConfidence:'high',applicabilityBasis:['EXPLICIT_ACTIVITY_EXCLUSION']};
  if (/선택\s*(?:시청|수강)|optional|참고용/i.test(text) && !/UIC/i.test(text)) return {applicability:'optional',applicabilityConfidence:'high',applicabilityBasis:['EXPLICIT_OPTIONAL_INSTRUCTION']};
  if (/(?:전원|모든\s*수강생|필수).{0,20}(?:시청|수강)|required\s+(?:viewing|video)|all\s+students\s+must/i.test(text) && !excluded.test(text))
    return {applicability:'required',applicabilityConfidence:'high',applicabilityBasis:['EXPLICIT_REQUIRED_INSTRUCTION']};
  return {applicability:'unknown',applicabilityConfidence:'low',applicabilityBasis:['AUDIENCE_REQUIREMENT_UNCONFIRMED']};
}
export function currentWeek(weeks:CourseContextIndex['weeks'], now=Date.now()):number|undefined {
  return weeks.filter(w=>w.start && Date.parse(w.start)<=now).sort((a,b)=>b.week-a.week)[0]?.week;
}
export function requiredVideo(video:VideoLearningStatus):boolean {
  return video.attendanceTarget==='yes'&&video.state!=='completed'&&!video.warnings.includes('VIDEO_DEADLINE_CONFLICT')&&(video.completionState==='incomplete'||['not_started','in_progress','overdue_unwatched','overdue_incomplete'].includes(video.state));
}
export function courseSemester(text:string,now=Date.now()):string|undefined {
  const semester=cleanText(text).match(/(20\d{2})\s*[-년.]\s*([12])\s*(?:학기|semester)?/i),term=cleanText(text).match(/(?:^|\D)([12])\s*학기/);
  return semester?`${semester[1]}-${semester[2]}`:term?`${new Date(now+9*3600000).getUTCFullYear()}-${term[1]}`:undefined;
}
export function parseCourseContext(html:string,courseId:string,override:CourseOverride={}, now=Date.now()):CourseContextIndex {
  const $=load(html);$('script,style,nav,footer,#page-header,.block_navigation').remove();
  const root=$('.course-content'), name=cleanText($('.coursename').first().text()||$('h1').first().text())||undefined;
  const semesterText=cleanText($('.breadcrumb,.coursename,.course-content .semester,[data-semester]').text());
  const semester=courseSemester(semesterText,now),year=semester?.slice(0,4)||String(new Date(now+9*3600000).getUTCFullYear());
  const audience=override.audienceTags||[];
  const result:CourseContextIndex={courseId,courseName:name,courseCode:name?.match(/\b[A-Z]{3}\d{4}[.-]\d{2}(?:-\d{2})?\b/)?.[0],semester,weeks:[],activities:[],videos:[],audienceContext:audience,fetchedAt:now,warnings:[]};
  root.find('li.section').each((_,e)=>{
    const s=$(e), heading=cleanText(s.find('.sectionname').first().text()), week=Number(heading.match(/(\d+)\s*주차|week\s*(\d+)/i)?.slice(1).find(Boolean));
    const range=heading.match(/(\d{1,2})월\s*(\d{1,2})일\s*[-~]\s*(\d{1,2})월\s*(\d{1,2})일/);
    if(week) result.weeks.push({week,start:range?learningDate(`${year}-${range[1]}-${range[2]}`):undefined,end:range?learningDate(`${year}-${range[3]}-${range[4]}`,true):undefined});
  });
  const seen=new Set<string>();
  root.find('.activity,[id^="module-"]').each((_,e)=>{
    const el=$(e), a=el.find('a[href]').filter((_,a)=>/^\/mod\/[a-z0-9_]+\/view\.php$/.test(localUrl($(a).attr('href')||'')?.pathname||'')).first();
    const u=localUrl(a.attr('href')||''), id=u?.searchParams.get('id')||el.attr('id')?.match(/^module-(\d+)$/)?.[1];
    const identity=activityIdentity(id);if(!identity||seen.has(identity))return;seen.add(identity);
    const type=u?.pathname.match(/\/mod\/([a-z0-9_]+)\//)?.[1]||el.attr('class')?.match(/modtype_([a-z0-9_]+)/)?.[1]||'unknown';
    const titleNode=a.find('.instancename').clone();titleNode.find('.accesshide').remove();
    const title=cleanText(titleNode.text()||a.text()), section=el.closest('li.section'), heading=section.find('.sectionname').first().text();
    const week=Number(heading.match(/(\d+)\s*주차|week\s*(\d+)/i)?.slice(1).find(Boolean))||undefined;
    const url=u?`${ORIGIN}${u.pathname}?id=${id}`:undefined;
    const completionState=parseActivityCompletion($.html(el));
    result.activities.push({id:id!,title,type,url,week,completionState});if(type!=='vod')return;
    const image=el.find('.autocompletion img'), src=image.attr('src')||'',alt=image.attr('title')||image.attr('alt')||'';
    const completionHint=/completion-auto-y/.test(src)?true:/completion-auto-n/.test(src)?false:/^완료함:/.test(alt)?true:/^완료하지 못함:/.test(alt)?false:undefined;
    const direct=contentText(el.find('.contentafterlink,.availabilityinfo,.displayoptions').toArray().map(e=>$.html(e)).join('\n'));
    result.videos.push({videoId:id!,courseId,title,url,week,completionHint,completionState,...resolveApplicability('',direct,audience),...resolveDeadline(direct,courseId),state:'unknown',completionBasis:'unknown',confidence:'low',warnings:[]});
  });
  if(!root.length)result.warnings.push('COURSE_STRUCTURE_UNRECOGNIZED');
  if(!result.semester)result.warnings.push('SEMESTER_UNCONFIRMED');
  return result;
}
function seconds(value:string):number|undefined {
  const t=value.match(/(?<!\d)(\d+):(\d{2})(?::(\d{2}))?/);if(t)return t[3]!==undefined?Number(t[1])*3600+Number(t[2])*60+Number(t[3]):Number(t[1])*60+Number(t[2]);
  const m=value.match(/(?:(\d+)\s*시간)?\s*(?:(\d+)\s*분)?\s*(\d+)\s*초/);return m?Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]):undefined;
}
const observedDate=normalizeDate;
export function parseCompletionReport(html:string,finalUrl:string):CompletionReport {
  const $=load(html), result:CompletionReport={mode:'unknown',entries:[],warnings:[]};
  const table=$('table').filter((_,e)=>{const h=$(e).find('th').text();return /강의\s*자료|learning\s*material|video/i.test(h)&&/진도율|출석|progress|attendance/i.test(h);}).first();
  if(!table.length){result.warnings.push('COMPLETION_STRUCTURE_UNRECOGNIZED');return result;}
  const headers=table.find('tr').first().children('th,td').toArray().map(e=>cleanText($(e).text()));
  result.mode=headers.some(h=>/출석|attendance/i.test(h))?'attendance':headers.some(h=>/진도율|progress/i.test(h))?'progress':/user_progress_a\.php/.test(finalUrl)?'attendance':'unknown';
  // Expand rowspans before applying header aliases (the real reports merge week cells).
  const carried=new Map<number,{node:ReturnType<typeof $>;remaining:number}>();
  table.find('tr').slice(1).each((_,row)=>{
    const cells:ReturnType<typeof $>[]=[];
    for(const [i,v] of carried){cells[i]=v.node;if(--v.remaining===0)carried.delete(i);}
    let col=0;$(row).children('td,th').each((_,e)=>{while(cells[col])col++;const node=$(e),span=Number(node.attr('colspan')||1),rows=Number(node.attr('rowspan')||1);for(let n=0;n<span;n++){cells[col]=node;if(rows>1)carried.set(col,{node,remaining:rows-1});col++;}});
    const cell=(re:RegExp)=>cells[headers.findIndex(h=>re.test(h))];
    const titleCell=cell(/강의\s*자료|learning\s*material|video/i), imageTitle=titleCell?.find('img').first().attr('alt')||titleCell?.find('img').first().attr('title');
    const title=cleanText(titleCell?.clone().find('img,button').remove().end().text()||imageTitle||'');
    const identity=$(row).find('[data-modid]').first(), module=identity.attr('data-modname');
    if(module && module!=='vod')return;
    if(!title)return;
    const entry:CompletionReport['entries'][number]={title,instanceId:identity.attr('data-modid')};
    const link=$(row).find('a[href*="/mod/vod/view.php"]').first(),u=localUrl(link.attr('href')||'');
    const videoId=u?.searchParams.get('id');if(videoId&&/^\d+$/.test(videoId))entry.videoId=videoId;
    const progress=cell(/진도율|progress\s*(?:rate|percent)?/i)?.text().match(/(\d+(?:\.\d+)?)\s*%/);
    if(progress && Number(progress[1])<=100)entry.progressPercent=Number(progress[1]);
    entry.watchedSeconds=seconds(cell(/총\s*학습시간|total\s*(?:learning|study)\s*time/i)?.text()||'');
    const pos=cell(/최대\s*학습위치|max.*position/i)?.text();entry.maxPositionSeconds=seconds(pos||'');
    if(pos?.trim()==='-')entry.maxPositionSeconds=0;
    entry.contentLengthSeconds=seconds(cell(/콘텐츠\s*길이|content\s*length/i)?.text()||'');
    const recognized=(v:string|undefined)=>v?.trim().match(/^(O|○|인정|출석|Present)$/i)?true:v?.trim().match(/^(X|×|결석|Absent)$/i)?false:null;
    if(result.mode==='attendance'){entry.officiallyRecognized=recognized(cell(/^출석$|^attendance$/i)?.text());entry.weeklyAttendanceRecognized=recognized(cell(/주차\s*출석|weekly\s*attendance/i)?.text());}
    const starts=observedDate(identity.attr('data-sterm')),ends=observedDate(identity.attr('data-eterm'),true);
    if(result.mode==='attendance'&&ends){entry.attendanceDueAt=ends;entry.effectiveDueAt=ends;entry.effectiveDueSource='attendance';entry.deadlineCandidates=[{date:ends,source:'attendance'}];entry.deadlinePrecision='exact';entry.deadlineBasis=['ATTENDANCE_RECOGNITION_PERIOD'];}
    else {if(starts)entry.systemAvailableFrom=starts;if(ends)entry.systemAvailableUntil=ends;}
    result.entries.push(entry);
  });
  if(!result.entries.length)result.warnings.push('NO_VIDEO_RECORDS_FOUND');return result;
}
export function resolveVideo(video:VideoLearningStatus,report:CompletionReport, now=Date.now(),events:CalendarEvent[]=[]):VideoLearningStatus {
  const matches=report.entries.filter(e=>e.videoId===video.videoId);
  const raw=matches.length===1?matches[0]:undefined;
  const v={...video,...raw,videoId:video.videoId,courseId:video.courseId,warnings:[...video.warnings]};
  if(matches.length>1)v.warnings.push('AMBIGUOUS_REPORT_IDENTITY');
  if(!raw&&report.entries.some(entry=>!entry.videoId))v.warnings.push('REPORT_IDENTITY_UNRESOLVED');
  const candidates=[...(video.deadlineCandidates??(video.instructionalDueAt?[{date:video.instructionalDueAt,source:'instructor' as const}]:[])),...matches.flatMap(e=>e.deadlineCandidates??[])];
  for(const event of events)if(String(event.cmid)===video.videoId&&event.module==='vod'&&event.type==='progressstop')candidates.push({date:event.date,source:'calendar_progress_stop'});
  v.deadlineCandidates=candidates;
  if(candidates.length){const rank={attendance:1,calendar_progress_stop:2,instructor:3};const tier=Math.min(...candidates.map(c=>rank[c.source]));const best=candidates.filter(c=>rank[c.source]===tier);const dates=new Set(best.map(c=>Date.parse(c.date)));
    if(dates.size>1){v.effectiveDueAt=undefined;v.effectiveDueSource='unknown';v.warnings.push('VIDEO_DEADLINE_CONFLICT');}
    else{v.effectiveDueAt=best[0].date;v.effectiveDueSource=best[0].source;if(new Set(candidates.map(c=>Date.parse(c.date))).size>1)v.warnings.push('VIDEO_DEADLINE_SOURCES_DIFFER');}
  }
  const completed=v.officiallyRecognized===true || v.progressPercent===100 || v.completionState==='complete';
  v.completionBasis=v.officiallyRecognized!==undefined&&v.officiallyRecognized!==null?'attendance':raw&&(v.progressPercent!==undefined||v.maxPositionSeconds!==undefined)?'progress':v.completionHint!==undefined?'completion_hint':'unknown';
  v.confidence=raw?'high':v.completionHint!==undefined?'medium':'low';
  if(raw && v.completionHint!==undefined && v.completionHint!==completed)v.warnings.push('COMPLETION_HINT_DISAGREEMENT');
  if(v.applicability==='unknown'&&v.officiallyRecognized===false){v.applicability='required';v.applicabilityConfidence='high';v.applicabilityBasis=['INDIVIDUAL_ATTENDANCE_NOT_RECOGNIZED'];}
  v.attendanceTarget=v.applicability==='required'?'yes':['not_applicable','optional'].includes(v.applicability)?'no':'unknown';
  v.attendanceStatus=v.officiallyRecognized===true?'attended':v.officiallyRecognized===false?'not_attended':(v.progressPercent??0)>0&&v.progressPercent!==100?'in_progress':'unknown';
  if(v.applicability==='not_applicable'||v.applicability==='optional')v.state='not_required';
  else if(completed || (!raw && v.completionHint===true))v.state='completed';
  else {
    const partial=(v.progressPercent||0)>0||(v.watchedSeconds||0)>0||(v.maxPositionSeconds||0)>0;
    const overdue=v.applicability==='required'&&v.effectiveDueAt&&Date.parse(v.effectiveDueAt)<now;
    v.state=overdue?(partial?'overdue_incomplete':'overdue_unwatched'):partial?'in_progress':v.systemAvailableFrom&&Date.parse(v.systemAvailableFrom)>now?'upcoming':raw?'not_started':'unknown';
  }
  return v;
}
