import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDashboard } from '../../src/parser/dashboard.js';
import { parseCourse } from '../../src/parser/course.js';
import { extractSesskey, authenticatedHtml } from '../../src/parser/session.js';
const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}.html`, import.meta.url), 'utf8');
describe('parsers', () => {
  it('deduplicates URL identities and discards authentication parameters', () => {
    const result = parseDashboard(fixture('dashboard'));
    expect(result.courses.map(c => c.id)).toEqual([101,102]);
    expect(JSON.stringify(result)).not.toContain('sesskey');
  });
  it('tolerates missing markup and names', () => {
    expect(parseDashboard('<a href="/course/view.php?id=5"></a>').courses[0].id).toBe(5);
    expect(parseDashboard('').warnings).toEqual(['NO_COURSE_LINKS_FOUND']);
  });
  it('preserves unknown and unlinked activities', () => {
    expect(parseCourse(fixture('course')).activities.map(a => a.type)).toEqual(['assign','unknown','unknown']);
  });
  it('extracts config using syntax without evaluating remote code', () => {
    expect(extractSesskey('<script>M.cfg={"sesskey":"synthetic"}; throw Error();</script>')).toBe('synthetic');
    expect(extractSesskey('<script>M["cfg"].sesskey="synthetic"</script>')).toBe('synthetic');
    expect(extractSesskey('<input name="sesskey" value="synthetic">')).toBe('synthetic');
  });
  it('does not confuse guest config with authentication', () => {
    expect(authenticatedHtml(fixture('dashboard'), 'https://ys.learnus.org/')).toBe(true);
    expect(authenticatedHtml('<script>M.cfg={sesskey:"guest"}</script>', 'https://ys.learnus.org/')).toBe(false);
    expect(authenticatedHtml(fixture('dashboard'), 'https://infra.yonsei.ac.kr/')).toBe(false);
  });
});

it('uses observed course semantics without counting menu/footer links', () => {
  const result = parseCourse(fixture('course-semantic'));
  expect(result.name).toBe('Synthetic course');
  expect(result.activities.map(a => ({id:a.id,type:a.type}))).toEqual([{id:11,type:'assign'},{id:12,type:'unknown'}]);
  expect(JSON.stringify(result)).not.toContain('sesskey');
});
