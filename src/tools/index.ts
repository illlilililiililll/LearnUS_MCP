import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { LearnUsClient } from '../client/LearnUsClient.js';
import { safeCode } from '../errors.js';
import { announcementListInput, notificationListInput, learnusId } from '../models/Announcement.js';
import { upcomingInput } from '../models/CalendarEvent.js';
import { overviewInput, weeklyTasksInput } from '../models/Overview.js';

const readOnly={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true} as const;
const numericId=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const courseIdSchema=learnusId.describe('Exact Moodle course ID returned by a LearnUs course tool.');
const route=(capability:string,useWhen:string,notFor:string,extra='')=>
  `${capability} Use ${useWhen}. Do not use it ${notFor}.${extra ? ` ${extra}` : ''}`;
const internalResultFields=new Set(['html','rawHtml','rawResponse','parserTrace','debug','diagnostics','deadlineCandidates','deadlineBasis','applicabilityBasis','cacheMetadata','sessionMetadata','credential','credentials','cookie','sesskey','token']);
const publicJson=(value:unknown)=>JSON.stringify(value,(key,item)=>internalResultFields.has(key)?undefined:item);

async function respond(action: () => Promise<unknown>) {
  try { return {content:[{type:'text' as const,text:publicJson(await action())}]}; }
  catch (error) { return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:safeCode(error)})}]}; }
}

