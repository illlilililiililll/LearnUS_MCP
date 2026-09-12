export type Confidence = 'high' | 'medium' | 'low';
export type Applicability = 'required' | 'optional' | 'not_applicable' | 'unknown';
export interface LearningDeadline {
  attendanceDueAt?:string;
  effectiveDueSource?:'attendance'|'calendar_progress_stop'|'instructor'|'unknown';
  deadlineCandidates?:{date:string;source:'attendance'|'calendar_progress_stop'|'instructor'}[];
  systemAvailableFrom?: string; systemAvailableUntil?: string;
  instructionalDueAt?: string; instructionalDueRule?: string; effectiveDueAt?: string;
  deadlinePrecision?: 'exact' | 'day' | 'week' | 'relative' | 'unknown'; deadlineBasis?: string[];
}
export interface VideoLearningStatus extends LearningDeadline {
  completionState?:import('../parser/completion.js').CompletionState;
  attendanceTarget?:'yes'|'no'|'unknown';
  attendanceStatus?:'attended'|'not_attended'|'in_progress'|'unknown';
  videoId: string; courseId: string; title: string; url?: string; week?: number;
  progressPercent?: number; watchedSeconds?: number; maxPositionSeconds?: number; contentLengthSeconds?: number;
  officiallyRecognized?: boolean | null; weeklyAttendanceRecognized?: boolean | null; completionHint?: boolean | null;
  applicability: Applicability; applicabilityConfidence: Confidence; applicabilityBasis?: string[];
  state: 'not_required' | 'upcoming' | 'not_started' | 'in_progress' | 'completed' | 'overdue_unwatched' | 'overdue_incomplete' | 'unknown';
  completionBasis: 'attendance' | 'progress' | 'completion_hint' | 'unknown'; confidence: Confidence; warnings: string[];
}
export interface CourseContextIndex {
  courseId: string; courseName?: string; courseCode?: string; semester?: string;
  weeks: {week:number;start?:string;end?:string}[];
  activities: {id:string;title:string;type:string;url?:string;week?:number;completionState?:import('../parser/completion.js').CompletionState}[];
  videos: VideoLearningStatus[]; audienceContext: string[]; fetchedAt:number; warnings:string[];
}
export interface CompletionReport {
  mode: 'attendance' | 'progress' | 'unknown';
  // Site data-modid is an instance identity, not necessarily Moodle's course-module ID.
  entries: (Partial<VideoLearningStatus> & {instanceId?:string;title:string})[]; warnings:string[];
}
export interface CourseOverride { audienceTags?:string[] }
export interface TimetableEvidence { rule:string; startsAt:string; courseId:string; confidence:Confidence }
