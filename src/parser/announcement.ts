import { load } from 'cheerio';
import { cleanText, localUrl, ORIGIN } from './dashboard.js';
import { contentDocument, contentText, contentUrl } from './content.js';
import type { AnnouncementDetail, AnnouncementSummary, ListResult } from '../models/Announcement.js';
import { announcementIdentity, normalizeDate } from '../normalize.js';
const validId = (value: string | null | undefined) => !!value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
const emptyNotice = /등록된\s*(?:게시물|게시글|글|공지사항|자료)(?:이|가)?\s*없|게시물이\s*없|no\s+(?:announcements|posts|articles|records|entries)(?:\s+(?:found|available))?/i;
export const announcementUrl = (moduleId: string, articleId: string) => `${ORIGIN}/mod/ubboard/article.php?id=${moduleId}&bwid=${articleId}`;

const announcementLabel = /^(?:과목\s*공지|course\s+announcements?|announcements?)$/i;
export interface InlineAnnouncements extends ListResult<AnnouncementSummary> {
  moduleIds:string[];widgetCount:number;emptyWidgetCount:number;parserMismatchCount:number;
}
export function parseInlineAnnouncements(html:string,courseId:string):InlineAnnouncements {
  const $=load(html),items=new Map<string,AnnouncementSummary>(),modules=new Set<string>();
  let widgetCount=0,emptyWidgetCount=0,parserMismatchCount=0;
  $('.course-article').each((_,element)=>{
    const widget=$(element),label=cleanText(widget.find('.course-article-header h5').first().text());
    const articleLinks=widget.find('a[href]').filter((_,link)=>localUrl($(link).attr('href')||'')?.pathname==='/mod/ubboard/article.php');
    if(!announcementLabel.test(label)&&!articleLinks.length)return;
    widgetCount++;
    widget.find('.actions a[href],a[href]').each((_,link)=>{
      const url=localUrl($(link).attr('href')||'');
      if(url?.pathname==='/mod/ubboard/view.php'&&validId(url.searchParams.get('id')))modules.add(url.searchParams.get('id')!);
    });
    const candidates=widget.find('.article-list-item');
    if(!candidates.length&&!articleLinks.length){emptyWidgetCount++;return;}
    const before=items.size,beforeMismatch=parserMismatchCount;
    (candidates.length?candidates:articleLinks).each((_,node)=>{
      const scope=$(node),a=(scope.is('a')?scope:scope.find('a[href*="/mod/ubboard/article.php"]').first());
      const url=localUrl(a.attr('href')||''),moduleId=url?.searchParams.get('id'),articleId=url?.searchParams.get('bwid');
      const title=cleanText(scope.find('.article-subject').first().text()||a.find('.article-subject').first().text()||a.text());
      if(url?.pathname!=='/mod/ubboard/article.php'||!validId(moduleId)||!validId(articleId)||!title){parserMismatchCount++;return;}
      modules.add(moduleId!);
      const item:AnnouncementSummary={id:articleId!,moduleId:moduleId!,courseId,title,url:announcementUrl(moduleId!,articleId!),createdAt:normalizeDate(cleanText(scope.find('.article-date').first().text()))};
      items.set(announcementIdentity(moduleId,articleId)!,item);
    });
    if(items.size===before&&parserMismatchCount===beforeMismatch)emptyWidgetCount++;
  });
  return {items:[...items.values()],moduleIds:[...modules],widgetCount,emptyWidgetCount,parserMismatchCount,warnings:[]};
}

export function announcementModules(html: string): {moduleIds:string[];warnings:string[]} {
  const parsed=parseInlineAnnouncements(html,'1');
  return {moduleIds:parsed.moduleIds,warnings:parsed.parserMismatchCount?['ANNOUNCEMENT_STRUCTURE_UNRECOGNIZED']:[]};
}

