import { load } from 'cheerio';
export { ORIGIN,cleanText } from '../normalize.js';
import { ORIGIN,cleanText,learnUsUrl,courseIdentity } from '../normalize.js';
export const localUrl=learnUsUrl;
export function parseDashboard(html: string) {
  const $ = load(html);
  const courses = new Map<string, import('../models/Course.js').Course>();
  $('a[href]').each((_, element) => {
    const a = $(element), url = localUrl(a.attr('href')!);
    if (url?.pathname !== '/course/view.php') return;
    const id = Number(url.searchParams.get('id'));
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const container = a.closest('[data-courseid], .coursebox, .course-box, .course-item, .course_info, article, li');
    const name = cleanText(a.find('.coursename, .course-title, h3').first().text() || a.text() || container.find('.coursename, .course-title, h3').first().text());
    const key=courseIdentity(id)!;const previous=courses.get(key);
    if (!previous || (!previous.name && name)) courses.set(key, {id, name: name || undefined, url: `${ORIGIN}/course/view.php?id=${id}`});
  });
  return {courses: [...courses.values()], warnings: courses.size ? [] : ['NO_COURSE_LINKS_FOUND']};
}
