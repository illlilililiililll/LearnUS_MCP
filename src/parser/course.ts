import { load } from 'cheerio';
import { cleanText, localUrl } from './dashboard.js';
import type { Activity } from '../models/Activity.js';
import { activityIdentity } from '../normalize.js';
import { parseActivityCompletion } from './completion.js';
export function parseCourse(html: string) {
  const $ = load(html), activities: Activity[] = [], seen = new Set<string>();
  // Prefer Moodle activity containers; global navigation/footer links are not course activities.
  const containers = $('.activity');
  (containers.length ? containers : $('.course-content a[href]').filter((_,link)=>!$(link).closest('nav,footer,.breadcrumb,.menu-item').length)).each((_, element) => {
    const el = $(element), a = el.is('a') ? el : el.find('a[href]').filter((_, link) => {
      const candidate = localUrl($(link).attr('href') || '');
      return !!candidate?.pathname.match(/^\/mod\/[a-z0-9_]+\/view\.php$/);
    }).first();
    const url = localUrl(a.attr('href') || '');
    const match = url?.pathname.match(/^\/mod\/([a-z0-9_]+)\/view\.php$/);
    const module = match?.[1] || el.attr('class')?.match(/modtype_([a-z0-9_]+)/)?.[1];
    if (!module && !el.hasClass('activity')) return;
    const rawId = Number(url?.searchParams.get('id')) || Number(el.attr('id')?.match(/^module-(\d+)$/)?.[1]);
    const id = Number.isSafeInteger(rawId) && rawId > 0 ? rawId : undefined;
    const key = activityIdentity(id) || el.attr('id');
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    const type = ['assign','quiz','ubboard','vod'].includes(module || '') ? module as Activity['type'] : 'unknown';
    activities.push({id, type, module, completionState:el.is('a')?'unknown':parseActivityCompletion($.html(el)),name: cleanText(a.find('.instancename').first().text() || a.text() || el.text()) || undefined,
      url: match && id ? `${url!.origin}${url!.pathname}?id=${id}` : undefined});
  });
  return {name: cleanText($('.coursename').first().text() || $('h1').first().text()) || undefined, activities};
}
