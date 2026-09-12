import { z } from 'zod';
const date = z.union([z.iso.date(), z.iso.datetime({offset:true})]);
export const upcomingInput = z.object({
  from:date.describe('Inclusive range start as YYYY-MM-DD in Asia/Seoul or an ISO 8601 timestamp with timezone.'),
  to:date.describe('Inclusive range end as YYYY-MM-DD in Asia/Seoul or an ISO 8601 timestamp with timezone.'),
  limit:z.number().int().min(1).max(500).default(20).describe('Maximum number of calendar events to return after date and course filtering.'),
  courseId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER).describe('Exact Moodle course ID returned by a LearnUs course Tool.').optional(),
});
export type UpcomingInput = z.input<typeof upcomingInput>;
export interface CalendarEvent {
  cmid?:number;
  id: number;
  timesort: number;
  date: string;
  name?: string;
  courseId?: number;
  module?: string;
  type?: string;
}
export interface UpcomingResult {
  events: CalendarEvent[];
  warnings: string[];
  truncated: boolean;
}
// Date-only inputs use the LearnUs calendar's Korea timezone, including the whole end day.
export function calendarBoundary(value: string, end: boolean): number {
  const milliseconds = Date.parse(value.length === 10 ? `${value}T${end ? '23:59:59' : '00:00:00'}+09:00` : value);
  return (end ? Math.floor : Math.ceil)(milliseconds / 1000);
}
