import { PlaywrightAuthManager } from '../auth/PlaywrightAuthManager.js';
import { authenticatedHtml } from '../parser/session.js';
import { ORIGIN, parseDashboard } from '../parser/dashboard.js';
import { parseCourse } from '../parser/course.js';
import { parseAssignment } from '../parser/assignment.js';
import { LearnUsError, safeCode } from '../errors.js';
import { MoodleAjaxClient, record } from './MoodleAjaxClient.js';
import { upcomingInput, calendarBoundary, type UpcomingInput, type UpcomingResult } from '../models/CalendarEvent.js';
import { CoursemosClient } from './CoursemosClient.js';
import { announcementListInput, notificationListInput, learnusId, type AnnouncementSummary, type AnnouncementListResult } from '../models/Announcement.js';
import { parseAnnouncements, parseAnnouncement, announcementTime, parseInlineAnnouncements } from '../parser/announcement.js';
import { parseNotifications } from '../parser/notification.js';
import { MemoryCache } from './MemoryCache.js';
import { AssignmentAttachmentAdapter, FileClient, attachmentLinks } from './FileClient.js';
import { parseCourseContext, parseCompletionReport, resolveVideo, currentWeek, requiredVideo, courseSemester } from '../parser/learning.js';
import type { CourseOverride, VideoLearningStatus } from '../models/Learning.js';
import type { AttachmentRef } from '../models/Attachment.js';
import { overviewInput, weeklyTasksInput, type WeeklyTasksInput, type AssignmentSummary, type LearnUsOverview, type OverviewInput } from '../models/Overview.js';
import { load } from 'cheerio';
import { announcementIdentity, assignmentIdentity, calendarEventIdentity, courseIdentity, dateTimestamp, dedupeBy, notificationIdentity } from '../normalize.js';
import { DataRequestCoordinator, type LearnUsPerformanceMetrics, type RequestCategory } from './DataRequestCoordinator.js';
import { getText } from './HttpText.js';
type ClientOptions={maxConcurrentRequests?:number;cacheEnabled?:boolean;now?:()=>number};
export class LearnUsClient {
  private readonly cache:MemoryCache;
  private readonly requests:DataRequestCoordinator;
  private readonly generalCache:MemoryCache;
  private readonly files=new FileClient();
  private readonly assignmentFiles=new AssignmentAttachmentAdapter(this.files);
  private readonly ajax = new MoodleAjaxClient();
  private readonly coursemos = new CoursemosClient();
  constructor(readonly auth: PlaywrightAuthManager,options:ClientOptions={}) {
    this.requests=new DataRequestCoordinator(options.maxConcurrentRequests);
    this.cache=new MemoryCache({generation:()=>this.auth.session.generation});
    this.generalCache=new MemoryCache({metrics:this.requests,generation:()=>this.auth.session.generation,enabled:options.cacheEnabled??process.env.LEARNUS_CACHE_ENABLED!=='0',now:options.now});
  }
  performanceMetrics():LearnUsPerformanceMetrics{return this.requests.snapshot();}
  resetPerformanceMetrics():void{this.requests.reset();}
  resetEvaluationState(clearCaches=false):void{this.requests.reset();if(clearCaches){this.cache.clear();this.generalCache.clear();}}
  private checkId(id:string) {if(!learnusId.safeParse(id).success)throw new LearnUsError('PARSE_ERROR');}
  async courseContext(courseId:string,refresh=false) {
    this.checkId(courseId);
    return this.cache.get(`context:${courseId}`,3600000,refresh,async()=>{
      let override:CourseOverride={};
      if(process.env.LEARNUS_COURSE_CONTEXT_OVERRIDES){
        try{const raw=JSON.parse(process.env.LEARNUS_COURSE_CONTEXT_OVERRIDES);const tags=raw[courseId]?.audienceTags;if(tags!==undefined){if(!Array.isArray(tags)||!tags.every(t=>typeof t==='string'))throw Error();override={audienceTags:tags};}}
        catch{throw new LearnUsError('PARSE_ERROR');}
      }
      return parseCourseContext(await this.html(`/course/view.php?id=${courseId}`),courseId,override);
    });
  }
  async listVideos(input:{courseId:string;refresh?:boolean}) {
    const context=await this.courseContext(input.courseId,input.refresh);
    return {items:context.videos,currentWeek:currentWeek(context.weeks),warnings:context.warnings};
  }
  async getVideoAttendance(input:{courseId:string;videoId?:string;refresh?:boolean},events:import('../models/CalendarEvent.js').CalendarEvent[]=[]) {
    this.checkId(input.courseId);if(input.videoId)this.checkId(input.videoId);
    const context=await this.courseContext(input.courseId,input.refresh);
    const report=await this.cache.get(`report:${input.courseId}`,45000,!!input.refresh,async()=>{
      const response=await this.dataRequest('completion','GET',`${ORIGIN}/report/ubcompletion/progress.php?id=${input.courseId}`,undefined,async()=>this.coursemos.getCompletionHtml(await this.auth.session.getContext(),input.courseId));
      return parseCompletionReport(response.html,response.url);
    });
    return {mode:report.mode,items:context.videos.filter(v=>!input.videoId||v.videoId===input.videoId).map(v=>resolveVideo(v,report,Date.now(),events)),currentWeek:currentWeek(context.weeks),warnings:[...context.warnings,...report.warnings]};
  }
  async learningOverview(input:{courseId?:string;week?:'current'|'all'|number;status?:'not_started'|'in_progress'|'completed'|'overdue'|'all';refresh?:boolean}={}) {
    if(input.courseId)this.checkId(input.courseId);
    if(typeof input.week==='number'&&(!Number.isSafeInteger(input.week)||input.week<1))throw new LearnUsError('PARSE_ERROR');
    const ids=input.courseId?[input.courseId]:(await this.cache.get('learning-courses',3600000,!!input.refresh,()=>this.listCourses())).courses.map(c=>String(c.id));
    const courses=[],requiredIncomplete:VideoLearningStatus[]=[],completed:VideoLearningStatus[]=[],excludedOrOptional:VideoLearningStatus[]=[],unknown:VideoLearningStatus[]=[],warnings=new Set<string>();
    for(const courseId of ids){
      try{
        const context=await this.courseContext(courseId,input.refresh);
        if(!context.videos.length){courses.push({courseId,currentWeek:currentWeek(context.weeks),items:[]});for(const w of context.warnings)warnings.add(w);continue;}
        const report=await this.getVideoAttendance({courseId,refresh:input.refresh});
        const items=report.items.filter(v=>{
          const week=input.week??'current';
          if(typeof week==='number'&&v.week!==week)return false;
          // Default includes current and past weeks; unknown weeks remain visible with uncertainty.
          if(week==='current'&&report.currentWeek!==undefined&&v.week!==undefined&&v.week>report.currentWeek)return false;
          const status=input.status??'all';return status==='all'||(status==='overdue'?v.state.startsWith('overdue_'):v.state===status);
        });
        courses.push({courseId,currentWeek:report.currentWeek,mode:report.mode,items});
        for(const v of items){if(v.applicability==='optional'||v.applicability==='not_applicable')excludedOrOptional.push(v);else if(v.state==='completed')completed.push(v);else if(requiredVideo(v))requiredIncomplete.push(v);else unknown.push(v);}
        for(const w of report.warnings)warnings.add(w);
      }catch(error){if(error instanceof LearnUsError&&error.code==='ENDPOINT_UNAVAILABLE')warnings.add('COMPLETION_ENDPOINT_UNAVAILABLE');else throw error;}
    }
    return {asOf:new Date().toISOString(),currentWeek:courses.length===1?courses[0].currentWeek:undefined,courses,requiredIncomplete,completed,excludedOrOptional,unknown,warnings:[...warnings]};
  }
  private registerAttachments(html:string,source:AttachmentRef['sourceType'],parentId:string,courseId?:string) {
    const $=load(html);
    const inferred=$('.breadcrumb a[href*="/course/view.php"],nav[aria-label="breadcrumb"] a[href*="/course/view.php"]').first().attr('href');
    let owner=courseId;try{owner??=inferred?new URL(inferred,ORIGIN).searchParams.get('id')||undefined:undefined;}catch{/* Missing owner stays unregistered. */}
    if(!owner||!learnusId.safeParse(owner).success)return [];
    return source==='assignment'?this.assignmentFiles.resolve(html,owner,parentId):attachmentLinks(html,source).map(a=>this.files.register(a.url,a.name,source,owner!,parentId));
  }
  async listFiles(input:{courseId:string;scope?:'course'|'assignments'|'announcements'|'all';refresh?:boolean}) {
    this.checkId(input.courseId);const scope=input.scope??'course';
    return this.cache.get(`files:${input.courseId}:${scope}`,1200000,!!input.refresh,async()=>{
      const context=await this.courseContext(input.courseId,input.refresh),items:AttachmentRef[]=[],warnings:string[]=[];
      if(scope==='course'||scope==='all')for(const a of context.activities){
        if(a.type==='ubfile'&&a.url)items.push({...this.files.register(a.url,a.title,'ubfile',input.courseId,a.id),completionState:a.completionState});
        else if(['resource','folder','unknown'].includes(a.type))warnings.push('FILE_SOURCE_RESEARCH_REQUIRED');
      }
      if(scope==='assignments'||scope==='all')for(const a of context.activities.filter(a=>a.type==='assign')){
        const html=await this.html(`/mod/assign/view.php?id=${a.id}`);items.push(...this.registerAttachments(html,'assignment',a.id,input.courseId).map(file=>({...file,completionState:a.completionState})));
      }
      if(scope==='announcements'||scope==='all'){
        const announcements=await this.listAnnouncements({courseId:input.courseId,limit:50});warnings.push(...announcements.warnings);
        if(announcements.items.length===50)warnings.push('FILE_ANNOUNCEMENT_SCAN_LIMIT_REACHED');
        for(const a of announcements.items){if(!a.moduleId)continue;const html=await this.dataRequest('announcement','GET',`${ORIGIN}/mod/ubboard/article.php?id=${a.moduleId}&bwid=${a.id}`,undefined,async()=>this.coursemos.getArticle(await this.auth.session.getContext(),a.moduleId!,a.id));items.push(...this.registerAttachments(html,'announcement',a.id,input.courseId));}
      }
      return {items:[...new Map(items.map(a=>[a.fileId,a])).values()],warnings:[...new Set(warnings)]};
    });
  }
  async downloadFile(fileId:string) {
    const courseId=this.files.courseId(fileId),context=await this.courseContext(courseId);
    const course=context.semester?context:{...context,semester:courseSemester((await this.listCourses()).courses.find(course=>String(course.id)===courseId)?.name||'')};
    return this.dataRequest('file','GET',this.files.requestUrl(fileId),undefined,async()=>this.files.download(fileId,await this.auth.session.getContext(),course),false);
  }
  private async withSessionRetry<T>(request: () => Promise<T>,authenticated=false): Promise<T> {
    try {
      if(!authenticated)await this.auth.ensureAuthenticated();
      for (let attempt = 0; attempt < 2; attempt++) {
        const generation = this.auth.session.generation;
        try {
          return await request();
        } catch (error) {
          if (!(error instanceof LearnUsError) || error.code !== 'SESSION_EXPIRED') throw error;
          if (attempt === 0) await this.auth.ensureAuthenticated(generation);
        }
      }
      throw new LearnUsError('SESSION_EXPIRED');
    } catch (error) { throw error instanceof LearnUsError ? error : new LearnUsError(safeCode(error)); }
  }
  private dataRequest<T>(category:RequestCategory,method:string,url:string,body:unknown,request:()=>Promise<T>,coalesce=true,authenticated=false):Promise<T>{
    return this.withSessionRetry(()=>this.requests.run({category,method,url,body,generation:this.auth.session.generation,coalesce},request),authenticated);
  }
  private async html(path: string,authenticated=false): Promise<string> {
    return this.dataRequest('page','GET',ORIGIN+path,undefined,async () => {
      const response = await getText(await this.auth.session.getContext(),ORIGIN+path);
      if (response.status >= 500) throw new LearnUsError('NETWORK_ERROR');
      if (response.status === 401) throw new LearnUsError('SESSION_EXPIRED');
      if (!response.ok) throw new LearnUsError('NETWORK_ERROR');
      if (!authenticatedHtml(response.text,response.url)) throw new LearnUsError('SESSION_EXPIRED');
      return response.text;
    },true,authenticated);
  }
  private async courseHtml(courseId:string,authenticated=false):Promise<string>{
    return this.dataRequest('page','GET',`${ORIGIN}/course/view.php?id=${courseId}`,undefined,async()=>this.coursemos.getCourseHtml(await this.auth.session.getContext(),courseId),true,authenticated);
  }
  async upcoming(input: UpcomingInput): Promise<UpcomingResult> {
    const parsed = upcomingInput.safeParse(input);
    if (!parsed.success) throw new LearnUsError('PARSE_ERROR');
    const {from,to,limit,courseId} = parsed.data;
    const start = calendarBoundary(from,false), end = calendarBoundary(to,true);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) throw new LearnUsError('PARSE_ERROR');
    await this.auth.ensureAuthenticated();
    return this.generalCache.get(`upcoming:${JSON.stringify(parsed.data)}`,15000,false,async()=>{
    const result: UpcomingResult = {events:[],warnings:[],truncated:false};
    const warnings = new Set<string>(), seen = new Set<string>(), cursors = new Set<number>();
    let aftereventid = 0;
    // Bound work for extremely sparse course filters; report incomplete results explicitly.
    for (let page = 0; page < 100; page++) {
      const args={timesortfrom:start,timesortto:end,aftereventid,limitnum:50,limittononsuspendedevents:true};
      const events = await this.dataRequest('calendar','POST',`${ORIGIN}/lib/ajax/service.php?info=core_calendar_get_action_events_by_timesort`,args,async () => this.ajax.getActionEventsByTimesort(
        await this.auth.session.getContext(), this.auth.session.sesskey,
        args,
      ),true,true);
      for (const value of events) {
        const event = record(value), id = event.id, time = event.timesort;
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || typeof time !== 'number' || !Number.isSafeInteger(time)) {
          warnings.add('INVALID_EVENT_SKIPPED'); continue;
        }
        const identity=calendarEventIdentity(id)!;if (seen.has(identity)) continue;
        seen.add(identity);
        const course = record(event.course), rawCourseId = course.id ?? event.courseid;
        const eventCourseId = typeof rawCourseId === 'number' && Number.isSafeInteger(rawCourseId) && rawCourseId > 0 ? rawCourseId : undefined;
        if (time < start || time > end || (courseId !== undefined && eventCourseId !== courseId)) continue;
        let cmid:number|undefined;
        try{const url=new URL(String(record(event.action).url??event.url??''),ORIGIN);if(url.origin===ORIGIN&&/^\/mod\/vod\/view\.php$/.test(url.pathname)){const value=Number(url.searchParams.get('id'));if(Number.isSafeInteger(value)&&value>0)cmid=value;}}catch{/* No canonical identity means no join. */}
        result.events.push({id,timesort:time,date:new Date(time*1000).toISOString(),...(cmid?{cmid}:{}),
          name:typeof event.name === 'string' ? event.name : undefined,courseId:eventCourseId,
          module:typeof event.modulename === 'string' ? event.modulename : undefined,
          type:typeof event.eventtype === 'string' ? event.eventtype : undefined});
      }
      result.events.sort((a,b) => a.timesort-b.timesort || a.id-b.id);
      if (result.events.length >= limit) {
        result.truncated = result.events.length > limit || events.length === 50;
        result.events = result.events.slice(0,limit); break;
      }
      if (events.length < 50) break;
      const last = record(events[events.length-1]).id;
      if (typeof last !== 'number' || !Number.isSafeInteger(last) || last <= 0 || cursors.has(last)) {
        warnings.add('PAGINATION_STALLED'); result.truncated = true; break;
      }
      cursors.add(last); aftereventid = last;
      if (page === 99) { warnings.add('PAGE_LIMIT_REACHED'); result.truncated = true; }
    }
    result.warnings = [...warnings];
    return result;
    },result=>result.warnings.length===0);
  }
  async listCourses() { await this.auth.ensureAuthenticated();return this.generalCache.get('courses',30000,false,async()=>parseDashboard(await this.html('/',true)),result=>result.warnings.length===0); }
  async getCourse(id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new LearnUsError('PARSE_ERROR');
    await this.auth.ensureAuthenticated();
    return this.generalCache.get(`course:${id}`,30000,false,async()=>parseCourse(await this.courseHtml(String(id),true)));
  }
  async listActivities(courseId: number) {
    return {activities:(await this.getCourse(courseId)).activities};
  }
  async getAssignment(cmid: number) {
    if (!Number.isSafeInteger(cmid) || cmid <= 0) throw new LearnUsError('PARSE_ERROR');
    await this.auth.ensureAuthenticated();
    const path = `/mod/assign/view.php?id=${cmid}`;
    return this.generalCache.get(`assignment:${cmid}`,25000,false,async()=>{const html=await this.html(path,true);
      return {cmid, url:ORIGIN + path, ...parseAssignment(html),attachments:this.registerAttachments(html,'assignment',String(cmid))};
    },result=>result.warnings.length===0);
  }
  async listAnnouncements(input: {courseId?:string;limit?:number} = {}): Promise<AnnouncementListResult> {
    const parsed = announcementListInput.safeParse(input);
    if (!parsed.success) throw new LearnUsError('PARSE_ERROR');
    await this.auth.ensureAuthenticated();
    return this.generalCache.get(`announcements:${JSON.stringify(parsed.data)}`,20000,false,async()=>{
    const {courseId,limit} = parsed.data;
    const dashboard = courseId ? undefined : await this.listCourses();
    const courses = courseId ? [{id:Number(courseId)}] : dashboard!.courses;
    const items = new Map<string,AnnouncementSummary>(), warnings = new Set<string>();
    if (!courseId && dashboard?.warnings.length) warnings.add('ANNOUNCEMENT_STRUCTURE_UNRECOGNIZED');
    const boardSources=new Map<string,{moduleId:string;courseId:string}>();
    let courseCount=0,announcementWidgetCount=0,emptyCourseCount=0,requests=0,boardRequestCount=0,emptyBoards=0,parserMismatchCount=0;
    for (const course of courses) {
      if (requests >= 50) { warnings.add('ANNOUNCEMENT_SCAN_LIMIT_REACHED'); break; }
      requests++;
      let courseHtml: string;
      try {
        courseHtml = await this.courseHtml(String(course.id),true);
      } catch (error) {
        if (error instanceof LearnUsError && error.code==='ENDPOINT_UNAVAILABLE') { warnings.add('ENDPOINT_UNAVAILABLE'); continue; }
        throw error;
      }
      courseCount++;
      const inline=parseInlineAnnouncements(courseHtml,String(course.id));
      announcementWidgetCount+=inline.widgetCount;
      parserMismatchCount+=inline.parserMismatchCount;
      if(!inline.items.length&&!inline.parserMismatchCount)emptyCourseCount++;
      for(const item of inline.items)items.set(announcementIdentity(item.moduleId,item.id)!,item);
      for(const moduleId of inline.moduleIds)boardSources.set(`${course.id}:${moduleId}`,{moduleId,courseId:String(course.id)});
    }
    if(items.size<limit)for(const {moduleId,courseId:sourceCourseId} of boardSources.values()) {
        let page = 0;
        for (;;) {
          if (requests >= 50) { warnings.add('ANNOUNCEMENT_SCAN_LIMIT_REACHED'); break; }
          requests++;
          try {
            boardRequestCount++;
            const html = await this.dataRequest('announcement','GET',`${ORIGIN}/mod/ubboard/view.php?id=${moduleId}${page?`&page=${page}`:''}`,undefined,async()=>this.coursemos.getBoard(await this.auth.session.getContext(),moduleId,page),true,true);
            const result = parseAnnouncements(html,moduleId,sourceCourseId,page);
            if (result.warnings.includes('NO_ANNOUNCEMENTS_FOUND')) emptyBoards++;
            if(result.warnings.includes('ANNOUNCEMENT_STRUCTURE_UNRECOGNIZED'))parserMismatchCount++;
            if(result.warnings.includes('ANNOUNCEMENT_FIELDS_MISSING'))parserMismatchCount++;
            for (const item of result.items) items.set(announcementIdentity(moduleId,item.id)!,item);
            if (result.nextPage === undefined) break;
            page = result.nextPage;
          } catch (error) {
            if (error instanceof LearnUsError && error.code==='ENDPOINT_UNAVAILABLE') { warnings.add('ENDPOINT_UNAVAILABLE'); break; }
            throw error;
          }
        }
    }
    const all = [...items.values()];
    if (!all.length) {
      if(parserMismatchCount)warnings.add('ANNOUNCEMENT_STRUCTURE_UNRECOGNIZED');
      else if(announcementWidgetCount||emptyBoards)warnings.add('NO_ANNOUNCEMENTS_FOUND');
      else if(courseCount)warnings.add('NO_ANNOUNCEMENT_BOARDS');
    } else if(parserMismatchCount) {
      warnings.add('ANNOUNCEMENT_FIELDS_MISSING');
    }
    if (all.some(item=>announcementTime(item.createdAt) === undefined)) warnings.add('ANNOUNCEMENT_DATES_MISSING');
    all.sort((a,b)=>{
      const left = announcementTime(a.createdAt), right = announcementTime(b.createdAt);
      return left === undefined ? right === undefined ? 0 : 1 : right === undefined ? -1 : right-left;
    });
    return {items:all.slice(0,limit),warnings:[...warnings],diagnostics:{courseCount,announcementWidgetCount,emptyCourseCount,boardCount:boardSources.size,boardRequestCount,announcementCount:all.length,parserMismatchCount}};
    },result=>result.warnings.length===0);
  }
  async getAnnouncement(moduleId: string, articleId: string) {
    if (!learnusId.safeParse(moduleId).success || !learnusId.safeParse(articleId).success) throw new LearnUsError('PARSE_ERROR');
    const html = await this.dataRequest('announcement','GET',`${ORIGIN}/mod/ubboard/article.php?id=${moduleId}&bwid=${articleId}`,undefined,async()=>this.coursemos.getArticle(await this.auth.session.getContext(),moduleId,articleId));
    const result=parseAnnouncement(html,moduleId,articleId);
    return {...result,item:result.item?{...result.item,attachments:this.registerAttachments(html,'announcement',articleId)}:undefined};
  }
  async listNotifications(input: {limit?:number} = {}) {
    const parsed = notificationListInput.safeParse(input);
    if (!parsed.success) throw new LearnUsError('PARSE_ERROR');
    await this.auth.ensureAuthenticated();
    return this.generalCache.get(`notifications:${parsed.data.limit}`,7000,false,async()=>{
      const html = await this.dataRequest('notification','POST',`${ORIGIN}/theme/coursemosv2/action.php`,{type:'userInfoNotifications'},async()=>this.coursemos.getNotificationHtml(await this.auth.session.getContext(),this.auth.session.sesskey),true,true);
      const result = parseNotifications(html);
      return {...result,items:result.items.slice(0,parsed.data.limit)};
    },result=>result.warnings.length===0);
  }
  async getWeeklyTasks(input:WeeklyTasksInput={}):Promise<LearnUsOverview> {
    const parsed=weeklyTasksInput.safeParse(input);
    if(!parsed.success)throw new LearnUsError('PARSE_ERROR');
    const {courseId,...range}=parsed.data;
    return this.getOverview({...range,...(courseId?{courseId:Number(courseId)}:{}),includeLearning:true});
  }
  async getOverview(input:OverviewInput={}):Promise<LearnUsOverview> {
    const parsed=overviewInput.safeParse(input);
    if(!parsed.success)throw new LearnUsError('PARSE_ERROR');
    const options=parsed.data,day=86400000,koreaNow=new Date(Date.now()+9*3600000),monday=new Date(koreaNow.getTime()-((koreaNow.getUTCDay()+6)%7)*day);
    const date=(value:Date)=>value.toISOString().slice(0,10),shift=(value:string,days:number)=>value.length===10?date(new Date(Date.parse(`${value}T00:00:00+09:00`)+days*day)):new Date(Date.parse(value)+days*day).toISOString();
    const from=options.from??(options.to?shift(options.to,-6):date(monday));
    const to=options.to??(options.from?shift(options.from,6):date(new Date(monday.getTime()+6*day)));
    const start=calendarBoundary(from,false),end=calendarBoundary(to,true);
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end)throw new LearnUsError('PARSE_ERROR');
    const warnings=new Set<string>(),result:LearnUsOverview={range:{from,to},warnings:[]},limit=options.maxItemsPerSection;
    const neededCourses=options.includeCourses||options.includeAssignments||options.includeLearning;
    const coursesTask=neededCourses?(options.courseId?Promise.resolve({courses:[{id:options.courseId,url:`${ORIGIN}/course/view.php?id=${options.courseId}`}],warnings:[]}):this.listCourses()).catch(()=>{warnings.add('COURSES_UNAVAILABLE');return undefined;}):Promise.resolve(undefined);
    const upcomingTask=options.includeUpcoming?this.upcoming({from,to,limit,...(options.courseId?{courseId:options.courseId}:{})}).catch(()=>{warnings.add('UPCOMING_UNAVAILABLE');return undefined;}):Promise.resolve(undefined);
    const announcementsTask=options.includeAnnouncements?this.listAnnouncements({limit,...(options.courseId?{courseId:String(options.courseId)}:{})}).catch(()=>{warnings.add('ANNOUNCEMENTS_UNAVAILABLE');return undefined;}):Promise.resolve(undefined);
    const notificationsTask=options.includeNotifications?this.listNotifications({limit}).catch(()=>{warnings.add('NOTIFICATIONS_UNAVAILABLE');return undefined;}):Promise.resolve(undefined);
    const assignmentsTask=options.includeAssignments?coursesTask.then(async listed=>{
      if(!listed){warnings.add('ASSIGNMENTS_UNAVAILABLE');return;}
      for(const warning of listed.warnings)warnings.add(warning);
      const activities:PromiseSettledResult<{courseId:number;activities:Awaited<ReturnType<LearnUsClient['listActivities']>>['activities']}>[]=[];
      for(let offset=0;offset<listed.courses.length;offset+=3)activities.push(...await Promise.allSettled(listed.courses.slice(offset,offset+3).map(async course=>({courseId:course.id,activities:(await this.listActivities(course.id)).activities}))));
      result.resources=[];
      for(const entry of activities)if(entry.status==='fulfilled')for(const activity of entry.value.activities)if(activity.id&&['ubfile','resource','folder'].includes(activity.module??''))result.resources.push({cmid:activity.id,courseId:entry.value.courseId,completionState:activity.completionState,classification:activity.completionState==='complete'?'completed':activity.completionState==='incomplete'?'actionable':activity.completionState==='unknown'?'unknown':'informational'});
      result.resources=result.resources.slice(0,limit);
      const refs=new Map<string,{cmid:number;courseId:number}>(),failedCourses=activities.filter(value=>value.status==='rejected').length;
      for(const value of activities)if(value.status==='fulfilled')for(const activity of value.value.activities){const identity=assignmentIdentity(activity.id);if(activity.type==='assign'&&activity.id&&identity&&!refs.has(identity))refs.set(identity,{cmid:activity.id,courseId:value.value.courseId});}
      const details:PromiseSettledResult<{courseId:number;item:Awaited<ReturnType<LearnUsClient['getAssignment']>>}>[]=[];
      const values=[...refs.values()];
      for(let offset=0;offset<values.length;offset+=3)details.push(...await Promise.allSettled(values.slice(offset,offset+3).map(async ref=>({courseId:ref.courseId,item:await this.getAssignment(ref.cmid)}))));
      const items:AssignmentSummary[]=[];let unknownDate=false;
      for(const value of details)if(value.status==='fulfilled'){
        const {item,courseId}=value.value,due=dateTimestamp(item.dueDate);
        for(const warning of item.warnings)warnings.add(warning);
        if(due!==undefined){if(due<start*1000||due>end*1000)continue;}else if(item.dueDate)unknownDate=true;
        else unknownDate=true;
        const status=item.submissionStatus??'';
        const classification=/^(submitted for grading|submitted|제출 완료|제출완료)$/i.test(status)?'completed':/^(not submitted|no submissions have been made yet|미제출|제출되지 않음)$/i.test(status)?'actionable':'unknown';
        items.push({classification,cmid:item.cmid,courseId,url:item.url,title:item.title,dueDate:item.dueDate,submissionStatus:item.submissionStatus,gradingStatus:item.gradingStatus,lastModified:item.lastModified,timeRemaining:item.timeRemaining});
      }
      const failedDetails=details.filter(value=>value.status==='rejected').length;
      if((failedCourses||failedDetails)&&(items.length||failedCourses<activities.length||failedDetails<details.length))warnings.add('ASSIGNMENTS_PARTIAL');
      else if((failedCourses||failedDetails)&&!items.length)warnings.add('ASSIGNMENTS_UNAVAILABLE');
      if(unknownDate)warnings.add('ASSIGNMENT_DATE_UNRECOGNIZED');
      items.sort((a,b)=>(dateTimestamp(a.dueDate)??Infinity)-(dateTimestamp(b.dueDate)??Infinity)||a.cmid-b.cmid);
      return items.slice(0,limit);
    }):Promise.resolve(undefined);
    const [courses,upcoming,announcements,notifications,assignments]=await Promise.all([coursesTask,upcomingTask,announcementsTask,notificationsTask,assignmentsTask]);
    if(options.includeCourses&&courses){result.courses=dedupeBy(courses.courses,course=>courseIdentity(course.id)).slice(0,limit);for(const warning of courses.warnings)warnings.add(warning);}
    if(options.includeUpcoming&&upcoming){result.upcoming=dedupeBy(upcoming.events,event=>calendarEventIdentity(event.id)).sort((a,b)=>a.timesort-b.timesort).slice(0,limit);for(const warning of upcoming.warnings)warnings.add(warning);}
    if(options.includeAssignments&&assignments)result.assignments=assignments;
    if(options.includeAnnouncements&&announcements){result.announcements=dedupeBy(announcements.items,item=>announcementIdentity(item.moduleId,item.id)).filter(item=>{const time=announcementTime(item.createdAt);return time===undefined||(time>=start*1000&&time<=end*1000);}).sort((a,b)=>(announcementTime(b.createdAt)??-Infinity)-(announcementTime(a.createdAt)??-Infinity)).slice(0,limit);for(const warning of announcements.warnings)warnings.add(warning);}
    if(options.includeNotifications&&notifications){result.notifications=dedupeBy(notifications.items,item=>notificationIdentity(item)).filter(item=>{const time=announcementTime(item.createdAt);return time===undefined||(time>=start*1000&&time<=end*1000);}).sort((a,b)=>(announcementTime(b.createdAt)??-Infinity)-(announcementTime(a.createdAt)??-Infinity)).slice(0,limit).map(item=>({...item,text:item.text&&[...item.text].length>200?[...item.text].slice(0,197).join('')+'...':item.text}));for(const warning of notifications.warnings)warnings.add(warning);}
    if(options.includeLearning){result.learning={actionable:[],completed:[],unknown:[]};const ids=options.courseId?[options.courseId]:(courses?.courses??[]).map(c=>c.id);if(!courses&&!options.courseId)warnings.add('LEARNING_UNAVAILABLE');
      for(let offset=0;offset<ids.length;offset+=3){const reports=await Promise.allSettled(ids.slice(offset,offset+3).map(id=>this.getVideoAttendance({courseId:String(id)},upcoming?.events??[])));for(const report of reports){if(report.status==='rejected'){warnings.add('LEARNING_UNAVAILABLE');continue;}for(const video of report.value.items){if(video.state==='completed')result.learning.completed.push(video);else if(requiredVideo(video))result.learning.actionable.push(video);else if(video.attendanceTarget!=='no')result.learning.unknown.push(video);}}}
      for(const key of ['actionable','completed','unknown'] as const)result.learning[key]=result.learning[key].slice(0,limit);
    }
    result.sectionSemantics={announcements:'informational',notifications:'informational',upcoming:'schedule_not_completion'};
    result.warnings=[...warnings];return result;
  }
}
