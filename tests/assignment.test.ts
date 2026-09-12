import { readFileSync } from 'node:fs';
import { it, expect, vi } from 'vitest';
import { parseAssignment } from '../src/parser/assignment.js';
import { PlaywrightAuthManager } from '../src/auth/PlaywrightAuthManager.js';
import { LearnUsClient } from '../src/client/LearnUsClient.js';
const fixture = (name: string) => readFileSync(new URL(`./fixtures/assignment-${name}.html`, import.meta.url),'utf8');
it('reads reordered Korean td labels, preserving unknown fields without form values', () => {
  const result = parseAssignment(fixture('ko'));
  expect(result).toMatchObject({title:'합성 과제',submissionStatus:'제출되지 않음',gradingStatus:'채점되지 않음',dueDate:'2026-09-30T23:59:00+09:00',extraFields:[{label:'새로운 항목',value:'합성 값'}],warnings:[]});
  expect(result.lastModified).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('synthetic-private');
});
it('finds English row headers independently of column order and class changes', () => {
  const result = parseAssignment(fixture('en'));
  expect(result).toMatchObject({submissionStatus:'Submitted for grading',gradingStatus:'Not graded',timeRemaining:'2 days',extraFields:[],warnings:[]});
  expect(result.dueDate).toBe('2026-09-30T23:59:00+09:00');
  expect(result.lastModified).toBeUndefined();
});
it('handles missing and unfamiliar fields gracefully', () => {
  expect(parseAssignment('').warnings).toEqual(['NO_ASSIGNMENT_STATUS_FIELDS']);
  expect(parseAssignment('<table class="submissionstatustable"><tr><td>New field</td><td>Value</td></tr></table>').extraFields).toEqual([{label:'New field',value:'Value'}]);
});
it('uses the shared one-retry read-only request for assignment details', async () => {
  const auth = new PlaywrightAuthManager({getCredentials:vi.fn()});
  const ensure = vi.spyOn(auth,'ensureAuthenticated').mockResolvedValue();
  const response = (html: string) => ({text:async () => html,ok:() => true,status:() => 200,url:() => 'https://ys.learnus.org/mod/assign/view.php?id=11',dispose:vi.fn()});
  const expired = response('<input name="password">');
  const valid = response('<script>M.cfg={sesskey:"synthetic"}</script><a href="/login/logout.php">Logout</a>'+fixture('en'));
  const get = vi.fn().mockResolvedValueOnce(expired).mockResolvedValueOnce(valid);
  vi.spyOn(auth.session,'getContext').mockResolvedValue({request:{get}} as never);
  const result = await new LearnUsClient(auth).getAssignment(11);
  expect(result.cmid).toBe(11);
  expect(result.submissionStatus).toBe('Submitted for grading');
  expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls.every(([url]) => url === 'https://ys.learnus.org/mod/assign/view.php?id=11')).toBe(true);
  expect(ensure).toHaveBeenCalledTimes(2);
  expect(expired.dispose).toHaveBeenCalledOnce();
  expect(valid.dispose).toHaveBeenCalledOnce();
  await expect(new LearnUsClient(auth).getAssignment(-1)).rejects.toThrow('PARSE_ERROR');
  expect(get).toHaveBeenCalledTimes(2);
});
