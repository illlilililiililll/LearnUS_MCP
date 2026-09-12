import { load, type CheerioAPI } from 'cheerio';
import { localUrl } from './dashboard.js';
export function contentDocument(html: string): CheerioAPI {
  const $ = load(html);
  $('script,style,nav,body > header,footer,#page-header,iframe,form,button,input,select,textarea,.modal,.button_area,[hidden],[aria-hidden="true"]').remove();
  return $;
}
export function contentText(html: string): string {
  const $ = contentDocument(html);
  $('img[alt]').each((_,element)=>{ $(element).replaceWith($('<span>').text($(element).attr('alt') || '')); });
  $('br').replaceWith('\n');
  $('p,div,li,h1,h2,h3,h4,blockquote,tr').append('\n');
  $('td,th').append('\t');
  return $.root().text().replace(/\u00a0/g,' ').split('\n')
    .map(line=>line.replace(/[^\S\n]+/g,' ').trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
// Return only local read URLs with known query keys; never expose session/action parameters.
export function contentUrl(href: string, attachment = false): string | undefined {
  const url = localUrl(href);
  if (!url || url.username || url.password) return;
  if (attachment) {
    if (!/^\/(?:pluginfile|webservice\/pluginfile)\.php\//.test(url.pathname)) return;
  } else if (!/^\/(?:course\/view|mod\/[a-z0-9_]+\/(?:view|article))\.php$/.test(url.pathname)) return;
  const params = new URLSearchParams();
  for (const key of attachment ? ['forcedownload'] : ['id','bwid']) {
    const value = url.searchParams.get(key);
    if (value && /^\d+$/.test(value)) params.set(key,value);
  }
  return `${url.origin}${url.pathname}${params.size ? `?${params}` : ''}`;
}
