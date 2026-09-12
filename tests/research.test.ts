import { existsSync, readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { load } from 'cheerio';
import { parseCourse } from '../src/parser/course.js';
import { parseAssignment } from '../src/parser/assignment.js';
import { parseAnnouncement } from '../src/parser/announcement.js';
import { parseNotifications } from '../src/parser/notification.js';
const path = '_research/ys.learnus.org.har';
it.skipIf(!existsSync(path))('validates recorded course, assignment, announcement and notification HTML without exposing source values', () => {
  try {
    const har = JSON.parse(readFileSync(path,'utf8'));
    let checked = 0;
    for (const entry of har.log.entries) {
      if (new URL(entry.request.url).pathname !== '/course/view.php') continue;
      const content = entry.response.content;
      const html = content.encoding === 'base64' ? Buffer.from(content.text,'base64').toString() : content.text;
      const $ = load(html);
      if (!$('.activity').length) continue;
      const result = parseCourse(html);
      $('.activity').each((_,node)=>{const id=Number($(node).attr('id')?.match(/^module-(\d+)$/)?.[1]);const icon=$(node).find('img').toArray().some(img=>($(img).attr('src')??'').includes('completion-auto-n'));if(icon)expect(result.activities.some(a=>a.id===id&&a.completionState==='incomplete')).toBe(true);});
      const moduleIds = new Set<number>();
      $('.activity').each((_, element) => {
        const id = Number($(element).attr('id')?.match(/^module-(\d+)$/)?.[1]);
        if (Number.isSafeInteger(id) && id > 0) moduleIds.add(id);
      });
      // The recorded page repeats one module container; activities are module identities.
      expect(result.activities.length === moduleIds.size).toBe(true);
      expect(typeof result.name === 'string' && result.name.length > 0).toBe(true);
      expect(result.activities.every(a => a.id !== undefined && a.id > 0)).toBe(true);
      expect([...moduleIds].every(id => result.activities.some(a => a.id === id))).toBe(true);
      checked++;
    }
    expect(checked > 0).toBe(true);
    let assignmentsChecked = 0;
    for (const entry of har.log.entries) {
      if (new URL(entry.request.url).pathname !== '/mod/assign/view.php') continue;
      const content = entry.response.content;
      const html = content.encoding === 'base64' ? Buffer.from(content.text,'base64').toString() : content.text;
      const result = parseAssignment(html);
      expect(!!result.title && !!result.submissionStatus && !!result.gradingStatus && !!result.dueDate).toBe(true);
      expect(result.warnings.length === 0).toBe(true);
      assignmentsChecked++;
    }
    expect(assignmentsChecked > 0).toBe(true);
    let announcementsChecked = 0, notificationsChecked = 0;
    for (const entry of har.log.entries) {
      const url = new URL(entry.request.url);
      if (!['/mod/ubboard/article.php','/theme/coursemosv2/action.php'].includes(url.pathname)) continue;
      const content = entry.response.content;
      const body = content.encoding === 'base64' ? Buffer.from(content.text,'base64').toString() : content.text;
      if (url.pathname === '/mod/ubboard/article.php') {
        const result = parseAnnouncement(body,url.searchParams.get('id')!,url.searchParams.get('bwid')!);
        expect(!!result.item?.title && !!result.item?.content && !!result.item?.createdAt).toBe(true);
        expect(result.warnings.length===0).toBe(true);
        announcementsChecked++;
      } else {
        const result = parseNotifications(JSON.parse(body).html);
        expect(result.items.length>0).toBe(true);
        expect(result.items.every(item=>!!item.title || !!item.text)).toBe(true);
        notificationsChecked++;
      }
    }
    expect(announcementsChecked>0 && notificationsChecked>0).toBe(true);
  } catch { throw new Error('RECORDED_HTML_VALIDATION_FAILED'); }
},30000);
