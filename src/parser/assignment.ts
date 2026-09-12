import { load } from 'cheerio';
import { cleanText } from './dashboard.js';
import type { Assignment } from '../models/Assignment.js';
import { normalizeDate } from '../normalize.js';

const aliases = {
  submissionStatus:['제출 여부','제출 상태','제출 상황','Submission status'],
  gradingStatus:['채점 상황','채점 상태','Grading status'],
  dueDate:['종료 일시','마감 일시','제출 마감일','Due date'],
  lastModified:['최종 수정 일시','최근 수정 일시','Last modified'],
  timeRemaining:['남은 시간','Time remaining'],
} as const;
type StatusField = keyof typeof aliases;
const normalize = (label: string) => cleanText(label).replace(/[:：]\s*$/, '').toLowerCase();
const fieldFor = new Map<string, StatusField>(Object.entries(aliases)
  .flatMap(([field, labels]) => labels.map(label => [normalize(label), field as StatusField])));

export function parseAssignment(html: string): Omit<Assignment, 'cmid' | 'url'> {
  const $ = load(html);
  $('script, style, input, textarea, select, button, [hidden], [aria-hidden="true"]').remove();
  $('br').replaceWith(' ');
  $('p, li').append(' ');
  const result: Omit<Assignment, 'cmid' | 'url'> = {
    title: cleanText($('#region-main h2, main h2, h2').not('.coursename').first().text()) || undefined,
    description: cleanText($('#intro, .assignmentintro').first().text()) || undefined,
    extraFields:[], warnings:[],
  };
  const scoped = $('.submissionstatustable table, table.submissionstatustable, .submissionsummarytable table, table.submissionsummarytable');
  (scoped.length ? scoped : $('table')).each((_, table) => {
    const rows: {label:string; value:string}[] = [];
    $(table).find('tr').each((_, row) => {
      if ($(row).closest('table')[0] !== table || $(row).closest('thead').length) return;
      const cells = $(row).children('th,td');
      const labelCell = cells.filter('th[scope="row"]').first().length
        ? cells.filter('th[scope="row"]').first() : cells.first();
      const value = cleanText(cells.not(labelCell).text());
      const label = cleanText(labelCell.text());
      if (label && value) rows.push({label, value});
    });
    // Without familiar classes, require a known label before treating a table as status data.
    if (!scoped.length && !rows.some(row => fieldFor.has(normalize(row.label)))) return;
    for (const row of rows) {
      const field = fieldFor.get(normalize(row.label));
      if (field) result[field] ??= field==='dueDate'||field==='lastModified' ? normalizeDate(row.value) : row.value;
      else if (!result.extraFields.some(other => other.label === row.label && other.value === row.value)) result.extraFields.push(row);
    }
  });
  if (!Object.keys(aliases).some(field => result[field as StatusField])) result.warnings.push('NO_ASSIGNMENT_STATUS_FIELDS');
  return result;
}
