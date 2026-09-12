import { expect,it } from 'vitest';
import { activityIdentity, announcementIdentity, assignmentIdentity, calendarEventIdentity, courseIdentity, dedupeBy, learnUsUrl, normalizeDate, notificationIdentity } from '../src/normalize.js';
import { contentText } from '../src/parser/content.js';
import { parseCourse } from '../src/parser/course.js';
import { parseNotifications } from '../src/parser/notification.js';

it('uses Moodle IDs as canonical entity identities',()=>{
  expect(courseIdentity(7)).toBe('course:7');expect(activityIdentity('11')).toBe('activity:11');expect(assignmentIdentity(11)).toBe('activity:11');
  expect(calendarEventIdentity(21)).toBe('event:21');expect(announcementIdentity('31','41')).toBe('announcement:31:41');expect(courseIdentity(0)).toBeUndefined();
  expect(dedupeBy([{id:1,value:'first'},{id:1,value:'second'}],item=>courseIdentity(item.id))).toEqual([{id:1,value:'first'}]);
});
it('uses stable notification IDs before deterministic composite identities',()=>{
  expect(notificationIdentity({id:'stable',url:'https://ys.learnus.org/a'})).toBe(notificationIdentity({id:'stable',url:'https://ys.learnus.org/b'}));
  const first=notificationIdentity({url:'/mod/assign/view.php?id=1&utm_source=test',createdAt:'2026년 9월 2일 10:00',title:'Synthetic',text:'Message'});
  expect(first).toBe(notificationIdentity({url:'https://ys.learnus.org/mod/assign/view.php?id=1',createdAt:'2026-09-02 10:00',title:' Synthetic ',text:'Message'}));
  expect(first).not.toBe(notificationIdentity({url:'/mod/assign/view.php?id=2',createdAt:'2026-09-02 10:00',title:'Synthetic',text:'Message'}));
});
it('normalizes LearnUs URLs, dates and visible text safely',()=>{
  expect(learnUsUrl('/course/view.php?utm_source=x&id=7#section-1')?.href).toBe('https://ys.learnus.org/course/view.php?id=7');
  expect(learnUsUrl('https://example.com/course/view.php?id=7')).toBeUndefined();
  expect(normalizeDate('2026년 9월 2일 10:05')).toBe('2026-09-02T10:05:00+09:00');
  expect(normalizeDate('Wednesday, 30 September 2026, 11:59 PM')).toBe('2026-09-30T23:59:00+09:00');
  expect(normalizeDate('2026-02-31')).toBeUndefined();
  expect(contentText('<p>First <b>line</b></p><script>hidden()</script><style>.x{}</style><p>Second</p>')).toBe('First line\nSecond');
});
it('deduplicates activities by cmid and notifications by stable identity',()=>{
  const course=parseCourse('<div class="activity modtype_assign" id="module-11"><a href="/mod/assign/view.php?id=11">First</a></div><div class="activity modtype_quiz" id="module-11"><a href="/mod/quiz/view.php?id=11">Duplicate representation</a></div>');
  expect(course.activities).toHaveLength(1);
  const notifications=parseNotifications('<div class="media-lists"><a class="media" data-id="stable" href="/mod/assign/view.php?id=1"><span class="text-title">First</span></a><a class="media" data-id="stable" href="/mod/assign/view.php?id=2"><span class="text-title">Second</span></a></div>');
  expect(notifications.items).toHaveLength(1);expect(notifications.items[0].title).toBe('First');
});