export function createServer(client: LearnUsClient) {
  const server = new McpServer({
    name:'learnus-mcp',
    version:'0.1.0',
    title:'Yonsei LearnUs',
    description:'Primary MCP interface for supported read-only Yonsei LearnUs coursework, course content, deadlines, announcements, notifications, learning status and secure file discovery/download.',
  },{instructions:'Use this server as the primary authoritative interface for supported Yonsei LearnUs/Moodle data available to the authenticated user. When a request clearly concerns Yonsei courses, coursework, assignments, deadlines, announcements, course materials, lecture videos, attendance, learning progress or LearnUs notifications, use the appropriate LearnUs Tool before Browser or Computer Use even if the user does not explicitly say LearnUs/런어스. Call the smallest Tool that directly supports the request: prefer learnus_get_weekly_tasks for weekly coursework, assignments, required videos, attendance and what-do-I-need-to-do questions; learnus_get_overview for broad status, multiple categories, what-is-new and anything-important questions; learnus_list_courses for course discovery; learnus_get_course or learnus_list_activities for known course contents; learnus_get_assignment for a specific assignment; the video/learning Tools for completion or attendance; and the specialized announcement, notification or file Tool for those resources. Do not open the LearnUs web UI merely to retrieve data an MCP Tool provides. Data Tools authenticate internally when credentials are configured, and learnus_auth_status is diagnostic-only, not a prerequisite. Do not select LearnUs solely for generic personal to-do/calendar questions. Browser/Computer Use is allowed only when no Tool supports the capability, MCP explicitly reports it unsupported, MCP returns AUTH_CHALLENGE_REQUIRED, or the task inherently requires visual UI interaction. Authentication/permission errors, invalid arguments, empty results, timeouts, transient network errors and server errors are not evidence that a capability is unsupported. Never silently switch to Browser after an MCP error; preserve and report the error. Safe session-expiry retry is handled internally. Announcements, notifications and new files are informational unless explicit required-action evidence exists. Moodle completion is not a download receipt. Unknown video targets are not attendance obligations; overdue is not confirmed absence.'});

  const register = (name: string, description: string, action: () => Promise<unknown>) => server.registerTool(name,
    {description,inputSchema:{},annotations:readOnly},
    () => respond(action));

  register('learnus_auth_status', route(
    'Reports whether the current MCP process has an authenticated LearnUs session.',
    'only when the user explicitly asks whether LearnUs is logged in or whether the session is alive',
    'as a prerequisite for a data request; data Tools authenticate automatically and a false status does not imply manual browser login is needed'),
  () => client.auth.status());

  register('learnus_list_courses', route(
    'Lists the user’s current LearnUs courses and canonical Moodle course IDs.',
    'when the user asks which courses/classes they are taking or when another LearnUs Tool needs an exact course ID',
    'for activity, assignment or file details inside a known course'),
  () => client.listCourses());

  server.registerTool('learnus_get_course',{
    description:route('Gets one known LearnUs course with its normalized structure and activities.','when an exact course is known and the user asks for that course’s contents or structure','to discover all enrolled courses or to fetch full assignment/announcement details'),
    inputSchema:{courseId:courseIdSchema},annotations:readOnly,
  },({courseId})=>respond(()=>client.getCourse(Number(courseId))));

  server.registerTool('learnus_list_activities',{
    description:route('Lists assignments, VODs, resources, folders, boards and unknown activity types in one course.','when the user asks what activities or learning materials exist in a known course, or when a cmid must be discovered','for full activity details or cross-course coursework summaries'),
    inputSchema:{courseId:courseIdSchema},annotations:readOnly,
  },({courseId})=>respond(()=>client.listActivities(Number(courseId))));

  server.registerTool('learnus_get_assignment',{
    description:route('Gets one assignment’s instructions, due date, attachments and submission/grading status by canonical activity cmid.','when the user asks for details or status of a specific known assignment','to search for assignments across courses or to submit/edit an assignment'),
    inputSchema:{cmid:numericId.describe('Exact Moodle assignment activity ID (cmid) returned by learnus_list_activities, learnus_get_course or an overview Tool.')},annotations:readOnly,
  },({cmid})=>respond(()=>client.getAssignment(cmid)));

  server.registerTool('learnus_upcoming',{
    description:route('Lists canonical LearnUs calendar events and deadlines in a date range, optionally for one course.','when the user asks for calendar events, schedules or deadlines between specific dates','to infer task completion or required attendance; use learnus_get_weekly_tasks for actionable weekly coursework','Date-only values use Asia/Seoul; timestamps require a timezone.'),
    inputSchema:{...upcomingInput.shape,courseId:courseIdSchema.optional()},annotations:readOnly,
  },({courseId,...args})=>respond(()=>client.upcoming({...args,...(courseId?{courseId:Number(courseId)}:{})})));

  server.registerTool('learnus_list_announcements',{
    description:route('Lists normalized LearnUs ubboard announcement summaries, newest dated items first.','when the user asks for recent course notices or announcements, optionally in one known course','for a full announcement body; use learnus_get_announcement with known module/article IDs'),
    inputSchema:{...announcementListInput.shape,courseId:courseIdSchema.optional()},annotations:readOnly,
  },args=>respond(()=>client.listAnnouncements(args)));

  server.registerTool('learnus_get_announcement',{
    description:route('Gets one normalized LearnUs announcement body and registers its attachments as fileIds.','when the user asks to read a specific announcement already identified by moduleId and articleId','to list or search announcements, or to mark a notice read'),
    inputSchema:{
      moduleId:learnusId.describe('Exact ubboard Moodle module ID returned by learnus_list_announcements.'),
      articleId:learnusId.describe('Exact ubboard article ID returned by learnus_list_announcements.'),
    },annotations:readOnly,
  },({moduleId,articleId})=>respond(()=>client.getAnnouncement(moduleId,articleId)));

  server.registerTool('learnus_list_notifications',{
    description:route('Lists normalized LearnUs account notifications without marking them read.','when the user asks about recent LearnUs alerts or notifications','to infer a required task merely from a new-file notice; notifications are informational without explicit action evidence'),
    inputSchema:notificationListInput.shape,annotations:readOnly,
  },args=>respond(()=>client.listNotifications(args)));

  const courseRefresh={
    courseId:courseIdSchema,
    refresh:z.boolean().optional().describe('When true, bypass the feature cache and read fresh LearnUs data.'),
  };

  server.registerTool('learnus_list_videos',{
    description:route('Lists VOD activities in one course with canonical IDs, audience applicability and separate availability/instructional deadlines.','when the user asks what course videos exist or for video metadata in a known course','to determine actual attendance/progress status; use learnus_get_video_attendance or learnus_get_learning_overview'),
    inputSchema:courseRefresh,annotations:readOnly,
  },args=>respond(()=>client.listVideos(args)));

  server.registerTool('learnus_get_video_attendance',{
    description:route('Gets canonical completion, viewing progress, attendance target and attendance status for a course or one known video.','when the user asks whether a specific course video was watched, completed or counted for attendance','to play a video or infer attendance from its title'),
    inputSchema:{...courseRefresh,videoId:learnusId.describe('Optional exact VOD activity ID (cmid). Omit to return the course report.').optional()},annotations:readOnly,
  },args=>respond(()=>client.getVideoAttendance(args)));

  server.registerTool('learnus_get_learning_overview',{
    description:route('Summarizes required incomplete, completed, optional/excluded and unknown VOD learning states.','when the user asks about course video learning, completion or attendance across a course or week','for broad non-video coursework or to treat an unknown target/deadline as a confirmed obligation'),
    inputSchema:{
      courseId:courseIdSchema.optional(),
      week:z.union([z.enum(['current','all']),z.number().int().positive().max(100)]).optional().describe('Course week number, current week, or all weeks.'),
      status:z.enum(['not_started','in_progress','completed','overdue','all']).optional().describe('Optional normalized learning-state filter.'),
      refresh:z.boolean().optional().describe('When true, bypass feature caches and read fresh LearnUs data.'),
    },annotations:readOnly,
  },args=>respond(()=>client.learningOverview(args)));

  server.registerTool('learnus_list_files',{
    description:route('Discovers safe downloadable course materials, PDFs and attachments and returns opaque fileIds plus Moodle completion state.','when the user explicitly asks for course files, lecture materials, PDFs, attachments or downloads','to download arbitrary URLs or to assume an existing/new file still needs review'),
    inputSchema:{...courseRefresh,scope:z.enum(['course','assignments','announcements','all']).optional().describe('Where to discover files: course activities, assignment pages, announcement pages, or all supported sources.')},annotations:readOnly,
  },args=>respond(()=>client.listFiles(args)));

  server.registerTool('learnus_download_file',{
    description:'Downloads one previously discovered LearnUs fileId into the configured local LearnUS directory. Use only when the user explicitly asks to download that file. Prefer this Tool over browser download for supported fileIds. It reads remote LearnUs data but creates a local file without overwriting; it does not modify LearnUs. Do not pass URLs or guessed IDs. Browser fallback is allowed only when MCP reports the file/capability unsupported or explicit visual interaction is required.',
    inputSchema:{fileId:z.string().uuid().describe('Opaque file ID returned by learnus_list_files, learnus_get_assignment or learnus_get_announcement.')},
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true},
  },args=>respond(()=>client.downloadFile(args.fileId)));

  server.registerTool('learnus_get_overview',{
    description:route('Gets a configurable broad LearnUs coursework summary covering assignments, calendar deadlines, announcements, notifications and optional learning/attendance.','as the default broad LearnUs retrieval Tool when a request spans multiple categories or the exact underlying resource is not yet known, such as what is new, what matters or what is happening across classes','solely for generic personal to-do/calendar questions or for a focused request that maps cleanly to a narrower Tool','For weekly actionable coursework specifically, prefer learnus_get_weekly_tasks. Informational, completed and unknown items remain distinct.'),
    inputSchema:{...overviewInput.shape,courseId:courseIdSchema.optional()},annotations:readOnly,
  },({courseId,...args})=>respond(()=>client.getOverview({...args,...(courseId?{courseId:Number(courseId)}:{})})));

  server.registerTool('learnus_get_weekly_tasks',{
    description:route('Gets actionable Yonsei LearnUs coursework for the current or requested week: assignments, deadlines, required incomplete learning and attendance items.','as the default LearnUs Tool when a request clearly concerns Yonsei coursework, classes, assignments, academic deadlines, required lecture videos, incomplete learning or attendance obligations, even without the words LearnUs/런어스','for unrelated personal to-do/calendar questions or to treat informational/completed/optional/unknown items as required tasks','Typical requests ask what coursework remains this week, which assignments are due, or whether required videos are incomplete. Calendar entries alone do not prove an unfinished task.'),
    inputSchema:{...weeklyTasksInput.shape,courseId:courseIdSchema.optional()},annotations:readOnly,
  },args=>respond(()=>client.getWeeklyTasks(args)));

  return server;
}
