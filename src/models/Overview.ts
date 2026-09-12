import { z } from 'zod';
import { upcomingInput, type CalendarEvent } from './CalendarEvent.js';
import type { Course } from './Course.js';
import type { AnnouncementSummary, LearnUsNotification } from './Announcement.js';
import { learnusId } from './Announcement.js';

export const weeklyTasksInput=z.object({
  courseId:learnusId.describe('Exact Moodle course ID returned by a LearnUs course Tool. Omit for all current courses.').optional(),
  from:upcomingInput.shape.from.optional(),to:upcomingInput.shape.to.optional(),
});
export type WeeklyTasksInput=z.input<typeof weeklyTasksInput>;

export const overviewInput=z.object({
  courseId:z.number().int().positive().describe('Exact Moodle course ID returned by a LearnUs course Tool. Omit for all current courses.').optional(),
  includeLearning:z.boolean().default(false).describe('Include course video learning, completion and attendance classification.'),
  from:upcomingInput.shape.from.optional(),to:upcomingInput.shape.to.optional(),
  includeCourses:z.boolean().default(false).describe('Include current course summaries.'),
  includeUpcoming:z.boolean().default(true).describe('Include LearnUs calendar events in the requested range.'),
  includeAssignments:z.boolean().default(true).describe('Include normalized assignment summaries and submission states.'),
  includeAnnouncements:z.boolean().default(true).describe('Include recent announcement summaries without full article bodies.'),
  includeNotifications:z.boolean().default(false).describe('Include recent account notifications without marking them read.'),
  maxItemsPerSection:z.number().int().min(1).max(50).default(10).describe('Maximum number of items returned in each included overview section.'),
});
export type OverviewInput=z.input<typeof overviewInput>;
export interface AssignmentSummary {
  classification?:'actionable'|'informational'|'completed'|'unknown';
  cmid:number;courseId:number;url:string;title?:string;dueDate?:string;
  submissionStatus?:string;gradingStatus?:string;lastModified?:string;timeRemaining?:string;
}
export interface LearnUsOverview {
  learning?:{actionable:import('./Learning.js').VideoLearningStatus[];completed:import('./Learning.js').VideoLearningStatus[];unknown:import('./Learning.js').VideoLearningStatus[]};
  resources?:{cmid:number;courseId:number;completionState?:import('../parser/completion.js').CompletionState;classification:'actionable'|'informational'|'completed'|'unknown'}[];
  sectionSemantics?:{announcements:'informational';notifications:'informational';upcoming:'schedule_not_completion'};
  range:{from:string;to:string};courses?:Course[];upcoming?:CalendarEvent[];
  assignments?:AssignmentSummary[];announcements?:AnnouncementSummary[];notifications?:LearnUsNotification[];
  warnings:string[];
}
