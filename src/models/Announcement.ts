import { z } from 'zod';
import type { AttachmentRef } from './Attachment.js';
export const learnusId = z.string().regex(/^[1-9]\d*$/).refine(value => Number.isSafeInteger(Number(value)));
export const announcementListInput = z.object({
  courseId:learnusId.describe('Exact Moodle course ID returned by a LearnUs course Tool. Omit to scan current courses.').optional(),
  limit:z.number().int().min(1).max(50).default(10).describe('Maximum number of newest announcement summaries to return.'),
});
export const notificationListInput = z.object({
  limit:z.number().int().min(1).max(50).default(10).describe('Maximum number of newest LearnUs notifications to return.'),
});
export interface AnnouncementSummary {
  id: string;
  moduleId?: string;
  courseId?: string;
  title: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  url: string;
}
export interface AnnouncementDetail extends AnnouncementSummary {
  content?: string;
  attachments?: AttachmentRef[];
}
export interface LearnUsNotification {
  id?: string;
  title?: string;
  text?: string;
  createdAt?: string;
  url?: string;
  read?: boolean;
}
export interface ListResult<T> { items:T[]; warnings:string[] }
export interface AnnouncementListResult extends ListResult<AnnouncementSummary> {
  diagnostics:{courseCount:number;announcementWidgetCount:number;emptyCourseCount:number;boardCount:number;boardRequestCount:number;announcementCount:number;parserMismatchCount:number};
}