export function parseAnnouncements(html: string, moduleId: string, courseId?: string, page = 0): ListResult<AnnouncementSummary> & {nextPage?:number} {
  // Board tables can be wrapped in a form, so structural parsing must preserve form children.
  const $ = load(html), items = new Map<string,AnnouncementSummary>();
  $('script,style,nav,footer,iframe,button,input,select,textarea,.modal,.button_area,[hidden],[aria-hidden="true"]').remove();
  $('.menu-item,.footer-link,.breadcrumb').remove();
  let malformed = false;
  $('a[href]').each((_,element) => {
    const a = $(element), url = localUrl(a.attr('href') || '');
    if (url?.pathname !== '/mod/ubboard/article.php' || url.searchParams.get('id') !== moduleId) return;
    const id = url.searchParams.get('bwid');
    if (!validId(id)) { malformed = true; return; }
    const row = a.closest('tr,li,article,[data-articleid],.article-list-item,.board-item');
    const scope = row.length ? row : a.parent();
    const title = cleanText(a.find('.article-subject,.subject,.title').first().text() || a.attr('title') || a.text());
    if (!title) { malformed = true; return; }
    const value = (selector:string) => {
      const el = scope.find(selector).first().clone();
      el.find('.label,.title').remove();
      return cleanText(el.text()) || undefined;
    };
    const cells = scope.children('td,th');
    const table = scope.closest('table');
    const labeledCell = (labels:RegExp) => {
      let found: string | undefined;
      table.find('thead th, tr:first-of-type th').each((index,cell)=>{
        if (labels.test(cleanText($(cell).text()))) found = cleanText(cells.eq(index).text()) || undefined;
      });
      return found;
    };
    const time = scope.find('time').first();
    const item: AnnouncementSummary = {id:id!,moduleId,courseId,title,url:announcementUrl(moduleId,id!),
      author:value('.writer,.author,[rel="author"]') || labeledCell(/^(?:작성자|글쓴이|author|writer)$/i),
      createdAt:normalizeDate(time.attr('datetime') || value('.article-date,.createdat,.created-at,.date') || labeledCell(/^(?:작성일|등록일|날짜|date|created)$/i)),
      updatedAt:normalizeDate(value('.updated-at,.updatedat'))};
    const key=announcementIdentity(moduleId,id)!;const previous = items.get(key);
    if (!previous) items.set(key,item);
    else for (const key of ['author','createdAt','updatedAt'] as const) previous[key] ??= item[key];
  });
  const warnings: string[] = [];
  if (!items.size) warnings.push(!malformed && (emptyNotice.test($.root().text()) || $('.article-list,.ubboard_list,table').length) ? 'NO_ANNOUNCEMENTS_FOUND' : 'ANNOUNCEMENT_STRUCTURE_UNRECOGNIZED');
  else if (malformed) warnings.push('ANNOUNCEMENT_FIELDS_MISSING');
  let nextPage: number | undefined;
  $('a[href]').each((_,element)=>{
    const a = $(element), url = localUrl(a.attr('href') || '');
    if (url?.pathname !== '/mod/ubboard/view.php' || url.searchParams.get('id') !== moduleId) return;
    const next = url.searchParams.get('page');
    if (next && /^\d+$/.test(next) && Number(next) === page+1) nextPage = Number(next);
  });
  return {items:[...items.values()],warnings,nextPage};
}

type ParsedAnnouncementDetail = Omit<AnnouncementDetail,'attachments'> & {attachments?:{name:string;url:string}[]};
export function parseAnnouncement(html: string, moduleId: string, articleId: string): {item?:ParsedAnnouncementDetail;warnings:string[]} {
  const $ = contentDocument(html);
  const root = $('.ubboard_view, article[data-articleid], article').first();
  const scope = root.length ? root : $('main, #region-main, [role="main"]').first();
  if (!scope.length) return {warnings:['ANNOUNCEMENT_STRUCTURE_UNRECOGNIZED']};
  const field = (selector:string) => {
    const el = scope.find(selector).first().clone();
    el.find('.title,.label').remove();
    return cleanText(el.text()) || undefined;
  };
  const title = cleanText(scope.find('.subject h3,.subject,h1,h2,[itemprop="headline"]').first().text());
  const body = scope.find('.content,.article-content,[itemprop="articleBody"]').first();
  if (!title) return {warnings:['ANNOUNCEMENT_STRUCTURE_UNRECOGNIZED']};
  const item: ParsedAnnouncementDetail = {id:articleId,moduleId,title,url:announcementUrl(moduleId,articleId),
    author:field('.writer,.author,[rel="author"]'),
    createdAt:normalizeDate(scope.find('time').first().attr('datetime') || field('.date,.created-at')),updatedAt:normalizeDate(field('.updated-at')),
    content:body.length ? contentText(body.html() || '') || undefined : undefined};
  const attachments: {name:string;url:string}[] = [];
  scope.find('.files a[href],.attachments a[href],a[download]').each((_,element)=>{
    const a = $(element), url = contentUrl(a.attr('href') || '',true), name = cleanText(a.text() || a.attr('download') || '');
    if (url && name && !attachments.some(file=>file.url===url)) attachments.push({name,url});
  });
  if (attachments.length) item.attachments = attachments;
  return {item,warnings:body.length ? [] : ['ANNOUNCEMENT_CONTENT_MISSING']};
}

export function announcementTime(value: string | undefined): number | undefined {
  if (!value) return;
  // Only order dates actually present; do not substitute "now" for missing dates.
  const parsed = Date.parse(normalizeDate(value) || '');
  return Number.isFinite(parsed) ? parsed : undefined;
}
